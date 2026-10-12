from ytm2spotify.normalize import aliases, clean_title, norm, parse_upload_title, similarity, variant_of


def test_norm_ignores_spaces_and_case():
    assert norm("서울전자음악단") == norm("서울 전자 음악단")
    assert norm("PinkPantheress") == norm("pinkpantheress")


def test_aliases_split_brackets_and_scripts():
    assert {"희대의", "heedae"} <= aliases("희대의 (HEEDAE)")
    assert {"jennie", "제니"} <= aliases("JENNIE (제니)")
    assert "goonam" in aliases("구남과여라이딩스텔라 Goonam")


def test_similarity_uses_aliases():
    assert similarity("희대의 (HEEDAE)", "HEEDAE") == 1.0
    assert similarity("모래내판타지 Moraenae Fantasy", "Moraenae Fantasy") == 1.0
    assert similarity("Circles", "Sunflower") < 0.5


def test_variants_are_found_on_raw_titles():
    # Spike R4 false positives: these must not look like the studio track
    assert variant_of("Post Malone - Circles (cover by Zior Park, Sion Jung)") == "cover"
    assert variant_of("JENNIE (제니) - MANTRA (CRAZY ver.)") == "version"
    assert variant_of("LNGSHOT – Moonwalkin' (ANIME REMIX)") == "remix"
    assert variant_of("[Live] 윤다혜 | 260502 한대음 페스티벌") == "live"
    assert variant_of("Labi Siffre - My Song (Official HD Music Video)") is None
    assert variant_of("Blueming") is None


def test_clean_title_drops_noise_and_variant_brackets():
    assert clean_title("My Song (Official HD Music Video)") == "My Song"
    assert clean_title("Moonwalkin' (ANIME REMIX)") == "Moonwalkin'"
    assert clean_title("Spring Water (feat. KWON KI BAEK)") == "Spring Water"


def test_parse_upload_title():
    assert parse_upload_title("Labi Siffre - My Song (Official HD Music Video)") == ("Labi Siffre", "My Song")
    assert parse_upload_title("[온스테이지2.0] 백현진 - 모과(Unreleased)") == ("백현진", "모과(Unreleased)")
    assert parse_upload_title("한국힙합 대표곡 TOP300 (1989~2026)")[0] is None
