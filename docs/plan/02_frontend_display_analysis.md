# 프론트엔드 이미지 표시 분석 보고서

> **분석 날짜**: 2025-11-22
> **분석 범위**: 모든 이미지 목록/그리드 표시 컴포넌트

---

## 📋 요약

프론트엔드 코드베이스는 **이중 식별자 시스템**으로 마이그레이션되었습니다:
- **`id` (number)**: 선택 및 UI 인터랙션용 (image_files.id)
- **`composite_hash` (string)**: 메타데이터 작업용 (API 호출: 삭제, 다운로드 등)

---

## 🎯 핵심 발견사항

### ✅ 현재 상태
모든 이미지 표시 컴포넌트가 **이미 올바르게 구현**되어 있습니다:
- 선택 상태: `selectedIds: number[]` (image_files.id 기반)
- API 작업: `composite_hash: string` (삭제, 다운로드 시)
- 변환 레이어: 컴포넌트가 두 식별자 간 매핑 처리
- Null 안전성: Phase 1 처리 상태 완전 대응
- 성능: 대량 선택 시 Set 기반 조회 사용

### ⚠️ 중요한 인사이트
**수정이 필요하지 않습니다!** 마이그레이션은 이미 완료되었으며 올바르게 작동하고 있습니다.

---

## 📱 컴포넌트별 상세 분석

### 1. HomePage (마소니 뷰)

**파일**: `frontend/src/pages/Home/HomePage.tsx`

**현재 구현**:
- `ImageMasonry` 컴포넌트 사용
- 선택 상태: `selectedIds: number[]`
- 데이터 소스: `useInfiniteImages()` 훅
- 무한 스크롤 + 마소니 레이아웃

**코드 예시**:
```typescript
// 선택 관리 (Line 21)
const [selectedIds, setSelectedIds] = useState<number[]>([]);

// 삭제 처리 - id를 composite_hash로 변환 (Lines 35-48)
const handleActionComplete = async (deletedHashes?: string[]) => {
  if (deletedHashes && deletedHashes.length > 0) {
    const deletedImageIds = images
      .filter(img => img.composite_hash && deletedHashes.includes(img.composite_hash))
      .map(img => img.id)
      .filter((id): id is number => id !== undefined);
    setSelectedIds(prev => prev.filter(id => !deletedImageIds.includes(id)));
  }
}
```

**사용하는 식별자**:
- ✅ 선택: `id` (number)
- ✅ API 작업: `composite_hash` (string)
- ✅ React key: 하이브리드 `id-${id}` 또는 `hash-${composite_hash}-${index}`

---

### 2. GalleryPage (그리드 뷰)

**파일**: `frontend/src/pages/Gallery/GalleryPage.tsx`

**현재 구현**:
- `ImageGrid` 컴포넌트 사용
- 선택 상태: `useSelection()` 훅을 통한 `selectedIds: number[]`
- 데이터 소스: 페이지네이션 포함 `useImages()` 훅
- AI 도구별 필터링 및 정렬 지원

**코드 예시**:
```typescript
// 선택 변경 핸들러 (Lines 65-68)
const handleSelectionChange = (newSelectedIds: number[]) => {
  selectAll(newSelectedIds);
};

// 삭제 핸들러 - composite_hash 사용 (Lines 70-77)
const handleImageDelete = async (compositeHash: string) => {
  await deleteImages([compositeHash]);
  const imageToDelete = images.find(img => img.composite_hash === compositeHash);
  if (imageToDelete?.id && selectedIds.includes(imageToDelete.id)) {
    toggleSelection(imageToDelete.id);
  }
};
```

**사용하는 식별자**:
- ✅ 선택: `id` (number)
- ✅ 삭제 작업: `composite_hash` (string)
- ✅ 키 매핑: 선택에서 제거 시 composite_hash에서 id 찾기

---

### 3. SearchPage (검색 결과)

**파일**: `frontend/src/pages/Search/SearchPage.tsx`

**현재 구현**:
- `ImageGrid` 컴포넌트 사용
- 선택 상태: `useSelection()` 훅을 통한 `selectedIds: number[]`
- 데이터 소스: `useSearch()` 훅
- 프롬프트/메타데이터 필터로 복잡한 검색

