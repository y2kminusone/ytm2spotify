# M0 Spike 결과 리포트

> 진행 중 · 시작 2026-10-12 · 대응: PRD §8

| # | 가정 | 결과 | 비고 |
|---|---|---|---|
| R0 | 사용자가 Spotify 개발자 앱을 만들 수 있다 | ⚠️ 조건부 성공 | 아래 참고 |
| R1 | `PUT /me/library`로 아티스트 팔로우 | ✅ 성공 | 레퍼런스 문서와 달리 artist URI 동작 |
| R2 | PKCE + `127.0.0.1` 리디렉트 인증 | ✅ 성공 | `market=from_token` 함정 있음 |
| R3 | YTM 보관함 전체 페이지네이션 | ⏳ | |
| R4 | 좋아요 곡 videoType 분포 / UGC 매칭률 | ⏳ | |
| R5 | 검색 limit 10으로 충분 | ✅ limit 확인 / 충분성은 R4와 함께 | 11 이상은 HTTP 400 |

## R0. Spotify 개발자 앱 생성 (새로 발견한 리스크)

- **현상:** Premium 계정인데도 Dashboard에 **Create app 버튼이 표시되지 않는다.** "You haven't created any apps yet" 문구만 보인다. (2026-10-12 확인)
- **우회:** `https://developer.spotify.com/dashboard/create`로 직접 접속하면 앱 생성 폼이 열리고, 생성도 정상 동작한다.
- **참고:** 2026-08 Spotify Community에 같은 증상 보고가 있으나 공식 답변은 없다. 2026-03 이후 Premium 계정당 Development 모드 앱은 1개로 제한된다는 답변도 있다.
- **제품 영향:**
  - 설정 마법사 1단계에 "Premium 필요"를 명시한다.
  - 앱 생성 링크는 Dashboard가 아니라 **`/dashboard/create`로 직접 연결**한다.
  - 문제 해결 가이드에 "버튼이 안 보여요" 항목을 추가한다.
  - 사용자가 이미 다른 앱을 갖고 있으면 새로 만들지 말고 **기존 앱의 Client ID를 재사용**하도록 안내한다(1개 제한). Redirect URI만 추가하면 된다.

## R1. 아티스트 팔로우 (`PUT /me/library`)

- 레퍼런스 문서의 지원 URI 목록에는 `spotify:artist:`가 없지만, 변경 로그는 "Follow Artists → `PUT /me/library` 사용"이라고 안내한다. 실제로는 **동작한다.**
- 테스트(2026-10-12, 대상 NewJeans `spotify:artist:6HvZYsbFfjnjFrWF950C9d`):
  - `GET /me/library/contains` → `[false]`
  - `PUT /me/library?uris=…` (쿼리스트링) → 200
  - `contains` → `[true]`, `GET /me/following` 목록에도 노출
  - `DELETE /me/library?uris=…` → 200, `contains` → `[false]` (원상복구)
- **결론:** 저장과 팔로우 모두 `uris`를 **쿼리스트링**으로 보낸다(최대 40개). 문서와 실제가 다르므로, 통합 테스트로 회귀를 감시할 가치가 있다.

## R2. 인증

- PKCE(Client Secret 없음), Redirect `http://127.0.0.1:8765/callback`, scope 4종(`user-library-read/modify`, `user-follow-read/modify`) 모두 정상이다.
- 읽기: `GET /me/albums`, `GET /me/following?type=artist`, `GET /me/tracks` 정상 (테스트 계정: 앨범 18 / 아티스트 17 / 곡 43).
- **함정:** 검색에 `market=from_token`을 쓰면 **403 Insufficient client scope**가 난다(추가 scope가 필요한 것으로 추정). → `market=KR`처럼 **국가 코드를 명시**한다. 국가는 설정에서 고를 수 있게 한다.

## R5. 검색

- `limit` 최대 10, 11 이상은 400.
- 검색 결과의 **track에는 `external_ids.isrc`가 있다** → 곡 매칭에 ISRC를 쓸 수 있다.
- 검색 결과의 **album에는 `external_ids`(UPC)가 없다.** `GET /albums/{id}`로 개별 조회해야 하며, 배치 조회(`GET /albums`)는 폐지됐다. → 앨범 매칭은 이름/아티스트/연도/트랙 수 기반으로 하고, UPC는 쓰지 않는다.
- album 객체에서 `label`, `popularity`가 사라졌다. `release_date`, `total_tracks`는 남아 있다.
