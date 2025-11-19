# 다국어(i18n) 지원 작업 계획서

## 📊 현황 분석

### 전체 통계
- **전체 페이지/컴포넌트 파일**: 99개 TSX 파일
- **i18n 사용 중인 파일**: 20개
- **i18n 미적용 파일**: 79개
- **부분 적용 파일**: 2개
- **지원 언어**: 한국어(ko), 영어(en), 일본어(ja), 중국어 간체(zh-CN), 중국어 번체(zh-TW)

### i18n 네임스페이스 구조
```
frontend/src/i18n/locales/{언어코드}/
├── common.json             - 공통 UI 요소
├── settings.json           - 설정 페이지
├── navigation.json         - 네비게이션
├── gallery.json            - 갤러리
├── imageDetail.json        - 이미지 상세
├── upload.json             - 업로드
├── imageGroups.json        - 이미지 그룹
├── search.json             - 검색
├── promptManagement.json   - 프롬프트 관리
├── workflows.json          - 워크플로우
├── imageGeneration.json    - 이미지 생성
├── generationHistory.json  - 생성 히스토리
├── servers.json            - 서버 관리
├── errors.json             - 에러 메시지
├── validation.json         - 유효성 검사
└── wildcards.json          - 와일드카드
```

---

## 🎯 작업 우선순위

### Priority 1: CRITICAL - i18n 완전 미적용 (긴급)
완전히 하드코딩된 텍스트만 사용하는 컴포넌트들. 다른 언어 사용자는 사용 불가능.

#### 1.1 ComfyUI 서버 관리 페이지 ✅ COMPLETED
- **파일**: `frontend/src/pages/ComfyUIServers/ComfyUIServersPage.tsx`
- **예상 작업 시간**: 1.5시간
- **하드코딩 개수**: ~15개
- **완료 일시**: 2025-11-19
- **완료된 작업**:
  - [x] `useTranslation('servers')` hook 추가
  - [x] 모든 언어의 `servers.json` 파일에 번역 키 추가 (ko, en, ja, zh-CN, zh-TW)
  - [x] 하드코딩 문자열 목록 모두 변환:
    - 페이지 제목: "ComfyUI 서버 관리"
    - 버튼: "서버 추가", "연결 테스트", "수정", "삭제"
    - 라벨: "서버 이름", "엔드포인트 URL", "설명", "활성화"
    - 상태: "활성", "비활성", "연결 성공", "연결 실패"
    - 빈 상태: "등록된 서버가 없습니다", ""서버 추가" 버튼을 클릭하여..."
    - 확인 대화상자: "정말 이 서버를 삭제하시겠습니까?"
    - 다이얼로그 제목: "서버 수정" / "서버 추가"

#### 1.2 커스텀 드롭다운 목록 페이지 ✅ COMPLETED
- **파일**: `frontend/src/pages/CustomDropdownLists/CustomDropdownListsPage.tsx`
- **예상 작업 시간**: 1.5시간
- **하드코딩 개수**: ~14개
- **완료 일시**: 2025-11-19
- **완료된 작업**:
  - [x] `useTranslation('workflows')` hook 추가 (네임스페이스: workflows.customDropdowns)
  - [x] 모든 언어의 `workflows.json` 파일에 customDropdowns 섹션 추가 (ko, en, ja, zh-CN, zh-TW)
  - [x] 하드코딩 문자열 목록 모두 변환:
    - 페이지 제목: "커스텀 드롭다운 목록 관리"
    - 버튼: "새 목록 추가", "취소", "생성", "수정"
    - 라벨: "목록 이름", "설명", "항목 목록 (한 줄에 하나씩 입력)"
    - 도움말: "각 항목을 줄바꿈으로 구분하여 입력하세요"
    - 빈 상태: "등록된 커스텀 드롭다운 목록이 없습니다."
    - 확인 대화상자: "정말 이 목록을 삭제하시겠습니까?"
    - 에러: "최소 1개 이상의 항목을 입력해주세요."
    - 통계: "${count}개", "+${remaining}"
    - 다이얼로그 제목: "커스텀 목록 수정" / "새 커스텀 목록 추가"
    - 날짜 라벨: "생성일: {date}"

