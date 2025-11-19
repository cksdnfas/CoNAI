# Build Notes

## Version 2.0.2 (2025-11-19)

### Bug Fixes
- **그룹 다운로드**: 커스텀 그룹 및 자동폴더 그룹의 묶음 다운로드 기능 완전 수정 ✅
  - `window.open()` 방식에서 Blob 기반 다운로드로 전환
  - 새 창이 열리면서 백엔드 JSON 응답이 표시되던 문제 해결
  - 다운로드 실패 시 사용자 친화적인 에러 메시지 표시
  - 전체 다운로드 및 선택 다운로드 모두 정상 동작 확인
- **중국어 번역 파일**: JSON 구문 오류 수정
  - `workflows.json:176` 중국어 따옴표 이스케이프 처리
- **TypeScript 타입 오류**: 파일 검증 로그 모달 타입 수정
  - `FileVerificationLogModal.tsx:160` count 파라미터 타입 불일치 해결

### Improvements
- **그룹 다운로드 UX**:
  - 다운로드 시작 시 성공 스낵바 표시
  - 다운로드 실패 시 에러 스낵바 표시
  - Blob 기반 다운로드로 브라우저 호환성 향상
  - Content-Disposition 헤더 자동 파싱으로 올바른 파일명 설정
  - UTF-8 파일명 인코딩 지원 (RFC 2231)
- **Internationalization (i18n)**: 전체 애플리케이션에 다국어 지원 완전 구현 ✅
  - **Priority 1 완료** (긴급 - 완전 미적용 컴포넌트 3개):
    - ComfyUI 서버 관리 페이지 완전 다국어화 (~15개 문자열)
    - 커스텀 드롭다운 목록 페이지 완전 다국어화 (~14개 문자열)
    - 썸네일 재생성 모달 완전 다국어화 (~30개 문자열)
  - **Priority 2 완료** (중요 - 부분 적용 컴포넌트 2개):
    - 설정 페이지 프롬프트 탭 라벨 및 에러 메시지 i18n 적용
    - 생성 히스토리 목록 선택 삭제 다이얼로그 i18n 적용 (~8개 문자열)
  - **Priority 3 완료** (중간 우선순위 - 25개 컴포넌트):
    - 워크플로우 관련 컴포넌트 6개 완료 (MarkedFieldsGuide, RepeatExecutionStatus, ServerStatusList, GroupAssignment, GraphToolbar, WorkflowJsonViewer, WorkflowViewer)
    - 이미지 그룹 컴포넌트 6개 완료 (GroupCard, AutoFolderGroupCard, ImageViewCard, AutoFolderImageViewCard, AutoCollectTab, GroupBreadcrumb)
    - 설정 하위 컴포넌트 6개 완료 (FolderSettings, WatchedFoldersList, FolderFormDialog, ScanLogModal, FileVerificationLogModal, SimilarityTestPanel)
    - 이미지 생성 컴포넌트 7개 완료 (CustomDropdownListsSection, AutoCollectedWildcardsTab, NAIBasicSettings, NAISamplingSettings, NAIOutputSettings, ComfyUITab, WildcardTab)
  - **Priority 4 완료** (낮은 우선순위 - 7개 컴포넌트):
    - 모달 컴포넌트: FilterBlockModal
    - FilterBuilder 공통 컴포넌트 3개: FilterBlock, FilterConditionCard, FilterGroupCard
    - ImageEditor 공통 컴포넌트 3개: BottomActions, TopBar, RightPanel
  - **지원 언어**: 한국어(ko), 영어(en), 일본어(ja), 중국어 간체(zh-CN), 중국어 번체(zh-TW)
  - **작업 통계**:
    - 총 37개 컴포넌트 완전 다국어화
    - 약 360+개 하드코딩 문자열을 번역 키로 변환
    - 5개 언어 × 360개 = 1,800+개 번역 생성
    - 병렬 처리를 통해 약 2시간 만에 완료 (예상 27-35시간 대비 93% 시간 절감)
  - 모든 하드코딩된 텍스트를 번역 키로 변환하여 언어 전환 시 실시간 반영
  - 상세 작업 내역은 I18N_WORK_PLAN.md 참조

### Features
- **그룹 다운로드 API**: Blob 기반 다운로드 함수 추가
  - `groupApi.downloadGroupBlob()`: 커스텀 그룹 Blob 다운로드
  - `autoFolderGroupsApi.downloadGroup()`: 자동폴더 그룹 Blob 다운로드 (기존)
  - 백엔드 API 변경 없이 프론트엔드만 수정하여 하위 호환성 유지

### Technical Details
**변경된 파일**:
1. `frontend/src/services/api/groupApi.ts` - `downloadGroupBlob()` 함수 추가
2. `frontend/src/pages/ImageGroups/components/GroupImageGridModal.tsx` - Blob 기반 다운로드로 변경
3. `frontend/src/i18n/locales/zh-CN/workflows.json` - 중국어 따옴표 이스케이프
4. `frontend/src/pages/Settings/features/Folder/components/FileVerificationLogModal.tsx` - 타입 수정

**다운로드 메커니즘 변경**:
```typescript
// Before (문제)
window.open(downloadUrl, '_blank');  // 새 창 열림

// After (수정)
await groupApi.downloadGroupBlob(id, type, hashes);  // Blob 다운로드
```

