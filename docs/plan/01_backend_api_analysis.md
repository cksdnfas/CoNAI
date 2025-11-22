# 백엔드 API 분석 보고서

> **분석 날짜**: 2025-11-22
> **분석 범위**: 이미지 쿼리 및 반환 로직 전체

---

## 📋 요약

백엔드는 **이중 테이블 아키텍처**로 완전히 마이그레이션되었습니다:
- `media_metadata`: 고유한 이미지 메타데이터 (composite_hash 기반)
- `image_files`: 물리적 파일 위치 추적 (file_id 기반)

모든 주요 라우트가 이 구조로 업데이트되었으며, 일관된 JOIN 패턴과 응답 형식을 사용합니다.

---

## 🗄️ 데이터베이스 아키텍처

### 핵심 테이블

#### 1. media_metadata
- **역할**: 고유한 이미지 콘텐츠당 1개의 레코드
- **Primary Key**: `composite_hash` (이미지: 48자 SHA-384, 비디오: 32자 MD5)
- **포함 데이터**: AI 메타데이터, 크기, 프롬프트, 썸네일, 해시, 태그, 등급

#### 2. image_files
- **역할**: composite_hash당 N개의 파일 레코드 가능
- **Primary Key**: `id` (auto-increment)
- **Foreign Key**: `composite_hash` → media_metadata 참조
- **포함 데이터**: 파일 경로, 크기, MIME 타입, 상태, 폴더 참조

#### 3. image_groups
- **역할**: 이미지를 그룹에 연결
- **식별자**: `composite_hash` 사용 (file_id 아님!)

---

## 🔍 쿼리 패턴 분석

### 패턴 1: 갤러리/목록 뷰 (가장 일반적)

**위치**: `query.routes.ts` GET `/api/images`

**SQL 구조**:
```sql
SELECT
  mm.composite_hash,
  mm.*, -- 모든 메타데이터 필드
  if.id,  -- ← 프론트엔드용 file_id
  if.original_file_path,
  if.file_size,
  if.mime_type,
  if.file_status,
  if.scan_date,
  if.file_type
FROM image_files if
LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
WHERE if.file_status = 'active' AND if.composite_hash IS NOT NULL
ORDER BY mm.first_seen_date DESC
```

**특징**:
- **image_files에서 시작**: 모든 활성 파일 표시
- Phase 1 이미지 필터링 (`composite_hash IS NOT NULL`)
- LEFT JOIN 사용 (비디오는 메타데이터 없을 수 있음)
- `if.id`를 파일 식별자로 반환
- 인덱스 최적화: `idx_files_scan_date_desc`, `idx_metadata_first_seen_desc`

---

### 패턴 2: 검색 쿼리

**위치**: `ImageSearchModel.advancedSearch()`

**SQL 구조**:
```sql
SELECT
  im.*,
  if.id as file_id,
  if.original_file_path,
  if.file_status,
  if.file_size,
  if.mime_type,
  GROUP_CONCAT(DISTINCT g.id) as group_ids,
  GROUP_CONCAT(DISTINCT g.name) as group_names
FROM media_metadata im
LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
LEFT JOIN image_groups ig ON im.composite_hash = ig.composite_hash
LEFT JOIN groups g ON ig.group_id = g.id
WHERE [메타데이터 검색 조건]
GROUP BY im.composite_hash
```

**특징**:
- **media_metadata에서 시작**: 메타데이터 먼저 검색
- 파일 테이블 및 그룹에 LEFT JOIN
- `composite_hash`로 GROUP BY (중복 제거)
- GROUP_CONCAT으로 그룹 정보 집계
- 메타데이터 필드에 검색 조건 (프롬프트, 모델, 크기 등)

---

### 패턴 3: 그룹 이미지

**위치**: `Group.ts` - `ImageGroupModel.findImagesByGroup()`

**SQL 구조**:
```sql
SELECT
  COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
  im.width, im.height, im.thumbnail_path, im.prompt, [등],
  (SELECT id FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as id,
  (SELECT original_file_path FROM image_files WHERE composite_hash = ig.composite_hash LIMIT 1) as original_file_path,
  [파일 필드용 추가 서브쿼리],
  ig.collection_type
FROM image_groups ig
LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
WHERE ig.group_id = ?
GROUP BY ig.composite_hash
ORDER BY ig.order_index ASC, ig.added_date DESC
```

