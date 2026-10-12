"""Text handling for matching: normalization, aliases, noise/variant detection, title parsing.

Spike R4 findings drive this module:
- "서울전자음악단" vs "서울 전자 음악단"  → compare without spaces/punctuation
- "희대의 (HEEDAE)", "구남과여라이딩스텔라 Goonam" → a name can carry a second-script alias
- "Circles (cover by …)" matched the original at 1.00 → detect variants on the *raw* title
  before any brackets are stripped
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Bracketed parts that only describe the upload, never the song.
NOISE = re.compile(
    r"official|music\s*video|\bm/?v\b|lyric|가사|audio|visualizer|\bhd\b|\b4k\b|\bvideo\b|\bfull\s*ver|"
    r"\bprod\b|\bfeat\b|\bft\b|자막|sub(title)?s?|\d{4}|remaster",
    re.I,
)

# Words that mean "not the studio recording". Order matters: first hit names the variant.
VARIANTS: list[tuple[str, re.Pattern]] = [
    ("cover", re.compile(r"\bcover\b|커버|\bcovered by\b", re.I)),
    ("remix", re.compile(r"remix|리믹스|\bflip\b|bootleg|mashup|\bedit\)", re.I)),
    ("live", re.compile(r"\blive\b|라이브|직캠|fancam|무대|stage|concert|콘서트|session|in studio|본선|방송", re.I)),
    ("speed", re.compile(r"sped\s*up|slowed|nightcore|reverb", re.I)),
    ("version", re.compile(r"\bver\.?\b|version|acoustic|\binst(rumental)?\b|어쿠스틱", re.I)),
]

BRACKETS = re.compile(r"[\(\[\{【（](.*?)[\)\]\}】）]")
SEPARATORS = re.compile(r"\s+[-–—|]\s+")
_KEEP = re.compile(r"[^\w]+", re.UNICODE)


def norm(s: str | None) -> str:
    """NFKC, lowercase, drop spaces/punctuation. Keeps letters of every script and digits."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).lower()
    # drop accents on Latin letters (CRÈME = CREME) without touching Hangul/Kana syllables
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    s = unicodedata.normalize("NFC", s)
    s = s.replace("&", "and")
    return _KEEP.sub("", s).replace("_", "")


def _script(ch: str) -> str:
    if "가" <= ch <= "힣" or "㄰" <= ch <= "㆏":
        return "hangul"
    if "぀" <= ch <= "ヿ":
        return "kana"
    if "一" <= ch <= "鿿":
        return "han"
    if ch.isalpha():
        return "latin"
    return "other"


def aliases(name: str | None) -> set[str]:
    """All normalized spellings a name may go by.

    "희대의 (HEEDAE)"                → {희대의heedae, 희대의, heedae}
    "구남과여라이딩스텔라 Goonam"     → {…, 구남과여라이딩스텔라, goonam}
    "JENNIE (제니)"                  → {jennie제니, jennie, 제니}
    """
    if not name:
        return set()
    out = {norm(name)}
    inner = BRACKETS.findall(name)
    outer = BRACKETS.sub(" ", name)
    for part in [outer, *inner]:
        if norm(part):
            out.add(norm(part))
    # split runs of different scripts: "모래내판타지 Moraenae Fantasy" → hangul run + latin run
    runs: list[list[str]] = []
    for word in re.split(r"\s+", outer.strip()):
        if not word:
            continue
        sc = {_script(c) for c in word if c.isalpha()} or {"other"}
        tag = sc.pop() if len(sc) == 1 else "mixed"
        if runs and runs[-1][0] == tag:
            runs[-1][1] += " " + word
        else:
            runs.append([tag, word])
    if len(runs) > 1:
        for _, text in runs:
            if len(norm(text)) >= 2:
                out.add(norm(text))
    return {a for a in out if a}


def similarity(a: str | None, b: str | None) -> float:
    """Best similarity across both names' aliases, 0..1."""
    best = 0.0
    for x in aliases(a):
        for y in aliases(b):
            if x == y:
                return 1.0
            r = SequenceMatcher(None, x, y).ratio()
            if min(len(x), len(y)) >= 4 and (x in y or y in x):
                r = max(r, 0.9)
            best = max(best, r)
    return best


def variant_of(raw_title: str) -> str | None:
    """Which non-studio variant a raw title describes, if any. Looks at brackets and the tail."""
    probes = BRACKETS.findall(raw_title)
    # "Song - Live at X" / "Song (Live)" / "[SMTM12] …" — check the bracket contents and the whole string
    for text in [*probes, raw_title]:
        for name, pat in VARIANTS:
            if pat.search(text):
                return name
    return None


def clean_title(title: str) -> str:
    """Drop bracketed noise and variant markers, for searching and comparing."""
    def repl(m: re.Match) -> str:
        inner = m.group(1)
        if NOISE.search(inner) or any(p.search(inner) for _, p in VARIANTS):
            return " "
        return m.group(0)

    t = BRACKETS.sub(repl, title)
    t = re.sub(r"\s+(feat\.?|ft\.?)\s.*$", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip(" -–|")


def parse_upload_title(title: str) -> tuple[str | None, str]:
    """User uploads usually look like "Artist - Song (noise)". Returns (artist or None, song)."""
    t = BRACKETS.sub(lambda m: " " if NOISE.search(m.group(1)) else m.group(0), title)
    t = re.sub(r"^\s*\[[^\]]*\]\s*", "", t)  # leading "[온스테이지2.0]"
    parts = SEPARATORS.split(t, maxsplit=1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[0].strip(), clean_title(parts[1])
    return None, clean_title(t)