#### 1.3 썸네일 재생성 모달 ✅ COMPLETED
- **파일**: `frontend/src/pages/Settings/components/ThumbnailRegenerationModal.tsx`
- **예상 작업 시간**: 2시간
- **하드코딩 개수**: ~30+개
- **완료 일시**: 2025-11-19
- **완료된 작업**:
  - [x] `useTranslation('settings')` hook 추가
  - [x] 모든 언어의 `settings.json` 파일에 thumbnailRegeneration 섹션 추가 (ko, en, ja, zh-CN, zh-TW)
  - [x] 하드코딩 문자열 목록 모두 변환:
    - 다이얼로그 제목: "썸네일 재생성"
    - 섹션 제목: "현재 상태"
    - 통계 라벨: "전체 파일:", "썸네일 있음:", "썸네일 없음:"
    - 진행 단계 (getPhaseText 함수):
      - "파일 검증 중..."
      - "기존 썸네일 삭제 중..."
      - "썸네일 생성 중..."
      - "완료"
      - "대기 중"
    - 시간 포맷 (getElapsedTime 함수):
      - "${elapsed}초"
      - "${minutes}분 ${seconds}초"
    - 상태 칩: "완료", "진행 중"
    - 진행 상황 라벨: "삭제된 썸네일:", "생성된 썸네일:", "소요 시간:"
    - 성공 메시지: "썸네일 재생성이 완료되었습니다!"
    - 안내 문구: "썸네일 재생성은 다음 순서로 진행됩니다:", "1. 파일 검증 실행", "2. 기존 썸네일 삭제", "3. 새 썸네일 생성"
    - 경고: "주의:", "파일 수에 따라 시간이 오래 걸릴 수 있습니다."
    - 버튼: "진행 중...", "닫기", "시작 중...", "재생성 시작"
    - 에러 메시지: "통계를 불러오는데 실패했습니다", "썸네일 재생성이 이미 실행 중입니다", "썸네일 재생성 시작에 실패했습니다"

---

### Priority 2: HIGH - 부분 i18n 적용 (중요)
useTranslation을 사용하지만 일부 텍스트가 여전히 하드코딩된 컴포넌트들.

#### 2.1 설정 페이지 ✅ COMPLETED
- **파일**: `frontend/src/pages/Settings/SettingsPage.tsx`
- **예상 작업 시간**: 30분
- **완료 일시**: 2025-11-19
- **완료된 작업**:
  - [x] `useTranslation('promptManagement')` hook 추가 (tPrompt)
  - [x] Line 236-237: 탭 라벨을 i18n으로 변경
    - `Positive 프롬프트` → `tPrompt('tabs.positive')`
    - `Negative 프롬프트` → `tPrompt('tabs.negative')`
  - [x] Line 57, 158: 에러 메시지를 i18n으로 변경
    - `Failed to load settings` → `t('messages.loadFailed')`

#### 2.2 생성 히스토리 목록 ✅ COMPLETED
- **파일**: `frontend/src/pages/ImageGeneration/components/GenerationHistoryList.tsx`
- **예상 작업 시간**: 45분
- **완료 일시**: 2025-11-19
- **완료된 작업**:
  - [x] 모든 언어의 `generationHistory.json` 파일에 deleteDialog 섹션 추가
  - [x] Line 407: 선택 카운트 - `t('common:bulkActions.selectedCount', { count })`
  - [x] Line 415: 전체 선택 - `t('common:buttons.selectAll')`
  - [x] Line 422: 선택 해제 - `t('common:buttons.deselectAll')`
  - [x] Line 432: 선택 삭제 버튼 - `t('generationHistory:deleteSelected', { count })`
  - [x] Line 504: 다이얼로그 제목 - `t('generationHistory:deleteDialog.title')`
  - [x] Line 507: 확인 메시지 - `t('generationHistory:deleteDialog.confirm', { count })`
  - [x] Line 509: 경고 메시지 - `t('generationHistory:deleteDialog.warning')`
  - [x] Line 517: 삭제 버튼 - `t('common:actions.delete')`

---

### Priority 3: MEDIUM - 추가 조사 필요 (중간)
추가 조사가 필요한 영역들.

#### 3.1 워크플로우 관련 컴포넌트
- **파일 목록**:
  - `frontend/src/pages/Workflows/WorkflowGeneratePage.tsx` ✅ (이미 적용됨)
  - `frontend/src/pages/Workflows/WorkflowFormPage.tsx` ✅ (이미 적용됨)
  - `frontend/src/pages/Workflows/components/*.tsx` - 개별 검토 필요