**코드 예시**:
```typescript
// 선택 관리 (Lines 56-73)
const handleSelectionChange = (newSelectedIds: number[]) => {
  if (newSelectedIds.length === 0) {
    deselectAll();
  } else {
    // ID 차이에 기반한 토글 로직
    const lastSelected = newSelectedIds.find(id => !selectedIds.includes(id));
    if (lastSelected) {
      toggleSelection(lastSelected);
    }
  }
};

// 삭제 핸들러 (Lines 75-82)
const handleImageDelete = async (compositeHash: string) => {
  await deleteImages([compositeHash]);
  const imageToDelete = images.find(img => img.composite_hash === compositeHash);
  if (imageToDelete?.id && selectedIds.includes(imageToDelete.id)) {
    toggleSelection(imageToDelete.id);
  }
};
```

**사용하는 식별자**:
- ✅ 선택: `id` (number)
- ✅ 삭제 작업: `composite_hash` (string)
- ✅ 컨텍스트 인식 작업을 위해 `searchParams`를 ImageGrid에 전달

---

### 4. ImageGroupsPage (그룹 이미지 목록)

**파일**: `frontend/src/pages/ImageGroups/ImageGroupsPage.tsx`

**현재 구현**:
- 두 개 탭: 사용자 정의 그룹과 자동 폴더 그룹
- 그룹 이미지 보기용 `GroupImageGridModal` 사용
- 브레드크럼으로 계층 탐색
- 회전 기능 있는 이미지 미리보기 카드

**코드 예시**:
```typescript
// 모달에서 그룹 이미지 처리 (Lines 159-182)
const fetchGroupImages = async (groupId: number, page: number = 1, pageSize?: PageSize) => {
  const response = await groupApi.getGroupImages(groupId, page, actualPageSize);
  if (response.success && response.data) {
    setGroupImages(response.data.images || []);
  }
};

// 이미지 제거 - composite_hash 사용 (Lines 326-380)
const handleImagesRemoved = async (manualImageIds: string[]) => {
  const result = await groupApi.removeImagesFromGroup(selectedGroupForImages.id, manualImageIds);
  // 모달을 통한 업데이트 처리
};
```

**사용하는 식별자**:
- ✅ 그룹 작업: `groupId` (number)
- ✅ 이미지 제거: `composite_hash` (string 배열)
- ✅ 모달 내 선택: `id` (number)

---

### 5. ImageGrid 컴포넌트 (핵심 그리드)

**파일**: `frontend/src/components/ImageGrid/ImageGrid.tsx`

**현재 구현**:
- 재사용 가능한 페이지네이션 그리드 컴포넌트
- Ctrl/Shift 다중 선택 지원
- ImageCard 및 ImageViewerModal과 통합

**코드 예시**:
```typescript
// Props 정의 (Lines 22-39)
export interface ImageGridProps {
  selectedIds?: number[];  // image_files.id[]
  onSelectionChange?: (selectedIds: number[]) => void;
  onImageDelete?: (compositeHash: string) => void;  // composite_hash
  allImageIds?: number[]; // 뷰어 탐색용
}

// 선택 핸들러 (Lines 106-139)
const handleSelectionChange = (id: number, event?: React.MouseEvent) => {
  // Ctrl+클릭: 토글
  if (event && (event.ctrlKey || event.metaKey)) {
    const newSelectedIds = selectedIds.includes(id)
      ? selectedIds.filter(selectedId => selectedId !== id)
      : [...selectedIds, id];
    onSelectionChange(newSelectedIds);
  }

  // Shift+클릭: 범위 선택
  if (event && event.shiftKey && lastClickedIndex >= 0) {
    const rangeIds = safeImages.slice(start, end + 1)
      .map(img => img.id)
      .filter((id): id is number => id !== undefined);
    onSelectionChange(Array.from(new Set([...selectedIds, ...rangeIds])));
  }
};

// 이미지 키 (Line 291)
key={image.id ? `id-${image.id}` : `hash-${image.composite_hash || 'processing'}-${index}`}
```

**사용하는 식별자**:
- ✅ 선택: `id` (number) - 중복 해시 선택 가능
- ✅ 삭제 콜백: `composite_hash` (string)
- ✅ React key: `id` 우선, `composite_hash`로 폴백
- ✅ 컨텍스트용 모든 ID 가져오기: 뷰어 탐색용 `allImageIds: number[]`

---

### 6. ImageMasonry 컴포넌트 (마소니 그리드)

**파일**: `frontend/src/components/ImageMasonry/ImageMasonry.tsx`

