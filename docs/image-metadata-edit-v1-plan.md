# Image Metadata Edit V1 Plan

## Goal
기존 라이브러리 이미지에 대해 메타데이터를 실사용 가능하게 수정한다.

- 이미지 상세 / 이미지 모달의 메타 정보 영역에서 편집 진입 가능
- 전용 편집 페이지에서 수정 수행
- 수정 결과를
  - 다운로드하거나
  - 기존 이미지에 저장할 수 있어야 함

## Current State
- 프론트엔드에 재사용 가능한 메타 수정 폼이 이미 존재함
  - `frontend/src/features/metadata/components/metadata-rewrite-form.tsx`
  - `frontend/src/features/metadata/use-metadata-rewrite-draft.ts`
- 업로드 페이지에서는 임시 파일 기준 메타 rewrite + 다운로드가 가능함
- 백엔드에는 메타 rewrite 서비스가 존재함
  - `backend/src/services/imageMetadataWriteService.ts`
- DB 메타 업데이트 기능도 존재함
  - `backend/src/models/Image/MediaMetadataModel.ts`
- 하지만 기존 라이브러리 이미지 기준
  - 편집 페이지
  - hash 기반 다운로드 API
  - hash 기반 저장 API
  는 아직 연결되어 있지 않음

## V1 Scope
### Editable fields
- prompt
- negative prompt
- model
- steps
- sampler

### Supported actions
- 다운로드: 수정 메타를 포함한 파일 다운로드
- 저장: 새 운영 파일 생성 + 기존 운영 파일 RecycleBin 보관 + 라이브러리 `media_metadata` 갱신

### Explicit limits
- 대상은 정적 이미지 파일만 (`file_type === image`)
- 저장은 실제 운영 파일 교체 + DB 메타 반영을 함께 수행
- 기존 운영 파일은 시스템 RecycleBin으로 보관하고, 새 파일을 active로 승격
- 다운로드는 현재 draft의 format 선택 허용
- `cfg_scale`, `seed`, `scheduler`, `auto_tags`, `raw_nai_parameters` 직접 편집 UI는 v1 제외

## Implementation Plan

### 1. Frontend route + page
- 새 라우트 추가: `/images/:compositeHash/metadata`
- 새 페이지에서 수행:
  - `getImage(compositeHash)` 로드
  - 기존 메타로 draft 초기화
  - `MetadataRewriteForm` 재사용
  - 원본 이미지 미리보기 제공
  - 액션 버튼 제공: `저장`, `다운로드`, `뒤로`

### 2. Entry points
- 메타 카드(`image-detail-meta-card.tsx`) 상단에 `메타 수정` 버튼 추가
- 이 버튼은 상세페이지와 모달 모두에서 동일하게 노출됨

### 3. Backend download endpoint
- 신규 엔드포인트: `POST /api/images/:compositeHash/rewrite-metadata/download`
- 서버가 활성 원본 파일을 직접 찾고
- `ImageMetadataWriteService`로 수정 파일을 생성한 뒤
- 즉시 다운로드 응답 반환

### 4. Backend save endpoint
- 신규 엔드포인트: `PATCH /api/images/:compositeHash/metadata`
- 처리 순서:
  1. active file / metadata 조회
  2. 입력 patch 검증
  3. 수정 메타가 반영된 새 운영 파일 생성
  4. 기존 운영 파일을 시스템 RecycleBin에 보관
  5. 기존 file row는 `deleted`, 새 file row는 `active`로 전환
  6. `media_metadata` 갱신
  7. 편집 revision 기록 생성
  8. 캐시 무효화
  9. 갱신된 이미지 레코드 반환

### 5. Data consistency rules
- DB 반영 필드:
  - `prompt`
  - `negative_prompt`
  - `model_name`
  - `steps`
  - `sampler`
- prompt / negative / auto tags 변경 시 기존 `MediaMetadataModel.update()`의 prompt-similarity 재계산 로직 활용
- NAI 원본 파라미터가 존재하면 prompt / negative / model 관련 대표 값도 가능한 범위에서 같이 동기화

### 6. Validation and UX
- 저장 전 `window.confirm` 1회
- 저장 성공 후 상세 데이터 refresh / query invalidate
- 다운로드 성공 시 snackbar
- 저장/다운로드 실패 시 snackbar + error surface

## Verification Checklist
- 상세페이지에서 `메타 수정` 진입 가능
- 모달에서도 동일 진입 가능
- 편집 페이지에서 현재 메타가 draft에 채워짐
- 다운로드 시 수정된 파일이 내려옴
- 저장 시 파일 메타 + DB가 함께 갱신됨
- 저장 후 상세 페이지 재조회 시 변경값이 즉시 보임
- `frontend` / `backend` 빌드 통과

## Notes
- v1은 실사용 가능한 첫 연결이 목적임
- 저장 시 포맷 변경까지 포함하면 리스크가 커지므로 제외
- 추후 v2에서 raw NAI JSON 상세 편집, seed/cfg/scheduler, auto-tag 편집 여부 검토
