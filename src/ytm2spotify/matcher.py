"""Match one YT Music item to Spotify candidates (DESIGN §4).

Pipeline per item:  ① already in Spotify?  ② classify  ③ build queries  ④ score  ⑤ decide status
The matcher only produces machine judgments; human decisions live in the store and are never
overwritten here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .models import Item
from .normalize import COMPILATION, clean_title, parse_upload_title, similarity, variant_of

MATCHER_VERSION = 2  # 2: compilations skip search; accents ignored
T_AUTO = 0.90    # auto-approve at or above (conservative default, DESIGN §4.3)
T_REVIEW = 0.60  # below this: not found
OFFICIAL = {"MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC"}
VIDEO = {"MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_UGC"}

Reason = list  # [code, "ok"|"warn"|"bad", param?]  — language-neutral (ADR-003)


@dataclass
class Scored:
    item: Item
    score: float
    why: list[Reason] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"item": self.item.to_dict(), "score": round(self.score, 3), "why": self.why}


@dataclass
class Result:
    status: str  # exists | auto | review | substitute | not_found
    candidates: list[Scored]
    variant: str | None = None
    parsed_artist: str | None = None


def _weighted(parts: list[tuple[float, float | None]]) -> float:
    """Weighted mean that ignores missing signals (None) and renormalizes."""
    num = sum(w * v for w, v in parts if v is not None)
    den = sum(w for w, v in parts if v is not None)
    return num / den if den else 0.0


def _best_artist(src: list[str], cand: list[str]) -> float:
    if not src or not cand:
        return 0.0
    return max(similarity(a, b) for a in src for b in cand)


def score(src: Item, cand: Item, *, title: str | None = None, artists: list[str] | None = None) -> Scored:
    """Score cand against src. `title`/`artists` override the source's (e.g. parsed from an upload title)."""
    why: list[Reason] = []
    s_title = title if title is not None else src.title
    s_artists = artists if artists is not None else src.artists

    if src.kind == "artist":
        sim = similarity(src.title, cand.title)
        why.append(["name_match", "ok"] if sim >= 0.95 else ["alias_match", "warn"] if sim >= 0.8 else ["name_differs", "bad"])
        return Scored(cand, sim, why)

    t = similarity(clean_title(s_title), clean_title(cand.title))
    a = _best_artist(s_artists, cand.artists)
    if t >= 0.95:
        why.append(["title_match", "ok"])
    elif t < 0.8:
        why.append(["title_differs", "bad"])
    if a >= 0.95:
        why.append(["artist_match", "ok"])
    elif a >= 0.8:
        why.append(["alias_match", "ok"])
    else:
        why.append(["artist_differs", "bad" if a < 0.6 else "warn"])

    if src.kind == "album":
        y = None
        if src.year and cand.year:
            gap = abs(src.year - cand.year)
            y = 1.0 if gap == 0 else 0.5 if gap == 1 else 0.0
            why.append(["year_match", "ok"] if gap == 0 else ["year_differs", "warn", cand.year])
        return Scored(cand, _weighted([(0.55, t), (0.35, a), (0.10, y)]), why)

    # tracks
    al = similarity(src.album, cand.album) if src.album and cand.album else None
    if al is not None and al >= 0.9:
        why.append(["album_match", "ok"])
    d = None
    if src.duration_s and cand.duration_s:
        diff = abs(src.duration_s - cand.duration_s)
        is_video = src.video_type in VIDEO
        # music videos often carry intros/outros: weaker signal for videos (DESIGN §4.2 note)
        d = 1.0 if diff <= 3 else 0.7 if diff <= 10 else (0.5 if is_video else 0.15) if diff <= 40 else (0.3 if is_video else 0.0)
        level = "ok" if diff <= 3 else "warn" if diff <= 10 or (is_video and diff <= 40) else "bad"
        why.append(["length_diff", level, diff])
    return Scored(cand, _weighted([(0.45, t), (0.30, a), (0.10, al), (0.15, d)]), why)