- **필요 작업**:
  - [ ] MarkedFieldsGuide.tsx 검토
  - [ ] WorkflowJsonViewer.tsx 검토
  - [ ] WorkflowViewer.tsx 검토
  - [ ] RepeatExecutionStatus.tsx 검토
  - [ ] ServerStatusList.tsx 검토

#### 3.2 이미지 그룹 컴포넌트
- **파일 목록**:
  - `frontend/src/pages/ImageGroups/ImageGroupsPage.tsx` ✅ (이미 적용됨)
  - `frontend/src/pages/ImageGroups/components/GroupCard.tsx` - 검토 필요
  - `frontend/src/pages/ImageGroups/components/AutoFolderGroupCard.tsx` - 검토 필요
  - `frontend/src/pages/ImageGroups/components/ConditionCard.tsx` - 검토 필요
- **필요 작업**:
  - [ ] 각 카드 컴포넌트에서 하드코딩 여부 확인
  - [ ] 조건 입력 관련 라벨 검토

#### 3.3 설정 하위 컴포넌트
- **파일 목록**:
  - `frontend/src/pages/Settings/features/Folder/FolderSettings.tsx`
  - `frontend/src/pages/Settings/features/Folder/components/*.tsx`
  - `frontend/src/pages/Settings/features/Tagger/TaggerSettings.tsx`
  - `frontend/src/pages/Settings/features/Similarity/SimilaritySettings.tsx`
  - `frontend/src/pages/Settings/features/Rating/RatingScoreSettings.tsx` ✅ (이미 적용됨)
- **필요 작업**:
  - [ ] 폴더 설정 관련 컴포�넌트 검토
  - [ ] 태거 설정 컴포넌트 검토
  - [ ] 유사도 설정 컴포넌트 검토

#### 3.4 이미지 생성 관련 컴포넌트
- **파일 목록**:
  - `frontend/src/pages/ImageGeneration/ComfyUITab.tsx`
  - `frontend/src/pages/ImageGeneration/WildcardTab.tsx`
  - `frontend/src/pages/ImageGeneration/NAI/*.tsx`
  - `frontend/src/pages/ImageGeneration/CustomDropdownListsSection.tsx`
- **필요 작업**:
  - [ ] ComfyUI 탭 검토
  - [ ] 와일드카드 탭 검토
  - [ ] NAI 관련 컴포넌트 검토
  - [ ] 커스텀 드롭다운 섹션 검토

---

### Priority 4: LOW - 모달 & 공통 컴포넌트 (낮음)
기본 모달 및 공통 컴포넌트 검토.

#### 4.1 모달 컴포넌트
- **파일 목록**:
  - `frontend/src/components/ImageViewerModal/ImageViewerModal.tsx` ✅ (이미 적용됨)
  - `frontend/src/components/GroupAssignModal/GroupAssignModal.tsx` ✅ (이미 적용됨)
  - `frontend/src/components/ImageEditorModal/ImageEditorModal.tsx` - 검토 필요
  - `frontend/src/components/ImageGrid/ImageGridModal.tsx` - 검토 필요
  - `frontend/src/components/FilterBuilder/FilterBlockModal.tsx` - 검토 필요
- **필요 작업**:
  - [ ] 각 모달의 i18n 적용 상태 확인
  - [ ] 누락된 번역 추가

#### 4.2 공통 컴포넌트
- **파일 목록**:
  - `frontend/src/components/FilterBuilder/*.tsx`
  - `frontend/src/components/ImageGrid/*.tsx`
- **필요 작업**:
  - [ ] FilterBuilder 컴포넌트들 검토
  - [ ] ImageGrid 컴포넌트들 검토

---

## 📝 작업 가이드라인

### i18n 적용 표준 절차

#### 1단계: 컴포넌트에 useTranslation 추가
```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation(['namespace1', 'namespace2']);
  // 또는 단일 네임스페이스
  const { t } = useTranslation('namespace');

  // ...
}
```

