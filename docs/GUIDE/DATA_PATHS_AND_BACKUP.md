# 데이터 경로와 백업

CoNAI의 런타임 데이터는 기본적으로 `user/` 아래에 모입니다. 이미지/비디오가 많아질수록 `database`, `uploads`, `RecycleBin`의 일관성이 중요합니다.

## 기본 구조

```text
user/
├─ uploads/      # 등록/저장된 미디어
├─ database/     # SQLite DB
├─ logs/         # 로그
├─ temp/         # 임시 파일
├─ models/       # 자동 태그/추출 모델
└─ RecycleBin/   # 삭제 보호/휴지통
```

`.env`에서 `RUNTIME_BASE_PATH=./user`를 바꾸면 전체 기준 경로가 바뀝니다. 필요한 경우 개별 경로도 지정할 수 있습니다.

```ini
RUNTIME_UPLOADS_DIR=E:/CoNAI/uploads
RUNTIME_DATABASE_DIR=E:/CoNAI/database
RUNTIME_LOGS_DIR=E:/CoNAI/logs
RUNTIME_TEMP_DIR=E:/CoNAI/temp
RUNTIME_MODELS_DIR=E:/CoNAI/models
RUNTIME_RECYCLE_BIN_DIR=E:/CoNAI/RecycleBin
```

## 중요한 데이터

| 경로 | 중요도 | 설명 |
| --- | --- | --- |
| `user/database` | 매우 높음 | 이미지/프롬프트/그룹/설정 DB |
| `user/uploads` | 매우 높음 | CoNAI가 관리하는 미디어 파일 |
| `user/RecycleBin` | 높음 | 삭제 보호 흐름에서 보관되는 파일 |
| `user/models` | 중간 | 자동 태그/추출 모델 |
| `user/logs` | 중간 | 문제 해결용 로그 |
| `user/temp` | 낮음 | 변환/생성/처리 중 임시 파일 |

## 백업 기본 원칙

1. 앱을 종료하거나 쓰기 작업이 없는 상태로 만듭니다.
2. `database`와 `uploads`를 같은 시점으로 백업합니다.
3. 삭제 보호를 쓴다면 `RecycleBin`도 함께 백업합니다.
4. `.env`를 별도로 보관합니다.
5. 자동 태그/추출 모델 재다운로드가 번거롭다면 `models`도 백업합니다.

DB와 파일의 시점이 다르면 상세 화면은 존재하지만 원본이 없거나, 파일은 있는데 CoNAI 목록에 안 보이는 상태가 생길 수 있습니다.

## 백업 권장 순서

1. 앱 종료
2. `user/database` 백업
3. `user/uploads` 백업
4. `user/RecycleBin` 백업
5. `.env` 백업
6. 필요하면 `user/models`와 `user/logs` 백업
7. 복구 테스트용으로 앱을 한 번 실행해 홈/상세/다운로드 확인

## 기존 데이터 이전

이전 구조의 `uploads/`, `database/`, `logs/`, `temp/`, `RecycleBin/`, `models/` 데이터는 `user/` 아래로 모아 쓰는 것을 권장합니다.

안전한 이전 절차:

1. 앱을 종료합니다.
2. 기존 데이터를 별도 위치에 원본 백업합니다.
3. 새 `RUNTIME_BASE_PATH` 또는 개별 `RUNTIME_*_DIR`를 정합니다.
4. `database`, `uploads`, `RecycleBin`을 새 위치로 복사합니다.
5. `.env` 경로를 새 위치에 맞춥니다.
6. 앱을 실행합니다.
7. 홈 이미지 수, 상세 원본 경로, 다운로드, 스캔 로그를 확인합니다.
8. 정상 확인 후에만 기존 원본을 정리합니다.

충돌 원본은 `user/_migration_backup/<timestamp>/` 같은 별도 위치에 보관하세요.

## 백업 소스와 감시 폴더 차이

| 항목 | 용도 |
| --- | --- |
| 감시 폴더 | 새 이미지/비디오를 등록하고 스캔합니다. |
| 백업 소스 | 외부 원본 위치를 Upload 내부 대상으로 복사/변환해 가져옵니다. |
| RecycleBin | 삭제 보호와 복구 여지를 확보합니다. |

감시 폴더는 “이미 있는 위치를 읽기”, 백업 소스는 “원본 위치에서 관리 폴더로 가져오기”에 가깝습니다.

## 파일 검증

설정 → 감시 폴더의 **전체 파일 검증**은 DB 레코드와 실제 파일의 불일치를 확인합니다.

검증이 필요한 상황:

- 외부에서 파일을 대량 이동/삭제했을 때
- 백업 복구 후 이미지가 일부 깨져 보일 때
- 상세 화면에서 원본 파일을 열 수 없을 때
- 스캔 로그에 누락/오류가 반복될 때

## 복구 체크리스트

- `.env`의 런타임 경로가 복구 위치를 가리키는지
- `database`와 `uploads`가 같은 시점의 백업인지
- `RecycleBin`을 함께 복구해야 하는 상황인지
- 앱 실행 후 홈 이미지 수가 예상과 맞는지
- 상세 페이지에서 원본 파일을 열 수 있는지
- 다운로드가 되는지
- 스캔 로그에 대량 오류가 없는지
- 프롬프트/그룹 데이터가 유지되는지

다음 문서: [감시 폴더와 백업 소스](./WATCHED_FOLDERS.md)
