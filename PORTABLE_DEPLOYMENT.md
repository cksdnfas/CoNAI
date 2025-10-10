# Portable 배포 가이드 - WD v3 Tagger 포함

## 📦 Portable 빌드 구조

```
portable-output/
├── node.exe                    # Node.js 런타임
├── start.bat / start.sh        # 시작 스크립트
├── .env.example                # 환경 설정 템플릿
├── README.txt                  # 사용자 가이드
├── app/
│   ├── bundle.js              # 번들된 애플리케이션
│   ├── migrations/            # 데이터베이스 마이그레이션
│   ├── python/                # Python 스크립트 (WD v3 Tagger)
│   │   ├── wdv3_tagger.py
│   │   ├── requirements.txt
│   │   └── README.md
│   ├── frontend/              # 프론트엔드 빌드
│   └── node_modules/          # Native 모듈 (sharp, sqlite3)
├── database/                   # SQLite 데이터베이스
├── uploads/                    # 업로드된 이미지
├── logs/                       # 로그 파일
├── temp/                       # 임시 파일
└── models/                     # AI 모델 캐시
```

## 🚀 빌드 프로세스

### 1. 전체 빌드 실행

```bash
npm run build:full
```

이 명령은 다음을 순차적으로 실행:
1. `npm run build:integrated` - 백엔드 + 프론트엔드 통합 빌드
2. `npm run build:bundle` - esbuild로 번들링
3. `npm run build:portable` - Portable 패키지 생성

### 2. 단계별 빌드 (선택사항)

```bash
# 1단계: 백엔드 + 프론트엔드 빌드
npm run build:integrated

# 2단계: 번들링
npm run build:bundle

# 3단계: Portable 패키징
npm run build:portable
```

## 📋 Python 의존성 처리

### Portable 배포 시 포함되는 것

✅ **포함됨:**
- Python 스크립트 (`wdv3_tagger.py`)
- 의존성 목록 (`requirements.txt`)
- 사용 가이드 (`README.md`)

❌ **포함되지 않음:**
- Python 런타임
- Python 패키지 (torch, timm 등)
- AI 모델 파일 (자동 다운로드됨)

### 사용자 설치 과정

사용자는 다음 단계를 수행해야 합니다:

1. **Python 3.8+ 설치** (선택사항, AI 태깅 기능 사용 시)
   - Windows: https://www.python.org/downloads/
   - Linux/Mac: 기본 설치되어 있거나 `apt install python3`

2. **Python 패키지 설치:**
   ```bash
   pip install -r app/python/requirements.txt
   ```

3. **환경 설정:**
   - `.env.example`을 `.env`로 복사
   - `TAGGER_ENABLED=true` 활성화
   - `PYTHON_PATH=python` 확인 (Linux/Mac은 `python3`)

## 🤖 AI 모델 처리

### 자동 다운로드

- 첫 실행 시 Hugging Face Hub에서 자동 다운로드
- 저장 위치: `{portable-output}/models/`
- 모델 크기: 약 600MB~1GB (모델 타입에 따라)

### 모델 종류

| 모델 | 크기 | 속도 | 정확도 |
|------|------|------|--------|
| vit | ~600MB | 빠름 | 높음 |
| swinv2 | ~800MB | 보통 | 매우 높음 |
| convnext | ~700MB | 빠름 | 높음 |

### 오프라인 배포 (선택사항)

인터넷이 없는 환경에서 사용하려면:

1. **개발 환경에서 모델 사전 다운로드:**
   ```bash
   python backend/python/wdv3_tagger.py test_image.png
   ```

2. **models/ 폴더 복사:**
   - 소스: `{개발환경}/models/`
   - 대상: `{portable-output}/models/`

3. **배포 패키지에 models/ 폴더 포함**

## ⚙️ 경로 자동 해석

`imageTaggerService.ts`는 다음 순서로 Python 스크립트를 찾습니다:

1. `backend/python/wdv3_tagger.py` (개발 환경)
2. `backend/dist/../python/wdv3_tagger.py` (컴파일된 환경)
3. `app/python/wdv3_tagger.py` (Portable 환경)
4. `{cwd}/app/python/wdv3_tagger.py` (Bundle 환경)

첫 번째로 존재하는 경로를 사용합니다.

## 📝 배포 체크리스트

### 빌드 전

- [ ] 백엔드 TypeScript 컴파일 확인 (`npm run build:backend`)
- [ ] Python 스크립트 테스트 확인
- [ ] Frontend 빌드 확인 (선택사항)
- [ ] `.env.example`에 모든 설정 포함 확인