**현재 구현**:
- 무한 스크롤 마소니 레이아웃
- 개별 이미지용 `MasonryImageCard` 사용
- 대량 선택 시 Set 기반 조회로 최적화

**코드 예시**:
```typescript
// Props (Lines 11-19)
interface ImageMasonryProps {
  selectedIds?: number[];  // image_files.id[]
  onSelectionChange?: (selectedIds: number[]) => void;
}

// 성능 최적화 (Line 36)
const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

// 선택 핸들러 (Lines 56-94)
const handleSelectionChange = useCallback((id: number, event?: React.MouseEvent) => {
  // Ctrl/Shift/일반 클릭 처리
  // O(1) 조회를 위한 Set 사용
  const newSelectedIds = selectedSet.has(id)
    ? selectedIds.filter(selectedId => selectedId !== id)
    : [...selectedIds, id];
  onSelectionChange(newSelectedIds);
}, [images, selectedIds, selectedSet]);

// 이미지 키 (Line 211)
key={image.id ? `id-${image.id}` : `hash-${image.composite_hash || 'processing'}-${index}`}

// 선택 확인 (Line 214)
selected={image.id ? selectedSet.has(image.id) : false}
```

**사용하는 식별자**:
- ✅ 선택: Set 최적화와 함께 `id` (number)
- ✅ React key: 하이브리드 접근
- ✅ 삭제 작업 없음 (부모가 처리)

---

### 7. MasonryImageCard 컴포넌트

**파일**: `frontend/src/components/ImageMasonry/MasonryImageCard.tsx`

**현재 구현**:
- 마소니 레이아웃의 개별 카드
- 지연 로딩으로 썸네일 표시
- 배지 표시 (등급, 처리 중, 비디오)

**코드 예시**:
```typescript
// Props (Lines 14-20)
interface MasonryImageCardProps {
  onSelectionChange?: (id: number, event?: React.MouseEvent) => void;  // image_files.id
}

// 선택 핸들러 (Lines 76-86)
const handleSelectionChange = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  if (onSelectionChange && image.id) {
    onSelectionChange(image.id, e);
  }
}, [onSelectionChange, image.id]);

// 썸네일 URL은 composite_hash 사용 (Lines 60-74)
const imageUrl = useMemo(() => {
  if (isProcessing) {
    return `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path)}`;
  }
  if (isVideo || isGif) {
    return `${backendOrigin}/api/images/${image.composite_hash}/file`;
  }
  return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`;
});
```

**사용하는 식별자**:
- ✅ 선택 콜백: `id` (number)
- ✅ 썸네일 URL: `composite_hash` (string)
- ✅ 처리 중 폴백: `original_file_path` (string)

---

### 8. ImageCard 컴포넌트

**파일**: `frontend/src/components/ImageCard/ImageCard.tsx`

**현재 구현**:
- 그리드 레이아웃의 표준 카드
- 다운로드 및 삭제 버튼
- 그룹용 컬렉션 타입 배지

**코드 예시**:
```typescript
// Props (Lines 26-35)
interface ImageCardProps {
  onSelectionChange?: (id: number, event?: React.MouseEvent) => void;  // image_files.id
  onDelete?: (compositeHash: string) => void;  // composite_hash
}

// 선택 (Lines 75-80)
const handleSelectionClick = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  if (onSelectionChange && image.id) {
    onSelectionChange(image.id, e);
  }
});

// 다운로드 (Lines 82-97)
const handleDownload = useCallback((e: React.MouseEvent) => {
  if (image.is_processing || !image.composite_hash) {
    link.href = `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path)}`;
  } else {
    link.href = `${backendOrigin}/api/images/${image.composite_hash}/download/original`;
  }
});

// 삭제 (Lines 99-108)
const handleDelete = useCallback((e: React.MouseEvent) => {
  if (onDelete && image.composite_hash && window.confirm(confirmMessage)) {
    onDelete(image.composite_hash);
  }
});
```

**사용하는 식별자**:
- ✅ 선택: `id` (number)
- ✅ 다운로드: `composite_hash` 또는 `original_file_path` (처리 중)
- ✅ 삭제: `composite_hash` (string)

---

### 9. BulkActionBar 컴포넌트

**파일**: `frontend/src/components/BulkActionBar/BulkActionBar.tsx`

**현재 구현**:
- 대량 작업용 고정 하단 바
- 삭제, 다운로드, 그룹 할당 작업
- 작업을 위해 ID를 해시로 변환

**코드 예시**:
```typescript
// Props (Lines 22-30)
interface BulkActionBarProps {
  selectedIds: number[];  // image_files.id[]
  selectedImages?: ImageRecord[];
  onActionComplete?: (deletedIds?: string[]) => void;  // composite_hash[]
}

