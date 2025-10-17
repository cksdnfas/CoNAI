# Setup Guide

Complete setup guide for ComfyUI Image Manager.

[한국어](#한국어) | [English](#english)

---

## 한국어

### 🚀 빠른 시작

#### 방법 1: Portable 패키지 (권장) ⭐

**요구사항:** 없음 (Node.js 포함됨)

1. **다운로드**
   - [Releases](https://github.com/yourusername/comfyui-image-manager/releases)에서 플랫폼에 맞는 파일 다운로드
   - Windows: `comfyui-image-manager-portable-windows.zip`
   - Linux: `comfyui-image-manager-portable-linux.tar.gz`
   - macOS: `comfyui-image-manager-portable-macos.tar.gz`

2. **압축 해제 및 실행**
   ```bash
   # Windows
   start.bat

   # Linux/Mac
   chmod +x start.sh
   ./start.sh
   ```

3. **브라우저 접속**
   - 로컬: http://localhost:1566
   - 네트워크: http://192.168.x.x:1566 (콘솔에 표시)

#### 방법 2: 소스에서 빌드

**요구사항:** Node.js 18+, npm

```bash
# 저장소 클론
git clone https://github.com/yourusername/comfyui-image-manager.git
cd comfyui-image-manager

# 설치 및 실행
npm run install:all
npm run dev

# 프로덕션 빌드
npm run build:full
```

### ⚙️ 환경 설정

#### 기본 설정

`.env` 파일 생성 (선택사항):

```env
# 서버 설정
PORT=1566
BACKEND_HOST=0.0.0.0

# 데이터 저장 경로
RUNTIME_BASE_PATH=./

# WD v3 Tagger AI 기능 (선택)
TAGGER_ENABLED=false
PYTHON_PATH=python
```

#### AI 태깅 기능 활성화 (선택사항)

1. **Python 3.8+ 설치**
   - Windows: https://www.python.org/downloads/
   - Linux/Mac: `sudo apt install python3 python3-pip`

2. **Python 패키지 설치**
   ```bash
   pip install -r app/python/requirements.txt
   # 또는 개발 환경: pip install -r backend/python/requirements.txt
   ```

3. **환경 변수 설정**
   ```env
   TAGGER_ENABLED=true
   PYTHON_PATH=python  # Linux/Mac: python3
   ```

자세한 내용: [docs/user/features.md](docs/user/features.md)

### 📁 디렉토리 구조

실행 후 자동 생성되는 폴더:

```
comfyui-image-manager/
├── uploads/          # 업로드된 이미지 (원본)
├── database/         # SQLite 데이터베이스
├── logs/             # 로그 파일
├── models/           # AI 모델 캐시 (AI 태깅 사용 시)
└── temp/             # 임시 파일
```

**커스텀 경로 설정:**
```env
RUNTIME_BASE_PATH=D:\MyImages
```

### 🔧 개발 환경 설정

#### 초기 설정

```bash
# 모든 의존성 설치
npm run setup              # 디렉토리 및 .env 자동 생성
npm run install:all        # root + backend + frontend 설치
```

#### 개발 서버

```bash
npm run dev                # Backend + Frontend 동시 실행
npm run dev:backend        # Backend만 (포트 1566)
npm run dev:frontend       # Frontend만
```

#### 빌드 명령어

```bash
npm run build              # Backend + Frontend 빌드
npm run build:backend      # TypeScript 컴파일
npm run build:frontend     # Vite 빌드
npm run build:full         # 통합 + 번들 + Portable 패키지
```

#### 데이터베이스

```bash
npm run db:reset           # DB 초기화 (모든 데이터 삭제)
cd backend && npm run db:migrate  # 마이그레이션 실행
```

### 🌐 네트워크 접속

#### 로컬 네트워크 (같은 Wi-Fi)

기본 설정으로 바로 사용 가능! 서버 시작 시 표시되는 네트워크 URL 사용.

#### 외부 인터넷 접속

1. 공유기 포트 포워딩 (포트 1566)
2. 외부 IP 확인 및 `.env` 설정
3. DDNS 사용 권장 (IP 변경 대응)

자세한 내용: [docs/user/deployment.md](docs/user/deployment.md)

### ❓ 문제 해결

#### 포트가 이미 사용 중

`.env` 파일에서 포트 변경:
```env
PORT=3000
```

#### Python 태깅 오류

의존성 확인:
```bash
GET http://localhost:1566/api/images/tagger/check
```

#### 데이터베이스 오류

```bash
npm run db:reset  # 주의: 모든 데이터 삭제됨
```

---

## English

### 🚀 Quick Start

#### Option 1: Portable Package (Recommended) ⭐

**Requirements:** None (Node.js included)

1. **Download**
   - Get the latest release from [Releases](https://github.com/yourusername/comfyui-image-manager/releases)
   - Windows: `comfyui-image-manager-portable-windows.zip`
   - Linux: `comfyui-image-manager-portable-linux.tar.gz`
   - macOS: `comfyui-image-manager-portable-macos.tar.gz`

2. **Extract and Run**
   ```bash
   # Windows
   start.bat

   # Linux/Mac
   chmod +x start.sh
   ./start.sh
   ```

3. **Open Browser**
   - Local: http://localhost:1566
   - Network: http://192.168.x.x:1566 (shown in console)

#### Option 2: Build from Source

**Requirements:** Node.js 18+, npm

```bash
# Clone repository
git clone https://github.com/yourusername/comfyui-image-manager.git
cd comfyui-image-manager

# Install and run
npm run install:all
npm run dev

# Production build
npm run build:full
```

### ⚙️ Configuration

#### Basic Configuration

Create `.env` file (optional):

```env
# Server settings
PORT=1566
BACKEND_HOST=0.0.0.0

# Data storage path
RUNTIME_BASE_PATH=./

# WD v3 Tagger AI feature (optional)
TAGGER_ENABLED=false
PYTHON_PATH=python
```

#### Enable AI Tagging (Optional)

1. **Install Python 3.8+**
   - Windows: https://www.python.org/downloads/
   - Linux/Mac: `sudo apt install python3 python3-pip`

2. **Install Python packages**
   ```bash
   pip install -r app/python/requirements.txt
   # Or for dev: pip install -r backend/python/requirements.txt
   ```

3. **Configure environment**
   ```env
   TAGGER_ENABLED=true
   PYTHON_PATH=python  # Linux/Mac: python3
   ```

Details: [docs/user/features.md](docs/user/features.md)

### 📁 Directory Structure

Auto-created after first run:

```
comfyui-image-manager/
├── uploads/          # Uploaded images (original)
├── database/         # SQLite database
├── logs/             # Log files
├── models/           # AI model cache (if AI tagging enabled)
└── temp/             # Temporary files
```

**Custom path:**
```env
RUNTIME_BASE_PATH=D:\MyImages
```

### 🔧 Development Setup

#### Initial Setup

```bash
# Install all dependencies
npm run setup              # Auto-create directories and .env
npm run install:all        # Install root + backend + frontend
```

#### Development Server

```bash
npm run dev                # Backend + Frontend concurrently
npm run dev:backend        # Backend only (port 1566)
npm run dev:frontend       # Frontend only
```

#### Build Commands

```bash
npm run build              # Backend + Frontend build
npm run build:backend      # TypeScript compilation
npm run build:frontend     # Vite build
npm run build:full         # Integrated + bundle + portable package
```

#### Database

```bash
npm run db:reset           # Reset DB (deletes all data)
cd backend && npm run db:migrate  # Run migrations
```

### 🌐 Network Access

#### Local Network (Same Wi-Fi)

Works out of the box! Use the network URL shown when server starts.

#### External Internet Access

1. Configure router port forwarding (port 1566)
2. Get external IP and configure `.env`
3. Recommend DDNS for dynamic IPs

Details: [docs/user/deployment.md](docs/user/deployment.md)

### ❓ Troubleshooting

#### Port Already in Use

Change port in `.env`:
```env
PORT=3000
```

#### Python Tagging Error

Check dependencies:
```bash
GET http://localhost:1566/api/images/tagger/check
```

#### Database Error

```bash
npm run db:reset  # Warning: Deletes all data
```

---

## 📚 Additional Resources

- **Deployment Guide:** [docs/user/deployment.md](docs/user/deployment.md)
- **Features Guide:** [docs/user/features.md](docs/user/features.md)
- **API Documentation:** [docs/development/api.md](docs/development/api.md)
- **Architecture:** [docs/development/architecture.md](docs/development/architecture.md)
- **Development Guide:** [CLAUDE.md](CLAUDE.md)