### 빌드 중

- [ ] `npm run build:full` 실행
- [ ] 빌드 오류 없이 완료 확인
- [ ] `portable-output/` 폴더 생성 확인
- [ ] Python 파일 복사 확인 (Step 6)

### 빌드 후

- [ ] `start.bat` / `start.sh` 실행 테스트
- [ ] 웹 UI 접속 확인
- [ ] 이미지 업로드 테스트
- [ ] AI 태깅 기능 테스트 (Python 설치 후)

## 🎯 배포 시나리오

### 시나리오 1: Python 포함 배포 (권장하지 않음)

**장점:**
- 사용자가 Python 설치 불필요
- 즉시 사용 가능

**단점:**
- 패키지 크기 증가 (1GB+)
- 플랫폼별 빌드 필요
- 복잡한 라이센스 문제

**구현:** PyInstaller 사용 (별도 구현 필요)

### 시나리오 2: Python 별도 설치 (현재 구현)

**장점:**
- 작은 패키지 크기
- 플랫폼 독립적
- 업데이트 용이
- AI 기능 선택적 사용

**단점:**
- 사용자가 Python 설치 필요
- 추가 설정 단계 필요

**사용자 경험:**
1. Portable 패키지 다운로드 & 압축 해제
2. `start.bat` 실행 → 즉시 사용 가능 (기본 기능)
3. AI 태깅 원하면: Python 설치 + pip install

### 시나리오 3: Docker 배포 (향후 고려)

**장점:**
- 완전한 격리 환경
- Python 포함
- 크로스 플랫폼

**단점:**
- Docker 설치 필요
- 리소스 오버헤드

## 📚 사용자 문서

### README.txt 자동 생성

Portable 빌드 스크립트가 자동으로 생성하는 내용:

1. **Quick Start**: Windows/Linux/Mac 실행 방법
2. **Python Setup**: AI 태깅 기능 활성화 방법
3. **Configuration**: .env 설정 가이드
4. **Troubleshooting**: 일반적인 문제 해결
5. **Package Contents**: 포함된 파일 설명

### 추가 문서 포함 (선택사항)

배포 시 다음 문서를 함께 포함 가능:

- `DEPLOYMENT_GUIDE.md` - 상세 배포 가이드
- `API_DOCUMENTATION.md` - API 사용법
- `WD_TAGGER_GUIDE.md` - AI 태깅 기능 가이드

## 🔧 고급 설정

### GPU 가속 활성화

사용자가 NVIDIA GPU를 사용하는 경우:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 모델 변경

`.env` 파일에서:
```env
TAGGER_MODEL=swinv2    # vit, swinv2, convnext
```

### 임계값 조정

```env
TAGGER_GEN_THRESHOLD=0.25    # 더 많은 태그 (기본값: 0.35)
TAGGER_CHAR_THRESHOLD=0.85   # 더 정확한 캐릭터 인식 (기본값: 0.75)
```

## 🐛 디버깅

### 로그 확인

- 서버 로그: `logs/` 폴더
- Python 출력: 콘솔 창에 표시

### Python 경로 확인

서버 시작 시 로그에서 확인:
```
[ImageTagger] Script path: D:\_Dev\...\app\python\wdv3_tagger.py
[ImageTagger] Script exists: true
```

### 의존성 체크

```bash
GET http://localhost:1566/api/images/tagger/check
```

응답에서 Python 의존성 상태 확인.

## 📦 배포 최적화

### 패키지 크기 줄이기

1. **Frontend 최적화:**
   - Vite 프로덕션 빌드 사용
   - 이미지/에셋 압축

2. **Native 모듈 최적화:**
   - 불필요한 파일 제거
   - 플랫폼별 빌드만 포함

3. **문서 최소화:**
   - README만 포함
   - 나머지는 온라인 문서 링크

### 전송 최적화

```bash
# ZIP 압축
cd portable-output
zip -r ComfyUI-Image-Manager-v1.0.0.zip .

# 7-Zip (더 높은 압축률)
7z a -mx=9 ComfyUI-Image-Manager-v1.0.0.7z *
```

## ✅ 배포 완료

배포 패키지 테스트:

1. 새 폴더에 압축 해제
2. Python 설치 (선택)
3. `pip install -r app/python/requirements.txt` (선택)
4. `start.bat` 실행
5. 브라우저에서 접속
6. 모든 기능 테스트

---

**참고 문서:**
- [WD_TAGGER_GUIDE.md](./WD_TAGGER_GUIDE.md) - AI 태깅 기능 상세 가이드
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - 전체 배포 가이드
