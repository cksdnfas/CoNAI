# 설치와 실행

이 문서는 CoNAI를 로컬에서 설치하고 실행하는 절차를 정리합니다.

## 요구사항

| 항목 | 기준 |
| --- | --- |
| Node.js | `>= 18.0.0` |
| npm | Node.js와 함께 설치되는 npm |
| OS | Windows 권장 |
| 디스크 | 이미지/비디오 저장 공간 충분히 확보 |

권장 런타임은 Node.js 22 LTS입니다. Node 18 이상이면 실행 기준은 만족합니다.

## 설치

프로젝트 루트에서 실행합니다.

```bash
npm install
npm run install:all
```

`install:all`은 루트, 프론트엔드, 백엔드 워크스페이스 의존성을 설치합니다.

## `.env` 준비

루트의 `.env.example`을 복사해 `.env`를 만듭니다.

주요 기본값:

```ini
PORT=1666
BIND_ADDRESS=0.0.0.0
FRONTEND_URL=http://localhost:1677
ENABLE_EXTERNAL_IP=false
RUNTIME_BASE_PATH=./user
```

처음에는 로컬/내부망 기준으로 시작하고, 외부 공개가 필요할 때만 네트워크와 보안을 별도로 점검하세요.

## 개발 서버 실행

```bash
npm run dev
```

기본 주소:

| 항목 | 주소 |
| --- | --- |
| Backend | `http://localhost:1666` |
| Frontend | `http://localhost:1677` |

개발 서버는 shared, backend, frontend를 함께 실행합니다.

## 프로덕션 빌드

```bash
npm run build
```

전체 빌드는 shared, backend, frontend 순서로 진행됩니다.

## 프로덕션 실행

```bash
npm run start
```

프론트엔드 preview 서버와 백엔드 서버를 함께 실행합니다.

## 문서 사이트 실행

개발 미리보기:

```bash
npm run docs:dev
```

문서 빌드:

```bash
npm run docs:build
```

## 자주 쓰는 빌드 명령

| 명령 | 용도 |
| --- | --- |
| `npm run build` | 일반 전체 빌드 |
| `npm run build:integrated` | 통합 빌드 |
| `npm run build:portable` | 포터블 패키지 생성 |
| `npm run build:docker` | Docker 패키지 생성 |
| `npm run build:all` | 통합/번들/포터블/Docker 빌드 묶음 |

## 실행 후 확인

1. 브라우저에서 `http://localhost:1677` 접속
2. `/access`에서 접근 가능한 페이지 확인
3. `/settings` → 보안에서 계정 상태 확인
4. `/settings` → 감시 폴더에서 폴더 등록
5. 전체 스캔 실행
6. `/`에서 이미지 표시 확인

## 자주 막히는 지점

| 증상 | 확인 |
| --- | --- |
| `npm install` 실패 | Node 버전, 네트워크, lockfile 충돌 확인 |
| 프론트가 안 열림 | `1677` 포트 사용 여부 확인 |
| 백엔드 API 실패 | `1666` 포트, `FRONTEND_URL`, 방화벽 확인 |
| 이미지가 안 보임 | 감시 폴더 등록과 전체 스캔 상태 확인 |
| 권한 화면만 보임 | 로그인/권한 그룹 설정 확인 |

다음 문서: [초기 설정](./INITIAL_SETUP.md)
