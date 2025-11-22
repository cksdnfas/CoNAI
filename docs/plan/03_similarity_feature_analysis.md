# 이미지 유사도 검색 기능 분석 보고서

> **분석 날짜**: 2025-11-22
> **분석 범위**: 설정의 이미지 유사도 검색 및 중복 감지 기능

---

## 📋 요약

이미지 유사도 기능은 perceptual hashing(pHash)과 color histogram 분석을 사용하여 중복/유사 이미지를 감지하고 관리합니다. 시스템은 새로운 `composite_hash` 기반 아키텍처와 레거시 `imageId` 시스템을 모두 지원합니다.

---

## 🗂️ 파일 구조

```
frontend/src/pages/Settings/features/Similarity/
├── SimilaritySettings.tsx               # 메인 컨테이너
├── components/
│   ├── SimilaritySystemStatus.tsx       # 해시 생성 상태
│   ├── SimilarityTestPanel.tsx          # 테스트 검색 인터페이스
│   ├── SimilarityResultsDisplay.tsx     # 검색 결과 그리드
│   ├── SimilarityDuplicateScan.tsx      # 중복 감지 및 삭제
│   └── SimilarityThresholds.tsx         # 임계값 설정
├── hooks/
│   ├── useSimilarityStats.ts            # 해시 생성 통계
│   ├── useSimilarityTest.ts             # 테스트 검색 로직
│   └── useDuplicateScan.ts              # 중복 스캔
└── utils/
    └── similarityHelpers.ts             # URL & 라벨 헬퍼
```

---

## 🎯 주요 컴포넌트

### 1. SimilaritySettings.tsx
메인 오케스트레이터:
- 시스템 상태 (해시 생성 진행률)
- 테스트 패널 (composite_hash로 검색)
- 중복 스캔 (전체 데이터베이스 스캔)
- 임계값 설정

### 2. SimilarityDuplicateScan.tsx
**중복 관리 인터페이스** - 가장 중요!

**식별자 사용**:
- ✅ **선택**: `file_id` 사용 (lines 52, 57-66, 74-79, 92)
- ✅ **삭제**: `file_id` 배열로 bulk 삭제

**기능**:
- 체크박스로 다중 선택
- RecycleBin 지원 대량 삭제
- 그룹당 "1개만 유지, 나머지 삭제" 빠른 작업

**코드 예시** (lines 100-130):
```typescript
const handleDeleteSelected = async () => {
  const fileIds = Array.from(selectedImages); // file_id Set → Array
  const result = await imageApi.deleteImageFiles(fileIds);

  if (result.success) {
    alert(t('deleteSuccess', { count: deletedFiles.length }));
    setSelectedImages(new Set()); // 선택 초기화
    onImagesDeleted(); // 재스캔 트리거
  }
};
```

---

## 🔍 이미지 표시 방식

### SimilarityResultsDisplay.tsx

**쿼리 이미지 표시**:
- composite_hash를 ID로 표시 (line 54)
- thumbnail_url 또는 original_file_path 사용
- 메타데이터 표시: 크기, AI 도구, 파일명

**검색 결과 그리드**:
- 4열 반응형 그리드 (line 76)
- 각 결과 표시:
  - 썸네일 이미지
  - 유사도 퍼센트 (0-100 스케일)
  - 매치 타입 배지 (exact, near-duplicate, similar, color-similar)
  - 선택적 색상 유사도 점수

**🔴 중요한 구현 세부사항** (line 78):
```tsx
key={result.image.file_id ? `file-${result.image.file_id}` : `hash-${result.image.composite_hash}-${index}`}
```

**문제점**:
- `file_id` 우선, `composite_hash` 폴백 전략
- 동일 composite_hash의 중복 파일이 있으면 다른 file_id로 여러 결과 포함 가능
- 키 패턴이 `file-XXX`와 `hash-XXX-index` 사이에서 전환됨
- React reconciliation 이슈 발생 가능

