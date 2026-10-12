"""Build src/sample.json for the design prototype from the spike dumps + live Spotify search (thumbnails only)."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]  # spikes/
sys.path.insert(0, str(ROOT))
from spotify_probe import call  # noqa: E402

OUT = ROOT / "output"
albums = json.load(open(OUT / "ytm_albums.json"))
artists = json.load(open(OUT / "ytm_artists.json"))
liked = json.load(open(OUT / "ytm_liked.json"))

def thumb(ts):
    ts = ts or []
    return ts[-1]["url"] if ts else None

def ytm(pool, key, needle):
    for x in pool:
        if needle.lower() in (x.get(key) or "").lower():
            return x
    raise SystemExit(f"not found in ytm: {needle}")

def sp(kind, q, pick=0):
    r = call("GET", "/search", params={"q": q, "type": kind, "limit": 5, "market": "KR"})
    items = r.json()[kind + "s"]["items"]
    it = items[pick]
    img = (it.get("images") or it.get("album", {}).get("images") or [{}])
    return {
        "title": it["name"],
        "artists": ", ".join(a["name"] for a in it.get("artists", [])),
        "img": img[0].get("url") if img else None,
        "year": (it.get("release_date") or it.get("album", {}).get("release_date") or "")[:4],
        "tracks": it.get("total_tracks"),
        "dur": round(it["duration_ms"] / 1000) if it.get("duration_ms") else None,
        "album": it.get("album", {}).get("name"),
    }

def mmss(s):
    return f"{s // 60}:{s % 60:02d}" if s else ""

S = []
def add(kind, src, status, cands):
    S.append({"kind": kind, "src": src, "status": status, "cands": cands})

def album_src(needle):
    a = ytm(albums, "title", needle)
    return {"title": a["title"], "artists": ", ".join(x["name"] for x in a.get("artists") or []),
            "meta": " · ".join(filter(None, [a.get("year"), a.get("type")])), "img": thumb(a.get("thumbnails"))}

def cand(c, score, why, meta=None):
    return {**c, "score": score, "why": why, "meta": meta or " · ".join(filter(None, [c.get("year"), f'{c["tracks"]}곡' if c.get("tracks") else None]))}

# ---- albums (only ones that exist in the user's library)
for needle, q, status, score, why in [
    ("모래내판타지", "Moraenae Fantasy", "review", 0.84, [["별칭으로 일치", "ok"], ["아티스트 로마자 표기", "warn"], ["트랙 수 일치", "ok"]]),
    ("사랑하는 사람들을 위한 지침서", "BIBI 사랑하는 사람들을 위한 지침서", "auto", 0.97, [["앨범명 일치", "ok"], ["아티스트 일치", "ok"], ["연도 일치", "ok"]]),
    ("탕아", "Bassagong TANG-A", "exists", 1.0, [["이미 내 Spotify에 있음", "ok"]]),
]:
    try:
        add("album", album_src(needle), status, [cand(sp("album", q), score, why)])
    except Exception as e:
        print("skip", needle, e)
for a in albums[:40]:
    if len([s for s in S if s["kind"] == "album"]) >= 7:
        break
    if any(s["src"]["title"] == a["title"] for s in S):
        continue
    artist = ", ".join(x["name"] for x in a.get("artists") or [])
    try:
        c = sp("album", f'album:{a["title"]} artist:{artist.split(",")[0]}')
    except Exception:
        continue
    add("album", album_src(a["title"]), "auto", [cand(c, 0.98, [["앨범명 일치", "ok"], ["아티스트 일치", "ok"], ["연도 일치", "ok"]])])

# ---- artists
for a in artists[:5]:
    c = sp("artist", a["artist"])
    add("artist", {"title": a["artist"], "artists": "", "meta": "구독 중", "img": thumb(a.get("thumbnails"))},
        "auto" if c["title"].lower() == a["artist"].lower() else "review",
        [cand(c, 0.99 if c["title"].lower() == a["artist"].lower() else 0.86,
              [["이름 일치", "ok"], ["검색 1위", "ok"]] if c["title"].lower() == a["artist"].lower() else [["별칭 일치", "ok"]], meta="아티스트")])

# ---- liked tracks
def track_src(needle):
    t = ytm(liked, "title", needle)
    return {"title": t["title"], "artists": ", ".join(x["name"] for x in t.get("artists") or []),
            "meta": " · ".join(filter(None, [(t.get("album") or {}).get("name"), t.get("duration")])),
            "img": thumb(t.get("thumbnails")), "vt": (t.get("videoType") or "").replace("MUSIC_VIDEO_TYPE_", "")}

atv = [t for t in liked if t.get("videoType") == "MUSIC_VIDEO_TYPE_ATV" and t.get("album")][:3]
for t in atv:
    c = sp("track", f'track:{t["title"]} artist:{t["artists"][0]["name"]}')
    add("track", track_src(t["title"]), "auto", [cand(c, 0.99, [["곡명 일치", "ok"], ["앨범 일치", "ok"], ["길이 1초 차", "ok"]], meta=" · ".join(filter(None, [c["title"] and None, mmss(c["dur"])])) or None)])

for needle, q, status, score, why in [
    ("Labi Siffre - My Song", "track:My Song artist:Labi Siffre", "review", 0.97, [["제목에서 아티스트 추출", "ok"], ["길이 3초 차", "ok"], ["사용자 업로드라 확인 필요", "warn"]]),
    ("Circles (cover", "track:Circles artist:Post Malone", "substitute", 0.96, [["커버곡", "warn"], ["원곡으로 대체", "warn"]]),
    ("MANTRA (CRAZY", "track:Mantra artist:JENNIE", "substitute", 0.95, [["다른 버전 (CRAZY ver.)", "warn"], ["길이 33초 차", "bad"]]),
    ("Moonwalkin' (ANIME REMIX)", "track:Moonwalkin' artist:LNGSHOT", "substitute", 0.93, [["리믹스", "warn"]]),
    ("AH AH feat. Sik-K (ANIME REMIX)", "NOWIMYOUNG AH AH", "substitute", 0.92, [["리믹스", "warn"]]),
]:
    try:
        add("track", {**track_src(needle), "group": "ANIME REMIX" if "ANIME" in needle else None}, status, [cand(sp("track", q), score, why, meta="")])
    except Exception as e:
        print("skip", needle, e)
for needle in ["잡아가세요 (ANIME REMIX)", "한국힙합 대표곡 TOP300"]:
    try:
        add("track", {**track_src(needle), "group": "ANIME REMIX" if "ANIME" in needle else None}, "not_found", [])
    except SystemExit as e:
        print(e)

for s in S:
    for c in s["cands"]:
        if s["kind"] == "track":
            c["meta"] = " · ".join(filter(None, [c.get("album"), mmss(c.get("dur"))]))
        elif not c.get("meta"):
            c["meta"] = " · ".join(filter(None, [c.get("year"), mmss(c.get("dur"))]))
# length reasons are computed from real durations, never hand-written
def secs(meta):
    for part in reversed(meta.split(" · ")):
        bits = part.split(":")
        if len(bits) in (2, 3) and all(b.isdigit() for b in bits):
            n = 0
            for b in bits:
                n = n * 60 + int(b)
            return n
    return None
for s in S:
    if s["kind"] != "track":
        continue
    a = secs(s["src"]["meta"])
    for c in s["cands"]:
        c["why"] = [w for w in c["why"] if not w[0].startswith("길이")]
        if a is not None and c.get("dur"):
            diff = abs(a - c["dur"])
            c["why"].append([f"길이 {diff}초 차", "ok" if diff <= 3 else "warn" if diff <= 10 else "bad"])
dst = Path(__file__).resolve().parents[1] / "src" / "sample.json"
dst.write_text(json.dumps({"totals": {"album": len(albums), "artist": len(artists), "track": len({t['videoId'] for t in liked})}, "items": S}, ensure_ascii=False, indent=1))
print("wrote", dst, len(S), "items")