// 삭제 핸들러 (Lines 52-86)
const handleDelete = async () => {
  const compositeHashes = selectedImages
    .map(img => img.composite_hash)
    .filter((hash): hash is string => hash !== null);

  const success = await deleteImages(compositeHashes);
  if (success && onActionComplete) {
    onActionComplete(compositeHashes); // 삭제된 해시 반환
  }
};

// 다운로드 핸들러 (Lines 88-95)
const handleDownload = async () => {
  const compositeHashes = selectedImages
    .map(img => img.composite_hash)
    .filter((hash): hash is string => hash !== null);
  await downloadImages(compositeHashes);
};
```

**사용하는 식별자**:
- ✅ 입력: `selectedIds: number[]` 및 `selectedImages: ImageRecord[]`
- ✅ 작업: API 호출을 위해 `composite_hash`로 변환
- ✅ 콜백: 부모가 선택 업데이트하도록 `composite_hash[]` 반환

---

### 10. GroupImageGridModal 컴포넌트

**파일**: `frontend/src/pages/ImageGroups/components/GroupImageGridModal.tsx`

**현재 구현**:
- 그룹 이미지 보기용 모달
- 제거/할당 작업
- 다운로드 옵션 (썸네일/원본/비디오)

**코드 예시**:
```typescript
// 선택 상태 (Line 78)
const [selectedIds, setSelectedIds] = useState<number[]>([]);  // id 기반

// 제거 핸들러 (Lines 124-138)
const handleRemoveConfirm = () => {
  const manualImageIds = selectedImages
    .filter(img => {
      const groupInfo = img.groups?.find(g => g.id === currentGroup?.id);
      return groupInfo?.collection_type === 'manual';
    })
    .map(img => img.composite_hash)
    .filter((hash): hash is string => hash !== null);
  onImagesRemoved(manualImageIds);
};

// 할당 핸들러 (Lines 144-153)
const handleAssignConfirm = async (groupId: number) => {
  const compositeHashes = selectedImages
    .map(img => img.composite_hash)
    .filter((hash): hash is string => hash !== null);
  onImagesAssigned(groupId, compositeHashes);
};

// 다운로드 핸들러 (Lines 213-244)
const startDownload = async (type, scope) => {
  let compositeHashes: string[] | undefined;
  if (scope === 'selected') {
    compositeHashes = selectedImages
      .map(img => img.composite_hash)
      .filter((hash): hash is string => hash !== null);
  }
  await groupApi.downloadGroupBlob(currentGroup.id, type, compositeHashes);
};
```

**사용하는 식별자**:
- ✅ 선택: `id` (number)
- ✅ 제거/할당/다운로드: `composite_hash` (string)
- ✅ 자동 수집 제거 방지를 위해 `collection_type`으로 필터링

---

## 🔄 데이터 흐름 분석

### API 데이터 구조 (ImageRecord)
```typescript
interface ImageRecord {
  id?: number;                    // image_files.id (선택, UI)
  composite_hash: string | null;  // 48자 해시 (작업)
  is_processing?: boolean;        // composite_hash가 NULL일 때 true

  // 파일 정보
  file_id: number | null;
  original_file_path: string | null;