**특징**:
- image_groups에서 시작 (그룹 내용 표시)
- 메타데이터에 LEFT JOIN (비디오는 메타데이터 없을 수 있음)
- 파일 필드에 **서브쿼리 사용** (JOIN 아님) - 해시당 1개 파일 보장
- COALESCE로 비디오 처리
- `composite_hash`로 GROUP BY (중복 제거)

---

### 패턴 4: 유사도 검색

**위치**: `ImageSimilarityModel.findDuplicates()`

**SQL 구조**:
```sql
SELECT
  im.*,
  if.id as file_id,
  if.original_file_path,
  if.file_size,
  if.mime_type,
  if.file_status
FROM media_metadata im
LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
WHERE im.composite_hash != ? AND im.perceptual_hash IS NOT NULL
  AND im.width BETWEEN ? AND ?
  AND im.height BETWEEN ? AND ?
```

**특징**:
- 메타데이터 먼저 필터링 (perceptual_hash 필수)
- 성능을 위한 크기 사전 필터링
- 파일 정보 가져오기 위한 LEFT JOIN
- GROUP BY 없음 (매칭되는 모든 해시 반환)

---

### 패턴 5: 복잡한 필터 검색

**위치**: `ComplexFilterService.buildComplexQuery()`

**SQL 구조**:
```sql
WITH
  excluded AS (SELECT DISTINCT im.composite_hash FROM media_metadata im WHERE [제외 조건]),
  or_results AS (SELECT DISTINCT im.composite_hash FROM media_metadata im WHERE [OR 조건]),
  and_results AS (SELECT DISTINCT im.composite_hash FROM media_metadata im WHERE [AND 조건])
SELECT
  im.*,
  if.id,
  if.original_file_path,
  if.file_status,
  if.file_type,
  if.file_size,
  if.mime_type
FROM media_metadata im
LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
WHERE im.composite_hash IN (SELECT composite_hash FROM or_results)
  AND im.composite_hash IN (SELECT composite_hash FROM and_results)
  AND im.composite_hash NOT IN (SELECT composite_hash FROM excluded)
```

**특징**:
- 복잡한 필터링을 위한 CTE 사용
- 모든 필터가 `composite_hash`로 작동
- 파일 정보 가져오기 위한 최종 JOIN
- GROUP BY 불필요 (CTE가 이미 중복 제거)

---

## 📤 응답 구조

### 표준 이미지 응답 (`enrichImageWithFileView()` 에서)

```typescript
{
  // 식별자
  id: file_id,              // ← 프론트엔드 호환성을 위해 if.id에서 매핑
  composite_hash: string,    // 고유 콘텐츠 식별자

  // 파일 정보
  original_file_path: string,
  file_size: number,
  mime_type: string,
  file_status: 'active',
  file_type: 'original' | 'thumbnail',

  // URL (enrichment에서 생성)
  thumbnail_url: `/api/images/${composite_hash}/thumbnail`,
  image_url: `/api/images/${composite_hash}/download/original`,

  // 메타데이터
  width, height, thumbnail_path,
  prompt, negative_prompt, seed, steps, cfg_scale, sampler,
  model_name, ai_tool, lora_models,
  first_seen_date, rating_score,
  auto_tags: JSON,

  // 그룹 정보 (해당되는 경우)
  groups: [{
    id: number,
    name: string,
    color: string,
    collection_type: 'manual' | 'auto'
  }],

  // 구조화된 AI 메타데이터
  ai_metadata: {
    ai_tool, model_name, lora_models,
    generation_params: { steps, cfg_scale, sampler, seed, ... },
    prompts: { prompt, negative_prompt }
  }
}
```

### 주요 응답 매핑

1. **`id` 필드**: enrichment 함수에서 `if.id` (file_id)로 매핑
2. **`composite_hash`**: 항상 고유 이미지 식별자로 포함
3. **레거시 호환성**: 일부 라우트에서 `upload_date`가 `first_seen_date`로 별칭 지정
4. **그룹 정보**: GROUP_CONCAT 또는 별도 쿼리로 집계

---

## 🆔 File ID vs Composite Hash 사용

### composite_hash가 사용되는 곳 (주요)

1. **모든 메타데이터 작업**: 검색, 필터, 유사도, 통계
2. **그룹 멤버십**: `image_groups.composite_hash`
3. **중복 제거**: GROUP BY composite_hash
4. **API 라우트**: `/api/images/:compositeHash/*`
5. **캐시 키**: QueryCacheService가 composite_hash 사용

