# Electron 앱 빌드 가이드

## 초기 설정

### 1. Electron 패키지 설치
```bash
# 루트 디렉토리에서
npm install electron electron-builder wait-on --save-dev
```

### 2. Backend 빌드
```bash
cd backend
npm run build
```

### 3. Frontend 빌드
```bash
cd frontend
npm run build
```

## 개발 모드 실행

```bash
# 루트 디렉토리에서
npm run electron:dev
```

이 명령어는:
1. Backend를 개발 모드로 시작 (포트 1566)
2. Backend가 준비되면 Electron 창 실행
3. Frontend는 Vite dev server (포트 5173) 사용

## 프로덕션 빌드

### 실행 파일 생성

```bash
# 1. Backend와 Frontend 빌드
npm run build

# 2. Electron 앱 빌드
npm run electron:build
```

### 빌드 결과

`dist-electron/` 폴더에 생성됨:
- **Windows**:
  - `ComfyUI Image Manager Setup.exe` (인스톨러)
  - `ComfyUI Image Manager.exe` (포터블 버전)

### 포터블 버전 배포

사용자에게 `.exe` 파일 하나만 주면 됨:
- Node.js 설치 불필요
- npm install 불필요
- 더블클릭으로 바로 실행

## 구조

```
ComfyUI_Image_Manager_2/
├── electron/
│   ├── main.js          # Electron 메인 프로세스
│   └── preload.js       # 보안 브릿지
├── backend/
│   └── dist/            # 빌드된 백엔드
├── frontend/
│   └── dist/            # 빌드된 프론트엔드
└── dist-electron/       # 최종 실행 파일
```

## 주의사항

### 데이터베이스 경로

Electron 앱에서는 사용자 데이터 경로 사용:
```javascript
const dbPath = path.join(app.getPath('userData'), 'database');
```

### uploads 폴더 경로

```javascript
const uploadsPath = path.join(app.getPath('userData'), 'uploads');
```

### 환경 변수 설정

`electron/main.js`에서 Backend 시작 시 설정:
```javascript
env: {
  PORT: '1566',
  NODE_ENV: 'production',
  DATABASE_PATH: path.join(app.getPath('userData'), 'database'),
  UPLOADS_PATH: path.join(app.getPath('userData'), 'uploads')
}
```

## 트러블슈팅

### Backend가 시작 안 됨
- `backend/dist/index.js` 파일 존재 확인
- `npm run build:backend` 실행 필요

### Frontend가 안 보임
- `frontend/dist/index.html` 파일 존재 확인
- `npm run build:frontend` 실행 필요

### 포트 충돌
- `electron/main.js`에서 포트 변경 가능
- Backend와 Frontend 모두 내부에서 실행되므로 외부 포트 충돌 없음

## 추가 설정

### 아이콘 변경
1. `build/icon.ico` (Windows)
2. `build/icon.png` (Linux)
3. `build/icon.icns` (macOS)

### 앱 이름/ID 변경
`electron-package.json`의 `build` 섹션 수정

### 자동 업데이트 추가
electron-updater 패키지 사용 가능
