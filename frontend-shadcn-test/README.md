# frontend-shadcn-test

ComfyUI Image Manager용 **분리형 shadcn/ui 테스트 프론트엔드**입니다.

## 목적
- 기존 `frontend`(MUI 기반)와 완전히 분리된 테스트 프론트엔드 제공
- 기존 `backend`(`:1666`)에 연결하여 UI/연동 검증
- 경로/포트/스크립트 충돌 방지

## 핵심 분리 정책
- 기존 프론트: `frontend` (dev port `5555`)
- 테스트 프론트: `frontend-shadcn-test` (dev port `5666`, `strictPort=true`)
- 백엔드: `backend` (port `1666`)

## 실행
```bash
# 1) 백엔드 실행 (프로젝트 루트)
npm run dev:backend

# 2) 테스트 프론트 실행 (프로젝트 루트)
npm run dev:frontend:shadcn
```

또는:
```bash
cd frontend-shadcn-test
npm install
npm run dev
```

## API 연결 방식
- Vite dev origin: `http://localhost:5666`
- Vite proxy
  - `/api` -> `http://localhost:1666`
  - `/uploads` -> `http://localhost:1666`
  - `/temp` -> `http://localhost:1666`
- 선택 옵션: `VITE_BACKEND_URL` 지정 시 axios baseURL override 가능

## 화면 구성
- Dashboard: `/health`, `/api/settings`, `/api/images` 연동 지표
- Images: 이미지 테이블/썸네일 렌더링
- Settings: 설정 payload 스냅샷
- API Playground: GET/POST 테스트 요청
