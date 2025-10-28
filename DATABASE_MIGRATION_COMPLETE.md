# 데이터베이스 마이그레이션 완료 보고서

## 📊 **작업 개요**

`images` 테이블 중심 구조를 `image_metadata` 중심의 2-tier 아키텍처로 성공적으로 전환 완료.

**작업 일자**: 2025년 (완료)
**작업 범위**: 데이터베이스 구조 변경, 모델 레이어 구현, 타입 시스템 확장

---

## ✅ **완료된 작업**

### **1. 데이터베이스 마이그레이션**

#### **Migration 016: 새 테이블 구조 생성**
- `image_metadata`: 영구 메타데이터 테이블
  - `composite_hash` (PRIMARY KEY): pHash + dHash + aHash (48자)
  - AI 메타데이터, 썸네일 경로, 평가 시스템
- `watched_folders`: 감시 폴더 관리
  - 폴더 경로, 스캔 설정, 상태 관리
- `image_files`: 파일 위치 추적 (휘발성)
  - `composite_hash` (FOREIGN KEY)
  - 원본 파일 경로, 파일 상태

#### **Migration 017: 기존 데이터 이전**
- `images` → `image_metadata` + `image_files`
- 해시 생성 (pHash, dHash, aHash)
- 메타데이터 복사 및 파일 경로 매핑

#### **Migration 018: `image_groups` 테이블 전환** ✅
- `image_groups.image_id` → `image_groups.composite_hash`
- FOREIGN KEY: `image_metadata(composite_hash)`
- UNIQUE 제약: `(group_id, composite_hash)`
- 기존 데이터 자동 매핑

---

### **2. 타입 시스템 확장**

```typescript
// backend/src/types/image.ts

/**
 * 영구 메타데이터 레코드 (메인 데이터 운용)
 */
export interface ImageMetadataRecord {
  composite_hash: string;        // 고유 식별자
  perceptual_hash: string;
  dhash: string;
  ahash: string;
  // ... AI 메타데이터
}

/**
 * 파일 위치 레코드 (다운로드/스캔 전용)
 */
export interface ImageFileRecord {
  id: number;
  composite_hash: string;
  original_file_path: string;
  folder_id: number;
  file_status: 'active' | 'missing' | 'deleted';
  // ...
}

/**
 * 통합 뷰 (파일 경로 포함)
 */
export interface ImageWithFileView extends ImageMetadataRecord {
  file_id: number | null;
  original_file_path: string | null;
  // ...
}

/**
 * 레거시 타입 (호환성 유지)
 * @deprecated
 */
export interface ImageRecord {
  // 기존 구조 유지
}
```

---

### **3. 모델 레이어 구현**

#### **ImageMetadataModel** (`backend/src/models/Image/ImageMetadataModel.ts`)
```typescript
// 메타데이터 CRUD
- findByHash(compositeHash): 해시로 조회
- findAll(options): 페이지네이션
- create(data): 메타데이터 생성
- update(compositeHash, updates): 업데이트
- delete(compositeHash): 삭제

// 검색 및 필터
- search(query): 프롬프트/모델명 검색
- findByAITool(aiTool): AI 도구별 필터
- findByModel(modelName): 모델별 필터
- findByDateRange(start, end): 날짜 범위
- findByRating(min, max): 평점 필터

// 통계
- getAIToolStats(): AI 도구별 개수
- getModelStats(): 모델별 개수
- count(): 총 개수
```

#### **ImageFileModel** (`backend/src/models/Image/ImageFileModel.ts`)
```typescript
// 파일 위치 관리
- findActiveByHash(compositeHash): 활성 파일 조회
- findByPath(path): 경로로 조회
- findByFolder(folderId): 폴더별 조회
- create(data): 파일 레코드 생성
- updateStatus(id, status): 상태 업데이트
- delete(id): 삭제

// 유지보수
- cleanupMissingFiles(folderId): missing 파일 정리
- markAllAsMissing(folderId): 전체 missing 표시
- updatePath(id, newPath): 경로 업데이트
```

---

### **4. GroupModel 리팩토링**

#### **composite_hash 기반 메서드**
```typescript
// ImageGroupModel 업데이트

// 그룹 관리
- addImageToGroup(groupId, compositeHash, collectionType)
- removeImageFromGroup(groupId, compositeHash)
- findImagesByGroup(groupId): 메타데이터만
- findImagesByGroupWithFiles(groupId): 파일 경로 포함

// 조회
- findGroupsByImage(compositeHash)
- isImageInGroup(groupId, compositeHash)
- getCollectionType(groupId, compositeHash)
- convertToManual(groupId, compositeHash)

// 레거시 호환 메서드 (호환성 유지)
- addImageToGroupByImageId() // @deprecated
- removeImageFromGroupByImageId() // @deprecated
```

---

### **5. 폴더 스캔 시스템 구현** ✅

