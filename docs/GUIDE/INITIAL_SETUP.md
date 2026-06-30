# 초기 설정

설치 후 첫 실행 전에 런타임 경로, 네트워크, 계정, 감시 폴더를 정리합니다.

## 1. `.env` 준비

루트의 `.env.example`을 기준으로 `.env`를 만듭니다.

```ini
PORT=1666
BIND_ADDRESS=0.0.0.0
FRONTEND_URL=http://localhost:1677
ENABLE_EXTERNAL_IP=false
CONAI_MCP_HTTP_ENABLED=false
RUNTIME_BASE_PATH=./user
```

처음에는 기본값으로 시작해도 됩니다. 데이터 위치를 분리하려면 앱을 많이 쓰기 전에 먼저 경로를 정하세요.

## 2. 네트워크 설정

| 값 | 의미 | 권장 상황 |
| --- | --- | --- |
| `BIND_ADDRESS=localhost` | 같은 PC에서만 접속 | 완전 로컬 사용 |
| `BIND_ADDRESS=0.0.0.0` | 같은 네트워크의 다른 기기에서도 접속 | 내부망 공유 |
| `ENABLE_EXTERNAL_IP=false` | 외부 IP 노출 기능 비활성 | 기본 권장 |
| `CONAI_MCP_HTTP_ENABLED=false` | HTTP MCP 엔드포인트 비활성 | 공개/데모 기본 |

외부 공개, 도메인, 리버스 프록시, HTTPS를 붙일 때는 `TRUST_PROXY`, `PUBLIC_BASE_URL`, `BACKEND_ORIGIN` 같은 값도 함께 검토합니다. 보안/권한 정리 전에는 외부 공개하지 않는 것이 좋습니다.

## 3. 런타임 데이터 위치

기본값은 `./user`입니다.

```text
user/
├─ uploads/
├─ database/
├─ logs/
├─ temp/
├─ models/
└─ RecycleBin/
```

필요하면 개별 경로를 지정할 수 있습니다.

```ini
RUNTIME_UPLOADS_DIR=E:/CoNAI/uploads
RUNTIME_DATABASE_DIR=E:/CoNAI/database
RUNTIME_LOGS_DIR=E:/CoNAI/logs
RUNTIME_TEMP_DIR=E:/CoNAI/temp
RUNTIME_MODELS_DIR=E:/CoNAI/models
RUNTIME_RECYCLE_BIN_DIR=E:/CoNAI/RecycleBin
```

중요: `database`와 `uploads`는 같은 백업 시점으로 관리하세요. DB만 있거나 파일만 있으면 상세/다운로드/유사도 결과가 어긋날 수 있습니다.

## 4. 첫 실행

```bash
npm run dev
```

브라우저에서 프론트엔드 주소를 엽니다.

```text
http://localhost:1677
```

## 5. 계정 설정

인증이 켜진 상태라면 먼저 관리자 계정을 설정합니다.

설정 → 보안에서 관리하는 항목:

- 인증 상태
- 첫 계정 또는 현재 계정
- 계정 목록
- 계정 비밀번호
- 권한 그룹
- 페이지별 접근 권한
- 복구 정보

외부 접속을 허용할 계획이면 게스트와 anonymous 권한을 반드시 확인하세요.

## 6. 기본 앱 설정

`/settings`에서 먼저 볼 탭:

| 탭 | 먼저 확인할 값 |
| --- | --- |
| 일반 | 언어, RecycleBin 경로, 삭제 보호, 유사/중복 검사 정책 |
| 감시 폴더 | 폴더 경로, 전체 스캔, watcher 상태 |
| 보안 | 관리자/게스트/권한 그룹 |
| 메타데이터 | stealth 스캔, 전체 재추출 |
| 이미지 저장 | 업로드/생성/워크플로 출력 저장 정책 |

## 7. 감시 폴더 등록

설정 → 감시 폴더에서 이미지가 저장되는 폴더를 등록합니다.

등록 전 확인:

- 폴더 경로가 실제로 존재하는지
- CoNAI가 읽을 수 있는 위치인지
- 하위 폴더까지 포함할지
- 제외할 확장자/패턴이 있는지
- watcher를 켤지
- 스캔 주기가 너무 짧지 않은지

## 8. 첫 스캔

감시 폴더 등록 후 전체 스캔을 실행합니다. 스캔이 끝나면 홈에서 이미지가 표시됩니다.

첫 스캔 확인 순서:

1. 설정 → 감시 폴더의 운영 카드에서 전체 스캔 실행
2. 최근 스캔 로그에서 신규/기존/오류 수 확인
3. 홈에서 이미지 수 확인
4. 이미지 상세에서 원본 경로와 메타데이터 확인
5. 필요하면 프롬프트/그룹/유사도 기능 확인

## 9. 권장 첫 확인

- 홈에서 이미지가 보이는지
- 이미지 상세에서 메타데이터가 보이는지
- 업로드 페이지에서 단일 파일 추출이 되는지
- 설정 → 감시 폴더에서 스캔 로그가 남는지
- 삭제 보호가 원하는 방식으로 동작하는지
- `/access`에서 현재 계정이 필요한 페이지를 열 수 있는지

다음 문서: [감시 폴더와 백업 소스](./WATCHED_FOLDERS.md)
