# Main Library + Import Folders 시스템 구현 계획

## 개요

사용자가 "메인 라이브러리" 폴더를 지정하고, 다른 폴더들을 "가져오기 폴더"로 설정하여 이미지를 자동으로 메인 라이브러리로 이동/복사할 수 있는 기능입니다.

## 현재 상태

### 현재 Watched Folders 시스템
- 다중 폴더 감시 지원
- 실시간 파일 모니터링 (Chokidar)
- 자동 스캔 스케줄링
- 네트워크 드라이브 지원
- `is_default` 플래그 존재 (기본 업로드 폴더 지정)

### 현재 동작 방식
```
감시 폴더 → 스캔 → DB에 파일 경로 참조 저장 (파일 이동 없음)
```

### 사용자가 원하는 동작 방식
```
Import 폴더 → 스캔 → Main Library로 이동/복사 → 정리
```

## 구현 방향

### 1단계: 데이터베이스 스키마 확장

**watched_folders 테이블에 추가할 컬럼:**
- `is_library`: 메인 라이브러리 지정 (0/1)
- `import_mode`: 가져오기 모드 ('move' | 'copy' | 'scan')
- `import_target_folder`: 대상 라이브러리 폴더 경로
- `import_organize_by`: 파일 정리 방식 ('date' | 'prompt' | 'none')
- `import_delete_after`: 원본 삭제 대기 일수 (0 = 삭제 안함)

### 2단계: 백엔드 서비스 수정

**새로 생성할 서비스:**
- `ImportService`: 파일 이동/복사 처리, 오류 복구

**수정할 서비스:**
- `FolderScanService`: import_mode 감지 및 파일 라우팅
- `FileWatcherService`: 스캔 후 이동/복사 작업 트리거
- `WatchedFolderService`: 라이브러리 폴더 유일성 검증

### 3단계: API 엔드포인트 추가

**새로운 엔드포인트:**
- `GET /api/folders/library`: 메인 라이브러리 폴더 조회
- `POST /api/folders/{id}/set-as-library`: 라이브러리로 지정
- `GET /api/folders/{id}/import-status`: 가져오기 상태 모니터링
- `POST /api/folders/{id}/import-config`: 가져오기 설정

### 4단계: 프론트엔드 UI 수정

**수정할 파일:**
- `frontend/src/pages/Settings/features/Folder/FolderSettings.tsx`
- `frontend/src/pages/Settings/features/Folder/components/FolderFormDialog.tsx`

**추가할 UI 요소:**
- 라이브러리 지정 토글
- 가져오기 모드 선택 (이동/복사/스캔만)
- 파일 정리 규칙 설정
- 가져오기 진행 상태 표시

## 파일 처리 흐름

```
1. 감시 폴더에서 새 파일 감지
2. 메타데이터 추출 (AI 도구, 프롬프트 등)
3. import_mode 확인:
   - 'scan': 현재와 동일하게 참조만 저장
   - 'move': 라이브러리로 이동 후 DB 경로 업데이트
   - 'copy': 라이브러리로 복사 후 DB에 새 경로 저장
4. import_organize_by에 따라 폴더 구조 결정:
   - 'date': YYYY-MM-DD 폴더
   - 'prompt': 첫 번째 프롬프트 키워드 기반
   - 'none': 루트에 저장
5. 썸네일 생성 및 자동 컬렉션 실행
```

## 관련 파일 위치

| 구분 | 파일 |
|------|------|
| 폴더 서비스 | `backend/src/services/watchedFolderService.ts` |
| 파일 감시 | `backend/src/services/fileWatcherService.ts` |
| 폴더 스캔 | `backend/src/services/folderScan/index.ts` |
| 자동 스캔 | `backend/src/services/autoScanScheduler.ts` |
| API 라우트 | `backend/src/routes/watchedFolders.ts` |
| 설정 UI | `frontend/src/pages/Settings/features/Folder/FolderSettings.tsx` |
| 폴더 다이얼로그 | `frontend/src/pages/Settings/features/Folder/components/FolderFormDialog.tsx` |
| 마이그레이션 | `backend/src/database/migrations/` |

## 예상 작업량

- 데이터베이스 마이그레이션: 낮음
- ImportService 생성: 중간
- 기존 서비스 수정: 중간
- API 엔드포인트: 낮음
- 프론트엔드 UI: 중간

**전체 예상: 중간~높음**

## 고려사항

1. **파일 충돌 처리:**
   - 동일 파일명 존재 시 이름 변경 규칙
   - 해시 기반 중복 검사

2. **오류 복구:**
   - 이동 실패 시 재시도 로직
   - 부분 실패 처리

3. **성능:**
   - 대용량 파일 비동기 처리
   - 진행 상태 실시간 업데이트

4. **역호환성:**
   - 기존 'scan' 모드가 기본값으로 유지
   - 마이그레이션 시 기존 데이터 영향 없음