### file_id (`image_files.id`)가 사용되는 곳

1. **프론트엔드 표시**: 응답에서 `id` 필드로 매핑
2. **대량 파일 삭제**: DELETE `/api/images/files/bulk`에서 file ID 사용
3. **개별 파일 작업**: 특정 중복 파일 타겟팅 시
4. **선택 기능**: "모두 선택"이 중복 처리를 위해 file ID 반환

### 중요한 인사이트

시스템은 **이중 식별자 전략** 사용:
- **백엔드 로직**: `composite_hash`로 작동 (콘텐츠 기반)
- **프론트엔드 표시**: 호환성을 위해 `id` (파일 기반) 수신
- **중복 제거**: GROUP BY를 통해 composite_hash당 1개 응답

---

## 🔗 JOIN 전략 요약

### LEFT JOIN (가장 일반적)

**사용 위치**: 갤러리 뷰, 검색, 유사도
```sql
FROM image_files if
LEFT JOIN media_metadata mm ON if.composite_hash = mm.composite_hash
```
**이유**:
- 비디오는 아직 메타데이터가 없을 수 있음 (Phase 1)
- 메타데이터 없어도 모든 활성 파일 표시
- 엣지 케이스 우아하게 처리

### INNER JOIN (드물음)

**사용 위치**: 특정 메타데이터 의존 기능
```sql
FROM media_metadata im
INNER JOIN image_files if ON im.composite_hash = if.composite_hash
```
**이유**:
- 메타데이터가 필수인 경우 (예: 프롬프트 검색)
- 메타데이터가 보장될 때 더 나은 성능

### 서브쿼리 패턴 (그룹)

**사용 위치**: 그룹 이미지 목록
```sql
(SELECT id FROM image_files WHERE composite_hash = ig.composite_hash LIMIT 1) as id
```
**이유**:
- 해시당 여러 파일로 인한 JOIN 폭발 방지
- 결과당 정확히 1개 파일 보장

---

## ⚠️ 현재 이슈 및 관찰사항

### 1. **일관되지 않은 JOIN 방향**
- 갤러리: `image_files`에서 시작 → 메타데이터 JOIN
- 검색: `media_metadata`에서 시작 → 파일 JOIN
- **버그 아님**, 다른 사용 케이스를 반영

### 2. **모든 곳에 GROUP BY composite_hash**
- 대부분의 쿼리에서 중복 제거 보장
- 해시당 1개 이미지 의미론 유지에 필수

### 3. **Phase 1 필터 (`composite_hash IS NOT NULL`)**
- 모든 쿼리가 미처리 파일 제외
- 불완전한 이미지 표시 방지
- 백그라운드 프로세서가 누락된 해시 채움

### 4. **응답의 File ID**
- **중요**: 프론트엔드가 `id` 필드 예상
- **해결책**: `enrichImageWithFileView()`가 `file_id` → `id` 매핑
- 하위 호환성을 위해 **보존됨**

### 5. **레거시 Image ID 지원**
- 유사도 라우트가 여전히 숫자 `imageId` 지원 (구 시스템)
- 내부적으로 `composite_hash`로 변환
- 최종적으로 deprecated 예정

---

## 🔧 수정 필요 라우트 (file_id 필터 추가 시)

특정 `file_id`로 쿼리 필요 시 (composite_hash만이 아닌):

### 업데이트할 라우트:
1. **`query.routes.ts`**:
   - GET `/api/images` - 선택적 `file_id` 필터 추가
   - GET `/api/images/:id` - composite_hash와 file_id 모두 지원

2. **`ImageSearchModel.advancedSearch()`**:
   - 검색 파라미터에 `file_id` 추가
   - WHERE 절 수정하여 `if.id = ?` 지원

3. **그룹 라우트** (`groups.ts`):
   - GET `/api/groups/:id/images` - file_id로 필터링 가능
   - `ImageGroupModel.findImagesByGroup()`을 file_id 배열 받도록 수정

4. **유사도 라우트**:
   - 이미 `parseImageIdentifier()`를 통한 이중 지원 있음

### SQL 수정 패턴:
```sql
-- 이전 (해시만)
WHERE im.composite_hash = ?

-- 이후 (둘 다 지원)
WHERE (im.composite_hash = ? OR if.id = ?)
```

---

