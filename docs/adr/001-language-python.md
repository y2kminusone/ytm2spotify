# ADR-001: 구현 언어로 Python을 사용한다

- 상태: Accepted
- 날짜: 2026-10-12

## 맥락

YouTube Music은 공식 API가 없다. 보관함(앨범, 구독, 좋아요)을 읽고 플레이리스트를 만들려면 비공식 클라이언트가 필요하다. 사실상 표준은 Python 라이브러리 [`ytmusicapi`](https://github.com/sigma67/ytmusicapi)이며, 다른 언어에는 유지보수되는 대안이 없다.

개발자에게 가장 익숙한 언어는 Java다.

## 결정

Python으로 구현한다.

## 근거

- `ytmusicapi`를 직접 쓸 수 있다. Java를 쓰면 YT Music 내부 API(InnerTube)를 직접 역분석해 재구현해야 하고, 그것이 프로젝트의 대부분을 차지하게 된다.
- 내부 API가 바뀌어도 `ytmusicapi` 커뮤니티의 수정을 버전 업데이트만으로 받을 수 있다.
- Spotify Web API는 단순한 REST라 언어 제약이 없다.
- PyInstaller로 Mac/Windows 실행 파일 배포가 가능하다.

## 결과

- (+) 가장 위험한 부분(YT Music 연동)의 구현 비용이 거의 0이 된다.
- (−) 익숙한 언어가 아니므로 학습 비용이 있다. → 타입 힌트와 테스트로 보완한다.
- (−) 실행 파일 크기가 커지고(수십 MB), 서명하지 않으면 OS 경고가 뜬다. → 배포 단계에서 다시 검토한다.