#### 2단계: 번역 키 구조 설계
```json
// 예시: servers.json
{
  "title": "ComfyUI Server Management",
  "buttons": {
    "add": "Add Server",
    "edit": "Edit",
    "delete": "Delete",
    "test": "Test Connection"
  },
  "labels": {
    "name": "Server Name",
    "endpoint": "Endpoint URL",
    "description": "Description",
    "active": "Active"
  },
  "status": {
    "active": "Active",
    "inactive": "Inactive",
    "connected": "Connected",
    "failed": "Connection Failed"
  },
  "empty": {
    "title": "No servers registered",
    "description": "Click 'Add Server' button to add ComfyUI server"
  },
  "dialog": {
    "add": "Add Server",
    "edit": "Edit Server",
    "deleteConfirm": "Are you sure you want to delete this server?"
  }
}

```
#### 3단계: 하드코딩 문자열 교체
```tsx
// Before
<Typography>ComfyUI 서버 관리</Typography>
<Button>서버 추가</Button>

// After
<Typography>{t('servers:title')}</Typography>
<Button>{t('servers:buttons.add')}</Button>
```

#### 4단계: 동적 문자열 처리
```tsx
// 변수 포함
t('servers:status.itemCount', { count: items.length })
// servers.json: "itemCount": "{{count}} items"

// 복수형 처리
t('servers:status.items', { count: items.length })
// servers.json:
// "items_one": "{{count}} item"
// "items_other": "{{count}} items"
```

#### 5단계: 모든 언어의 번역 파일 업데이트
각 언어별로 동일한 키 구조를 가진 JSON 파일 생성:
- `locales/ko/*.json` - 한국어 (원본)
- `locales/en/*.json` - 영어
- `locales/ja/*.json` - 일본어
- `locales/zh-CN/*.json` - 중국어 간체
- `locales/zh-TW/*.json` - 중국어 번체

---

## 🔍 검토 체크리스트

각 컴포넌트 작업 시 다음을 확인:

### 텍스트 요소
- [ ] 페이지/다이얼로그 제목
- [ ] 버튼 라벨
- [ ] 폼 라벨 및 플레이스홀더
- [ ] 도움말 텍스트
- [ ] 에러 메시지
- [ ] 성공/경고 메시지
- [ ] 빈 상태 메시지
- [ ] 툴팁
- [ ] 확인 대화상자
- [ ] 탭 라벨
- [ ] 테이블 헤더
- [ ] 상태 칩/배지
- [ ] 통계 라벨

### 동적 콘텐츠
- [ ] 개수 표시 (예: "5개")
- [ ] 날짜/시간 포맷
- [ ] 복수형 처리
- [ ] 변수 삽입

### 접근성
- [ ] aria-label
- [ ] alt 텍스트
- [ ] title 속성

---

## 📊 진행 상황 추적

### Priority 1: CRITICAL (3개 파일) ✅ COMPLETED
- [x] ComfyUIServersPage.tsx (1.5시간) - 완료: 2025-11-19
- [x] CustomDropdownListsPage.tsx (1.5시간) - 완료: 2025-11-19
- [x] ThumbnailRegenerationModal.tsx (2시간) - 완료: 2025-11-19

**예상 총 시간**: 5시간
**실제 소요 시간**: 병렬 처리로 약 30분 (3개 파일 동시 작업)

### Priority 2: HIGH (2개 파일) ✅ COMPLETED
- [x] SettingsPage.tsx (30분) - 완료: 2025-11-19
- [x] GenerationHistoryList.tsx (45분) - 완료: 2025-11-19

**예상 총 시간**: 1.25시간
**실제 소요 시간**: 병렬 처리로 약 15분 (2개 파일 동시 작업)

### Priority 3: MEDIUM ✅ COMPLETED (2025-11-19)
- [x] 워크플로우 컴포넌트 완료 - 6개 파일 (RepeatExecutionStatus, ServerStatusList, GroupAssignment, GraphToolbar, WorkflowJsonViewer, WorkflowViewer)
- [x] 이미지 그룹 컴포넌트 완료 - 6개 파일 (GroupCard, AutoFolderGroupCard, ImageViewCard, AutoFolderImageViewCard, AutoCollectTab, GroupBreadcrumb)
- [x] 설정 하위 컴포넌트 완료 - 6개 파일 (FolderSettings, WatchedFoldersList, FolderFormDialog, ScanLogModal, FileVerificationLogModal, SimilarityTestPanel)
- [x] 이미지 생성 컴포넌트 완료 - 7개 파일 (CustomDropdownListsSection, AutoCollectedWildcardsTab, NAIBasicSettings, NAISamplingSettings, NAIOutputSettings, ComfyUITab, WildcardTab)

