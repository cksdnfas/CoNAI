# FFmpeg Guide

Complete guide for FFmpeg setup, automatic bundling, and video processing in ComfyUI Image Manager.

[한국어](#한국어) | [English](#english)

---

## 한국어

### ✨ 자동 FFmpeg 번들링 (권장)

**v1.0.0부터 FFmpeg가 자동으로 포함됩니다!**

- `npm install` 실행 시 자동으로 FFmpeg 바이너리 다운로드
- **별도 설치 불필요** - Windows, macOS, Linux 모두 자동 지원
- **즉시 사용 가능** - 환경 변수 설정 필요 없음

#### 자동 번들링 동작 방식

1. `npm install` 실행
2. `ffmpeg-static` 패키지가 플랫폼별 FFmpeg 바이너리 다운로드
3. 애플리케이션이 자동으로 번들 FFmpeg 사용
4. 시스템 FFmpeg 미설치 시 자동 fallback

### 📦 패키지 정보

**ffmpeg-static:**
- 버전: 5.2.0
- 크기: ~50MB (플랫폼별 상이)
- 지원 플랫폼: Windows (x64, arm64), macOS (x64, arm64), Linux (x64, arm64, armv7l)

**포함 코덱:**
- 비디오: h264, h265, vp8, vp9, av1
- 오디오: aac, mp3, opus, vorbis
- 이미지: webp, png, jpg

**ffprobe-static:**
- 버전: 3.1.0
- 크기: ~40MB
- 기능: 동영상 메타데이터 추출

### 🔧 작동 원리

#### 개발 환경

**패키지 설치:**
```bash
npm install
```

- `ffmpeg-static@5.2.0` 설치
- `ffprobe-static@3.1.0` 설치
- 플랫폼별 FFmpeg 바이너리 자동 다운로드 (~50MB)
- `node_modules/ffmpeg-static/` 에 저장

**코드에서 사용:**
```typescript
import ffmpegPath from 'ffmpeg-static';
const ffprobeStatic = require('ffprobe-static');

// 번들 FFmpeg 경로 사용
const ffmpegCmd = ffmpegPath || 'ffmpeg';
const ffprobeCmd = ffprobeStatic.path || 'ffprobe';

// spawn으로 실행
spawn(ffmpegCmd, [...args]);
```

#### 포터블 배포

**빌드 프로세스:**
```bash
npm run build:bundle      # 백엔드 번들링
npm run build:portable    # 포터블 패키지 생성
```

**자동 포함 사항:**
- Node.js 런타임
- 애플리케이션 번들
- Sharp, better-sqlite3 네이티브 모듈
- **ffmpeg-static 바이너리** (자동 포함)

**포터블 구조:**
```
portable-output/
├── node.exe (or node)
├── app/
│   ├── bundle.js
│   ├── node_modules/
│   │   ├── sharp/
│   │   ├── better-sqlite3/
│   │   ├── ffmpeg-static/        ← FFmpeg 바이너리
│   │   └── ffprobe-static/       ← FFprobe 바이너리
│   └── migrations/
└── start.bat (or start.sh)
```

#### 사용자 환경

**첫 실행 (Lite 버전):**
```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

1. `bootstrap.js` 실행
2. 네이티브 모듈 확인 (sharp, sqlite3, ffmpeg-static)
3. 없으면 `npm install --production` 자동 실행
4. FFmpeg 바이너리 자동 다운로드
5. 서버 시작

**이후 실행:**
- 모든 의존성이 이미 설치됨
- 즉시 실행 가능
- 인터넷 연결 불필요

### 🎯 사용 사례

#### 동영상 프레임 추출
```typescript
const VideoProcessor = require('./services/videoProcessor');

// FFmpeg 자동 감지 및 사용
const frames = await VideoProcessor.extractFrames(
  videoPath,
  outputFolder,
  duration
);
```

#### 애니메이션 썸네일 생성
```typescript
// FFmpeg로 애니메이션 WebP 생성
await VideoProcessor.createAnimatedWebP(
  frameFiles,
  outputPath,
  95  // 품질
);
```

### 🔍 Fallback 메커니즘

**우선순위:**
1. 번들 FFmpeg (`ffmpeg-static`)
2. 시스템 FFmpeg (`PATH`에서 검색)
3. 없으면 에러 반환

**코드 구현:**
```typescript
private static getFFmpegPath(): string {
  return ffmpegPath || 'ffmpeg';  // 번들 우선, 없으면 시스템
}
```

**에러 처리:**
```typescript
const ffmpegAvailable = await VideoProcessor.checkFFmpegAvailable();
if (!ffmpegAvailable) {
  throw new Error('FFmpeg is not available. Please install FFmpeg.');
}
```

### 💾 디스크 공간

**개발 환경:**
```
node_modules/
├── ffmpeg-static/        ~50MB
├── ffprobe-static/       ~40MB
├── sharp/                ~30MB
├── better-sqlite3/       ~5MB
└── 기타 패키지           ~20MB
--------------------------------
총 node_modules:          ~145MB
```

**포터블 배포:**
```
portable-output/
├── node.exe              ~30MB
├── app/
│   ├── bundle.js         ~2MB
│   └── node_modules/     ~90MB
│       ├── ffmpeg-static ~50MB
│       ├── sharp         ~30MB
│       └── sqlite3       ~5MB
--------------------------------
총 배포 크기:             ~122MB
```

**압축 후:**
```
ZIP 압축:                 ~45MB
7z 압축:                  ~40MB
```

### 📊 성능

**FFmpeg 바이너리 로딩:**
- 첫 실행: ~50ms (바이너리 경로 확인)
- 이후 실행: ~5ms (캐시 사용)

**동영상 처리:**
- 프레임 추출: ~1s per 30 frames (1080p)
- 애니메이션 생성: ~0.5s per 30 frames
- 메타데이터 추출: ~100ms

**메모리 사용:**
- FFmpeg 프로세스: ~50MB
- Node.js 메인 프로세스: ~100MB
- 총 메모리: ~150MB (동영상 처리 시)

### 🛠️ 문제 해결

#### 자동 번들링 문제

**동영상 업로드 시 오류:**
```
FFmpeg is not available. Please install FFmpeg to process videos.
```

**해결 방법:**
1. `npm install` 다시 실행 (FFmpeg 바이너리 재다운로드)
2. `node_modules/ffmpeg-static` 폴더가 존재하는지 확인
3. 백엔드 서버 재시작

#### ffmpeg-static 미설치
```bash
Error: Cannot find module 'ffmpeg-static'
```

**해결:**
```bash
npm install ffmpeg-static ffprobe-static
```

#### 바이너리 실행 불가
```bash
Error: spawn ffmpeg ENOENT
```

**해결:**
1. `node_modules/ffmpeg-static/bin/` 확인
2. 실행 권한 확인 (Linux/Mac)
3. `npm install` 재실행

### 🔄 업데이트

**FFmpeg 업데이트:**
```bash
npm update ffmpeg-static ffprobe-static
```

**메이저 버전 업그레이드:**
```bash
npm install ffmpeg-static@latest ffprobe-static@latest
```

**특정 버전 설치:**
```bash
npm install ffmpeg-static@5.2.0 ffprobe-static@3.1.0
```

---

## 수동 설치 (선택사항)

**참고:** 대부분의 사용자는 자동 번들링으로 충분합니다. 다음의 경우에만 수동 설치가 필요합니다:
- 최신 버전의 FFmpeg를 사용하고 싶은 경우
- 특정 코덱이나 플러그인이 필요한 경우
- 시스템 전역에서 FFmpeg를 사용하고 싶은 경우

### Windows 수동 설치

**방법 1: Chocolatey (권장)**
```powershell
# PowerShell을 관리자 권한으로 실행
choco install ffmpeg
```

**방법 2: 수동 설치**
1. https://ffmpeg.org/download.html 에서 다운로드
2. `C:\ffmpeg`에 압축 해제
3. 환경 변수 Path에 `C:\ffmpeg\bin` 추가
4. 확인: `ffmpeg -version`

**방법 3: Scoop**
```powershell
scoop install ffmpeg
```

### macOS 수동 설치

**Homebrew (권장):**
```bash
brew install ffmpeg
```

**MacPorts:**
```bash
sudo port install ffmpeg
```

### Linux 수동 설치

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install ffmpeg
```

**Arch Linux:**
```bash
sudo pacman -S ffmpeg
```

---

## English

### ✨ Automatic FFmpeg Bundling (Recommended)

**FFmpeg is automatically included from v1.0.0!**

- Automatic FFmpeg binary download when running `npm install`
- **No separate installation required** - Automatic support for Windows, macOS, Linux
- **Ready to use immediately** - No environment variable configuration needed

#### How Auto-Bundling Works

1. Run `npm install`
2. `ffmpeg-static` package downloads platform-specific FFmpeg binary
3. Application automatically uses bundled FFmpeg
4. Automatic fallback when system FFmpeg not installed

### 📦 Package Information

**ffmpeg-static:**
- Version: 5.2.0
- Size: ~50MB (varies by platform)
- Supported platforms: Windows (x64, arm64), macOS (x64, arm64), Linux (x64, arm64, armv7l)

**Included codecs:**
- Video: h264, h265, vp8, vp9, av1
- Audio: aac, mp3, opus, vorbis
- Image: webp, png, jpg

**ffprobe-static:**
- Version: 3.1.0
- Size: ~40MB
- Function: Video metadata extraction

### 🔧 How It Works

#### Development Environment

**Package installation:**
```bash
npm install
```

- Install `ffmpeg-static@5.2.0`
- Install `ffprobe-static@3.1.0`
- Auto-download platform-specific FFmpeg binary (~50MB)
- Stored in `node_modules/ffmpeg-static/`

**Usage in code:**
```typescript
import ffmpegPath from 'ffmpeg-static';
const ffprobeStatic = require('ffprobe-static');

// Use bundled FFmpeg path
const ffmpegCmd = ffmpegPath || 'ffmpeg';
const ffprobeCmd = ffprobeStatic.path || 'ffprobe';

// Execute with spawn
spawn(ffmpegCmd, [...args]);
```

#### Portable Deployment

**Build process:**
```bash
npm run build:bundle      # Backend bundling
npm run build:portable    # Create portable package
```

**Auto-included:**
- Node.js runtime
- Application bundle
- Sharp, better-sqlite3 native modules
- **ffmpeg-static binary** (auto-included)

**Portable structure:**
```
portable-output/
├── node.exe (or node)
├── app/
│   ├── bundle.js
│   ├── node_modules/
│   │   ├── sharp/
│   │   ├── better-sqlite3/
│   │   ├── ffmpeg-static/        ← FFmpeg binary
│   │   └── ffprobe-static/       ← FFprobe binary
│   └── migrations/
└── start.bat (or start.sh)
```

#### User Environment

**First run (Lite version):**
```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

1. Execute `bootstrap.js`
2. Check native modules (sharp, sqlite3, ffmpeg-static)
3. If missing, auto-run `npm install --production`
4. Auto-download FFmpeg binary
5. Start server

**Subsequent runs:**
- All dependencies already installed
- Immediate execution
- No internet connection required

### 🎯 Use Cases

#### Video Frame Extraction
```typescript
const VideoProcessor = require('./services/videoProcessor');

// Auto-detect and use FFmpeg
const frames = await VideoProcessor.extractFrames(
  videoPath,
  outputFolder,
  duration
);
```

#### Animated Thumbnail Creation
```typescript
// Create animated WebP with FFmpeg
await VideoProcessor.createAnimatedWebP(
  frameFiles,
  outputPath,
  95  // quality
);
```

### 🔍 Fallback Mechanism

**Priority:**
1. Bundled FFmpeg (`ffmpeg-static`)
2. System FFmpeg (search in `PATH`)
3. Return error if not found

**Code implementation:**
```typescript
private static getFFmpegPath(): string {
  return ffmpegPath || 'ffmpeg';  // Bundled first, then system
}
```

**Error handling:**
```typescript
const ffmpegAvailable = await VideoProcessor.checkFFmpegAvailable();
if (!ffmpegAvailable) {
  throw new Error('FFmpeg is not available. Please install FFmpeg.');
}
```

### 💾 Disk Space

**Development environment:**
```
node_modules/
├── ffmpeg-static/        ~50MB
├── ffprobe-static/       ~40MB
├── sharp/                ~30MB
├── better-sqlite3/       ~5MB
└── other packages        ~20MB
--------------------------------
Total node_modules:       ~145MB
```

**Portable deployment:**
```
portable-output/
├── node.exe              ~30MB
├── app/
│   ├── bundle.js         ~2MB
│   └── node_modules/     ~90MB
│       ├── ffmpeg-static ~50MB
│       ├── sharp         ~30MB
│       └── sqlite3       ~5MB
--------------------------------
Total deployment size:    ~122MB
```

**After compression:**
```
ZIP compression:          ~45MB
7z compression:           ~40MB
```

### 📊 Performance

**FFmpeg binary loading:**
- First run: ~50ms (binary path verification)
- Subsequent runs: ~5ms (using cache)

**Video processing:**
- Frame extraction: ~1s per 30 frames (1080p)
- Animation creation: ~0.5s per 30 frames
- Metadata extraction: ~100ms

**Memory usage:**
- FFmpeg process: ~50MB
- Node.js main process: ~100MB
- Total memory: ~150MB (during video processing)

### 🛠️ Troubleshooting

#### Auto-Bundling Issues

**Video upload error:**
```
FFmpeg is not available. Please install FFmpeg to process videos.
```

**Solution:**
1. Re-run `npm install` (re-download FFmpeg binary)
2. Check if `node_modules/ffmpeg-static` folder exists
3. Restart backend server

#### ffmpeg-static Not Installed
```bash
Error: Cannot find module 'ffmpeg-static'
```

**Solution:**
```bash
npm install ffmpeg-static ffprobe-static
```

#### Binary Execution Failed
```bash
Error: spawn ffmpeg ENOENT
```

**Solution:**
1. Check `node_modules/ffmpeg-static/bin/`
2. Check execution permissions (Linux/Mac)
3. Re-run `npm install`

### 🔄 Updates

**Update FFmpeg:**
```bash
npm update ffmpeg-static ffprobe-static
```

**Major version upgrade:**
```bash
npm install ffmpeg-static@latest ffprobe-static@latest
```

**Install specific version:**
```bash
npm install ffmpeg-static@5.2.0 ffprobe-static@3.1.0
```

---

## Manual Installation (Optional)

**Note:** Auto-bundling is sufficient for most users. Manual installation is only needed when:
- Using latest version of FFmpeg
- Specific codecs or plugins required
- System-wide FFmpeg usage desired

### Windows Manual Installation

**Method 1: Chocolatey (Recommended)**
```powershell
# Run PowerShell as Administrator
choco install ffmpeg
```

**Method 2: Manual Install**
1. Download from https://ffmpeg.org/download.html
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to PATH environment variable
4. Verify: `ffmpeg -version`

**Method 3: Scoop**
```powershell
scoop install ffmpeg
```

### macOS Manual Installation

**Homebrew (Recommended):**
```bash
brew install ffmpeg
```

**MacPorts:**
```bash
sudo port install ffmpeg
```

### Linux Manual Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install ffmpeg
```

**Arch Linux:**
```bash
sudo pacman -S ffmpeg
```

---

## 📚 Related Documentation

- [Features Guide](../user/features.md) - Video processing features
- [Architecture](architecture.md) - System design
- [API Documentation](api.md) - REST API reference
- [ffmpeg-static GitHub](https://github.com/eugeneware/ffmpeg-static)
- [FFmpeg Official Docs](https://ffmpeg.org/documentation.html)
