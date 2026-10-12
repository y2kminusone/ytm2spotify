"""The migration steps (DESIGN §3): sync → match → (review in the UI) → apply → preserve."""

from __future__ import annotations

import csv
import io
import sys
import time
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed

from .adapters.spotify import QuotaExceeded, SpotifyAdapter, to_item
from .adapters.ytmusic import YTMusicAdapter
from .matcher import MATCHER_VERSION, initial_decision, match
from .models import Item
from .store import Store

PRESERVE_PLAYLIST = "ytm2spotify – couldn't move"


def _progress(label: str, done: int, total: int, started: float) -> None:
    rate = done / max(time.time() - started, 1e-6)
    eta = (total - done) / rate if rate else 0
    sys.stdout.write(f"\r  {label}: {done}/{total}  ({rate:.1f}/s, ~{eta / 60:.0f} min left)   ")
    sys.stdout.flush()


def sync(store: Store, ytm: YTMusicAdapter, sp: SpotifyAdapter) -> dict:
    report = {}
    ytm.check()  # fail before touching the store if the session died (otherwise everything looks "removed")
    albums, artists = ytm.albums(), ytm.artists()
    tracks, listed_count = ytm.liked_tracks()
    report["ytm"] = store.sync_items("ytm", albums + artists + tracks)
    report["ytm_counts"] = {"album": len(albums), "artist": len(artists), "track": len(tracks)}
    # liked playlist counts deleted/private videos it will never list (Spike R3)
    store.set_meta("ytm_unavailable_tracks", max(listed_count - len(tracks), 0))

    sp_items = sp.albums() + sp.artists() + sp.tracks()
    report["spotify"] = store.sync_items("spotify", sp_items)
    report["spotify_counts"] = {k: sum(1 for i in sp_items if i.kind == k) for k in ("album", "artist", "track")}
    store.set_meta("last_sync", time.time())
    return report


def match_all(store: Store, sp: SpotifyAdapter, workers: int = 4) -> dict:
    library = {k: store.items("spotify", k) for k in ("album", "artist", "track")}
    keys = store.unmatched_keys(MATCHER_VERSION)
    calls = {"api": 0, "cached": 0}

    def search(q: str, kind: str) -> list[Item]:
        ck = f"{kind}|{sp.market}|{q}"
        raw = store.cached(ck)
        if raw is None:
            raw = sp.search_raw(q, kind)
            store.cache(ck, raw)
            calls["api"] += 1
        else:
            calls["cached"] += 1
        return [to_item(kind, o) for o in raw if o]

    def one(key: str) -> str:
        src = store.item(key)
        r = match(src, library[src.kind], search)
        store.save_match(key, r.status, [c.to_dict() for c in r.candidates], r.variant, r.parsed_artist,
                         MATCHER_VERSION, initial_decision(src, r))
        return r.status

    counts: dict[str, int] = {}
    errors: list[str] = []
    quota: QuotaExceeded | None = None
    started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, k): k for k in keys}
        for i, f in enumerate(as_completed(futures), 1):
            try:
                st = f.result()
                counts[st] = counts.get(st, 0) + 1
            except CancelledError:
                continue
            except QuotaExceeded as e:
                quota = e
                for other in futures:
                    other.cancel()  # remaining items stay unmatched; the next run resumes them
            except Exception as e:  # keep going; failed items stay unmatched and are retried next run
                errors.append(f"{futures[f]}: {e}")
            if i % 5 == 0 or i == len(keys):
                _progress("matching", i, len(keys), started)
    print()
    if quota:
        store.set_meta("search_quota_reset_at", quota.reset_at)
    left = len(store.unmatched_keys(MATCHER_VERSION))
    return {"matched": sum(counts.values()), "left": left, "by_status": counts, "quota_stop": str(quota) if quota else None,
            "errors": errors[:10], "error_count": len(errors), "calls": calls}


def apply(store: Store, sp: SpotifyAdapter, kinds: list[str] | None = None, limit: int | None = None) -> dict:
    """Save every approved, not-yet-applied match. Idempotent and resumable (DESIGN §2.2)."""
    todo = [r for r in store.records()
            if r["decision"] == "accept" and r["apply_status"] != "done" and r["cands"]
            and (not kinds or r["kind"] in kinds)]
    if limit:
        todo = todo[:limit]
    by_uri = {}
    for r in todo:
        c = r["cands"][min(r["chosen"], len(r["cands"]) - 1)]
        by_uri.setdefault(c["item"]["uri"], []).append(r["key"])
    ok = failed = 0
    for batch, err in sp.save(list(by_uri)):
        for uri in batch:
            for key in by_uri[uri]:
                store.mark_applied(key, err is None, uri, err)
                ok, failed = (ok + 1, failed) if err is None else (ok, failed + 1)
    return {"saved": ok, "failed": failed}


def preserved_tracks(store: Store) -> list[dict]:
    return [r for r in store.records() if r["decision"] == "preserve"]


def preserve(store: Store, ytm: YTMusicAdapter) -> dict:
    """Collect 'keep' tracks into a private YT Music playlist so nothing is lost."""
    recs = [r for r in preserved_tracks(store) if r["kind"] == "track"]
    if not recs:
        return {"playlist": None, "tracks": 0}
    pid = ytm.create_playlist(PRESERVE_PLAYLIST, "Liked songs ytm2spotify couldn't find on Spotify.",
                              [r["src"]["id"] for r in recs])
    store.set_meta("preserve_playlist", pid)
    return {"playlist": pid, "tracks": len(recs)}


def preserved_csv(store: Store) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["kind", "title", "artists", "youtube_music_url"])
    for r in preserved_tracks(store):
        s = r["src"]
        url = (f"https://music.youtube.com/watch?v={s['id']}" if r["kind"] == "track"
               else f"https://music.youtube.com/browse/{s['id']}")
        w.writerow([r["kind"], s["title"], ", ".join(s.get("artists") or []), url])
    return buf.getvalue()


def undo(store: Store, sp: SpotifyAdapter) -> int:
    uris = [u for u in store.applied_uris() if u]
    sp.remove(uris)
    return len(uris)
