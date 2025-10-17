# ComfyUI Image Manager

<div align="center">

**Personal AI image management service accessible from anywhere**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](https://github.com/yourusername/comfyui-image-manager)

[English](#english) | [한국어](#한국어)

</div>

---

## 한국어

### 🎨 주요 기능

- **🖼️ AI 이미지 관리**: ComfyUI, Stable Diffusion, NovelAI 메타데이터 자동 추출
- **📱 언제 어디서든 접속**: 로컬, 네트워크, 인터넷 원격 접속 지원
- **🗂️ 스마트 그룹핑**: 자동 수집 규칙으로 이미지 자동 분류
- **🔍 강력한 검색**: 프롬프트, 모델, AI 도구, 날짜 검색
- **📊 프롬프트 분석**: 통계 및 동의어 관리
- **🚀 단일 실행 파일**: Node.js 설치 불필요
- **🌐 다국어 지원**: 한국어, 영어, 일본어, 중국어
- **🔗 REST API**: 외부 도구 연동 가능

### 🚀 빠른 시작

#### Portable 패키지 (권장) ⭐

1. **[Releases](https://github.com/yourusername/comfyui-image-manager/releases)에서 다운로드**
2. **압축 해제 후 실행**
   ```bash
   # Windows
   start.bat

   # Linux/Mac
   chmod +x start.sh
   ./start.sh
   ```
3. **브라우저 접속**: http://localhost:1566

#### 소스에서 빌드

```bash
git clone https://github.com/yourusername/comfyui-image-manager.git
cd comfyui-image-manager
npm run install:all
npm run dev
```

### 📖 문서

- **[설정 가이드](SETUP.md)** - 초기 설정 및 환경 구성
- **[배포 가이드](docs/user/deployment.md)** - 원격 접속, HTTPS, 자동 시작
- **[기능 가이드](docs/user/features.md)** - WD Tagger, 동영상 처리
- **[API 문서](docs/development/api.md)** - REST API 레퍼런스
- **[아키텍처](docs/development/architecture.md)** - 시스템 설계
- **[개발 가이드](CLAUDE.md)** - 개발 환경 설정

### 🛠️ 기술 스택

**Backend**: Node.js + TypeScript + Express.js + SQLite3 + Sharp
**Frontend**: React 19 + Material-UI + Vite
**Deployment**: Node.js SEA (Single Executable Application)

### 🗺️ 로드맵

- [x] **v1.0** - 기본 이미지 관리 및 원격 접속
- [ ] **v1.1** - ComfyUI 워크플로우 직접 실행
- [ ] **v1.2** - 사용자 인증 및 권한 관리
- [ ] **v1.3** - WebSocket 실시간 업데이트
- [ ] **v1.4** - S3 호환 스토리지 지원
- [ ] **v1.5** - 모바일 앱 (React Native)

### 📄 라이선스

MIT License - [LICENSE](LICENSE) 참조

### 📞 지원

- **이슈 신고**: [GitHub Issues](https://github.com/yourusername/comfyui-image-manager/issues)
- **문의**: your.email@example.com

---

## English

### 🎨 Key Features

- **🖼️ AI Image Management**: Auto-extract metadata from ComfyUI, Stable Diffusion, NovelAI
- **📱 Access Anywhere**: Local, network, and internet remote access
- **🗂️ Smart Grouping**: Automatic image classification
- **🔍 Powerful Search**: Search by prompts, models, AI tools, dates
- **📊 Prompt Analytics**: Statistics and synonym management
- **🚀 Single Executable**: No Node.js installation required
- **🌐 Multi-language**: Korean, English, Japanese, Chinese
- **🔗 REST API**: Integration with external tools

### 🚀 Quick Start

#### Portable Package (Recommended) ⭐

1. **Download from [Releases](https://github.com/yourusername/comfyui-image-manager/releases)**
2. **Extract and run**
   ```bash
   # Windows
   start.bat

   # Linux/Mac
   chmod +x start.sh
   ./start.sh
   ```
3. **Open browser**: http://localhost:1566

#### Build from Source

```bash
git clone https://github.com/yourusername/comfyui-image-manager.git
cd comfyui-image-manager
npm run install:all
npm run dev
```

### 📖 Documentation

- **[Setup Guide](SETUP.md)** - Initial setup and configuration
- **[Deployment Guide](docs/user/deployment.md)** - Remote access, HTTPS, auto-start
- **[Features Guide](docs/user/features.md)** - WD Tagger, video processing
- **[API Documentation](docs/development/api.md)** - REST API reference
- **[Architecture](docs/development/architecture.md)** - System design
- **[Development Guide](CLAUDE.md)** - Development environment

### 🛠️ Tech Stack

**Backend**: Node.js + TypeScript + Express.js + SQLite3 + Sharp
**Frontend**: React 19 + Material-UI + Vite
**Deployment**: Node.js SEA (Single Executable Application)

### 🗺️ Roadmap

- [x] **v1.0** - Basic image management and remote access
- [ ] **v1.1** - Direct ComfyUI workflow execution
- [ ] **v1.2** - User authentication and permissions
- [ ] **v1.3** - WebSocket real-time updates
- [ ] **v1.4** - S3-compatible storage support
- [ ] **v1.5** - Mobile app (React Native)

### 📄 License

MIT License - See [LICENSE](LICENSE)

### 📞 Support

- **Report Issues**: [GitHub Issues](https://github.com/yourusername/comfyui-image-manager/issues)
- **Contact**: your.email@example.com

---

<div align="center">

Made with ❤️ for the AI art community

**⭐ Star this repo if you find it useful!**

</div>
