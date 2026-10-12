from ytm2spotify.matcher import initial_decision, match, score
from ytm2spotify.models import Item


def sp(kind, id, title, artists=(), **kw):
    return Item("spotify", kind, id, title, list(artists), uri=f"spotify:{kind}:{id}", **kw)


def yt(kind, title, artists=(), **kw):
    return Item("ytm", kind, "x", title, list(artists), **kw)


def fake_search(results):
    calls = []

    def search(q, kind):
        calls.append(q)
        return results

    search.calls = calls
    return search


def test_official_track_auto_matches():
    src = yt("track", "Blueming", ["IU"], album="Love poem", duration_s=217, video_type="MUSIC_VIDEO_TYPE_ATV")
    cand = sp("track", "1", "Blueming", ["IU"], album="Love poem", duration_s=217)
    r = match(src, [], fake_search([cand]))
    assert r.status == "auto"
    assert initial_decision(src, r) == "accept"


def test_cover_upload_becomes_substitute_not_auto():
    src = yt("track", "Post Malone - Circles (cover by Zior Park, Sion Jung)", ["주시현"], duration_s=237,
             video_type="MUSIC_VIDEO_TYPE_UGC")
    cand = sp("track", "1", "Circles", ["Post Malone"], duration_s=215)
    r = match(src, [], fake_search([cand]))
    assert r.status == "substitute" and r.variant == "cover"
    assert r.parsed_artist == "Post Malone"
    assert initial_decision(src, r) == "pending"


def test_reupload_of_original_needs_review_even_when_exact():
    src = yt("track", "Labi Siffre - My Song (Official HD Music Video)", ["DemonMusicGroup"], duration_s=261,
             video_type="MUSIC_VIDEO_TYPE_UGC")
    cand = sp("track", "1", "My Song", ["Labi Siffre"], duration_s=284)
    r = match(src, [], fake_search([cand]))
    assert r.status in ("auto", "review")
    assert initial_decision(src, r) == "pending"  # UGC is never auto-approved


def test_already_saved_skips_search():
    src = yt("album", "Palette", ["IU"], year=2017)
    lib = [sp("album", "a", "Palette", ["IU"], year=2017)]
    s = fake_search([])
    r = match(src, lib, s)
    assert r.status == "exists" and s.calls == []


def test_romanized_alias_album_is_found():
    src = yt("album", "모래내판타지 Moraenae Fantasy", ["구남과여라이딩스텔라 Goonam"], year=2009)
    cand = sp("album", "1", "Moraenae Fantasy", ["Goonamguayeoridingstella"], year=2009)
    r = match(src, [], fake_search([cand]))
    assert r.status in ("auto", "review")
    assert r.candidates[0].item.id == "1"


def test_nothing_found():
    src = yt("track", "한국힙합 대표곡 TOP300 (1989~2026)", ["MemoryMas"], video_type="MUSIC_VIDEO_TYPE_UGC")
    r = match(src, [], fake_search([sp("track", "1", "Totally Different", ["Someone"])]))
    assert r.status == "not_found"
    assert initial_decision(src, r) == "preserve"


def test_length_is_a_weaker_signal_for_videos():
    a = yt("track", "Song", ["A"], duration_s=200, video_type="MUSIC_VIDEO_TYPE_OMV")
    b = yt("track", "Song", ["A"], duration_s=200, video_type="MUSIC_VIDEO_TYPE_ATV")
    cand = sp("track", "1", "Song", ["A"], duration_s=225)
    assert score(a, cand).score > score(b, cand).score


def test_compilation_upload_is_kept_without_searching():
    src = yt("track", "[Full Album] 유령서점 (Ghost Bookstore) - 유령서점 (Ghost Bookstore) / 앨범 전곡 듣기", ["POCLANOS"],
             video_type="MUSIC_VIDEO_TYPE_UGC")
    s = fake_search([sp("track", "1", "Ghost Bookstore", ["Ghost Bookstore"])])
    r = match(src, [], s)
    assert r.status == "not_found" and s.calls == []