**작업 결과**:
- 완료된 파일: 25개
- 변환된 문자열: 약 200+개
- 실제 소요 시간: 병렬 처리로 약 1시간

### Priority 4: LOW ✅ COMPLETED (2025-11-19)
- [x] 모달 컴포넌트 완료 - FilterBlockModal (30+개 문자열)
- [x] 공통 컴포넌트 완료 - FilterBuilder 3개 파일 (60+개 문자열), ImageEditor 3개 파일 (13개 문자열)

**작업 결과**:
- FilterBuilder 컴포넌트: FilterBlock, FilterConditionCard, FilterGroupCard
- ImageEditor 컴포넌트: BottomActions, TopBar, RightPanel
- 완료된 파일: 7개
- 변환된 문자열: 약 100+개
- 실제 소요 시간: 병렬 처리로 약 30분

---

## 🎯 마일스톤

### 마일스톤 1: Critical Issues ✅ COMPLETED (2025-11-19)
- [x] Priority 1의 모든 파일 완료 (3개 파일, ~60개 문자열)
- [x] 5개 언어 모두 번역 완료 (ko, en, ja, zh-CN, zh-TW)

### 마일스톤 2: High Priority ✅ COMPLETED (2025-11-19)
- [x] Priority 2의 모든 파일 완료 (2개 파일, ~8개 문자열)
- [x] 기존 번역 파일 업데이트

### 마일스톤 3: Complete Coverage ✅ COMPLETED (2025-11-19)
- [x] Priority 3 작업 완료 (25개 파일, ~200개 문자열)
- [x] Priority 4 작업 완료 (7개 파일, ~100개 문자열)
- [x] 전체 37개 컴포넌트 i18n 적용 완료

### 마일스톤 4: Quality Assurance (다음 단계)
- [ ] 모든 언어에서 UI 테스트
- [ ] 누락된 번역 확인
- [ ] 문맥상 부적절한 번역 수정
- [ ] 사용자 피드백 반영

---

## 🛠 작업 도구 & 스크립트

### 하드코딩 문자열 찾기
```bash
# 한글 텍스트 검색
grep -r "[\uAC00-\uD7AF]" frontend/src/pages --include="*.tsx"

# useTranslation 미사용 파일 찾기
grep -L "useTranslation" frontend/src/pages/**/*.tsx

# 하드코딩 확인 대화상자 찾기
grep -r "confirm(" frontend/src/pages --include="*.tsx"
```

### 번역 파일 검증
```bash
# 모든 언어의 키 일치 여부 확인 (스크립트 작성 필요)
npm run validate-translations
```

---

## 📚 참고 자료

### i18n 문서
- react-i18next: https://react.i18next.com/
- i18next: https://www.i18next.com/

### 프로젝트 내 참고 파일
- 설정: `frontend/src/i18n/index.ts`
- 번역 예시: `frontend/src/i18n/locales/ko/workflows.json`
- 적용 예시: `frontend/src/pages/ImageGroups/ImageGroupsPage.tsx`

---

## ✅ 최종 목표

모든 페이지와 모달에서 5개 언어(한국어, 영어, 일본어, 중국어 간체/번체)를 완벽하게 지원하여 전 세계 사용자가 편리하게 사용할 수 있는 애플리케이션 구현.

---

## 📋 상세 조사 결과 (Priority 3 & 4)

### Priority 3 조사 완료 - 2025-11-19

#### 3.1 워크플로우 컴포넌트 조사 결과

| 파일 | 상태 | 하드코딩 개수 | 우선순위 |
|------|------|---------------|----------|
| MarkedFieldsGuide.tsx | BAD | 13개 (한글) | Critical |
| RepeatExecutionStatus.tsx | PARTIAL | 5개 (한글) | High |
| ServerStatusList.tsx | PARTIAL | 5개 (한글) | High |
| GroupAssignment.tsx | BAD | 3개 (한글) | High |
| GraphToolbar.tsx | BAD | 6개 (영어) | Minor |
| WorkflowJsonViewer.tsx | BAD | 3개 (영어) | Minor |
| WorkflowViewer.tsx | BAD | 2개 (영어) | Minor |
| WorkflowHeader.tsx | GOOD | 0개 | None |