**해결책**:
```tsx
key={`${result.image.composite_hash}-${result.image.file_id || index}`}
```

---

## 🆔 식별자 사용: composite_hash vs file_id

### 데이터베이스 구조

```sql
media_metadata (composite_hash가 PRIMARY KEY)
├── composite_hash (48자 SHA-384 truncated)
├── perceptual_hash (16자 hex, 64-bit pHash)
├── dhash, ahash (대체 해시)
├── color_histogram (JSON 직렬화 RGB 배열)
└── width, height, AI 메타데이터...

image_files (id가 PRIMARY KEY)
├── id (file_id)
├── composite_hash (FOREIGN KEY → media_metadata)
├── original_file_path (UNIQUE)
├── file_status ('active' | 'missing' | 'deleted')
└── folder_id, file_size, mime_type...
```

**일대다 관계**:
- 1개 `composite_hash` (고유 이미지 콘텐츠) → N개 `file_id` (중복 파일 위치)
- 예시: 3개 폴더의 동일 이미지 = 1개 메타데이터 레코드 + 3개 파일 레코드

### 컴포넌트별 식별자 사용

| 컴포넌트 | 주 식별자 | 사용 사례 |
|----------|-----------|----------|
| **테스트 검색** | `composite_hash` | API 쿼리 (:id 파라미터) |
| **결과 표시** | 혼합 (file_id 우선) | React keys |
| **중복 그룹** | `file_id` | 선택 & 삭제 |
| **API 라우트** | 둘 다 (이중 모드) | 레거시 호환성 |

### parseImageIdentifier() 로직 (similarity.routes.ts lines 25-33)
```typescript
// ID가 composite_hash인지 레거시 imageId인지 감지
if (!isNaN(numericId) && id === numericId.toString()) {
  return { isHash: false, value: numericId }; // 레거시 imageId
}
return { isHash: true, value: id }; // composite_hash
```

---

## 🗑️ 삭제/제거 작업

### DELETE /api/images/files/bulk

**위치**: `backend/src/routes/images/similarity.routes.ts` (lines 416-528)

**최근 변경사항** (working tree에서 수정됨):
- RecycleBin 지원 추가 (lines 429-436)
- 상세 로깅으로 에러 처리 강화
- 모든 파일 삭제 시 고아 메타데이터 정리

**삭제 흐름**:
1. **fileIds 검증** (숫자여야 함)
2. **각 file_id에 대해:**
   - `ImageFileRecord` 가져오기 (composite_hash, original_file_path 포함)
   - `recycleBinDeleteFile()`로 물리 파일 삭제 (설정 준수)
   - `image_files`에서 DB 레코드 삭제
   - composite_hash에 남은 파일 확인
   - 고아 상태면: 썸네일 + 메타데이터 레코드 삭제

**핵심 로직** (lines 479-508):
```typescript
if (compositeHash) {
  const remainingFiles = ImageFileModel.findActiveByHash(compositeHash);

  if (remainingFiles.length === 0) {
    // 썸네일 삭제 (항상 즉시, 재생성 가능)
    if (metadata.thumbnail_path) {
      await recycleBinDeleteFile(thumbnailPath, false);
    }

    // 메타데이터 레코드 삭제
    MediaMetadataModel.delete(compositeHash);
    orphanedHashes.push(compositeHash);
  }
}
```

**RecycleBin 통합**:
- `settings.general.deleteProtection.enabled`로 활성화
- 활성화 시 원본 파일을 RecycleBin으로 이동
- 썸네일은 항상 즉시 삭제 (재생성 가능)

---

## 🌐 백엔드 API 엔드포인트

### 유사도 검색 라우트 (similarity.routes.ts)