def _dedupe(items: list[Item]) -> list[Item]:
    seen, out = set(), []
    for it in items:
        if it.id not in seen:
            seen.add(it.id)
            out.append(it)
    return out


def queries(src: Item, title: str, artists: list[str]) -> list[str]:
    """Search strings, most specific first (DESIGN §4.1 ③)."""
    main_artist = artists[0] if artists else ""
    if src.kind == "artist":
        names = [src.title, *sorted(_alt_spellings(src.title))]
        return list(dict.fromkeys(n for n in names if n))
    field = "album" if src.kind == "album" else "track"
    t = clean_title(title)
    qs = [f'{field}:"{t}" artist:"{main_artist}"' if main_artist else f'{field}:"{t}"', f"{t} {main_artist}".strip()]
    for alt in _alt_spellings(t):
        qs.append(f"{alt} {main_artist}".strip())
    return list(dict.fromkeys(qs))


def _alt_spellings(name: str) -> set[str]:
    """Human-readable alternate spellings for search ('희대의 (HEEDAE)' → {'희대의', 'HEEDAE'})."""
    import re
    from .normalize import BRACKETS
    out = set()
    inner = BRACKETS.findall(name)
    outer = BRACKETS.sub(" ", name).strip()
    for p in [outer, *inner]:
        p = re.sub(r"\s+", " ", p).strip()
        if p and p != name:
            out.add(p)
    return out


def match(
    src: Item,
    library: list[Item],
    search: Callable[[str, str], list[Item]],
    keep: int = 5,
) -> Result:
    """Match one YT Music item. `search(query, kind)` returns Spotify items (cached by the caller)."""
    title, artists, parsed_artist = src.title, src.artists, None
    variant = variant_of(src.title) if src.kind == "track" else None

    # compilations ("[Full Album] …", "TOP300", DJ mixes) can't map to one track: keep them, spend no searches
    if src.kind == "track" and src.video_type not in OFFICIAL and COMPILATION.search(src.title):
        return Result("not_found", [], "compilation", None)

    # ② classify: user uploads are "Artist - Song (noise)" under an uploader's channel name
    if src.kind == "track" and src.video_type not in OFFICIAL:
        p_artist, p_title = parse_upload_title(src.title)
        if p_artist and src.video_type == "MUSIC_VIDEO_TYPE_UGC":
            parsed_artist, title, artists = p_artist, p_title, [p_artist]
        else:
            title = p_title

    # ① already in the user's Spotify library? (local, no API calls)
    if library:
        best = max((score(src, lib, title=title, artists=artists) for lib in library), key=lambda s: s.score)
        if best.score >= T_AUTO and not variant:
            best.why = [["already_saved", "ok"], *best.why]
            return Result("exists", [best], None, parsed_artist)

    # ③ search, ④ score
    found: list[Item] = []
    for q in queries(src, title, artists):
        found = _dedupe(found + search(q, src.kind))
        if found and max(score(src, f, title=title, artists=artists).score for f in found) >= T_AUTO:
            break
    scored = sorted((score(src, f, title=title, artists=artists) for f in found), key=lambda s: -s.score)[:keep]
    if src.kind == "artist" and scored:
        scored[0].why.append(["top_result", "ok"])
    if parsed_artist and scored:
        scored[0].why.insert(0, ["artist_from_title", "ok"])

    # ⑤ status
    top = scored[0].score if scored else 0.0
    if not scored or top < T_REVIEW:
        return Result("not_found", scored, variant, parsed_artist)
    if variant:
        scored[0].why.insert(0, [f"variant:{variant}", "warn"])
        return Result("substitute", scored, variant, parsed_artist)
    if top >= T_AUTO:
        return Result("auto", scored, None, parsed_artist)
    return Result("review", scored, None, parsed_artist)


def initial_decision(src: Item, result: Result) -> str:
    """Default human decision (DESIGN §2.2). User uploads are never auto-approved (Spike R4)."""
    if result.status == "auto":
        return "pending" if src.video_type == "MUSIC_VIDEO_TYPE_UGC" else "accept"
    return {"exists": "skip", "not_found": "preserve"}.get(result.status, "pending")