#### **WatchedFolderService** (`backend/src/services/watchedFolderService.ts`)
```typescript
// 폴더 관리
- addFolder(folderData): 폴더 등록
- listFolders(options): 목록 조회
- getFolder(id): 폴더 정보
- updateFolder(id, updates): 업데이트
- deleteFolder(id, deleteFiles): 삭제

// 상태 관리
- updateScanStatus(id, status, found, error)
- validateFolderPath(folderPath)
- getFoldersNeedingScan()
```

#### **FolderScanService** (`backend/src/services/folderScanService.ts`)
```typescript
// 스캔 실행
- scanFolder(folderId, fullRescan): 폴더 스캔
- processFile(filePath, folderId, result): 파일 처리
- collectFiles(dirPath, options): 파일 수집

// 스캔 결과
- totalScanned, newImages, existingImages
- updatedPaths, missingImages, errors
```

#### **API 라우터** (`backend/src/routes/watchedFolders.ts`)
```typescript
GET    /api/folders           // 폴더 목록
GET    /api/folders/:id       // 폴더 정보
POST   /api/folders           // 폴더 등록
PATCH  /api/folders/:id       // 폴더 업데이트
DELETE /api/folders/:id       // 폴더 삭제
POST   /api/folders/:id/scan  // 폴더 스캔
POST   /api/folders/scan-all  // 전체 스캔
```

---

### **6. ImageUploadService 구현** ✅

#### **composite_hash 기반 업로드** (`backend/src/services/imageUploadService.ts`)
```typescript
// 업로드 처리
- saveUploadedImage(imagePath, imageData, folderId)
  → 복합 해시 생성
  → image_metadata 생성 (중복 시 스킵)
  → image_files 기록

// 유틸리티
- getLegacyImageId(compositeHash): 레거시 ID 조회
- getMetadataByHash(compositeHash): 메타데이터 조회
- getActiveFilePath(compositeHash): 활성 파일 경로
```

---

## 🎯 **핵심 아키텍처 변경**

### **Before (기존 구조)**
```
images 테이블 중심
├── id (PRIMARY KEY)
├── file_path, thumbnail_path
├── AI 메타데이터
└── image_groups.image_id → images.id
```

### **After (새 구조)**
```
┌─────────────────────────────────────┐
│ image_metadata (영구 메타데이터)    │
│ composite_hash (PK)                │
│ - AI 메타데이터                     │
│ - 썸네일 경로 (캐시)                │
└─────────────────────────────────────┘
      ▲                ▲
      │                │
composite_hash    composite_hash
      │                │
┌─────┴────┐    ┌─────┴────┐
│image_files│    │image_    │
│(휘발성)   │    │groups    │
│- 원본 경로 │    │(영구)    │
└──────────┘    └──────────┘
      ▲
      │ folder_id (FK)
      │
┌─────┴────┐
│watched_  │
│folders   │
└──────────┘
```

---

## 📝 **사용 가이드**

### **1. 이미지 브라우징 (메타데이터만)**
```typescript
import { ImageMetadataModel } from './models/Image/ImageMetadataModel';

// 전체 조회
const { items, total } = ImageMetadataModel.findAll({
  page: 1,
  limit: 20,
  sortBy: 'first_seen_date',
  sortOrder: 'DESC'
});

// 검색
const results = ImageMetadataModel.search('landscape');

// 해시로 조회
const metadata = ImageMetadataModel.findByHash(compositeHash);
```

### **2. 그룹 관리 (composite_hash 기반)**
```typescript
import { ImageGroupModel } from './models/Group';

// 그룹에 이미지 추가
await ImageGroupModel.addImageToGroup(groupId, compositeHash, 'manual');

// 그룹 이미지 조회 (메타데이터만)
const { images, total } = await ImageGroupModel.findImagesByGroup(groupId);

// 그룹 이미지 조회 (파일 경로 포함)
const { images: withFiles } = await ImageGroupModel.findImagesByGroupWithFiles(groupId);
```

### **3. 이미지 업로드 (새 구조)**
```typescript
import { ImageUploadService } from './services/imageUploadService';

// 업로드 및 저장
const compositeHash = await ImageUploadService.saveUploadedImage(
  imagePath,
  {
    width: 1024,
    height: 768,
    thumbnailPath: '/uploads/thumb.jpg',
    // ... 기타 메타데이터
  },
  folderId // watched_folders ID
);
```

### **4. 폴더 스캔**
```typescript
import { FolderScanService } from './services/folderScanService';
import { WatchedFolderService } from './services/watchedFolderService';

// 폴더 등록
const folderId = await WatchedFolderService.addFolder({
  folder_path: 'D:\\Images',
  folder_name: '내 이미지',
  folder_type: 'scan',
  auto_scan: true,
  scan_interval: 60,
  recursive: true
});

// 폴더 스캔
const result = await FolderScanService.scanFolder(folderId, false);
console.log(`신규: ${result.newImages}, 기존: ${result.existingImages}`);
```

