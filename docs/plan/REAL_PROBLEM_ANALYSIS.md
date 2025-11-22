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

## 🔍 그렇다면 문제는 어디에?

### 가설 1: 프론트엔드에서 중복 제거?

확인 필요:
- HomePage/GalleryPage가 받은 데이터를 그대로 표시하는가?
- 혹시 프론트엔드에서 composite_hash로 중복 제거하는가?

### 가설 2: enrichImageWithFileView() 문제?

확인 필요:
- utils.ts의 enrichment 함수가 올바른 파일 정보를 매핑하는가?

### 가설 3: ImageCard 표시 로직?

확인 필요:
- 카드에서 original_file_path를 제대로 표시하는가?
- 혹시 composite_hash로 썸네일 URL만 사용하고 파일 정보는 무시하는가?

---

## 다음 확인 사항

1. ✅ Backend query - 올바름
2. ❓ enrichImageWithFileView() - 확인 필요
3. ❓ Frontend display logic - 확인 필요
4. ❓ ImageCard/MasonryCard - 확인 필요

계속 분석 중...
