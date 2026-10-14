# 앱(Capacitor) 빌드용 공개 설정 — npm run build:app -w @saju/web 에서 사용 (비밀 키 금지)
# 운영 도메인이 정해지면 실제 주소로 바꾸세요 (docs/APP_PORTING.md)
VITE_API_BASE_URL=https://api.dalbitsaju.kr/api/v1
VITE_PUBLIC_WEB_URL=https://dalbitsaju.kr
# 커스텀 스킴(dalbitsaju://) — AndroidManifest·Info.plist 에 등록된 스킴과 일치해야 함
VITE_APP_URL_SCHEME=dalbitsaju
