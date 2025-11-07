# ComfyUI Image Manager - 종합 리팩토링 계획서

**작성일**: 2025-11-07
**대상**: Backend + Frontend 전체 코드베이스
**목표**: 코드 품질 개선, 유지보수성 향상, 기술 부채 해소

---

## 🚀 작업 진행 현황

**마지막 업데이트**: 2025-11-07

### Phase 1: 즉시 제거 가능한 코드 - ✅ 완료

| 작업 | 상태 | 제거 라인 | 완료일 |
|------|------|-----------|--------|
| 1.1 Backend 미사용 파일 제거 | ✅ 완료 | 1,284 lines | 2025-11-07 |
| 1.2 VideoMetadataModel 미사용 메서드 정리 | ✅ 완료 | 110 lines (주석처리) | 2025-11-07 |
| 1.3 API Base URL 중복 정의 통합 | ✅ 완료 | 통합 완료 | 2025-11-07 |

**Phase 1 총 효과**:
- ✅ 제거된 파일: 3개
  - `backend/src/utils/seedTestData.ts` (266 lines)
  - `backend/src/services/folderScanService.ts.backup` (969 lines)
  - `frontend/src/components/PromptDisplay/PromptDisplayExample.tsx` (49 lines)
- ✅ 정리된 메서드: VideoMetadataModel 5개 메서드 (110 lines 주석처리)
- ✅ 중앙화된 설정: API_BASE_URL 통합 (`frontend/src/services/api/config.ts`)
- ✅ TypeScript 빌드: 에러 없음

**다음 단계**: Phase 2 - 중복 기능 통합

### Phase 2: 중복 기능 통합 - 🚧 진행 중

| 작업 | 상태 | 제거/통합 라인 | 완료일 |
|------|------|---------------|--------|
| 2.4 Node 스타일 유틸리티 중복 제거 | ✅ 완료 | 70 lines | 2025-11-07 |
| 2.2 동적 UPDATE 쿼리 빌더 통합 | ✅ 완료 | ~50 lines (Group 모델) | 2025-11-07 |
| 2.1 파일 삭제 로직 중앙화 | ⏳ 예정 | ~200 lines | - |
| 2.3 useRepeatExecution 훅 통합 | ⏳ 예정 | ~150 lines | - |

**Phase 2.4 완료 효과**:
- ✅ 생성된 파일: `frontend/src/pages/Workflows/utils/nodeStyleHelpers.tsx`
- ✅ 중복 제거: `CustomNode.tsx`, `EnhancedCustomNode.tsx`에서 70 lines 제거
- ✅ 중앙화된 함수: `getNodeColor()`, `getNodeIcon()`, `getNodeCategory()`
- ✅ TypeScript 빌드: 에러 없음

**Phase 2.2 완료 효과**:
- ✅ 생성된 파일: `backend/src/utils/dynamicUpdate.ts`
- ✅ 핵심 함수:
  - `buildUpdateQuery()`: 동적 UPDATE 쿼리 생성
  - `sqlLiteral()`: SQL 함수 직접 삽입 (CURRENT_TIMESTAMP 등)
  - `filterDefined()`: undefined 값 필터링
- ✅ 적용 완료: `Group.ts` 모델 (50 lines 단순화)
- ✅ 적용 대기: GenerationHistory, ImageMetadataModel, CustomDropdownList, ComfyUIServer, Workflow, PromptGroup, RatingScore (7개 모델)
- ✅ TypeScript 빌드: 에러 없음
- 📝 나머지 7개 모델은 동일한 패턴으로 추후 적용 가능

---

## 📊 Executive Summary

### 분석 결과 요약

| 영역 | 발견된 이슈 | 영향받는 코드 라인 수 | 우선순위 |
|------|------------|---------------------|---------|
| **Backend 미사용 코드** | 2개 파일, 7개 메서드 | 1,345 lines | High |
| **Frontend 미사용 코드** | 3개 컴포넌트/훅 | 270 lines | Medium |
| **과도한 책임 (SRP 위반)** | 9개 파일 | 5,333 lines | High |
| **중복 기능** | 11건 | 650+ lines | High |
| **복잡도 높은 파일** | 10개 파일 | 6,000+ lines | Medium |
| **라이브러리 개선 기회** | 4건 | N/A | Low-Medium |

**전체 영향도**: 약 13,598 라인 (전체 코드베이스의 ~30%)

### 핵심 개선 효과 예상

- **코드 감소**: ~2,000 라인 제거 가능 (미사용/중복 코드)
- **유지보수성**: 복잡도 30-40% 감소 (관심사 분리)
- **성능**: 라이브러리 업그레이드로 5-10% 향상
- **개발 생산성**: 명확한 구조로 신규 기능 개발 시간 20% 단축

---

## 🔴 Phase 1: 즉시 제거 가능한 코드 (High Priority)

### 1.1 Backend - 완전 미사용 파일 제거

#### ✅ `backend/src/utils/seedTestData.ts` (266 lines)
**상태**: 완전 미사용
**설명**: 테스트 데이터 생성 유틸리티, 프로덕션에서 사용 안 함

**조치**:
```bash
# 옵션 A: 완전 삭제
rm backend/src/utils/seedTestData.ts

# 옵션 B: 테스트 폴더로 이동 (향후 사용 가능성 있는 경우)
mkdir -p backend/tests/fixtures
mv backend/src/utils/seedTestData.ts backend/tests/fixtures/
```

**예상 효과**: 266 lines 제거, 프로덕션 번들 크기 감소

---

#### ✅ `backend/src/services/folderScanService.ts.backup` (969 lines)
**상태**: 백업 파일 (새 구현체로 대체됨)
**설명**: Phase 1/2 스캔 로직의 레거시 백업, `services/folderScan/` 모듈로 이미 교체

**조치**:
```bash
# 즉시 삭제
rm backend/src/services/folderScanService.ts.backup
```

**예상 효과**: 969 lines 제거, 혼란 방지

---

#### ✅ `frontend/src/components/PromptDisplay/PromptDisplayExample.tsx` (49 lines)
**상태**: 완전 미사용
**설명**: 개발/테스트용 예제 컴포넌트, import 없음

**조치**:
```bash
rm frontend/src/components/PromptDisplay/PromptDisplayExample.tsx
```

**예상 효과**: 49 lines 제거

---

### 1.2 Backend - 미사용 모델 메서드 정리

#### ⚠️ `backend/src/models/VideoMetadataModel.ts` - 7개 메서드 미사용
**파일 크기**: 254 lines (43% 미사용)
**현재 사용**: `delete()`, `findByCompositeHash()` 만 사용 중

**미사용 메서드** (110 lines):
```typescript
Line 153: findAll(limit, offset)           // 페이지네이션 쿼리
Line 165: count()                           // 전체 카운트
Line 174: countByAiTool()                   // AI 도구별 통계
Line 192: searchByPrompt(searchTerm)        // 프롬프트 검색
Line 206: searchByTag(tag)                  // 태그 검색
Line 218: findByDateRange(start, end)       // 날짜 범위 검색
Line 230: findByDuration(min, max)          // 길이 범위 검색
```