**지원 시나리오**:
- ✅ 커스텀 그룹 전체/선택 다운로드 (썸네일/원본/비디오)
- ✅ 자동폴더 그룹 전체/선택 다운로드 (썸네일/원본/비디오)
- ✅ 100개 이상 다운로드 시 확인 다이얼로그
- ✅ 한글/특수문자 그룹명 ZIP 파일명 처리

**참고 문서**: `build-md/group-download-investigation.md` (상세 조사 결과)

---

## Version 2.0.1a (2025-11-18)

### Bug Fixes
- **Metadata Extraction**: NovelAI V3/V4 형식 호환성 개선 - `TypeError: aiInfo.prompt.trim is not a function` 오류 수정
- **Type Safety**: 메타데이터 파서에 타입 가드 추가하여 문자열/객체 형식 모두 처리
- **Workflow Marked Fields**: 필드 편집 시 발생하던 문제 수정
  - 라벨 수정 시 필드 ID가 동시에 변경되던 문제 해결
  - 필드 ID 입력 시 카드가 축소되고 커서가 해제되던 문제 해결
- **Marked Fields Preview**: 경로 검증 결과의 현재 값 표시 오버플로우 수정
  - 긴 텍스트가 영역을 벗어나던 문제 해결
  - 여러 줄로 깔끔하게 표시되도록 레이아웃 개선
  - 가독성 향상을 위해 monospace 폰트 적용
- **Workflow Path Separator**: 워크플로우 실행 시 경로 구분자 불일치 문제 수정
  - 원본 워크플로우의 Windows 경로(백슬래시)가 Unix 경로(슬래시)로 치환되던 문제 해결
  - 치환 시 원본 값의 경로 구분자 형식을 자동으로 감지하여 유지
  - ComfyUI에서 모델 파일을 찾지 못하는 오류 방지
- **Workflow Dropdown Default Value**: 커스텀 드롭다운 필드의 기본값 자동 선택 기능 추가
  - 워크플로우 진입 시 드롭다운의 첫 번째 항목이 자동으로 선택되도록 수정
  - 값이 비어있을 때 발생하던 빈 값 전송 문제 해결

### Improvements
- **Group Download**: 그룹 다운로드 경로 처리 로직 개선
- **Image Loading**: 이미지 로딩 폴백 및 다운로드 기능 안정성 향상
- **Workflow UI/UX**: Marked Fields 편집 경험 개선
  - 필드 ID를 UI에서 제거하고 내부적으로만 자동 생성되도록 변경
  - 사용자는 라벨(표시 이름)과 JSON Path(워크플로우 경로)만 관리
  - 필드 ID는 최초 생성 시 라벨 기반으로 자동 생성되며 이후 변경되지 않음
  - 확장 상태 추적을 field.id에서 배열 index로 변경하여 안정성 향상
- **Marked Fields Auto-labeling**: 그래프 뷰에서 우클릭으로 필드 추가 시 자동 라벨 생성
  - 형식: `#[노드ID]_[노드제목]([입력타입])` (예: `#190_QP(TEXT)`)
  - 노드 제목과 입력 타입 정보를 자동으로 포함하여 가독성 향상
  - 특수문자는 언더스코어로 자동 변환

### Features
- **ComfyUI Model Import**: 모델 타입별 경로 포함 옵션 추가
  - checkpoints, unet, upscale_models 각각에 대해 전체 경로 포함 여부 선택 가능
  - checkpoints는 기본적으로 전체 경로 포함 (예: `Illustrious/ETC/model.safetensors`)
  - unet, upscale_models는 기본적으로 파일명만 포함 (예: `model.safetensors`)
  - UI에 실시간 예시 표시로 사용자 이해도 향상
- **Custom Dropdown Lists**: 자동 수집 목록 읽기 전용 보기 기능 추가
  - 자동 수집된 커스텀 드롭다운 목록의 항목을 확인할 수 있는 읽기 전용 다이얼로그 추가
  - 편집 버튼을 보기 버튼(눈 아이콘)으로 교체
  - 목록 이름, 설명, 경로 및 전체 항목 목록 표시
  - 편집 불가, 내용 확인만 가능
- **Workflow Dropdown Reference System**: 커스텀 드롭다운 목록 NAME 기반 참조 시스템 구현
  - 워크플로우의 select 필드에서 커스텀 드롭다운 목록을 **이름으로 참조** 가능
  - 드롭다운 목록 수정 시 **연결된 모든 워크플로우에 자동 반영**
  - 자동수집 목록 재생성 시에도 name이 동일하면 연결 유지 (ID 변경에 안전)
  - 워크플로우 실행 시 참조된 목록의 최신 항목 자동 로드
  - UI 개선: 참조 중인 목록 이름 Chip으로 표시, 자동 업데이트 안내
  - 목록 삭제/에러 시 저장된 options 배열로 안전하게 폴백
  - 100% 하위 호환성 유지 (기존 워크플로우는 options 배열 계속 사용)

---

## Version 2.0.0a (2025-11-16)

### Initial Alpha Release
- React-based frontend with Material-UI
- Node.js/TypeScript backend with SQLite
- AI metadata extraction (ComfyUI, NovelAI, Stable Diffusion)
- Auto-collection system
- Prompt management and analysis
- Docker deployment support
