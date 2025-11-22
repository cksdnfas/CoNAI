# 진짜 문제 분석

> **작성**: 2025-11-22
> **상태**: 긴급 재분석

---

## 🔴 사용자가 지적한 실제 문제

### 문제 상황
```
동일한 이미지를 3개 다른 경로에 업로드:
- /uploads/images/2025-11-21/image1.png
- /uploads/images/2025-11-22/image2.png
- /uploads/API/images/image3.png

현재 갤러리:
✅ 3개 카드 표시됨 (맞음)
❌ 모든 카드에 같은 파일 경로 표시 (틀림!)
❌ 상세 정보도 같은 경로만 표시

결론: composite_hash 기반으로 메타데이터 사용 → 파일별 고유 정보 손실
```

---

## 백엔드 쿼리 확인

### MediaMetadataModel.findAllWithFiles()

**쿼리 (Line 383-388)**:
```sql
SELECT
  mm.*,  -- 메타데이터 (composite_hash 기반)
  if.id,  -- file_id
  if.original_file_path,  -- 파일 경로
  if.file_size,
  if.scan_date,
  if.file_type
FROM image_files if
LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
ORDER BY if.scan_date DESC
LIMIT ? OFFSET ?
```

**✅ 이 쿼리는 올바름!**
- GROUP BY 없음
- 모든 image_files 레코드 반환
- 각 파일의 고유 경로 포함

---

## enrichImageWithFileView() 확인

**파일**: `backend/src/routes/images/utils.ts:72-148`

**구조**:
```typescript
export function enrichImageWithFileView(image: any) {
  const enriched = {
    ...image,  // 모든 필드 spread (original_file_path 포함)
    id: image.file_id || image.id,
    thumbnail_url: ...,
    image_url: ...,
    ai_metadata: { ... }
  };
  return enriched;
}
```

**✅ 이 함수도 올바름!**
- `...image` spread로 모든 필드 보존
- `original_file_path`는 그대로 전달됨

---

## 프론트엔드 데이터 흐름 확인

### 1. useInfiniteImages Hook
**파일**: `frontend/src/hooks/useInfiniteImages.ts:41-43`

```typescript
const images = useMemo(() => {
  return data?.pages.flatMap(page => page.images) ?? [];
}, [data]);
```

**✅ 올바름** - 단순 배열 병합, 중복 제거 없음

### 2. ImageMasonry Component
**파일**: `frontend/src/components/ImageMasonry/ImageMasonry.tsx:209-218`

```typescript
{images.map((image, index) => (
  <MasonryImageCard
    key={image.id ? `id-${image.id}` : `hash-${image.composite_hash}`}
    image={image}  // 전체 image 객체 전달
    ...
  />
))}
```

**✅ 올바름** - 각 이미지의 전체 데이터 전달

### 3. FileInfoSection Display
**파일**: `frontend/src/components/ImageViewerModal/components/FileInfoSection.tsx:44-45`

```typescript
<Typography variant="body2" title={image.original_file_path ?? ''}>
  {t('imageDetail:fileInfo.filename')}: {truncateFilename(image.original_file_path || '')}
</Typography>
```

**✅ 코드 구조 올바름** - image props의 original_file_path를 그대로 표시

---

## 🔍 그렇다면 문제는 어디에?

### 가능성 1: 데이터베이스 데이터 자체가 잘못됨

**확인 필요**:
- 실제로 `image_files` 테이블에 3개 레코드가 다른 `original_file_path`로 저장되어 있는가?
- `MediaMetadataModel.findAllWithFiles()` 쿼리 결과를 직접 로그로 출력

**테스트 방법**:
```typescript
// backend/src/routes/images/query.routes.ts:43-48 수정
const result = await MediaMetadataModel.findAllWithFiles({...});

// ✅ 추가: 결과 로그 출력
console.log('🔍 [Query Result] Sample records:');
result.items.slice(0, 3).forEach((item, idx) => {
  console.log(`  [${idx}] file_id=${item.id}, hash=${item.composite_hash?.substring(0, 8)}, path=${item.original_file_path}`);
});
```

### 가능성 2: enrichImageWithFileView()에서 필드 유실

**확인 필요**:
- spread operator가 제대로 작동하는가?
- TypeScript 타입 변환에서 필드가 누락되는가?

**테스트 방법**:
```typescript
// backend/src/routes/images/utils.ts:72 수정
export function enrichImageWithFileView(image: any) {
  console.log('🔍 [Enrich] Input:', {
    file_id: image.id,
    hash: image.composite_hash?.substring(0, 8),
    path: image.original_file_path
  });

  const enriched = { ...image, ... };

  console.log('🔍 [Enrich] Output:', {
    file_id: enriched.id,
    hash: enriched.composite_hash?.substring(0, 8),
    path: enriched.original_file_path
  });

  return enriched;
}
```

### 가능성 3: 프론트엔드에서 데이터 병합/중복 제거

**확인 필요**:
- React Query가 캐시를 병합할 때 키 충돌이 있는가?
- imageApi 응답 파싱 과정에서 데이터가 손실되는가?

**테스트 방법**:
```typescript
// frontend/src/hooks/useInfiniteImages.ts:41-43 수정
const images = useMemo(() => {
  const result = data?.pages.flatMap(page => page.images) ?? [];
  console.log('🔍 [Hook] First 3 images:', result.slice(0, 3).map(img => ({
    id: img.id,
    hash: img.composite_hash?.substring(0, 8),
    path: img.original_file_path
  })));
  return result;
}, [data]);
```

---

## 다음 단계

1. ✅ 백엔드 쿼리 결과 로그 확인 - **진행 필요**
2. ✅ enrichImageWithFileView 입출력 로그 확인 - **진행 필요**
3. ✅ 프론트엔드 수신 데이터 로그 확인 - **진행 필요**
4. ❓ 실제 데이터베이스 레코드 직접 조회 - **필요 시**

**목표**: 어느 지점에서 `original_file_path`가 동일한 값으로 덮어씌워지는지 정확히 파악

---

## 임시 결론

코드 구조상으로는 **모든 부분이 올바르게 구현**되어 있습니다.
- 백엔드 쿼리: 각 파일별 레코드 반환 ✅
- enrichment: 필드 보존 ✅
- 프론트엔드: 데이터 전달 ✅

**따라서 문제는**:
1. 데이터베이스에 실제로 다른 경로가 저장되지 않았거나
2. 런타임에서 어딘가 예상치 못한 데이터 변형이 발생

**다음 조치**: 실제 런타임 로그를 통해 데이터 흐름 추적