**조치 옵션**:

**Option A (권장)**: 미사용 메서드 삭제
```typescript
// VideoMetadataModel.ts - 필수 메서드만 유지
export class VideoMetadataModel {
  static async findByCompositeHash(hash: string) { ... }
  static async create(metadata: VideoMetadata) { ... }
  static async update(id: number, updates: Partial<VideoMetadata>) { ... }
  static async delete(id: number) { ... }
}
```

**Option B**: 향후 비디오 검색 기능 구현 예정이라면 주석 추가
```typescript
/**
 * @reserved - 향후 비디오 검색 기능에서 사용 예정
 * @see https://github.com/yourproject/issues/123
 */
static async searchByPrompt(searchTerm: string) { ... }
```

**예상 효과**: 110 lines 제거 또는 명확한 의도 문서화

---

### 1.3 Frontend - 중복/미사용 코드 제거

#### ✅ API Base URL 중복 정의 통합

**현재 상태**: 4개 파일에서 중복 정의
```typescript
// frontend/src/services/api/apiClient.ts
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1566';

// frontend/src/services/backgroundQueueApi.ts (Line 4)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566';

// frontend/src/services/folderApi.ts
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1566';

// frontend/src/services/imageEditorApi.ts (Line 3)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1566';
```

**문제점**:
1. 환경 변수명 불일치 (`VITE_API_URL` vs `VITE_API_BASE_URL`)
2. 수정 시 4곳을 모두 변경해야 함
3. 타입 불일치 가능성

**조치**:
```typescript
// frontend/src/services/api/config.ts (새 파일)
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1566';

// 모든 서비스 파일에서 import
import { API_BASE_URL } from './api/config';
```

**수정 대상 파일**:
- `frontend/src/services/backgroundQueueApi.ts`
- `frontend/src/services/folderApi.ts`
- `frontend/src/services/imageEditorApi.ts`

**예상 효과**: 단일 진실 공급원(Single Source of Truth), 유지보수 용이

---

### 1.4 Phase 1 요약

| 작업 | 파일 수 | 라인 수 | 예상 시간 |
|------|---------|---------|----------|
| 미사용 파일 삭제 | 3 | 1,284 | 30분 |
| 미사용 메서드 정리 | 1 | 110 | 1시간 |
| API URL 통합 | 4 | 15 | 30분 |
| **합계** | **8** | **~1,400** | **2시간** |

---

## 🟠 Phase 2: 중복 기능 통합 (High Priority)

### 2.1 Backend - 파일 삭제 로직 중앙화

#### 🔥 문제점: 6개 서비스에서 삭제 로직 중복 구현

**현재 상황**:
```typescript
// 1. DeletionService (centralized - 권장)
services/deletionService.ts:46    - deletePhysicalFile()
services/deletionService.ts:270   - deleteVideoFiles()
services/deletionService.ts:294   - deleteTempFile()

// 2-6. 중복 구현 (제거 필요)
services/imageProcessor.ts:310         - deleteImageFiles()
services/videoProcessor.ts:411         - deleteVideoFiles()
services/APIImageProcessor.ts:97       - deleteGeneratedImages()
services/tempImageService.ts:129       - deleteTempFile()
services/backgroundProcessorService.ts - inline deletion logic
```

**중복 코드 패턴**:
- RecycleBin 이동 로직 반복 (5번)
- 경로 검증 로직 반복 (6번)
- 에러 핸들링 불일치
- 로깅 형식 다름

**조치**: 모든 삭제를 `DeletionService`로 중앙화

**Step 1**: `DeletionService` 메서드 검증 및 보완
```typescript
// backend/src/services/deletionService.ts
export class DeletionService {
  // 기존 메서드
  static async deletePhysicalFile(filePath: string): Promise<void>
  static async deleteVideoFiles(compositeHash: string): Promise<void>
  static async deleteTempFile(filePath: string): Promise<void>

  // 추가 필요한 메서드
  static async deleteGeneratedImages(imageIds: number[]): Promise<void> {
    // APIImageProcessor에서 이동
  }

  static async deleteImageWithThumbnail(imagePath: string): Promise<void> {
    // ImageProcessor에서 이동
  }
}
```

**Step 2**: 각 서비스 수정
```typescript
// Before: imageProcessor.ts
async deleteImageFiles(imagePath: string) {
  // 50 lines of deletion logic
}

// After: imageProcessor.ts
import { DeletionService } from './deletionService';

async deleteImageFiles(imagePath: string) {
  await DeletionService.deleteImageWithThumbnail(imagePath);
}
```

**수정 대상 파일**:
1. `backend/src/services/imageProcessor.ts` - deleteImageFiles() 제거
2. `backend/src/services/videoProcessor.ts` - deleteVideoFiles() 제거
3. `backend/src/services/APIImageProcessor.ts` - deleteGeneratedImages() 제거
4. `backend/src/services/tempImageService.ts` - deleteTempFile() 제거
5. `backend/src/services/backgroundProcessorService.ts` - inline 로직 제거

**예상 효과**:
- **200 lines 중복 코드 제거**
- 일관된 에러 핸들링
- RecycleBin 로직 버그 수정 시 한 곳만 수정

---

### 2.2 Backend - 동적 UPDATE 쿼리 빌더 통합

#### 🔥 문제점: 8개 모델에서 동일한 패턴 반복

**현재 패턴** (모든 모델에서 반복):
```typescript
// 동일한 로직이 8개 파일에 존재
const fields: string[] = [];
const values: any[] = [];

if (name !== undefined) {
  fields.push('name = ?');
  values.push(name);
}
if (description !== undefined) {
  fields.push('description = ?');
  values.push(description);
}

const sql = `UPDATE table SET ${fields.join(', ')} WHERE id = ?`;
values.push(id);

db.run(sql, values);
```

**영향받는 파일** (350+ lines 총합):
1. `backend/src/models/GenerationHistory.ts` - 80 lines
2. `backend/src/models/Group.ts` - 50 lines
3. `backend/src/models/Image/ImageMetadataModel.ts` - 60 lines
4. `backend/src/models/CustomDropdownList.ts` - 45 lines
5. `backend/src/models/ComfyUIServer.ts` - 40 lines
6. `backend/src/models/Workflow.ts` - 35 lines
7. `backend/src/models/PromptGroup.ts` - 20 lines
8. `backend/src/models/RatingScore.ts` - 20 lines

**조치**: 공통 유틸리티 생성