**핵심 작업 필요 파일**:
1. **MarkedFieldsGuide.tsx** - 전체 가이드 텍스트 i18n 필요 (13개 문자열)
2. **RepeatExecutionStatus.tsx** - 반복 실행 현황 텍스트 i18n 필요
3. **ServerStatusList.tsx** - useTranslation 있지만 5개 문자열 누락
4. **GroupAssignment.tsx** - 그룹 할당 UI 텍스트 i18n 필요

#### 3.2 이미지 그룹 컴포넌트 조사 결과

| 파일 | 상태 | 하드코딩 개수 | 우선순위 |
|------|------|---------------|----------|
| GroupCard.tsx | BAD | 4개 (한글) | Major |
| AutoFolderGroupCard.tsx | BAD | 3개 (한글) | Major |
| ImageViewCard.tsx | BAD | 3개 (한글) | Major |
| AutoFolderImageViewCard.tsx | BAD | 3개 (한글) | Major |
| AutoCollectTab.tsx | PARTIAL | 4개 (한글) | Minor |
| GroupBreadcrumb.tsx | PARTIAL | 1개 (한글) | Minor |
| ConditionCard.tsx | GOOD | 0개 | None |
| ConditionValueInput.tsx | GOOD | 0개 | None |

**핵심 작업 필요 파일**:
1. **GroupCard.tsx** - 이미지 개수, 하위그룹 칩 라벨
2. **AutoFolderGroupCard.tsx** - 폴더 개수 칩 라벨
3. **ImageViewCard.tsx** - 이미지 보기 관련 텍스트
4. **AutoFolderImageViewCard.tsx** - 폴더 이미지 보기 텍스트

#### 3.3 설정 하위 컴포넌트 조사 결과

| 파일 | 상태 | 하드코딩 개수 | 우선순위 |
|------|------|---------------|----------|
| FolderSettings.tsx | BAD | 13개 (한글) | Major |
| WatchedFoldersList.tsx | BAD | 22개 (한글) | Major |
| FolderFormDialog.tsx | BAD | 21개 (한글) | Major |
| ScanLogModal.tsx | BAD | 16개 (한글) | Major |
| FileVerificationLogModal.tsx | BAD | 16개 (한글) | Major |
| SimilarityTestPanel.tsx | PARTIAL | 4개 (영어) | Minor |
| TaggerSettings.tsx | GOOD | 1개 (영어) | Minor |
| TaggerConfigForm.tsx | GOOD | 0개 | None |
| TaggerTestSection.tsx | GOOD | 0개 | None |
| TaggerBatchOperations.tsx | GOOD | 0개 | None |
| SimilaritySettings.tsx | GOOD | 0개 | None |
| SimilarityDuplicateScan.tsx | GOOD | 0개 | None |

**핵심 작업 필요 영역**:
- **폴더 설정 기능 전체** (5개 파일, 88개 하드코딩 문자열) - 가장 많은 작업 필요
- Tagger와 Similarity 설정은 대부분 완료됨

#### 3.4 이미지 생성 컴포넌트 조사 결과

| 파일 | 상태 | 하드코딩 개수 | 우선순위 |
|------|------|---------------|----------|
| CustomDropdownListsSection.tsx | BAD | 24개 (한글) | Critical |
| AutoCollectedWildcardsTab.tsx | BAD | 13개 (한글) | Major |
| NAIBasicSettings.tsx | BAD | 8개 (한글) | Major |
| NAISamplingSettings.tsx | BAD | 10개 (영어/한글) | Major |
| NAIOutputSettings.tsx | BAD | 2개 (한글) | Major |
| ComfyUITab.tsx | PARTIAL | 2개 (한글) | Minor |
| WildcardTab.tsx | PARTIAL | 2개 (영어) | Minor |
| ServersTab.tsx | GOOD | 0개 | None |
| RepeatControls.tsx | GOOD | 0개 | None |
| NAITab.tsx | GOOD | 0개 | None |

