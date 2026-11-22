# 드론 조립과 정비 시뮬레이터

교육용 3D 드론 조립·배선·설정·테스트 실습 프로그램입니다. 브라우저에서 바로 실행됩니다.

- 단계: 하드웨어 설정 → 소프트웨어 설정(미션 플래너 방식 메뉴) → 테스트
- 시작 화면에서 이름 입력 후 START, 마지막에 "종료"를 누르면 실습 기록이 관리자 구글 시트로 전송됩니다.

## 배포

`main` 브랜치에 올리면 GitHub Actions가 GitHub Pages로 배포합니다.
처음 한 번 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 설정하세요.

## 관리자 기록

`docs/관리자-기록-구글시트.md`의 안내대로 Apps Script를 웹 앱으로 배포한 뒤,
그 주소를 `js/config.js`의 `recordUrl`에 넣으면 됩니다.