**Step 1**: 유틸리티 함수 작성
```typescript
// backend/src/utils/dynamicUpdate.ts
export interface UpdateQueryResult {
  sql: string;
  values: any[];
}

/**
 * 동적 UPDATE 쿼리 빌더
 * @param table - 테이블 명
 * @param updates - 업데이트할 필드 { fieldName: value }
 * @param where - WHERE 조건 { fieldName: value }
 * @returns SQL 문자열과 바인딩 값
 */
export function buildUpdateQuery(
  table: string,
  updates: Record<string, any>,
  where: Record<string, any>
): UpdateQueryResult {
  const fields: string[] = [];
  const values: any[] = [];

  // SET 절 생성
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  // WHERE 절 생성
  const whereFields: string[] = [];
  Object.entries(where).forEach(([key, value]) => {
    whereFields.push(`${key} = ?`);
    values.push(value);
  });

  const sql = `UPDATE ${table} SET ${fields.join(', ')} WHERE ${whereFields.join(' AND ')}`;

  return { sql, values };
}

/**
 * 선택적 필드 필터링
 * undefined 값 제거
 */
export function filterDefined<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  ) as Partial<T>;
}
```

**Step 2**: 모델 리팩토링 예시
```typescript
// Before: backend/src/models/Group.ts
async update(id: number, updates: Partial<GroupData>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  // ... 10+ more fields

  const sql = `UPDATE groups SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  await db.run(sql, values);
}

// After: backend/src/models/Group.ts
import { buildUpdateQuery, filterDefined } from '../utils/dynamicUpdate';

async update(id: number, updates: Partial<GroupData>): Promise<void> {
  const { sql, values } = buildUpdateQuery(
    'groups',
    filterDefined(updates),
    { id }
  );
  await db.run(sql, values);
}
```

**수정 대상**: 위 8개 모델 파일 전부

**예상 효과**:
- **250+ lines 보일러플레이트 제거**
- 일관된 쿼리 생성 로직
- SQL 인젝션 방지 통일
- 단위 테스트 용이

---

### 2.3 Frontend - useRepeatExecution 훅 통합

#### 🔥 문제점: 2개의 다른 구현체 존재

**파일 비교**:
```typescript
// 1. ComfyUI용 (75 lines)
frontend/src/pages/Workflows/hooks/useRepeatExecution.ts
- 다중 서버 지원
- 서버별 큐 관리
- 배치 실행

// 2. NovelAI용 (151 lines)
frontend/src/pages/ImageGeneration/NAI/hooks/useRepeatExecution.ts
- 단일 실행
- 반복 로직만
- 간단한 상태 관리
```

**차이점 분석**:
| 기능 | ComfyUI 버전 | NAI 버전 |
|------|--------------|----------|
| 다중 서버 | ✅ | ❌ |
| 큐 관리 | ✅ | ❌ |
| 반복 실행 | ✅ | ✅ |
| 에러 핸들링 | 복잡 | 단순 |

**조치**: 설정 가능한 단일 훅으로 통합

**Step 1**: 통합 훅 작성
```typescript
// frontend/src/hooks/useRepeatExecution.ts
export interface RepeatExecutionConfig {
  mode: 'single' | 'multi-server';
  maxRetries?: number;
  onSuccess?: (result: any) => void;
  onError?: (error: Error) => void;
}

export function useRepeatExecution(config: RepeatExecutionConfig) {
  // 공통 로직
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<Error[]>([]);

  // mode에 따라 다른 실행 로직
  const execute = useCallback(async (count: number, params: any) => {
    if (config.mode === 'single') {
      return executeSingle(count, params);
    } else {
      return executeMultiServer(count, params);
    }
  }, [config.mode]);

  return { execute, isExecuting, progress, errors };
}
```

**Step 2**: 각 페이지에서 사용
```typescript
// Workflows 페이지
const repeatExec = useRepeatExecution({
  mode: 'multi-server',
  onSuccess: handleSuccess
});

// NAI 페이지
const repeatExec = useRepeatExecution({
  mode: 'single',
  maxRetries: 3
});
```

**예상 효과**:
- **150 lines 중복 제거**
- 통일된 사용자 경험
- 버그 수정 시 한 곳만 수정

---

### 2.4 Frontend - Node 스타일 유틸리티 중복 제거

#### 🔥 문제점: 동일한 함수 2개 파일에 중복

**중복 코드**:
```typescript
// frontend/src/pages/Workflows/components/nodes/CustomNode.tsx (Lines 23-57)
function getNodeColor(type: string): string {
  if (type === 'KSampler') return '#4CAF50';
  if (type === 'VAEDecode') return '#2196F3';
  // ... 20+ more lines
}

function getNodeIcon(type: string): IconType {
  if (type === 'KSampler') return FiCpu;
  if (type === 'VAEDecode') return FiImage;
  // ... 15+ more lines
}

// frontend/src/pages/Workflows/components/nodes/EnhancedCustomNode.tsx (Lines 23-58)
// 완전히 동일한 함수 복사-붙여넣기
```

**조치**: 공통 유틸리티로 추출

**Step 1**: 유틸리티 파일 생성
```typescript
// frontend/src/pages/Workflows/utils/nodeStyleHelpers.ts
import { IconType } from 'react-icons';
import { FiCpu, FiImage, /* ... */ } from 'react-icons/fi';

/**
 * ComfyUI 노드 타입에 따른 색상 반환
 */
export function getNodeColor(type: string): string {
  const colorMap: Record<string, string> = {
    'KSampler': '#4CAF50',
    'VAEDecode': '#2196F3',
    'CheckpointLoaderSimple': '#FF9800',
    // ... 전체 매핑
  };
  return colorMap[type] || '#9E9E9E'; // 기본 색상
}

/**
 * ComfyUI 노드 타입에 따른 아이콘 반환
 */
export function getNodeIcon(type: string): IconType {
  const iconMap: Record<string, IconType> = {
    'KSampler': FiCpu,
    'VAEDecode': FiImage,
    'CheckpointLoaderSimple': FiDatabase,
    // ... 전체 매핑
  };
  return iconMap[type] || FiBox; // 기본 아이콘
}

/**
 * 노드 타입 카테고리 분류
 */
export function getNodeCategory(type: string): string {
  if (type.includes('Sampler')) return 'sampling';
  if (type.includes('VAE')) return 'vae';
  if (type.includes('Loader')) return 'loader';
  // ... 카테고리 로직
  return 'other';
}
```

**Step 2**: 양쪽 컴포넌트에서 import
```typescript
// CustomNode.tsx & EnhancedCustomNode.tsx
import { getNodeColor, getNodeIcon } from '../../utils/nodeStyleHelpers';