## 💡 권장사항

### 새 기능용:
1. **항상 `composite_hash` 사용**: 백엔드 로직에서 이미지 식별
2. **`file_id`를 `id`로 반환**: API 응답에서 프론트엔드용
3. **LEFT JOIN 사용**: 메타데이터 필수 아닌 경우 files에서 metadata로
4. **GROUP BY composite_hash**: 결과 중복 제거
5. **file_status = 'active' 필터 포함**: 모든 파일 JOIN에서

### 중복 처리용:
1. **중복 목록**: 동일한 `composite_hash`로 `image_files` 쿼리
2. **특정 파일 삭제**: DELETE 작업에서 `file_id` 사용
3. **갤러리 표시**: GROUP BY가 1개 항목 표시 보장

### 성능 최적화:
1. **인덱스 사용**: 쿼리가 이미 적절한 인덱스로 최적화됨
2. **페이지네이션**: 항상 파일 레벨에서 먼저 적용
3. **캐싱**: `composite_hash`를 캐시 키로 사용 (올바른 접근)

---

## 📝 코드 예시: 일반적인 쿼리 패턴

```typescript
// 백엔드 쿼리 (일반적인 검색)
const query = `
  SELECT
    im.*,                          -- 모든 메타데이터
    if.id as file_id,              -- 프론트엔드 'id' 필드용
    if.original_file_path,         -- 파일 위치
    if.file_size,
    if.mime_type,
    if.file_status
  FROM media_metadata im
  LEFT JOIN image_files if
    ON im.composite_hash = if.composite_hash
    AND if.file_status = 'active'  -- 활성 파일만
  WHERE im.composite_hash IS NOT NULL  -- Phase 2 완료
    AND [검색 조건]
  GROUP BY im.composite_hash         -- 중복 제거
  ORDER BY im.first_seen_date DESC
  LIMIT ? OFFSET ?
`;

// 프론트엔드 수신:
const enriched = results.map(enrichImageWithFileView);
// → { id: file_id, composite_hash: '...', ... }
```

---

## 📊 요약 테이블

| 측면 | 현재 구현 |
|------|---------|
| **주요 식별자** | `composite_hash` (media_metadata.composite_hash) |
| **보조 식별자** | `file_id` (image_files.id) |
| **JOIN 전략** | LEFT JOIN (files ← metadata) 또는 (metadata → files) |
| **중복 제거** | GROUP BY composite_hash |
| **응답 매핑** | enrichImageWithFileView()에서 `file_id` → `id` |
| **레거시 지원** | 유사도 라우트가 구 숫자 ID 허용 |
| **Phase 1 처리** | WHERE composite_hash IS NOT NULL 필터 |
| **그룹 연결** | image_groups.composite_hash |
| **캐시 키** | composite_hash |
| **API 라우트** | `/api/images/:compositeHash/*` |

---

## 📁 분석된 파일

### 라우트 파일:
- `backend/src/routes/images/query.routes.ts` - 갤러리, 검색, 랜덤
- `backend/src/routes/images/complex-search.routes.ts` - 고급 필터링
- `backend/src/routes/images/similarity.routes.ts` - 중복 감지
- `backend/src/routes/images/tagging.routes.ts` - WD Tagger
- `backend/src/routes/images/management.routes.ts` - 삭제 작업
- `backend/src/routes/groups.ts` - 그룹 관리

### 모델 파일:
- `backend/src/models/Image/MediaMetadataModel.ts` - 메타데이터 작업
- `backend/src/models/Image/ImageFileModel.ts` - 파일 추적
- `backend/src/models/Image/ImageSearchModel.ts` - 검색 로직
- `backend/src/models/Image/ImageSimilarityModel.ts` - 유사도
- `backend/src/models/Group.ts` - 그룹 및 이미지-그룹 작업

### 서비스 파일:
- `backend/src/routes/images/utils.ts` - enrichImageWithFileView()
- `backend/src/services/complexFilterService.ts` - 복잡한 필터링

---

## ✅ 결론

코드베이스는 이중 테이블 아키텍처로의 잘 구조화된 마이그레이션을 보여주며, 일관된 패턴과 적절한 중복 제거 전략을 갖추고 있습니다. 모든 주요 라우트가 프론트엔드를 위한 `file_id` 호환성을 유지하면서 `composite_hash`를 주요 식별자로 사용하도록 성공적으로 업데이트되었습니다.
