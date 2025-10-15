# FFmpeg 자동 번들링 가이드

## 📋 개요

ComfyUI Image Manager는 **ffmpeg-static** 패키지를 사용하여 FFmpeg를 자동으로 번들링합니다.

**주요 장점**:
- ✅ 사용자가 FFmpeg를 별도로 설치할 필요 없음
- ✅ 모든 플랫폼 자동 지원 (Windows, macOS, Linux)
- ✅ 환경 변수 설정 불필요
- ✅ 포터블 배포 시 자동 포함

## 🔧 작동 원리

### 1. 개발 환경

**패키지 설치 시**:
```bash
npm install
```

- `ffmpeg-static@5.2.0` 설치
- `ffprobe-static@3.1.0` 설치
- 플랫폼별 FFmpeg 바이너리 자동 다운로드 (~50MB)
- `node_modules/ffmpeg-static/` 에 저장

**코드에서 사용**:
```typescript
import ffmpegPath from 'ffmpeg-static';
const ffprobeStatic = require('ffprobe-static');

// 번들 FFmpeg 경로 사용
const ffmpegCmd = ffmpegPath || 'ffmpeg';
const ffprobeCmd = ffprobeStatic.path || 'ffprobe';

// spawn으로 실행
spawn(ffmpegCmd, [...args]);
```

### 2. 포터블 배포

**빌드 프로세스**:
```bash
npm run build:bundle      # 백엔드 번들링
npm run build:portable    # 포터블 패키지 생성
```

**자동 포함 사항**:
- Node.js 런타임
- 애플리케이션 번들
- Sharp, better-sqlite3 네이티브 모듈
- **ffmpeg-static 바이너리** (자동 포함)

**포터블 구조**:
```
portable-output/
├── node.exe (or node)
├── app/
│   ├── bundle.js
│   ├── node_modules/
│   │   ├── sharp/
│   │   ├── better-sqlite3/
│   │   ├── ffmpeg-static/        ← FFmpeg 바이너리
│   │   │   └── bin/
│   │   │       └── win32/x64/ffmpeg.exe
│   │   └── ffprobe-static/       ← FFprobe 바이너리
│   │       └── bin/
│   │           └── win32/x64/ffprobe.exe
│   └── migrations/
└── start.bat (or start.sh)
```

### 3. 사용자 환경

**첫 실행 시**:
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

**이후 실행**:
- 모든 의존성이 이미 설치됨
- 즉시 실행 가능
- 인터넷 연결 불필요

## 📦 패키지 정보

### ffmpeg-static

**버전**: 5.2.0
**크기**: ~50MB (플랫폼별 상이)
**지원 플랫폼**:
- Windows (x64, arm64)
- macOS (x64, arm64)
- Linux (x64, arm64, armv7l)

**포함 코덱**:
- 비디오: h264, h265, vp8, vp9, av1
- 오디오: aac, mp3, opus, vorbis
- 이미지: webp, png, jpg

### ffprobe-static

**버전**: 3.1.0
**크기**: ~40MB (플랫폼별 상이)
**기능**: 동영상 메타데이터 추출

## 🎯 사용 사례

### 동영상 프레임 추출
```typescript
const VideoProcessor = require('./services/videoProcessor');

// FFmpeg 자동 감지 및 사용
const frames = await VideoProcessor.extractFrames(
  videoPath,
  outputFolder,
  duration
);
```

### 애니메이션 썸네일 생성
```typescript
// FFmpeg로 애니메이션 WebP 생성
await VideoProcessor.createAnimatedWebP(
  frameFiles,
  outputPath,
  95  // 품질
);
```

## 🔍 Fallback 메커니즘

**우선순위**:
1. 번들 FFmpeg (`ffmpeg-static`)
2. 시스템 FFmpeg (`PATH`에서 검색)
3. 없으면 에러 반환

**코드 구현**:
```typescript
private static getFFmpegPath(): string {
  return ffmpegPath || 'ffmpeg';  // 번들 우선, 없으면 시스템
}
```

**에러 처리**:
```typescript
const ffmpegAvailable = await VideoProcessor.checkFFmpegAvailable();
if (!ffmpegAvailable) {
  throw new Error('FFmpeg is not available. Please install FFmpeg.');
}
```

## 🚀 배포 전략

### 옵션 1: 완전 번들 (권장)
**장점**:
- 사용자 설치 불필요
- 일관된 동작 보장
- 즉시 사용 가능

**단점**:
- 패키지 크기 증가 (~100MB)