// 함수 정의 제거, import만 사용
```

**예상 효과**:
- **70 lines 중복 제거**
- 노드 스타일 일관성 보장
- 새 노드 타입 추가 시 한 곳만 수정

---

### 2.5 Phase 2 요약

| 작업 | 파일 수 | 제거 라인 | 예상 시간 |
|------|---------|-----------|----------|
| 삭제 로직 중앙화 | 6 | 200 | 4시간 |
| UPDATE 빌더 통합 | 8 | 250 | 3시간 |
| useRepeatExecution 통합 | 2 | 150 | 2시간 |
| Node 스타일 유틸 | 2 | 70 | 1시간 |
| **합계** | **18** | **~670** | **10시간** |

---

## 🟡 Phase 3: 과도한 책임 분리 (Medium-High Priority)

### 3.1 Backend - 대형 모델 파일 분할

#### 📦 ImageMetadataModel.ts (548 lines) → 4개 파일로 분할

**현재 문제**: 5가지 책임이 하나의 파일에 혼재

**책임 분석**:
1. **CRUD Operations** (Lines 1-200): 기본 생성/읽기/수정/삭제
2. **Search & Filtering** (Lines 200-350): 복잡한 쿼리 빌딩
3. **AI Tool Queries** (Lines 350-420): 도구별 조회
4. **Statistics** (Lines 420-500): 집계 및 통계
5. **File Management** (Lines 500-548): 경로 해결

**리팩토링 계획**:

```
backend/src/models/Image/
├── ImageMetadataModel.ts        (150 lines) - 핵심 CRUD만
├── ImageQueryBuilder.ts         (200 lines) - 검색/필터 로직
├── ImageStatsModel.ts           (150 lines) - 통계 쿼리
└── ImageFileResolver.ts         (50 lines)  - 파일 경로 관리
```

**Step 1**: ImageMetadataModel.ts (핵심 CRUD)
```typescript
// backend/src/models/Image/ImageMetadataModel.ts
export class ImageMetadataModel {
  // 기본 CRUD만 유지
  static async create(metadata: ImageMetadata): Promise<number>
  static async findById(id: number): Promise<ImageMetadata | null>
  static async update(id: number, updates: Partial<ImageMetadata>): Promise<void>
  static async delete(id: number): Promise<void>
  static async findByCompositeHash(hash: string): Promise<ImageMetadata | null>

  // 복잡한 쿼리는 다른 클래스로 위임
  static query = ImageQueryBuilder;
  static stats = ImageStatsModel;
  static files = ImageFileResolver;
}
```

**Step 2**: ImageQueryBuilder.ts (검색/필터)
```typescript
// backend/src/models/Image/ImageQueryBuilder.ts
export class ImageQueryBuilder {
  static async search(params: SearchParams): Promise<ImageMetadata[]>
  static async filterByAiTool(tool: string): Promise<ImageMetadata[]>
  static async filterByDateRange(start: Date, end: Date): Promise<ImageMetadata[]>
  static async filterByTags(tags: string[]): Promise<ImageMetadata[]>
  static async complexFilter(filters: ComplexFilters): Promise<ImageMetadata[]>
}

// 사용 예시
const results = await ImageMetadataModel.query.search({ keyword: 'landscape' });
```

**Step 3**: ImageStatsModel.ts (통계)
```typescript
// backend/src/models/Image/ImageStatsModel.ts
export class ImageStatsModel {
  static async countByAiTool(): Promise<Record<string, number>>
  static async getUploadTrends(days: number): Promise<TrendData[]>
  static async getPopularTags(limit: number): Promise<TagStats[]>
  static async getDiskUsage(): Promise<{ total: number; byTool: Record<string, number> }>
}

// 사용 예시
const toolStats = await ImageMetadataModel.stats.countByAiTool();
```

**Step 4**: ImageFileResolver.ts (파일 경로)
```typescript
// backend/src/models/Image/ImageFileResolver.ts
export class ImageFileResolver {
  static resolveImagePath(metadata: ImageMetadata): string
  static resolveThumbnailPath(metadata: ImageMetadata): string
  static resolveOriginalPath(metadata: ImageMetadata): string | null
  static ensurePathExists(path: string): Promise<void>
}
```

**마이그레이션 전략**:
1. 새 파일 생성 및 기능 이동
2. `ImageMetadataModel`에 위임 메서드 추가 (하위 호환성)
3. 라우트/서비스에서 새 API로 점진적 이동
4. 레거시 메서드 제거

**예상 효과**:
- 파일당 평균 150 lines로 축소
- 각 클래스의 명확한 책임
- 단위 테스트 용이
- 병렬 개발 가능

---

#### 📦 ImageSearchModel.ts (601 lines) → 3개 파일로 분할

**리팩토링 계획**:

```
backend/src/models/Image/
├── ImageSearchModel.ts          (200 lines) - 핵심 검색만
├── SearchFilterBuilder.ts       (250 lines) - 필터 생성
└── TagSearchService.ts          (150 lines) - 태그 특화 검색
```

**핵심 변경**:
```typescript
// Before
await ImageSearchModel.complexSearch({ filters, tags, dateRange, ... });

// After
const filters = SearchFilterBuilder.build({ dateRange, aiTool, ... });
const results = await ImageSearchModel.search(filters);
const tagResults = await TagSearchService.searchByTags(['landscape', 'sunset']);
```

---

### 3.2 Backend - 대형 라우트 파일 분할

#### 📦 query.routes.ts (845 lines) → 4개 파일로 분할

**현재 문제**: 너무 많은 엔드포인트가 한 파일에

**책임 분석**:
1. **Gallery Queries** (Lines 1-200): 이미지 목록 조회
2. **Search Endpoints** (Lines 200-400): 검색 API
3. **File Serving** (Lines 400-600): 이미지/썸네일 제공
4. **Download Management** (Lines 600-845): 일괄 다운로드

**리팩토링 계획**:

```
backend/src/routes/images/
├── gallery.routes.ts            (200 lines) - GET /api/images
├── search.routes.ts             (200 lines) - GET /api/images/search
├── serve.routes.ts              (200 lines) - GET /api/images/:id/file
└── download.routes.ts           (245 lines) - POST /api/images/download
```

**Step 1**: gallery.routes.ts
```typescript
// backend/src/routes/images/gallery.routes.ts
import { Router } from 'express';

const router = Router();

/**
 * GET /api/images
 * 이미지 갤러리 조회 (페이지네이션)
 */
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, sort } = req.query;
  // ... 갤러리 로직만
}));

/**
 * GET /api/images/:id
 * 단일 이미지 메타데이터 조회
 */
router.get('/:id', asyncHandler(async (req, res) => {
  // ... 상세 조회 로직
}));

export default router;
```

**Step 2**: serve.routes.ts
```typescript
// backend/src/routes/images/serve.routes.ts
import { Router } from 'express';

const router = Router();

/**
 * GET /api/images/:id/file
 * 원본 이미지 파일 제공 (ETag 캐싱)
 */
router.get('/:id/file', asyncHandler(async (req, res) => {
  // ... 파일 서빙 로직
  // ETag 생성 및 캐싱
}));

/**
 * GET /api/images/:id/thumbnail
 * 썸네일 이미지 제공
 */