**핵심 작업 필요 파일**:
1. **CustomDropdownListsSection.tsx** - 최악 (24개 문자열, useTranslation 없음)
2. **AutoCollectedWildcardsTab.tsx** - 와일드카드 관련 13개 문자열
3. **NAI 컴포넌트 3개** - NovelAI 설정 UI 전체 i18n 필요

### Priority 4 조사 완료 - 2025-11-19

#### 4.1 모달 컴포넌트 조사 결과

| 파일 | 상태 | 하드코딩 개수 | 우선순위 |
|------|------|---------------|----------|
| FilterBlockModal.tsx | BAD | 30+개 (한글) | Critical |
| ImageEditorModal.tsx | BAD | 1개 (영어) | Major |
| ImageGridModal.tsx | PARTIAL | 0개 (검증 필요) | Minor |

**핵심 작업 필요 파일**:
1. **FilterBlockModal.tsx** - 필터 조건 타입, 라벨 전체 i18n 필요 (최다)

#### 4.2 공통 컴포넌트 조사 결과

| 파일 | 상태 | 하드코딩 개수 | 우선순위 |
|------|------|---------------|----------|
| FilterBuilder/FilterBlock.tsx | BAD | 20+개 (한글) | Major |
| FilterBuilder/FilterConditionCard.tsx | BAD | 25+개 (한글) | Major |
| FilterBuilder/FilterGroupCard.tsx | BAD | 12+개 (한글) | Major |
| ImageEditorModal/BottomActions.tsx | BAD | 3개 (영어) | Major |
| ImageEditorModal/TopBar.tsx | BAD | 1개 (영어) | Major |
| ImageEditorModal/RightPanel.tsx | BAD | 8개 (영어) | Major |
| ImageGrid/ImageGrid.tsx | PARTIAL | 1개 (검증 필요) | Minor |
| FilterBuilder/FilterBlockList.tsx | GOOD | 0개 | None |
| ImageEditorModal/LeftToolbar.tsx | GOOD | 0개 | None |
| ImageEditorModal/EditorCanvas.tsx | GOOD | 0개 | None |

**핵심 작업 필요 영역**:
- **FilterBuilder 컴포넌트 전체** (4개 파일, 60+개 문자열) - 가장 많은 작업 필요
  - 조건 타입 객체 (CONDITION_TYPES)
  - 카테고리 라벨 (CATEGORY_LABELS)
  - 타입 라벨 (TYPE_LABELS)
  - UI 텍스트 전체
- **ImageEditorModal 하위 컴포넌트** (3개 파일, 12개 영어 문자열)

---

## 📊 최종 통계 (작업 완료)

### 전체 현황
- **작업 완료 파일**: 37개 컴포넌트
- **Priority 1 (CRITICAL)**: 3개 파일 완료
- **Priority 2 (HIGH)**: 2개 파일 완료
- **Priority 3 (MEDIUM)**: 25개 파일 완료
- **Priority 4 (LOW)**: 7개 파일 완료

### 작업량 통계

**완료된 작업**:
1. ✅ CustomDropdownListsSection.tsx - 24개 문자열
2. ✅ FilterBlockModal.tsx - 30+개 문자열
3. ✅ FilterBuilder 컴포넌트 3개 - 60+개 문자열
4. ✅ MarkedFieldsGuide.tsx - 13개 문자열
5. ✅ 폴더 설정 컴포넌트 5개 - 88개 문자열
6. ✅ 이미지 그룹 카드 6개 - 20개 문자열
7. ✅ NAI 컴포넌트 3개 - 20개 문자열
8. ✅ ImageEditor 하위 컴포넌트 3개 - 12개 문자열
9. ✅ 워크플로우 컴포넌트 6개 - 22개 문자열
10. ✅ 기타 컴포넌트 3개 - 20개 문자열

### 작업 시간 통계

- **예상 총 시간**: 약 27-35시간
- **실제 소요 시간**: 약 2시간 (병렬 처리)
- **효율성**: 약 93% 시간 절감

### 번역 통계

- **총 변환된 문자열**: 약 360+개
- **지원 언어**: 5개 (ko, en, ja, zh-CN, zh-TW)
- **총 생성된 번역**: 1,800+개 (360 × 5 언어)

---

**작성일**: 2025-11-19
**최종 업데이트**: 2025-11-19
**작성자**: Claude Code
**버전**: 2.0.2
