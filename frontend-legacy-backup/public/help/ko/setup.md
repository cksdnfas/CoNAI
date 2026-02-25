# 설정 가이드

ComfyUI Image Manager 포터블 버전 설정 가이드입니다.

## 📁 디렉토리 구조

프로그램 실행 후 자동으로 생성되는 폴더들:

```
comfyui-image-manager/
├── app/                 # 실행 파일 및 프로그램 파일
├── python/              # Python 스크립트 및 requirements.txt
├── uploads/             # 업로드된 이미지 (자동 생성)
│   ├── images/         # 이미지 파일
│   └── videos/         # 동영상 파일
├── database/            # SQLite 데이터베이스 (자동 생성)
├── models/              # AI 모델 캐시 (자동 생성)
├── logs/                # 로그 파일 (자동 생성)
└── temp/                # 임시 파일 (자동 생성)
```

## 🔧 WD Tagger 사용 설정 (선택사항)

이미지에서 자동으로 태그를 추출하는 AI 기능입니다. 사용하려면 Python 설치가 필요합니다.

### 1단계: Python 설치

#### Windows
1. [Python 공식 사이트](https://www.python.org/downloads/)에서 Python 3.8 이상 다운로드
2. 설치 프로그램 실행
3. **중요**: "Add Python to PATH" 체크박스 반드시 선택
4. "Install Now" 클릭

#### Linux
```bash
sudo apt update
sudo apt install python3 python3-pip
```

#### macOS
```bash
# Homebrew 사용
brew install python3
```

#### 설치 확인
```bash
python --version
# 또는 (Linux/Mac)
python3 --version
```

Python 3.8 이상 버전이 표시되면 정상입니다.

### 2단계: Python 패키지 설치

프로그램 폴더의 `python` 디렉토리로 이동하여 필요한 패키지를 설치합니다.

```bash
# Windows
cd python
pip install -r requirements.txt

# Linux/Mac
cd python
pip3 install -r requirements.txt
```

**설치되는 패키지:**
- `torch` - PyTorch 딥러닝 프레임워크
- `timm` - 이미지 모델 라이브러리
- `huggingface-hub` - AI 모델 다운로드
- `pillow` - 이미지 처리
- `pandas`, `numpy` - 데이터 처리

**참고**:
- 설치 시간은 인터넷 속도에 따라 5~15분 소요
- PyTorch는 용량이 크므로(약 500MB~1GB) 충분한 저장공간 필요
- GPU 사용을 원하면 [PyTorch 공식 사이트](https://pytorch.org/get-started/locally/)에서 CUDA 버전 설치

### 3단계: 태거 활성화

1. **프로그램 실행 후 브라우저에서 접속**
2. **설정 페이지로 이동** (상단 메뉴 > 설정)
3. **태거 설정 탭 선택**
4. **"Python 의존성 확인" 버튼 클릭**
   - 모든 항목이 ✅ 표시되면 정상
   - ❌ 표시가 있으면 아래 문제 해결 참고

5. **태거 활성화 체크박스 선택**
6. **모델 선택** (기본값: ViT 권장)
   - **ViT (Vision Transformer)**: 빠르고 정확 (권장)
   - **SwinV2**: 매우 정확하지만 느림
   - **ConvNeXt**: 빠른 처리 속도

7. **임계값 조정** (선택사항)
   - **General 임계값** (기본: 0.35): 낮을수록 더 많은 태그, 높을수록 정확한 태그만
   - **Character 임계값** (기본: 0.75): 낮을수록 더 많은 캐릭터 인식

8. **첫 사용 시 자동 모델 다운로드**
   - 인터넷 연결 필요
   - 모델 크기: 600MB ~ 1GB
   - 다운로드 위치: `models/` 폴더
   - 한 번만 다운로드되며 이후 재사용

### 태거 사용 방법

1. **이미지 업로드** 또는 기존 이미지 선택
2. **이미지 상세 페이지에서 "태그 생성" 버튼 클릭**
3. **자동으로 태그가 추출되어 표시됨**
   - Rating: 이미지 등급 (General, Sensitive 등)
   - General: 일반 태그 (1girl, solo, long hair 등)
   - Character: 캐릭터 이름 (확신도 높은 경우만)

4. **일괄 태깅**
   - 여러 이미지 선택 후 "일괄 태그 생성" 가능
   - 대량 이미지 처리 시 유용

## ⚙️ 기본 설정

### 포트 변경

기본 포트는 1666입니다. 다른 프로그램과 충돌 시 변경이 필요합니다.

**변경 방법:**
1. 프로그램 폴더의 `.env` 파일 열기 (없으면 생성)
2. 다음 내용 추가:
   ```env
   PORT=3000
   ```
3. 프로그램 재시작

### 데이터 저장 경로 변경

기본적으로 프로그램 폴더에 데이터가 저장됩니다. 다른 위치를 사용하려면:

1. `.env` 파일 편집
2. 다음 내용 추가:
   ```env
   RUNTIME_BASE_PATH=D:\MyImages
   ```
3. 프로그램 재시작
4. 지정한 경로에 자동으로 폴더 생성

## 🌐 네트워크 접속

### 같은 네트워크에서 접속 (스마트폰, 태블릿 등)

1. **프로그램 실행 후 콘솔 창에 표시되는 네트워크 주소 확인**
   ```
   Local:   http://localhost:1666
   Network: http://xxx.xxx.xxx.xxx:1666  ← 이 주소 사용
   ```

2. **다른 기기에서 Network 주소로 접속**
   - 같은 Wi-Fi나 공유기에 연결되어 있어야 함
   - 방화벽에서 포트 허용 필요

### 외부 인터넷에서 접속

1. **공유기 포트 포워딩 설정**
   - 외부 포트: 1666
   - 내부 IP: PC의 로컬 IP
   - 내부 포트: 1666

2. **외부 IP 확인**
   - [내 IP 주소 확인](https://www.whatismyip.com/)
   - 외부 IP가 자주 바뀌면 DDNS 서비스 권장

3. **방화벽 설정**
   - Windows 방화벽에서 포트 1666 허용

## ❓ 문제 해결

### Python 설치 관련

#### "python is not recognized" 오류
**원인**: Python이 PATH 환경변수에 없음

**해결방법:**
1. Python 재설치 시 "Add Python to PATH" 체크
2. 또는 수동으로 환경변수 설정:
   - Windows: 시스템 속성 > 환경 변수 > Path 편집
   - Python 설치 경로 추가 (예: `C:\Python310\` 및 `C:\Python310\Scripts\`)

#### 관리자 권한 필요 오류
**해결방법:**
```bash
# Windows - 관리자 권한으로 명령 프롬프트 실행 후
pip install -r requirements.txt

# Linux/Mac
sudo pip3 install -r requirements.txt
```

### Python 패키지 설치 관련

#### 패키지 설치 실패
```bash
# pip 업그레이드 후 재시도
python -m pip install --upgrade pip
pip install -r requirements.txt --force-reinstall
```

#### 네트워크 오류로 설치 실패
**해결방법:**
- 안정적인 인터넷 연결 확인
- 방화벽/보안 프로그램 일시 해제
- 프록시 사용 시 pip 프록시 설정 필요

#### 디스크 공간 부족
**해결방법:**
- 최소 3GB 이상 여유 공간 확보
- PyTorch는 용량이 큼

### 태거 관련

#### "Python 의존성을 찾을 수 없습니다" 오류
**확인사항:**
1. Python 설치 확인: `python --version`
2. 패키지 설치 확인: `pip list | grep torch`
3. 올바른 디렉토리에서 설치했는지 확인

**해결방법:**
```bash
cd python
pip install -r requirements.txt --force-reinstall
```

#### 모델 다운로드 실패
**원인:**
- 인터넷 연결 문제
- Hugging Face Hub 접근 불가
- 디스크 공간 부족

**해결방법:**
1. 인터넷 연결 확인
2. [Hugging Face](https://huggingface.co/) 접속 확인
3. 방화벽에서 허용
4. 저장 공간 확보 (최소 2GB)

#### 태그 생성이 너무 느림
**원인**: CPU로 처리 중

**해결방법:**
- GPU 사용 설정 (NVIDIA GPU 있는 경우)
  ```bash
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
  ```
- 모델을 ViT나 ConvNeXt로 변경 (SwinV2는 느림)
- 일괄 처리 대신 개별 처리

#### 메모리 부족 오류
**해결방법:**
- 다른 프로그램 종료
- 더 가벼운 모델 선택 (ConvNeXt)
- 일괄 처리 시 이미지 개수 줄이기

### 일반 문제

#### 포트가 이미 사용 중
**오류 메시지**: "Port 1666 is already in use"

**해결방법:**
1. 다른 프로그램 종료
2. 또는 포트 변경 (위의 "포트 변경" 참고)

#### 이미지가 업로드되지 않음
**확인사항:**
1. 지원 형식: JPG, PNG, WebP, GIF, MP4, MOV
2. 최대 크기: 50MB
3. 디스크 여유 공간 확인

#### 데이터베이스 오류
**경고**: 모든 데이터가 삭제됩니다!

```bash
# 프로그램 폴더에서 실행
npm run db:reset
```

#### 브라우저가 자동으로 열리지 않음
**해결방법:**
- 수동으로 http://localhost:1666 접속
- 다른 브라우저 시도 (Chrome, Firefox, Edge)

## 📊 성능 참고 사항

### 태거 처리 속도
- **CPU**: 이미지당 2-5초
- **GPU (CUDA)**: 이미지당 0.5-1초

### 메모리 사용량
- **기본 프로그램**: 약 200-500MB
- **태거 사용 시 (CPU)**: 추가 2-4GB RAM
- **태거 사용 시 (GPU)**: 추가 2-4GB VRAM

### 권장 사양
- **최소**: CPU 2코어, RAM 4GB, 저장공간 5GB
- **권장**: CPU 4코어, RAM 8GB, 저장공간 10GB
- **태거 사용 시**: RAM 16GB 권장

## 📚 추가 도움말

### 주요 기능

- **이미지 관리**: 드래그 앤 드롭 업로드, 자동 썸네일, AI 메타데이터 추출
- **자동 수집**: 규칙 기반 자동 그룹핑
- **프롬프트 분석**: AI 생성 이미지의 프롬프트 통계 및 분석
- **고급 검색**: 복합 필터, 태그 기반 검색
- **동영상 지원**: 자동 애니메이션 썸네일 생성

### 지원하는 AI 메타데이터

- ComfyUI
- NovelAI

### 단축키

- `선택 + Delete`: 선택한 이미지 삭제
- `선택 + D`: 선택한 이미지 다운로드
- `Escape`: 모달/대화상자 닫기

## 🆘 추가 지원

문제가 해결되지 않으면:

1. **로그 파일 확인**: `logs/` 폴더의 최신 로그 파일
2. **GitHub Issues**: 문제 보고 및 질문
3. **콘솔 확인**: 브라우저 개발자 도구 (F12) > Console 탭
