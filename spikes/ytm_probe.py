"""Spike R3/R4: can we read the whole YT Music library, and what is liked songs made of?

Throwaway code. Usage:
    1. Paste your browser request headers into spikes/output/ytm_headers.txt
    2. python spikes/ytm_probe.py setup
    3. python spikes/ytm_probe.py probe
"""

import json
import sys
import time
from collections import Counter
from pathlib import Path

from ytmusicapi import YTMusic, setup

OUT = Path(__file__).parent / "output"
OUT.mkdir(exist_ok=True)
HEADERS_TXT = OUT / "ytm_headers.txt"
AUTH_FILE = OUT / "ytm_browser.local.json"


def cmd_setup() -> None:
    if not HEADERS_TXT.exists():
        sys.exit(f"Paste request headers into {HEADERS_TXT} first.")
    setup(filepath=str(AUTH_FILE), headers_raw=HEADERS_TXT.read_text(encoding="utf-8"))
    HEADERS_TXT.unlink()  # don't leave raw cookies lying around
    print(f"OK: saved auth to {AUTH_FILE.name} (raw headers file deleted)")


def timed(label, fn):
    t = time.perf_counter()
    result = fn()
    print(f"  {label}: {time.perf_counter() - t:.1f}s")
    return result


def cmd_probe() -> None:
    yt = YTMusic(str(AUTH_FILE))
    print("Fetching (limit=None, full pagination)...")
    albums = timed("albums", lambda: yt.get_library_albums(limit=None))
    artists = timed("subscriptions", lambda: yt.get_library_subscriptions(limit=None))
    liked = timed("liked songs", lambda: yt.get_liked_songs(limit=None))
    tracks = liked.get("tracks", [])

    for name, data in [("albums", albums), ("artists", artists), ("liked", tracks)]:
        (OUT / f"ytm_{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n== R3: counts (compare with the numbers shown in the YT Music app)")
    print(f"  library albums      : {len(albums)}")
    print(f"  subscribed artists  : {len(artists)}  (types: {dict(Counter(a.get('type') for a in artists))})")
    print(f"  liked songs         : {len(tracks)}  (playlist reports trackCount={liked.get('trackCount')})")

    print("\n== R4: liked songs by videoType")
    vt = Counter(t.get("videoType") or "None" for t in tracks)
    for k, n in vt.most_common():
        print(f"  {k:<32} {n:>5}  ({n / max(len(tracks), 1):.0%})")
    print(f"  unavailable (greyed out): {sum(not t.get('isAvailable', True) for t in tracks)}")
    print(f"  with album info         : {sum(bool(t.get('album')) for t in tracks)}")

    ugc = [t for t in tracks if t.get("videoType") == "MUSIC_VIDEO_TYPE_UGC"]
    lines = [f"{t['title']}  ||  {', '.join(a['name'] for a in t.get('artists') or [])}" for t in ugc]
    (OUT / "ugc_samples.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWrote {len(ugc)} UGC titles to output/ugc_samples.txt; raw dumps to output/ytm_*.json")


if __name__ == "__main__":
    {"setup": cmd_setup, "probe": cmd_probe}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
