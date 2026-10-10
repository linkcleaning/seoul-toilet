# 서울·경기 공중화장실 안내 (Ddong 서울)

제주 Ddong 앱(linkcleaning/jeju-toilet)과 같은 화면·구조로 만든 서울·경기판 모바일 웹앱(PWA)입니다. 빌드 도구 없이 GitHub Pages에 그대로 올리면 됩니다.

- 홈: 지금 이용 가능한 가장 가까운 화장실 카드, 카카오맵 길안내, 거리순 목록
- 지도: Leaflet + 묶음 표시, 내 위치. 지도를 못 불러오면 서울·경기 간단 지도로 대체
- 필터: 전체 / 서울 / 경기 / 지금 이용 / 24시간 / 휠체어 / 기저귀 교환대 / 비상벨 / 둘레길
- 상세: 운영 상태, 찾아가는 팁, 접근성·안전·위생, 둘레길·주차·전기차, 별점과 한줄 후기(이 기기에만 저장), 카카오·네이버·구글 길찾기
- SOS: 112·119·1330, 문자 신고, 한국어 문장 보여주기
- 4개 언어(한국어 / English / 中文 / 日本語), 또롱이 "장실!" 음성 (Web Audio 합성, 음성 파일 없음)

## 데이터

`data/toilets.json`은 지금 **예시 데이터 14곳**입니다. 앱 상세 화면에도 "예시 데이터"로 표시됩니다.
실제 서비스 전에는 공공데이터포털의 "전국공중화장실표준데이터"에서 서울특별시·경기도 자료로 바꿔야 합니다.
제주판의 `scripts/sync-toilets.mjs` 형식(필드 이름)을 그대로 쓰므로 같은 방식으로 변환하면 됩니다.

## 배포 (GitHub Pages)

1. 이 폴더 전체를 새 GitHub 저장소에 올립니다.
2. Settings → Pages → Branch `main`, 폴더 `/ (root)`로 저장합니다.

## 데이터 넣기

앱은 `data/toilets.json` 하나를 읽고, 이 파일은 `data/seoul.json` + `data/gyeonggi.json`을 합쳐서 만듭니다.

### 서울 (서울열린데이터광장 CSV)

1. https://data.seoul.go.kr/dataList/OA-22586/S/1/datasetView.do 에서 "서울시 공중화장실 위치정보" CSV를 내려받습니다.
2. `node scripts/seoul-csv-to-json.mjs 서울시_공중화장실_위치정보.csv`

### 경기 (경기데이터드림 OpenAPI, 자동)

1. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   이름 `GG_OPEN_DATA_KEY`, 값에 경기데이터드림 인증키를 넣습니다.
2. Actions 탭 → "경기 화장실 데이터 자동 갱신" → **Run workflow**.
   경기 데이터를 받아 서울 데이터와 합친 뒤 저장소에 자동 커밋합니다. 이후 매주 월요일 새벽에 다시 받습니다.

내 컴퓨터에서 직접 돌릴 때: `GG_OPEN_DATA_KEY=인증키 node scripts/gyeonggi-api-to-json.mjs`

인증키는 앱 코드나 저장소 파일에 절대 넣지 마세요.