router.get('/:id/thumbnail', asyncHandler(async (req, res) => {
  // ... 썸네일 로직
}));

export default router;
```

**Step 3**: 메인 라우터에서 통합
```typescript
// backend/src/routes/images/index.ts
import galleryRoutes from './gallery.routes';
import searchRoutes from './search.routes';
import serveRoutes from './serve.routes';
import downloadRoutes from './download.routes';

const router = Router();

router.use('/', galleryRoutes);
router.use('/search', searchRoutes);
router.use('/', serveRoutes);
router.use('/download', downloadRoutes);

export default router;
```

---

#### 📦 tagging.routes.ts (709 lines) → 4개 파일로 분할

**리팩토링 계획**:

```
backend/src/routes/images/tagging/
├── crud.routes.ts               (150 lines) - 태그 CRUD
├── auto-tag.routes.ts           (300 lines) - 자동 태깅
├── stats.routes.ts              (150 lines) - 태그 통계
└── daemon.routes.ts             (109 lines) - 데몬 제어
```

---

### 3.3 Frontend - 대형 페이지 컴포넌트 리팩토링

#### 📦 WorkflowFormPage.tsx (511 lines)

**현재 문제**: 7가지 책임 혼재

**책임 분석**:
1. 폼 상태 관리 (name, description, JSON, active, color)
2. JSON 파싱 및 유효성 검사
3. Marked Fields 관리
4. 파일 업로드 처리
5. 탭 UI 관리
6. 저장/로드 작업
7. Color picker debouncing

**리팩토링 계획**:

```
frontend/src/pages/Workflows/
├── WorkflowFormPage.tsx         (150 lines) - 오케스트레이터만
├── hooks/
│   └── useWorkflowFormState.ts  (100 lines) - 상태 관리 훅
├── components/
│   ├── WorkflowMetadataForm.tsx (100 lines) - 기본 정보 폼
│   ├── WorkflowJsonEditor.tsx   (150 lines) - JSON 에디터 + 검증
│   └── MarkedFieldsManager.tsx  (현재 분리됨)
```

**Step 1**: useWorkflowFormState.ts (Custom Hook)
```typescript
// frontend/src/pages/Workflows/hooks/useWorkflowFormState.ts
export function useWorkflowFormState(initialData?: Workflow) {
  const [formData, setFormData] = useState<WorkflowFormData>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    // ...
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateField = useCallback((field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    validateField(field, value);
  }, []);

  const validate = useCallback(() => {
    // 전체 검증 로직
  }, [formData]);

  const submit = useCallback(async () => {
    if (!validate()) return;
    // 제출 로직
  }, [formData]);

  return {
    formData,
    errors,
    updateField,
    validate,
    submit,
  };
}
```

**Step 2**: WorkflowFormPage.tsx (간소화)
```typescript
// frontend/src/pages/Workflows/WorkflowFormPage.tsx
export function WorkflowFormPage() {
  const { id } = useParams();
  const formState = useWorkflowFormState();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Container>
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
        <Tab label="기본 정보" />
        <Tab label="워크플로우 JSON" />
        <Tab label="마크된 필드" />
      </Tabs>

      {activeTab === 0 && <WorkflowMetadataForm {...formState} />}
      {activeTab === 1 && <WorkflowJsonEditor {...formState} />}
      {activeTab === 2 && <MarkedFieldsManager {...formState} />}

      <ActionButtons onSave={formState.submit} />
    </Container>
  );
}
```

**예상 효과**:
- 511 lines → 150 lines (페이지 컴포넌트)
- 재사용 가능한 훅
- 테스트 용이성 증가

---

#### 📦 ImageViewerModal.tsx (566 lines)

**리팩토링 계획**:

```typescript
// 현재: 하나의 거대 컴포넌트
ImageViewerModal.tsx (566 lines)

// 리팩토링 후
ImageViewerModal.tsx              (200 lines) - 오케스트레이터
├── hooks/
│   ├── useImageTransform.ts     (80 lines)  - Zoom/Pan 로직
│   └── useImageKeyboard.ts      (60 lines)  - 키보드 단축키
├── components/
│   ├── ImageViewerActions.tsx   (100 lines) - 액션 버튼
│   ├── ImageViewerMetadata.tsx  (80 lines)  - 메타데이터 탭
│   └── ImageViewerNavigation.tsx (40 lines) - 이전/다음
```

---

#### 📦 ImageGroupsPage.tsx (576 lines)

**리팩토링 계획**:

```typescript
// 현재: 하나의 거대 컴포넌트
ImageGroupsPage.tsx (576 lines)

// 리팩토링 후
ImageGroupsPage.tsx               (200 lines) - 오케스트레이터
├── hooks/
│   └── useGroupManagement.ts    (150 lines) - CRUD 로직
├── components/
│   ├── GroupFilters.tsx         (100 lines) - 필터/정렬
│   ├── GroupActions.tsx         (70 lines)  - 액션 버튼
│   └── GroupImageGrid.tsx       (50 lines)  - 이미지 그리드
```

---

### 3.4 Frontend - metadataReader.ts (675 lines) 분할

**현재 문제**: 7가지 파서가 하나의 파일에

**리팩토링 계획**:

```
frontend/src/utils/metadata/
├── metadataReader.ts            (100 lines) - 메인 오케스트레이터
├── parsers/
│   ├── pngExtractor.ts          (150 lines) - PNG 청크 추출
│   ├── novelaiParser.ts         (100 lines) - NovelAI 포맷
│   ├── webuiParser.ts           (100 lines) - WebUI 포맷
│   ├── comfyuiParser.ts         (100 lines) - ComfyUI 포맷
│   └── exifParser.ts            (80 lines)  - EXIF 데이터
└── types.ts                     (50 lines)  - 타입 정의
```

**Step 1**: 메인 오케스트레이터
```typescript
// frontend/src/utils/metadata/metadataReader.ts
import { extractPngChunks } from './parsers/pngExtractor';
import { parseNovelAI } from './parsers/novelaiParser';
import { parseWebUI } from './parsers/webuiParser';
import { parseComfyUI } from './parsers/comfyuiParser';