  // 메타데이터
  width: number;
  height: number;
  ai_tool: string | null;
  // ... 기타 메타데이터 필드
}
```

### 선택 흐름
1. **사용자 체크박스 클릭** → `ImageCard.handleSelectionClick(image.id)`
2. **상위 전파** → `ImageGrid.handleSelectionChange(id, event)`
3. **부모 수신** → `HomePage.setSelectedIds([...ids])`
4. **상태 업데이트** → `selectedIds: number[]`

### 삭제 흐름
1. **사용자 삭제 확인** → `BulkActionBar.handleDelete()`
2. **해시로 변환** → `compositeHashes = selectedImages.map(img => img.composite_hash)`
3. **API 호출** → `imageApi.deleteImages(compositeHashes)`
4. **선택 업데이트** → `onActionComplete(compositeHashes)` → 부모가 삭제된 ID 필터링

### 표시 흐름
1. **API 반환** → `id` 및 `composite_hash` 포함한 `ImageRecord[]`
2. **컴포넌트 렌더** → 키에 `id` 사용 (우선) 또는 `composite_hash` 폴백
3. **썸네일 URL** → `${backendOrigin}/api/images/${composite_hash}/thumbnail`
4. **처리 중 이미지** → `original_file_path`로 폴백

---

## 🎯 핵심 패턴 및 규칙

### 1. 이중 식별자 전략
- **선택/UI**: 항상 `id: number` 사용
- **API 작업**: 항상 `composite_hash: string` 사용
- **React 키**: `id` 우선, `composite_hash-${index}`로 폴백

### 2. Null 안전성
모든 코드가 다음을 적절히 처리:
- Phase 1 처리 중 `composite_hash: null`
- 불완전한 레코드의 `id: undefined`
- 필요 시 `original_file_path`로 폴백

### 3. 타입 일관성
```typescript
// 선택 props
selectedIds?: number[];
onSelectionChange?: (selectedIds: number[]) => void;

// 작업 props
onDelete?: (compositeHash: string) => void;
onActionComplete?: (deletedHashes?: string[]) => void;
```

### 4. 변환 패턴
```typescript
// 선택을 작업 ID로 변환
const compositeHashes = selectedImages
  .map(img => img.composite_hash)
  .filter((hash): hash is string => hash !== null);

// 작업 결과를 다시 선택으로 변환
const deletedImageIds = images
  .filter(img => img.composite_hash && deletedHashes.includes(img.composite_hash))
  .map(img => img.id)
  .filter((id): id is number => id !== undefined);
```

---

## ✅ 주의가 필요한 영역

### 1. 모든 이미지 표시 컴포넌트가 이미 업데이트됨
모든 컴포넌트가 이중 식별자 패턴을 올바르게 사용:
- HomePage, GalleryPage, SearchPage, ImageGroupsPage
- ImageGrid, ImageMasonry
- ImageCard, MasonryImageCard
- BulkActionBar, GroupImageGridModal

### 2. 전체적으로 일관된 패턴
- 선택: `id` (number)
- 작업: `composite_hash` (string)
- 키: `id` 우선 하이브리드
- Null 처리: 포괄적

### 3. 파괴적 변경 불필요
마이그레이션이 **완료되었고** **올바르게 작동**하고 있습니다. 모든 컴포넌트가:
- `selectedIds: number[]` 허용
- API 작업을 위해 `composite_hash`로 변환
- Phase 1 이미지를 위한 `is_processing` 상태 처리
- 누락된 식별자를 위한 폴백 제공

---

## 🏁 결론

프론트엔드 코드베이스가 이중 식별자 시스템을 지원하도록 성공적으로 마이그레이션되었습니다. 모든 이미지 목록/그리드 표시 컴포넌트가 일관된 패턴을 따릅니다:

1. **선택 상태**: UI 인터랙션을 위한 `id: number[]`
2. **API 작업**: 백엔드 호출을 위한 `composite_hash: string`
3. **변환 레이어**: 컴포넌트가 두 식별자 간 매핑 처리
4. **Null 안전성**: 모든 코드가 Phase 1 처리 상태 처리
5. **성능**: 대량 선택을 위한 Set 기반 조회

**추가 변경이 필요하지 않습니다.** 시스템은 프로덕션 준비가 완료되었으며 새로운 (composite_hash 기반) 및 처리 중 (경로 기반) 이미지를 모두 올바르게 처리합니다.

---

## 📁 분석된 파일

### 페이지 컴포넌트:
- `frontend/src/pages/Home/HomePage.tsx`
- `frontend/src/pages/Gallery/GalleryPage.tsx`
- `frontend/src/pages/Search/SearchPage.tsx`
- `frontend/src/pages/ImageGroups/ImageGroupsPage.tsx`

### 그리드/목록 컴포넌트:
- `frontend/src/components/ImageGrid/ImageGrid.tsx`
- `frontend/src/components/ImageMasonry/ImageMasonry.tsx`

### 카드 컴포넌트:
- `frontend/src/components/ImageCard/ImageCard.tsx`
- `frontend/src/components/ImageMasonry/MasonryImageCard.tsx`

### 작업 컴포넌트:
- `frontend/src/components/BulkActionBar/BulkActionBar.tsx`
- `frontend/src/pages/ImageGroups/components/GroupImageGridModal.tsx`

### 타입 정의:
- `frontend/src/types/image.ts`