| 엔드포인트 | 메서드 | 목적 | ID 타입 |
|------------|--------|------|---------|
| `/:id/duplicates` | GET | 근접 중복 (임계값 ≤5) | 둘 다 |
| `/:id/similar` | GET | 유사 이미지 (임계값 ≤15) | 둘 다 |
| `/:id/similar-color` | GET | 색상 기반 유사도 | 둘 다 |
| `/duplicates/all` | GET | 모든 중복 그룹 | N/A |
| `/similarity/rebuild` | POST | 해시 재구축 (배치 50) | N/A |
| `/similarity/rebuild-hashes` | POST | 백그라운드 해시 프로세서 | N/A |
| `/similarity/stats` | GET | 해시 완성 통계 | N/A |
| `/files/bulk` | DELETE | file_id로 삭제 | file_id |

### 이중 모드 ID 해결

**모든 `:id` 라우트가 두 식별자 모두 지원:**

1. **composite_hash 경로** (lines 49-64):
   ```typescript
   const image = MediaMetadataModel.findByHash(compositeHash);
   const duplicates = ImageSimilarityModel.findDuplicates(compositeHash, {
     threshold,
     includeMetadata
   });
   ```

2. **레거시 imageId 경로** (lines 66-80):
   ```typescript
   const legacyImage = db.prepare('SELECT perceptual_hash FROM images WHERE id = ?').get(imageId);
   const duplicates = ImageSimilarityModel.findDuplicatesByImageId(imageId, {
     threshold,
     includeMetadata
   });
   ```

**Enrichment 단계** (lines 84-87):
```typescript
const enrichedDuplicates = duplicates.map(item => ({
  ...item,
  image: enrichImageWithFileView(item.image) // file_view_url, thumbnail_url 추가
}));
```

---

## ⚠️ 발견된 이슈

### 🔴 심각한 이슈

**1. 일관성 없는 React 키** (SimilarityResultsDisplay.tsx line 78)
```tsx
key={result.image.file_id ? `file-${result.image.file_id}` : `hash-${result.image.composite_hash}-${index}`}
```

**문제**:
- 동일 composite_hash의 중복 파일 존재 시, 결과에 다른 file_id로 여러 레코드 포함 가능
- 키가 `file-XXX`와 `hash-XXX-index` 패턴 사이 전환
- React reconciliation 이슈 가능

**해결책**:
```tsx
key={`${result.image.composite_hash}-${result.image.file_id || index}`}
```

**2. 중복 그룹에서 file_id 처리 누락** (ImageSimilarityModel.ts lines 244-245)
```typescript
if (!image.file_id) return null; // 조용히 건너뜀
```

**문제**:
- 중복 그룹에 file_id 없는 이미지 있을 수 있음 (고아 메타데이터)
- 자동 필터링이 사용자 혼란 야기 (그룹에서 항목 누락)

**권장사항**:
- file_id 누락 시 경고 로그
- 메타데이터 전용 레코드에 UI 표시자 추가

### 🟡 중간 우선순위 이슈

**3. 테스트 패널이 48자 해시 요구** (useSimilarityTest.ts lines 26-31)
```typescript
const hashPattern = /^[0-9a-fA-F]{48}$/;
if (!hashPattern.test(compositeHash)) {
  alert('Invalid hash format. Expected 48 hexadecimal characters.');
}
```

**문제**:
- UX 장벽 - 사용자가 정확한 composite_hash 알아야 함
- 자동 제안이나 최근 이미지 선택기 없음

**개선안**:
- 최근 이미지에서 composite_hash 선택기 추가
- 부분 해시 검색 지원 (퍼지 매칭)

**4. 레거시 JOIN 쿼리 성능** (ImageSimilarityModel.ts lines 149-155)
```sql
SELECT if.composite_hash
FROM image_files if
JOIN images i ON if.original_file_path LIKE '%' || i.file_path
WHERE i.id = ?
```

**문제**:
- `LIKE '%' || path`는 인덱스 없는 스캔
- 대규모 데이터베이스에서 비효율적

**해결책**:
- 레거시 `images` 테이블에 composite_hash 채우는 마이그레이션 추가
- 레거시 매핑에 인덱스 생성

### 🟢 낮은 우선순위 이슈