export async function extractMetadata(file: File): Promise<Metadata> {
  const arrayBuffer = await file.arrayBuffer();

  // 1. PNG 청크 추출
  const chunks = extractPngChunks(arrayBuffer);

  // 2. AI 도구 감지 및 파싱
  if (chunks.has('Comment') && chunks.get('Comment').includes('novelai')) {
    return parseNovelAI(chunks);
  } else if (chunks.has('parameters')) {
    return parseWebUI(chunks);
  } else if (chunks.has('workflow')) {
    return parseComfyUI(chunks);
  }

  // 3. EXIF fallback
  return parseExif(arrayBuffer);
}
```

**예상 효과**:
- 675 lines → 100 lines (메인) + 파서별 80-150 lines
- 파서별 독립 테스트 가능
- 새 AI 도구 지원 시 파서만 추가

---

### 3.5 Phase 3 요약

| 작업 | 파일 수 | 예상 시간 |
|------|---------|----------|
| ImageMetadataModel 분할 | 4 | 6시간 |
| ImageSearchModel 분할 | 3 | 4시간 |
| query.routes 분할 | 4 | 5시간 |
| tagging.routes 분할 | 4 | 4시간 |
| WorkflowFormPage 리팩토링 | 4 | 6시간 |
| ImageViewerModal 리팩토링 | 5 | 6시간 |
| ImageGroupsPage 리팩토링 | 4 | 5시간 |
| metadataReader 분할 | 6 | 8시간 |
| **합계** | **34** | **44시간** |

---

## 🟢 Phase 4: 라이브러리 개선 기회 (Low-Medium Priority)

### 4.1 Backend 라이브러리 검토

#### ⬆️ lru-cache 버전 업그레이드

**현재 상태**:
```json
// backend/package.json
"lru-cache": "^5.1.1"  // 2019년 릴리스 (5년 이상 구버전)
```

**최신 버전**: v10.2.0 (2024)

**주요 변경사항** (v5 → v10):
- **성능**: 30-50% 빠른 조회 속도
- **타입 안전성**: 네이티브 TypeScript 지원 개선
- **API 변경**: `maxAge` → `ttl`, `length` → `sizeCalculation`
- **메모리 효율성**: 더 나은 가비지 컬렉션

**영향 파일**: `backend/src/services/QueryCacheService.ts`

**마이그레이션 가이드**:
```typescript
// Before (v5)
import LRU = require('lru-cache');

const cache = new LRU({
  max: 100,
  maxAge: 60 * 1000,
  length: (item) => JSON.stringify(item).length
});

// After (v10)
import { LRUCache } from 'lru-cache';

const cache = new LRUCache({
  max: 100,
  ttl: 60 * 1000,
  sizeCalculation: (item) => JSON.stringify(item).length
});
```

**예상 작업**:
1. 패키지 업데이트: `npm install lru-cache@latest`
2. `QueryCacheService.ts` API 변경 (50 lines)
3. 타입 정의 파일 제거: `types/lru-cache.d.ts` (불필요)
4. 단위 테스트 실행 및 검증

**예상 효과**:
- 캐시 조회 성능 30% 향상
- TypeScript 타입 안전성 개선
- 최신 보안 패치 적용

**우선순위**: Medium (성능 개선 + 간단한 작업)

---

#### ⚠️ better-queue 의존성 검토

**현재 상태**:
```json
"better-queue": "^3.8.12"  // 마지막 업데이트 3년 전
```

**사용 위치**: `backgroundProcessorService.ts`

**문제점**:
- 활발한 유지보수 없음 (마지막 커밋 2021년)
- Node.js 최신 버전 지원 불확실
- TypeScript 타입 정의 오래됨

**대안 검토**:

| 라이브러리 | 장점 | 단점 |
|-----------|------|------|
| **Bull** (Redis 기반) | 매우 활발한 개발, 클러스터 지원, UI 대시보드 | Redis 의존성 추가 필요 |
| **BullMQ** (Bull v2) | Bull 개선 버전, TypeScript 네이티브 | Redis 필요 |
| **p-queue** | 가벼움, Redis 불필요, 인메모리 | 영속성 없음 |
| **현재 유지** | 변경 없음 | 보안/호환성 리스크 |

**권장 사항**:
- **단기**: 현재 유지 (Redis 없이 동작하는 장점)
- **중기**: 프로젝트가 커지면 BullMQ + Redis 고려
- **모니터링**: npm audit 정기 확인

**우선순위**: Low (현재 잘 동작 중)

---

### 4.2 Frontend 라이브러리 검토

#### ✅ @tanstack/react-query 활용도 증대

**현재 상태**:
```typescript
// 사용 위치: frontend/src/hooks/useInfiniteImages.ts만
import { useInfiniteQuery } from '@tanstack/react-query';
```

**문제점**:
- 설치되어 있지만 거의 사용 안 함
- 대부분 `useState` + `useEffect` + `axios` 직접 사용
- 캐싱, 재시도, 낙관적 업데이트 등 혜택 못 받음

**개선 기회**:

**Step 1**: 자주 쓰는 API를 React Query로 마이그레이션
```typescript
// Before: 모든 페이지에서 반복
const [images, setImages] = useState([]);
const [loading, setLoading] = useState(false);

useEffect(() => {
  setLoading(true);
  imageApi.getImages().then(data => {
    setImages(data);
    setLoading(false);
  });
}, []);

// After: React Query 사용
import { useQuery } from '@tanstack/react-query';

const { data: images, isLoading } = useQuery({
  queryKey: ['images', filters],
  queryFn: () => imageApi.getImages(filters),
  staleTime: 5 * 60 * 1000, // 5분 캐싱
});
```

**적용 대상 API**:
1. `imageApi.getImages()` - 갤러리 조회 (가장 자주 호출)
2. `groupApi.getGroups()` - 그룹 목록
3. `workflowApi.getWorkflows()` - 워크플로우 목록
4. `imageApi.getMetadata()` - 이미지 상세

**예상 효과**:
- 자동 캐싱으로 불필요한 API 호출 감소 (30-50%)
- 로딩 상태 관리 간소화
- 에러 재시도 자동화
- Optimistic UI 업데이트 가능

**우선순위**: Medium-High (큰 사용자 경험 개선)

---

#### 🔄 react-masonry-css 대안 검토 (선택적)

**현재 상태**:
```json
"react-masonry-css": "^1.0.16"  // 2020년 마지막 업데이트
```

**사용 위치**:
- `ImageMasonry.tsx`
- `GenerationHistoryList.tsx`

**대안**:

| 라이브러리 | 장점 | 단점 |
|-----------|------|------|
| **react-masonry-css** (현재) | 단순, CSS 기반, 가벼움 | 업데이트 없음 |
| **react-masonry-component** | 더 많은 기능 | 무거움 |
| **CSS Grid (네이티브)** | 의존성 없음, 최신 브라우저 지원 | IE 미지원 (문제 없음) |
| **react-window + Masonry** | 가상화 지원 (성능) | 복잡함 |

**권장 사항**:
- **현재 유지**: 잘 동작하며 가벼움
- **장기적으로**: CSS Grid로 네이티브 구현 고려 (의존성 제거)

**우선순위**: Low (현재 문제없음)

---

#### ⚠️ react-infinite-scroll-component 검토

**현재 상태**:
```json
"react-infinite-scroll-component": "^6.1.0"
```

**사용 위치**:
- `ImageMasonry.tsx`
- `GenerationHistoryList.tsx`

**대안**: Intersection Observer API (네이티브)

**Custom Hook 예시**:
```typescript
// frontend/src/hooks/useInfiniteScroll.ts
export function useInfiniteScroll(callback: () => void) {
  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        callback();
      }
    });

    observerRef.current.observe(node);
  }, [callback]);

  return loadMoreRef;
}

