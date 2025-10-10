# ComfyUI Image Manager

<div align="center">

**언제 어디서든 나의 AI 이미지를 관리하는 개인 이미지 서비스**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](https://github.com/yourusername/comfyui-image-manager)

[English](#english) | [한국어](#한국어)

</div>

---

## 한국어

### 🎨 주요 기능

- **🖼️ AI 이미지 관리**: ComfyUI, Stable Diffusion, NovelAI 등 AI 도구 메타데이터 자동 추출
- **📱 언제 어디서든 접속**: 로컬, 네트워크, 인터넷을 통한 원격 접속 지원
- **🗂️ 스마트 그룹핑**: 자동 수집 규칙으로 이미지 자동 분류
- **🔍 강력한 검색**: 프롬프트, 모델, AI 도구, 날짜 등으로 검색
- **📊 프롬프트 분석**: 자주 사용하는 프롬프트 통계 및 동의어 관리
- **🚀 단일 실행 파일**: Node.js 설치 불필요, 다운로드 후 바로 실행
- **🌐 다국어 지원**: 한국어, 영어, 일본어, 중국어
- **🔗 API 제공**: 외부 도구 및 자동화 연동 가능

### 🚀 빠른 시작

#### 방법 1: Portable 패키지 다운로드 (권장) ⭐

1. **[Releases](https://github.com/yourusername/comfyui-image-manager/releases)에서 최신 버전 다운로드**
   - `comfyui-image-manager-portable-windows.zip` (Windows)
   - `comfyui-image-manager-portable-linux.tar.gz` (Linux)
   - `comfyui-image-manager-portable-macos.tar.gz` (macOS)

2. **압축 해제 후 실행**
   ```bash
   # Windows - start.bat 더블클릭 또는
   start.bat

   # Linux/Mac
   chmod +x start.sh
   ./start.sh
   ```

3. **브라우저에서 접속**
   - 콘솔에 표시된 URL로 접속
   - 로컬: http://localhost:1566
   - 네트워크: http://192.168.x.x:1566

**특징:**
- ✅ Node.js 설치 불필요 (포함됨)
- ✅ 압축 해제 후 즉시 실행
- ✅ Native 모듈 완벽 지원
- ✅ 모든 데이터 로컬 저장

#### 방법 2: 소스에서 빌드

**요구사항:**
- Node.js 18+
- npm

**설치:**
```bash
# 저장소 클론
git clone https://github.com/yourusername/comfyui-image-manager.git
cd comfyui-image-manager

# 의존성 설치
npm run install:all

# 개발 서버 실행
npm run dev

# 또는 프로덕션 빌드
npm run build:full
```

### 📖 상세 문서

- **[배포 가이드](./DEPLOYMENT_GUIDE.md)** - 원격 접속, HTTPS 설정, 자동 시작 등
- **[API 문서](./API_DOCUMENTATION.md)** - REST API 전체 레퍼런스
- **[개발 가이드](./CLAUDE.md)** - 개발 환경 설정 및 구조

### 🌐 원격 접속 설정

#### 로컬 네트워크 (같은 Wi-Fi)
```
기본 설정으로 이미 가능!
서버 시작 시 표시되는 네트워크 URL 사용
```

#### 외부 인터넷 (집 밖에서도 접속)
1. 공유기에서 포트 1566 포워딩 설정
2. `.env` 파일에 외부 IP 설정
3. DDNS 사용 권장 (IP 변경 시 자동 업데이트)

**자세한 설정 방법:** [배포 가이드](./DEPLOYMENT_GUIDE.md)

### 💡 사용 사례

#### 1. 개인 AI 아트 갤러리
- 모든 AI 생성 이미지를 한 곳에 보관
- 프롬프트 및 생성 설정 자동 기록
- 모바일/태블릿에서도 포트폴리오 확인

#### 2. 팀 리소스 라이브러리
- 로컬 네트워크에서 팀원과 공유
- 자동 그룹핑으로 체계적 관리
- API를 통한 워크플로우 자동화

#### 3. ComfyUI 워크플로우 관리
- 생성된 이미지 자동 수집
- 프롬프트 재사용 및 통계
- 워크플로우 결과 추적 및 분석

### 🛠️ 기술 스택

**Backend:**
- Node.js + TypeScript
- Express.js
- SQLite3
- Sharp (이미지 처리)

**Frontend:**
- React 19
- Material-UI
- Vite

**Deployment:**
- Node.js SEA (Single Executable Application)
- 크로스 플랫폼 지원

### 📸 스크린샷

_TODO: 스크린샷 추가_

### 🗺️ 로드맵

- [ ] **v1.0** - 기본 이미지 관리 및 원격 접속 ✅
- [ ] **v1.1** - ComfyUI 워크플로우 직접 실행 및 결과 자동 저장
- [ ] **v1.2** - 사용자 인증 및 권한 관리
- [ ] **v1.3** - WebSocket 실시간 업데이트
- [ ] **v1.4** - S3 호환 스토리지 지원
- [ ] **v1.5** - 모바일 앱 (React Native)

### 🤝 기여

기여를 환영합니다! Pull Request나 Issue를 통해 참여해주세요.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### 📄 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

### 📞 지원

- **이슈 신고:** [GitHub Issues](https://github.com/yourusername/comfyui-image-manager/issues)
- **문의:** your.email@example.com
- **Discord:** (추후 개설)

---

## English

### 🎨 Key Features

- **🖼️ AI Image Management**: Auto-extract metadata from ComfyUI, Stable Diffusion, NovelAI, etc.
- **📱 Access Anywhere**: Local, network, and internet remote access support
- **🗂️ Smart Grouping**: Automatic image classification with collection rules
- **🔍 Powerful Search**: Search by prompts, models, AI tools, dates, and more
- **📊 Prompt Analytics**: Statistics and synonym management for frequently used prompts
- **🚀 Single Executable**: No Node.js installation required - download and run
- **🌐 Multi-language**: Korean, English, Japanese, Chinese
- **🔗 REST API**: Integration with external tools and automation

### 🚀 Quick Start

#### Option 1: Download Executable (Recommended)

1. **Download latest release from [Releases](https://github.com/yourusername/comfyui-image-manager/releases)**

2. **Extract and run**
   ```bash
   # Windows
   comfyui-image-manager.exe

   # Linux/Mac
   chmod +x comfyui-image-manager
   ./comfyui-image-manager
   ```

3. **Open in browser**
   - http://localhost:1566

#### Option 2: Build from Source

**Requirements:**
- Node.js 18+
- npm

**Installation:**
```bash
# Clone repository
git clone https://github.com/yourusername/comfyui-image-manager.git
cd comfyui-image-manager

# Install dependencies
npm run install:all

# Run development server
npm run dev

# Or build for production
npm run build:full
```

### 📖 Documentation

- **[Deployment Guide](./DEPLOYMENT_GUIDE.md)** - Remote access, HTTPS setup, auto-start
- **[API Documentation](./API_DOCUMENTATION.md)** - Complete REST API reference
- **[Development Guide](./CLAUDE.md)** - Development environment and architecture

### 🌐 Remote Access Setup

#### Local Network (Same Wi-Fi)
```
Works out of the box!
Use the network URL shown when server starts
```

#### External Internet (Access from anywhere)
1. Configure port 1566 forwarding on your router
2. Set external IP in `.env` file
3. Recommend using DDNS for dynamic IPs

**Detailed setup:** [Deployment Guide](./DEPLOYMENT_GUIDE.md)

### 💡 Use Cases

#### 1. Personal AI Art Gallery
- Store all AI-generated images in one place
- Auto-record prompts and generation settings
- Access portfolio from mobile/tablet

#### 2. Team Resource Library
- Share with team on local network
- Systematic organization with auto-grouping
- Workflow automation via API

#### 3. ComfyUI Workflow Management
- Auto-collect generated images
- Reuse prompts and track statistics
- Monitor and analyze workflow results

### 🛠️ Tech Stack

**Backend:**
- Node.js + TypeScript
- Express.js
- SQLite3
- Sharp (Image processing)

**Frontend:**
- React 19
- Material-UI
- Vite

**Deployment:**
- Node.js SEA (Single Executable Application)
- Cross-platform support

### 📸 Screenshots

_TODO: Add screenshots_

### 🗺️ Roadmap

- [ ] **v1.0** - Basic image management and remote access ✅
- [ ] **v1.1** - Direct ComfyUI workflow execution with auto-save results
- [ ] **v1.2** - User authentication and permissions
- [ ] **v1.3** - WebSocket real-time updates
- [ ] **v1.4** - S3-compatible storage support
- [ ] **v1.5** - Mobile app (React Native)

### 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or create an Issue.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

### 📞 Support

- **Report Issues:** [GitHub Issues](https://github.com/yourusername/comfyui-image-manager/issues)
- **Contact:** your.email@example.com
- **Discord:** (Coming soon)

---

<div align="center">

Made with ❤️ for the AI art community

**⭐ Star this repo if you find it useful!**

</div>