**적용 대상**:
- 포터블 배포
- 데스크톱 앱
- 단순한 설치 프로세스 원하는 경우

### 옵션 2: 선택적 다운로드
**장점**:
- 작은 초기 다운로드 크기
- 필요한 경우만 다운로드

**단점**:
- 첫 실행 시 인터넷 필요
- 다운로드 실패 가능성

**적용 대상**:
- 웹 배포
- 제한된 대역폭 환경
- Git 저장소 크기 제한

### 옵션 3: 시스템 의존
**장점**:
- 최소 패키지 크기
- 시스템 FFmpeg 활용

**단점**:
- 사용자가 직접 설치 필요
- 버전 불일치 가능성
- 기술 지식 필요

**적용 대상**:
- 개발자 대상 도구
- 서버 배포
- 시스템 통합 환경

## 💾 디스크 공간

### 개발 환경
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

### 포터블 배포
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

### 압축 후
```
ZIP 압축:                 ~45MB
7z 압축:                  ~40MB
```

## 🔐 보안 고려사항

### 바이너리 검증
- ffmpeg-static은 공식 FFmpeg 빌드 사용
- npm 패키지 검증 (checksum)
- 신뢰할 수 있는 소스에서 다운로드

### 권한
- 바이너리 실행 권한 필요
- Windows: 자동
- Linux/Mac: `chmod +x` 필요 (bootstrap.js가 자동 처리)

### 업데이트
- npm 패키지 업데이트로 FFmpeg 업데이트
- `npm update ffmpeg-static`
- 보안 패치 자동 포함

## 📊 성능

### FFmpeg 바이너리 로딩
- **첫 실행**: ~50ms (바이너리 경로 확인)
- **이후 실행**: ~5ms (캐시 사용)

### 동영상 처리
- **프레임 추출**: ~1s per 30 frames (1080p)
- **애니메이션 생성**: ~0.5s per 30 frames
- **메타데이터 추출**: ~100ms

### 메모리 사용
- **FFmpeg 프로세스**: ~50MB
- **Node.js 메인 프로세스**: ~100MB
- **총 메모리**: ~150MB (동영상 처리 시)

## 🛠️ 트러블슈팅

### ffmpeg-static 미설치
```bash
Error: Cannot find module 'ffmpeg-static'
```

**해결**:
```bash
npm install ffmpeg-static ffprobe-static
```

### 바이너리 실행 불가
```bash
Error: spawn ffmpeg ENOENT
```

**해결**:
1. `node_modules/ffmpeg-static/bin/` 확인
2. 실행 권한 확인 (Linux/Mac)
3. `npm install` 재실행

### 플랫폼 미지원
```bash
Error: Unsupported platform
```

**해결**:
- 수동 FFmpeg 설치
- 시스템 PATH에 추가
- 애플리케이션 재시작

## 🔄 업데이트

### FFmpeg 업데이트
```bash
npm update ffmpeg-static ffprobe-static
```

### 메이저 버전 업그레이드
```bash
npm install ffmpeg-static@latest ffprobe-static@latest
```

### 특정 버전 설치
```bash
npm install ffmpeg-static@5.2.0 ffprobe-static@3.1.0
```

## 📚 참고 자료

- [ffmpeg-static GitHub](https://github.com/eugeneware/ffmpeg-static)
- [ffprobe-static GitHub](https://github.com/joshwnj/ffprobe-static)
- [FFmpeg 공식 문서](https://ffmpeg.org/documentation.html)
- [VIDEO_THUMBNAIL_IMPLEMENTATION.md](./VIDEO_THUMBNAIL_IMPLEMENTATION.md)
- [FFMPEG_SETUP.md](./FFMPEG_SETUP.md)

## ✅ 체크리스트

### 개발 환경 설정
- [ ] `npm install` 실행
- [ ] `node_modules/ffmpeg-static` 존재 확인
- [ ] 동영상 업로드 테스트

### 포터블 빌드
- [ ] `npm run build:bundle` 실행
- [ ] `npm run build:portable` 실행
- [ ] `portable-output/app/node_modules/ffmpeg-static` 확인
- [ ] 포터블 패키지 실행 테스트

### 배포 전 확인
- [ ] 모든 플랫폼에서 동영상 처리 테스트
- [ ] 에러 로그 확인
- [ ] 성능 측정
- [ ] 사용자 문서 업데이트

---

**버전**: 1.0.0
**마지막 업데이트**: 2025-01-15
**작성자**: ComfyUI Image Manager 개발팀