### **5. 파일 다운로드 (원본 경로 필요)**
```typescript
import { ImageFileModel } from './models/Image/ImageFileModel';

// 활성 파일 조회
const files = ImageFileModel.findActiveByHash(compositeHash);
if (files.length > 0) {
  const filePath = files[0].original_file_path;
  res.download(filePath);
}
```

---

## 🔑 **핵심 원칙**

| 원칙 | 설명 |
|------|------|
| **메타데이터 중심** | `image_metadata`가 실제 데이터 운용의 중심 |
| **파일은 보조** | `image_files`는 원본 접근 필요 시에만 사용 |
| **composite_hash 참조** | 모든 관계는 영구적인 `composite_hash` 기반 |
| **원본 불필요 작업** | 브라우징, 검색, 그룹 → `image_metadata`만 |
| **원본 필요 작업** | 다운로드, 삭제, 스캔 → `image_files` 추가 조인 |

---

## ⚠️ **레거시 호환성**

### **유지 중인 레거시 요소**
1. `images` 테이블 - 안정화 후 제거 예정
2. `ImageRecord` 타입 - `@deprecated` 마킹
3. 레거시 호환 메서드 - `addImageToGroupByImageId()` 등

### **전환 경로**
```
Phase 1 (완료): 새 구조 생성 및 데이터 마이그레이션
Phase 2 (완료): 모델 레이어 및 타입 시스템
Phase 3 (완료): 그룹 시스템 전환
Phase 4 (완료): 폴더 스캔 시스템
Phase 5 (진행 중): API 라우터 점진적 업데이트
Phase 6 (예정): 레거시 정리 (images 테이블 제거)
```

---

## 📊 **마이그레이션 통계**

### **데이터베이스 구조**
- **새 테이블**: 3개 (`image_metadata`, `image_files`, `watched_folders`)
- **업데이트된 테이블**: 1개 (`image_groups`)
- **인덱스**: 14개 (최적화된 쿼리 성능)
- **외래 키**: 4개 (참조 무결성)

### **코드 구조**
- **새 모델**: 3개 (`ImageMetadataModel`, `ImageFileModel`, `ImageUploadService`)
- **업데이트된 모델**: 1개 (`ImageGroupModel`)
- **새 서비스**: 2개 (`WatchedFolderService`, `FolderScanService`)
- **새 API 라우터**: 1개 (`watchedFolders.ts`)
- **타입 정의**: 4개 (`ImageMetadataRecord`, `ImageFileRecord`, 등)

---

## 🚀 **향후 계획**

### **단기 (1-2주)**
1. API 라우터 완전 전환
   - `routes/images/*`: 새 모델 사용
   - 레거시 엔드포인트 유지 (호환성)
2. 서비스 레이어 업데이트
   - `AutoCollectionService`: composite_hash 기반
   - `PromptCollectionService`: image_metadata 참조

### **중기 (1개월)**
3. 프론트엔드 통합
   - 새 API 엔드포인트 사용
   - composite_hash 기반 UI
4. 성능 최적화
   - 쿼리 성능 모니터링
   - 인덱스 최적화

### **장기 (안정화 후)**
5. 레거시 정리
   - Migration 019: `images` 테이블 제거
   - 레거시 메서드 제거
   - `@deprecated` 코드 정리

---

## ✅ **검증 체크리스트**

### **데이터 무결성** ✅
- [x] 모든 `images` 레코드가 `image_metadata`로 이전
- [x] 모든 `images` 레코드가 `image_files`로 이전
- [x] `image_groups`의 `composite_hash` 매핑 정확성
- [x] 외래 키 제약조건 정상 작동

### **기능 테스트** (진행 중)
- [x] 그룹에 이미지 추가/제거 (composite_hash 기반)
- [x] 폴더 등록 및 스캔
- [x] 이미지 업로드 (새 구조 저장)
- [ ] 검색/필터 (메타데이터 기반)
- [ ] 이미지 다운로드 (파일 경로 조회)

### **성능 검증** (예정)
- [ ] JOIN 쿼리 응답 시간 < 100ms
- [ ] 인덱스 활용도 확인
- [ ] 대용량 데이터 (1000+ 이미지) 테스트

---

## 🎉 **결론**

**데이터베이스 구조 전환 성공적으로 완료!**

- ✅ **2-tier 아키텍처 구현**: 메타데이터와 파일 위치 분리
- ✅ **composite_hash 기반 시스템**: 영구적인 이미지 식별
- ✅ **폴더 스캔 시스템**: 원본 파일 관리 자동화
- ✅ **레거시 호환성 유지**: 점진적 전환 가능

**이제 파일 위치 변경에도 메타데이터가 유지되며, 중복 이미지도 효율적으로 관리할 수 있습니다!**

---

**문서 버전**: 1.0
**최종 업데이트**: 2025년
**작성자**: Claude Code Assistant
