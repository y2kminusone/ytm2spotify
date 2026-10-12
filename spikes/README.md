# Spikes (M0)

PRD §8의 가정(R1–R5)을 실제 계정으로 검증하기 위한 **일회성 코드**다. 제품 코드에 쓰지 않는다.
결과는 `docs/spikes/m0-report.md`에 정리한다.

- `ytm_probe.py` — R3(전체 페이지네이션), R4(좋아요 곡 videoType 분포, UGC 샘플)
- `spotify_probe.py` — R1(`PUT /me/library`로 아티스트 팔로우), R2(PKCE 인증), R5(검색 limit)

`output/`은 인증 정보와 개인 보관함 덤프가 들어가므로 git에서 제외된다.