**5. 중복 스캔이 불필요하게 새로고침** (SimilaritySettings.tsx lines 95-98)
```typescript
onImagesDeleted={() => {
  handleScanDuplicates(t); // 삭제마다 전체 재스캔
}}
```

**개선안**:
- 전체 재스캔 대신 점진적 업데이트
- 삭제된 그룹의 낙관적 UI 제거

---

## 🧮 유사도 알고리즘 세부사항

### Perceptual Hash 생성 (imageSimilarity.ts)
1. 32×32 grayscale로 리사이즈
2. DCT (Discrete Cosine Transform) 적용
3. 8×8 저주파 영역 추출
4. 중앙값과 비교 → 64비트 바이너리 해시
5. 16자 hex 문자열로 변환

**Hamming Distance 계산**:
- 두 해시를 XOR → 1비트 개수 세기
- Distance 0 = 동일
- Distance 5 = 근접 중복 (리사이즈/압축)
- Distance 15 = 유사 콘텐츠

### Color Histogram
- 32×32 RGB로 리사이즈
- 채널당 256 bin 히스토그램 (R, G, B)
- 0-1 범위로 정규화
- 히스토그램 교차로 유사도 계산

### 임계값 (SIMILARITY_THRESHOLDS)
```typescript
EXACT_DUPLICATE: 0,       // 100% 동일
NEAR_DUPLICATE: 5,        // 리사이즈/압축
SIMILAR: 15,              // 유사 구성
COLOR_SIMILAR: 0.85       // 85% 색상 일치
```

---

## 📊 요약

### 현재 상태

✅ **올바르게 작동 중**:
- 이중 모드 ID 지원 (composite_hash + 레거시)
- 대량 삭제의 RecycleBin 통합
- 고아 메타데이터 정리
- 다단계 유사도 감지

⚠️ **주의 필요**:
- 결과 표시의 React 키 전략
- 테스트 패널 UX (해시 입력)
- 레거시 JOIN 쿼리 성능
- 삭제 후 전체 재스캔

### 아키텍처 전환

시스템은 **하이브리드 모드** - 새로운 `composite_hash` 아키텍처를 완전히 지원하면서 레거시 `imageId` 호환성 유지. 모든 새 개발은 `composite_hash` 메서드를 사용해야 하며, 레거시 메서드는 `@deprecated` 표시.

### 삭제 흐름 요약

```
프론트엔드 (file_id 선택)
  ↓
DELETE /api/images/files/bulk
  ↓
각 file_id에 대해:
  - ImageFileRecord 가져오기 (composite_hash, path)
  - 물리 파일 삭제 (RecycleBin 포함)
  - DB 레코드 삭제 (image_files)
  - composite_hash의 남은 파일 확인
  - 고아 상태면 → 썸네일 + 메타데이터 삭제
  ↓
응답: {deletedFiles[], failedFiles[], orphanedMetadataRemoved}
```

---

## 🔧 필요한 수정사항

### 우선순위 1 (필수)
1. **React 키 전략 수정** - SimilarityResultsDisplay.tsx
2. **file_id 누락 처리** - 경고 로그 및 UI 표시

### 우선순위 2 (권장)
3. **테스트 패널 UX 개선** - composite_hash 선택기 추가
4. **레거시 쿼리 최적화** - 인덱스 및 마이그레이션

### 우선순위 3 (선택)
5. **점진적 스캔 업데이트** - 전체 재스캔 대신

---

## 📁 분석된 파일

### 프론트엔드:
- `frontend/src/pages/Settings/features/Similarity/**/*.tsx` (모든 컴포넌트)
- `frontend/src/pages/Settings/features/Similarity/hooks/**/*.ts` (훅)
- `frontend/src/pages/Settings/features/Similarity/utils/*.ts` (헬퍼)

### 백엔드:
- `backend/src/routes/images/similarity.routes.ts`
- `backend/src/models/Image/ImageSimilarityModel.ts`
- `backend/src/utils/imageSimilarity.ts`