// 사용
const loadMoreRef = useInfiniteScroll(() => fetchNextPage());

return (
  <>
    {items.map(item => <Item key={item.id} {...item} />)}
    <div ref={loadMoreRef}>Loading...</div>
  </>
);
```

**권장 사항**:
- **현재 유지**: 라이브러리가 안정적이고 잘 동작
- **고려 사항**: 의존성 줄이기 원하면 네이티브 API로 교체 가능

**우선순위**: Low

---

### 4.3 Phase 4 요약

| 작업 | 예상 효과 | 예상 시간 | 우선순위 |
|------|----------|----------|---------|
| lru-cache 업그레이드 | 성능 30% 향상 | 2시간 | Medium |
| React Query 활용 | API 호출 50% 감소 | 8시간 | High |
| better-queue 모니터링 | 보안 유지 | 지속적 | Low |
| Masonry 대안 검토 | 의존성 감소 | 4시간 | Low |

---

## 📋 Phase 5: 특정 기능 개선 (Optional)

### 5.1 Settings 페이지 구조 개선

**현재 상태**:
- `RatingScoreSettings.tsx` - 816 lines (가장 큰 컴포넌트!)
- `TaggerSettings.tsx` - 768 lines
- `SimilaritySettings.tsx` - 671 lines

**개선 방향**: 각 설정을 더 작은 서브 컴포넌트로 분할

**예시 - RatingScoreSettings 리팩토링**:
```
RatingScoreSettings.tsx (현재 816 lines)
↓
RatingScoreSettings.tsx (200 lines - 오케스트레이터)
├── components/
│   ├── RatingScoreForm.tsx       (150 lines) - 점수 생성/수정 폼
│   ├── RatingScoreList.tsx       (200 lines) - 점수 목록
│   ├── RatingScoreStats.tsx      (100 lines) - 통계 대시보드
│   ├── RatingScorePreview.tsx    (100 lines) - 미리보기
│   └── RatingScoreBulkEdit.tsx   (66 lines)  - 일괄 수정
```

---

### 5.2 Image Editor 기능 사용 여부 확인

**조사 필요**:
```typescript
// frontend/src/services/imageEditorApi.ts (122 lines)
// frontend/src/components/ImageEditorModal.tsx
```

**확인 사항**:
1. 실제로 사용자가 이미지 편집 기능을 사용하는가?
2. 사용하지 않는다면 제거 가능 (122 lines + 모달 컴포넌트)
3. 사용한다면 유지

---

### 5.3 GenerationHistory Adapter 검토

**파일**: `frontend/src/utils/generationHistoryAdapter.ts` (228 lines)

**목적**: GenerationHistoryRecord ↔ ImageRecord 변환

**확인 사항**:
1. 백엔드 모델이 통합되었다면 어댑터 불필요
2. 여전히 필요하다면 유지
3. 일부만 사용 중이라면 사용하는 메서드만 추출

---

## 📊 전체 리팩토링 로드맵

### Timeline 개요

| Phase | 기간 | 주요 작업 | 예상 효과 |
|-------|------|----------|----------|
| **Phase 1** | 1일 (8시간) | 미사용 코드 제거 | -1,400 lines |
| **Phase 2** | 2주 (10시간) | 중복 기능 통합 | -670 lines |
| **Phase 3** | 2-3주 (44시간) | 책임 분리 | 복잡도 40% 감소 |
| **Phase 4** | 1주 (10시간) | 라이브러리 개선 | 성능 20% 향상 |
| **Phase 5** | 선택적 | 특정 기능 개선 | 유지보수성 향상 |

### 우선순위별 작업 순서

#### 🔴 High Priority (즉시 시작)
1. ✅ Phase 1.1 - 미사용 파일 제거 (2시간)
2. ✅ Phase 1.3 - API URL 통합 (30분)
3. ✅ Phase 2.1 - 삭제 로직 중앙화 (4시간)
4. ⚠️ Phase 2.4 - Node 스타일 유틸 (1시간)

**예상 시간**: 1주 (7.5시간)
**예상 효과**: 1,500+ lines 제거

---

#### 🟠 Medium-High Priority (2주 차)
1. ⚠️ Phase 2.2 - UPDATE 빌더 통합 (3시간)
2. ⚠️ Phase 2.3 - useRepeatExecution 통합 (2시간)
3. ⚠️ Phase 3.1 - ImageMetadataModel 분할 (6시간)
4. ⚠️ Phase 4.2 - React Query 활용 (8시간)

**예상 시간**: 2주 (19시간)
**예상 효과**: 대폭적인 구조 개선

---

#### 🟡 Medium Priority (3-4주 차)
1. ⚠️ Phase 3.2 - 라우트 파일 분할 (9시간)
2. ⚠️ Phase 3.3 - 페이지 컴포넌트 리팩토링 (17시간)
3. ⚠️ Phase 4.1 - lru-cache 업그레이드 (2시간)

**예상 시간**: 2주 (28시간)

---

#### 🟢 Low Priority (5주 차 이후, 선택적)
1. Phase 1.2 - VideoMetadata 메서드 정리 (1시간)
2. Phase 3.4 - metadataReader 분할 (8시간)
3. Phase 4.3 - 기타 라이브러리 검토 (4시간)
4. Phase 5 - 특정 기능 개선 (가변)

---

## 🛠️ 실행 가이드

### 리팩토링 진행 시 체크리스트

각 Phase 작업 시 다음 단계를 따르세요:

#### 1. 작업 전 준비
```bash
# ✅ 새 브랜치 생성
git checkout -p develop
git checkout -b refactor/phase-1-cleanup

# ✅ 현재 상태 백업
git commit -am "Backup before refactoring Phase 1"

# ✅ 테스트 실행 (베이스라인)
npm run test  # 있다면
```

#### 2. 리팩토링 실행
```bash
# ✅ 파일 제거/이동
rm backend/src/utils/seedTestData.ts

# ✅ 변경 사항 커밋 (작은 단위로)
git add .
git commit -m "refactor: Remove unused seedTestData.ts"
```

#### 3. 검증
```bash
# ✅ 빌드 성공 확인
npm run build

# ✅ 애플리케이션 실행 확인
npm run dev

# ✅ 주요 기능 수동 테스트
# - 이미지 업로드
# - 검색
# - 그룹 관리
# 등

# ✅ 테스트 실행 (있다면)
npm run test
```

#### 4. 문서화
```markdown
# CHANGELOG.md 또는 커밋 메시지에 기록

## [Refactoring] Phase 1 - Cleanup

### Removed
- `backend/src/utils/seedTestData.ts` - Unused test data seeder (266 lines)
- `backend/src/services/folderScanService.ts.backup` - Legacy backup (969 lines)

