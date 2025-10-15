# FFmpeg 설치 가이드

ComfyUI Image Manager는 동영상 파일 업로드 및 처리를 위해 **FFmpeg**를 사용합니다.

## ✨ 자동 FFmpeg 번들링 (권장)

**v1.0.0부터 FFmpeg가 자동으로 포함됩니다!**

- `npm install` 실행 시 자동으로 FFmpeg 바이너리 다운로드
- **별도 설치 불필요** - Windows, macOS, Linux 모두 자동 지원
- **즉시 사용 가능** - 환경 변수 설정 필요 없음

### 자동 번들링 동작 방식
1. `npm install` 실행
2. `ffmpeg-static` 패키지가 플랫폼별 FFmpeg 바이너리 다운로드
3. 애플리케이션이 자동으로 번들 FFmpeg 사용
4. 시스템 FFmpeg 미설치 시 자동 fallback

## 왜 FFmpeg가 필요한가요?

- 동영상 메타데이터 추출 (해상도, 재생시간, 코덱 정보 등)
- 동영상에서 프레임 추출 및 애니메이션 썸네일 생성
- 향후 동영상 최적화 및 변환 기능

## 📦 포터블 배포

포터블 빌드를 배포할 때:
- `npm run build:bundle && npm run build:portable` 실행
- FFmpeg 바이너리가 자동으로 포함됨
- 사용자는 압축 해제 후 바로 실행 가능

## 수동 설치 (선택사항)

**참고**: 대부분의 사용자는 자동 번들링으로 충분합니다. 다음의 경우에만 수동 설치가 필요합니다:
- 최신 버전의 FFmpeg를 사용하고 싶은 경우
- 특정 코덱이나 플러그인이 필요한 경우
- 시스템 전역에서 FFmpeg를 사용하고 싶은 경우

## Windows 수동 설치 방법

### 방법 1: Chocolatey 사용 (권장)

```powershell
# PowerShell을 관리자 권한으로 실행
choco install ffmpeg
```

### 방법 2: 수동 설치

1. **FFmpeg 다운로드**
   - 공식 사이트: https://ffmpeg.org/download.html
   - Windows builds: https://www.gyan.dev/ffmpeg/builds/
   - `ffmpeg-release-full.7z` 다운로드

2. **압축 해제**
   - 다운로드한 파일을 `C:\ffmpeg`에 압축 해제

3. **환경 변수 설정**
   - 시스템 환경 변수 편집
   - Path에 `C:\ffmpeg\bin` 추가
   - 예: `C:\ffmpeg\ffmpeg-6.0-full_build\bin`

4. **설치 확인**
   ```powershell
   ffmpeg -version
   ffprobe -version
   ```

### 방법 3: Scoop 사용

```powershell
scoop install ffmpeg
```

## macOS 수동 설치 방법

### Homebrew 사용 (권장)

```bash
brew install ffmpeg
```

### MacPorts 사용

```bash
sudo port install ffmpeg
```

## Linux 수동 설치 방법

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install ffmpeg
```

### Fedora/RHEL/CentOS

```bash
sudo dnf install ffmpeg
```

### Arch Linux

```bash
sudo pacman -S ffmpeg
```

## 설치 확인

### 자동 번들링 확인
애플리케이션을 실행하면 자동으로 작동합니다. 별도 확인이 필요하지 않습니다.

### 수동 설치 확인 (수동 설치한 경우만)
터미널/명령 프롬프트에서 다음 명령어를 실행하여 설치를 확인합니다:

```bash
ffmpeg -version
ffprobe -version
```

정상적으로 버전 정보가 출력되면 설치가 완료된 것입니다.

## 문제 해결

### 자동 번들링 문제

**동영상 업로드 시 오류**:
```
FFmpeg is not available. Please install FFmpeg to process videos.
```

**해결 방법**:
1. `npm install` 다시 실행 (FFmpeg 바이너리 재다운로드)
2. `node_modules/ffmpeg-static` 폴더가 존재하는지 확인
3. 백엔드 서버 재시작

### 수동 설치 문제 (수동 설치한 경우만)

**"command not found" 또는 "명령을 찾을 수 없습니다" 오류**:

1. **환경 변수 확인**
   - FFmpeg가 설치된 경로가 PATH에 추가되어 있는지 확인
   - Windows: `echo %PATH%`
   - macOS/Linux: `echo $PATH`

2. **터미널/명령 프롬프트 재시작**
   - 환경 변수 변경 후 터미널을 재시작해야 적용됩니다

3. **시스템 재시작**
   - Windows의 경우 시스템 재시작이 필요할 수 있습니다

## 지원되는 동영상 포맷

FFmpeg 설치 후 다음 포맷을 업로드할 수 있습니다:

- **MP4** (`.mp4`) - H.264/H.265 코덱
- **WebM** (`.webm`) - VP8/VP9 코덱
- **QuickTime** (`.mov`)
- **AVI** (`.avi`)
- **MKV** (`.mkv`)

## 추가 정보

- FFmpeg 공식 문서: https://ffmpeg.org/documentation.html
- FFmpeg 위키: https://trac.ffmpeg.org/
- 이슈 트래커: https://github.com/[your-repo]/issues

## 향후 기능 (개발 예정)

- GIF 썸네일 생성 옵션
- 다중 프레임 썸네일 생성
- 동영상 최적화 및 압축
- 사용자 정의 썸네일 설정 (시간 지점, 품질 등)