### Changed
- Centralized API_BASE_URL to single source

### Impact
- Reduced codebase by 1,400 lines
- Improved maintainability
```

---

### 리팩토링 실패 시 롤백

```bash
# ✅ 변경사항 버리기
git reset --hard HEAD

# ✅ 또는 이전 커밋으로
git revert <commit-hash>

# ✅ 브랜치 삭제
git checkout develop
git branch -D refactor/phase-1-cleanup
```

---

## 🎯 성공 지표 (KPI)

리팩토링 후 다음 지표로 효과 측정:

### 정량적 지표

| 지표 | 현재 | 목표 | 측정 방법 |
|------|------|------|----------|
| **총 코드 라인 수** | ~45,000 | ~43,000 (-4%) | `cloc` 도구 |
| **평균 파일 크기** | 250 lines | 180 lines | 파일별 line count |
| **500+ lines 파일** | 15개 | 5개 | `find + wc -l` |
| **중복 코드 비율** | ~15% | ~8% | `jscpd` 도구 |
| **번들 크기** | ? | -5% | Vite build 결과 |
| **빌드 시간** | ? | 측정 | `time npm run build` |

### 정성적 지표

| 영역 | 개선 사항 |
|------|----------|
| **코드 가독성** | 파일당 단일 책임, 명확한 구조 |
| **유지보수성** | 변경 시 영향 범위 축소 |
| **테스트 용이성** | 작은 단위로 분리되어 테스트 가능 |
| **신규 개발** | 기능 추가 시간 20% 단축 예상 |
| **버그 추적** | 명확한 책임으로 디버깅 용이 |

---

## 📝 주의사항 및 리스크

### ⚠️ 리팩토링 시 주의사항

1. **한 번에 하나씩**: Phase별로 순차 진행, 동시 여러 Phase 금지
2. **테스트 필수**: 각 변경 후 반드시 기능 검증
3. **작은 커밋**: 롤백 용이하도록 작은 단위 커밋
4. **문서화**: 변경 이유와 영향 기록
5. **사용자 영향**: 프로덕션 배포 전 충분한 테스트

### 🚨 잠재적 리스크

| 리스크 | 가능성 | 영향도 | 대응 방안 |
|--------|--------|--------|----------|
| **기능 파손** | Medium | High | 각 단계 후 수동 테스트 필수 |
| **성능 저하** | Low | Medium | 벤치마크 비교 측정 |
| **마이그레이션 오류** | Medium | High | 점진적 마이그레이션, A/B 유지 |
| **의존성 충돌** | Low | Low | 패키지 업데이트 전 호환성 확인 |
| **개발 시간 초과** | High | Medium | 우선순위 조정, Phase 분할 |

---

## 🔗 참고 자료

### 리팩토링 패턴
- [Refactoring Guru - Design Patterns](https://refactoring.guru/design-patterns)
- [Martin Fowler - Refactoring Catalog](https://refactoring.com/catalog/)

### 라이브러리 문서
- [LRU Cache v10 Migration Guide](https://github.com/isaacs/node-lru-cache)
- [TanStack Query (React Query) Docs](https://tanstack.com/query/latest/docs/react/overview)

### 코드 품질 도구
- `cloc` - 코드 라인 카운터
- `jscpd` - 중복 코드 탐지기
- `ts-prune` - 미사용 export 찾기
- `depcheck` - 미사용 의존성 찾기

---

## 📞 문의 및 피드백

리팩토링 진행 중 질문이나 이슈 발생 시:
1. GitHub Issues에 등록
2. 각 Phase별 브랜치에서 PR 생성
3. 팀 리뷰 후 merge

---

**작성자**: Claude (AI Assistant)
**검토 필요**: 실제 프로젝트 상황에 맞게 우선순위 조정
**업데이트**: 리팩토링 진행에 따라 문서 갱신

---

## 부록 A: 자동화 스크립트

### A.1 미사용 파일 찾기

```bash
#!/bin/bash
# scripts/find-unused-files.sh

echo "Searching for potentially unused files..."

# TypeScript/TSX 파일 중 import되지 않는 파일 찾기
find backend/src -name "*.ts" ! -name "*.d.ts" ! -name "index.ts" | while read file; do
  filename=$(basename "$file" .ts)
  # 해당 파일을 import하는 파일 개수
  count=$(grep -r "from.*$filename" backend/src --include="*.ts" | wc -l)
  if [ $count -eq 0 ]; then
    echo "⚠️  Potentially unused: $file"
  fi
done
```

### A.2 중복 코드 탐지

```bash
# jscpd로 중복 코드 찾기
npx jscpd backend/src frontend/src --min-lines 10 --min-tokens 50 --format "json" -o ./reports/duplication.json

# 결과 요약 출력
npx jscpd backend/src frontend/src --min-lines 10 --reporters "console"
```

### A.3 큰 파일 찾기

```bash
#!/bin/bash
# scripts/find-large-files.sh

echo "Files larger than 400 lines:"
echo "============================"

find backend/src frontend/src -name "*.ts" -o -name "*.tsx" | while read file; do
  lines=$(wc -l < "$file")
  if [ $lines -gt 400 ]; then
    printf "%5d lines: %s\n" $lines $file
  fi
done | sort -rn
```

---

## 부록 B: 리팩토링 체크리스트 템플릿

```markdown
# Refactoring Checklist: [Phase X.Y - Task Name]

## Pre-Refactoring
- [ ] 브랜치 생성: `refactor/phase-X-Y-task-name`
- [ ] 현재 코드 백업 커밋 완료
- [ ] 테스트 베이스라인 실행 (통과 확인)
- [ ] 영향 범위 파악 완료

## During Refactoring
- [ ] 코드 변경 완료
- [ ] 새 파일 생성 (필요 시)
- [ ] Import 경로 업데이트
- [ ] 타입 정의 업데이트
- [ ] 주석 및 문서 업데이트

## Post-Refactoring
- [ ] 빌드 성공 확인 (`npm run build`)
- [ ] Lint 통과 (`npm run lint`)
- [ ] 타입 체크 통과 (`tsc --noEmit`)
- [ ] 애플리케이션 실행 확인 (`npm run dev`)
- [ ] 주요 기능 수동 테스트
  - [ ] 이미지 업로드
  - [ ] 이미지 검색
  - [ ] 그룹 관리
  - [ ] (추가 기능)
- [ ] 테스트 실행 (있다면)
- [ ] 성능 비교 (필요 시)

## Documentation
- [ ] CHANGELOG 업데이트
- [ ] 커밋 메시지 작성 (conventional commits)
- [ ] PR 설명 작성
- [ ] 팀 리뷰 요청

## Rollback Plan
- [ ] 롤백 방법 확인 (`git revert` 또는 `git reset`)
- [ ] 영향받는 시스템 목록 작성
- [ ] 백업 브랜치 보존
```

---

**End of Refactoring Plan**
