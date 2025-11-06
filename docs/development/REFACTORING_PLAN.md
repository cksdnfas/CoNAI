# ComfyUI Image Manager - 리팩토링 계획서

**생성일:** 2025-11-06
**버전:** 1.0
**분석 범위:** 전체 백엔드/프론트엔드 코드베이스

---

## 📊 Executive Summary

### 핵심 지표
- **총 TypeScript 파일:** 356개
- **과도한 책임을 가진 파일:** 24개 (500줄 이상)
- **Critical 수준 파일:** 7개 (700줄 이상)
- **레거시/Deprecated 코드:** 12개 파일
- **디버깅 임시 스크립트:** 4개
- **ImageModel wrapper 여전히 사용 중:** 6개 파일

### 코드베이스 건강도: 6/10

**강점:**
- ✅ 데이터/서비스/라우트 계층 분리 양호
- ✅ 포괄적인 기능 커버리지
- ✅ TypeScript 타입 안정성 확보
- ✅ 명확한 API 구조

**약점:**
- ❌ 800줄 이상 파일 다수 존재
- ❌ Deprecated 코드가 여전히 활성 사용 중
- ❌ 서비스 간 중복 로직 다수
- ❌ 5개 이상 관심사 혼합한 React 컴포넌트
- ❌ 루프 내 N+1 쿼리 패턴

---

## 🎯 리팩토링 우선순위

### Phase 1: Critical (Week 1) - 차단 이슈 해결

#### 1. ImageModel Wrapper 제거 ⚠️ **BLOCKING ISSUE**

**현재 상태:**
- `backend/src/models/Image/index.ts` (202줄)
- 6개 파일에서 여전히 import 중
- Deprecated 마커 있지만 활성 사용 중

**영향받는 파일:**
```
backend/src/routes/images.routes.ts
backend/src/services/autoCollectionService.ts
backend/src/services/promptCollectionService.ts
backend/src/services/imageSimilarityService.ts
backend/src/services/folderScanService.ts
backend/src/services/imageUploadService.ts
```

**마이그레이션 경로:**
- `ImageModel.create()` → `ImageUploadService.uploadImage()`
- `ImageModel.findById()` → `ImageMetadataModel.findById()`
- `ImageModel.update()` → `ImageMetadataModel.update()`
- `ImageModel.delete()` → `ImageMetadataModel.delete()`

**작업 단계:**
1. 각 파일에서 ImageModel import 제거
2. 해당 메서드를 적절한 서비스/모델로 교체
3. 타입 체크 및 테스트
4. ImageModel 파일 완전 삭제

**예상 시간:** 1.5시간
**우선순위:** CRITICAL
**차단 해제:** 이 작업 완료 시 다른 리팩토링 진행 가능

---

#### 2. folderScanService.ts 분리 (968줄) 🔴 **LARGEST FILE**

**파일 위치:** `backend/src/services/folderScanService.ts`

**현재 책임:**
1. 폴더 스캔 및 파일 발견
2. 빠른 등록 (Fast Registration)
3. 해시 생성 및 관리
4. 썸네일 생성
5. 진행률 추적
6. 중복 감지
7. 메타데이터 추출

**문제점:**
- 단일 파일에 7개의 서로 다른 관심사
- 테스트 어려움
- 유지보수 복잡도 높음
- 의존성 파악 어려움

**리팩토링 구조:**

```
services/folderScan/
├── fileDiscoveryService.ts        # 파일 발견 및 스캔
├── fastRegistrationService.ts     # 빠른 등록 로직
├── hashGenerationService.ts       # 해시 생성 및 관리
├── thumbnailGenerationService.ts  # 썸네일 처리
├── scanProgressTracker.ts         # 진행률 추적
├── duplicateDetectionService.ts   # 중복 감지
└── index.ts                       # 통합 인터페이스
```

**각 서비스 책임:**

**fileDiscoveryService.ts** (~150줄)
```typescript
- scanDirectory(): 디렉토리 재귀 스캔
- filterImageFiles(): 이미지 파일 필터링
- getFileStats(): 파일 정보 수집
```

**fastRegistrationService.ts** (~200줄)
```typescript
- registerImages(): 이미지 일괄 등록
- validateRegistration(): 등록 검증
- batchInsert(): DB 배치 삽입
```

**hashGenerationService.ts** (~150줄)
```typescript
- generatePerceptualHash(): 지각 해시 생성
- generateFileHash(): 파일 해시 생성
- compareHashes(): 해시 비교
```

**thumbnailGenerationService.ts** (~120줄)
```typescript
- generateThumbnail(): 썸네일 생성
- optimizeThumbnail(): 썸네일 최적화
- saveThumbnail(): 썸네일 저장
```

**scanProgressTracker.ts** (~100줄)
```typescript
- initProgress(): 진행률 초기화
- updateProgress(): 진행률 업데이트
- getProgress(): 진행률 조회
- completeProgress(): 진행률 완료
```

**duplicateDetectionService.ts** (~150줄)
```typescript
- detectDuplicates(): 중복 감지
- compareImages(): 이미지 비교
- resolveDuplicates(): 중복 해결
```

**index.ts** (~100줄)
```typescript
// 통합 Facade 패턴
export class FolderScanOrchestrator {
  // 모든 서비스 조율
}
```

**마이그레이션 전략:**
1. 새 디렉토리 구조 생성
2. 각 서비스 단위로 코드 이동 및 독립화
3. 의존성 주입 패턴 적용
4. 통합 테스트 작성
5. 기존 파일 제거

**예상 시간:** 3-4시간
**우선순위:** CRITICAL
**영향도:** HIGH (여러 기능이 의존)

---

#### 3. api.ts 도메인 분리 (753줄) - Frontend

**파일 위치:** `frontend/src/services/api.ts`

**현재 구조:**
- 단일 파일에 7개 API 도메인 혼재
- 753줄의 모노리틱 구조
- 유지보수 어려움

**리팩토링 구조:**

```
services/api/
├── imageApi.ts           # 이미지 CRUD
├── groupApi.ts           # 그룹 관리
├── promptApi.ts          # 프롬프트 관리
├── settingsApi.ts        # 설정 관리
├── uploadApi.ts          # 업로드 처리
├── ratingApi.ts          # 평점 관리
├── workflowApi.ts        # 워크플로우 관리
├── apiClient.ts          # 공통 HTTP 클라이언트
└── index.ts              # 통합 export
```

**각 API 파일 책임:**

**imageApi.ts** (~120줄)
```typescript
- getImages()
- getImageById()
- updateImage()
- deleteImage()
- searchImages()
```

**groupApi.ts** (~100줄)
```typescript
- getGroups()
- createGroup()
- updateGroup()
- deleteGroup()
- addImagesToGroup()
```

**promptApi.ts** (~80줄)
```typescript
- getPrompts()
- searchPrompts()
- getPromptStats()
```

**settingsApi.ts** (~60줄)
```typescript
- getSettings()
- updateSettings()
```

**uploadApi.ts** (~100줄)
```typescript
- uploadImages()
- uploadProgress()
- cancelUpload()
```

**ratingApi.ts** (~80줄)
```typescript
- getRatings()
- updateRating()
- getRatingConfig()
```

**workflowApi.ts** (~120줄)
```typescript
- getWorkflows()
- createWorkflow()
- updateWorkflow()
- deleteWorkflow()
- executeWorkflow()
```

**apiClient.ts** (~80줄)
```typescript
// Axios 인스턴스 및 공통 로직
- request interceptors
- response interceptors
- error handling
- retry logic
```

**마이그레이션 전략:**
1. apiClient.ts 먼저 생성 (공통 로직)
2. 각 도메인별 API 파일 생성
3. 기존 코드 이동 및 정리
4. index.ts에서 통합 export
5. 사용하는 컴포넌트에서 import 경로 변경

**예상 시간:** 2시간
**우선순위:** CRITICAL
**영향도:** MEDIUM (import 경로만 변경)

---

### Phase 2: High Priority (Weeks 2-3) - 복잡도 감소

#### 4. autoCollectionService.ts 리팩토링 (817줄)

**파일 위치:** `backend/src/services/autoCollectionService.ts`

**주요 문제:**
- 160줄 switch statement (조건 타입별 처리)
- 10가지 이상의 조건 타입 처리
- 중복된 검증 로직 (4곳)
- 중복된 JSON 파싱 (4곳)

**리팩토링 구조:**

```
services/autoCollection/
├── conditionEvaluator.ts          # 조건 평가 엔진
├── evaluators/
│   ├── regexEvaluator.ts         # Regex 조건
│   ├── metadataEvaluator.ts      # 메타데이터 조건
│   ├── ratingEvaluator.ts        # 평점 조건
│   ├── autoTagEvaluator.ts       # Auto-tag 조건
│   ├── dateEvaluator.ts          # 날짜 조건
│   └── pathEvaluator.ts          # 경로 조건
├── duplicateDetector.ts           # 중복 감지
├── validatorService.ts            # 검증 로직 통합
├── autoCollectionOrchestrator.ts  # 전체 조율
└── index.ts
```

**핵심 패턴 - Strategy Pattern:**

```typescript
// conditionEvaluator.ts
interface ConditionEvaluator {
  evaluate(image: ImageMetadata, condition: any): boolean;
}

class ConditionEvaluatorFactory {
  private evaluators: Map<string, ConditionEvaluator>;

  getEvaluator(type: string): ConditionEvaluator {
    return this.evaluators.get(type) || new DefaultEvaluator();
  }
}

// 160줄 switch 제거됨
export async function evaluateCondition(
  image: ImageMetadata,
  condition: GroupCondition
): Promise<boolean> {
  const evaluator = factory.getEvaluator(condition.type);
  return evaluator.evaluate(image, condition);
}
```

**validatorService.ts - 중복 제거:**
```typescript
// 4곳에 중복된 rating 검증을 하나로
export function validateRatingCondition(condition: any): ValidationResult {
  // 통합 검증 로직
}

// 4곳에 중복된 JSON 파싱을 하나로
export function parseAutoTags(condition: any): string[] {
  // 안전한 JSON 파싱
}
```

**Quick Wins (15분 작업):**
1. `validateRatingCondition()` 추출 → 50줄 절약
2. `parseAutoTags()` 추출 → 40줄 절약
3. Regex 컴파일 캐싱 → 성능 개선

**예상 시간:** 3시간
**우선순위:** HIGH
**영향도:** HIGH (자동 수집 핵심 로직)

---

#### 5. workflows.ts 라우트 분리 (1,101줄) 🔴 **LARGEST ROUTE FILE**

**파일 위치:** `backend/src/routes/workflows.ts`

**현재 책임:**
1. Workflow CRUD
2. Workflow 실행
3. Marked fields 관리
4. Workflow groups 관리
5. Workflow 복사/내보내기
6. 실행 이력 관리
7. 통계 및 분석

**리팩토링 구조:**

```
routes/workflows/
├── crud.routes.ts              # 기본 CRUD
├── execution.routes.ts         # 실행 관련
├── markedFields.routes.ts      # Marked fields
├── groups.routes.ts            # Groups 관리
└── index.ts                    # 라우트 통합
```

**각 라우트 파일:**

**crud.routes.ts** (~250줄)
```typescript
GET    /workflows
POST   /workflows
GET    /workflows/:id
PUT    /workflows/:id
DELETE /workflows/:id
POST   /workflows/:id/copy
GET    /workflows/:id/export
```

**execution.routes.ts** (~300줄)
```typescript
POST   /workflows/:id/execute
GET    /workflows/:id/executions
GET    /workflows/:id/executions/:executionId
POST   /workflows/:id/executions/:executionId/cancel
GET    /workflows/executions/recent
```

**markedFields.routes.ts** (~250줄)
```typescript
GET    /workflows/:id/marked-fields
POST   /workflows/:id/marked-fields
PUT    /workflows/:id/marked-fields/:fieldId
DELETE /workflows/:id/marked-fields/:fieldId
GET    /workflows/:id/marked-fields/preview
```

**groups.routes.ts** (~200줄)
```typescript
GET    /workflows/groups
POST   /workflows/groups
PUT    /workflows/groups/:groupId
DELETE /workflows/groups/:groupId
POST   /workflows/groups/:groupId/workflows
DELETE /workflows/groups/:groupId/workflows/:workflowId
```

**index.ts** (~100줄)
```typescript
import { Router } from 'express';
import crudRoutes from './crud.routes';
import executionRoutes from './execution.routes';
import markedFieldsRoutes from './markedFields.routes';
import groupsRoutes from './groups.routes';

const router = Router();

router.use('/', crudRoutes);
router.use('/', executionRoutes);
router.use('/', markedFieldsRoutes);
router.use('/groups', groupsRoutes);

export default router;
```

**예상 시간:** 2.5시간
**우선순위:** HIGH
**영향도:** MEDIUM (라우트 분리만, 로직 변경 없음)

---

#### 6. RatingScoreSettings.tsx 컴포넌트 분리 (816줄)

**파일 위치:** `frontend/src/pages/Settings/features/RatingScore/RatingScoreSettings.tsx`

**현재 문제:**
- 9개 useState 훅
- 4가지 주요 기능 혼재:
  1. Weights 설정
  2. Tier 관리 (CRUD)
  3. Score 계산기
  4. Preview 기능

**리팩토링 구조:**

```
features/RatingScore/
├── RatingScoreSettings.tsx        # 메인 컨테이너 (150줄)
├── components/
│   ├── WeightsConfiguration.tsx   # Weights 설정 (200줄)
│   ├── TierManagement.tsx         # Tier CRUD (250줄)
│   ├── ScoreCalculator.tsx        # 계산기 (150줄)
│   └── ScorePreview.tsx           # 미리보기 (150줄)
├── hooks/
│   ├── useRatingConfig.ts         # 설정 관리
│   ├── useTierManagement.ts       # Tier 상태 관리
│   └── useScoreCalculation.ts     # 계산 로직
└── types.ts                       # 타입 정의
```

**컴포넌트 책임 분리:**

**WeightsConfiguration.tsx**
```typescript
// Props: weights, onChange
// State: 로컬 편집 상태
// 책임: weights 입력 UI 및 검증
```

**TierManagement.tsx**
```typescript
// Props: tiers, onAdd, onEdit, onDelete
// State: 편집 모드, 선택된 tier
// 책임: Tier CRUD UI
```

**ScoreCalculator.tsx**
```typescript
// Props: config
// State: 입력 값, 계산 결과
// 책임: 점수 계산 및 표시
```

**ScorePreview.tsx**
```typescript
// Props: config, sampleImages
// State: 선택된 이미지
// 책임: 실제 이미지로 미리보기
```

**Custom Hooks:**

```typescript
// useRatingConfig.ts
export function useRatingConfig() {
  const [config, setConfig] = useState<RatingConfig>();
  const [loading, setLoading] = useState(false);

  const loadConfig = async () => { /* ... */ };
  const saveConfig = async (config: RatingConfig) => { /* ... */ };

  return { config, loading, loadConfig, saveConfig };
}

// useTierManagement.ts
export function useTierManagement(initialTiers: Tier[]) {
  const [tiers, setTiers] = useState(initialTiers);
  const [editingTier, setEditingTier] = useState<Tier | null>(null);

  const addTier = (tier: Tier) => { /* ... */ };
  const updateTier = (id: string, tier: Tier) => { /* ... */ };
  const deleteTier = (id: string) => { /* ... */ };

  return { tiers, editingTier, addTier, updateTier, deleteTier };
}
```

**예상 시간:** 2시간
**우선순위:** HIGH
**영향도:** MEDIUM (UI 개선, 재사용성 향상)

---

#### 7. TaggerSettings.tsx 컴포넌트 분리 (768줄)

**파일 위치:** `frontend/src/pages/Settings/features/Tagger/TaggerSettings.tsx`

**현재 문제:**
- 10개 useState 훅
- 8개 독립적인 기능 영역:
  1. 모델 선택
  2. 의존성 체크
  3. 일괄 태깅
  4. 테스트 모드
  5. 설정 저장/로드
  6. 태그 관리
  7. 통계 표시
  8. 에러 처리

**리팩토링 구조:**

```
features/Tagger/
├── TaggerSettings.tsx             # 메인 컨테이너 (150줄)
├── components/
│   ├── ModelSelector.tsx          # 모델 선택 (120줄)
│   ├── DependencyChecker.tsx      # 의존성 체크 (100줄)
│   ├── BatchTaggingPanel.tsx      # 일괄 태깅 (180줄)
│   ├── TestModePanel.tsx          # 테스트 (150줄)
│   ├── TagManagement.tsx          # 태그 관리 (120줄)
│   └── TaggerStatistics.tsx       # 통계 (80줄)
├── hooks/
│   ├── useTaggerConfig.ts         # 설정 관리
│   ├── useBatchTagging.ts         # 일괄 태깅 로직
│   └── useDependencyCheck.ts      # 의존성 체크
└── types.ts
```

**예상 시간:** 2시간
**우선순위:** HIGH
**영향도:** MEDIUM

---

### Phase 3: Medium Priority (Week 4) - 코드 품질 개선

#### 8. autoTagSearchService.ts (740줄)

**파일 위치:** `backend/src/services/autoTagSearchService.ts`

**문제:**
- 복잡한 쿼리 빌더 로직
- 여러 검색 전략 혼재
- 테스트 어려움

**리팩토링 구조:**

```
services/autoTagSearch/
├── queryBuilder.ts               # SQL 쿼리 생성
├── searchStrategies/
│   ├── exactMatchStrategy.ts    # 정확한 매치
│   ├── partialMatchStrategy.ts  # 부분 매치
│   └── fuzzyMatchStrategy.ts    # 유사 매치
├── resultAggregator.ts          # 결과 통합
└── index.ts
```

**예상 시간:** 2.5시간
**우선순위:** MEDIUM
**영향도:** MEDIUM

---

#### 9. metadataReader.ts 중복 제거 (674줄)

**위치:**
- `backend/src/utils/metadataReader.ts`
- `frontend/src/utils/metadataReader.ts`

**문제:**
- 프론트엔드/백엔드에 거의 동일한 코드
- 동기화 어려움
- 버그 수정 시 두 곳 수정 필요

**해결 방안:**

**옵션 1: 공유 패키지 생성**
```
packages/
└── shared/
    ├── metadataReader.ts
    ├── types.ts
    └── package.json
```

**옵션 2: Backend에서만 처리, Frontend는 API 호출**
```typescript
// Frontend
const metadata = await api.post('/images/parse-metadata', { file });

// Backend에서만 처리
```

**권장:** 옵션 2 (단순화, 일관성)

**예상 시간:** 1.5시간
**우선순위:** MEDIUM
**영향도:** MEDIUM

---

#### 10. promptCollectionService.ts (693줄)

**파일 위치:** `backend/src/services/promptCollectionService.ts`

**문제:**
- 검증 로직이 여러 메서드에 분산
- 중복된 파싱 로직
- 복잡한 synonym 처리

**리팩토링 구조:**

```
services/promptCollection/
├── promptParser.ts              # 파싱 전담
├── promptValidator.ts           # 검증 전담
├── synonymMatcher.ts            # Synonym 매칭
├── statisticsCalculator.ts      # 통계 계산
└── index.ts
```

**예상 시간:** 2시간
**우선순위:** MEDIUM
**영향도:** MEDIUM

---

#### 11. imageSimilarity.ts 최적화 (629줄)

**파일 위치:** `backend/src/routes/imageSimilarity.ts`

**문제:**
- 중복된 해시 알고리즘 구현
- 메모리 효율성 낮음
- N+1 쿼리 패턴

**개선 사항:**

```typescript
// 현재: 루프 내에서 개별 쿼리
for (const hash of hashes) {
  const similar = await db.query('SELECT ...', [hash]);
  results.push(...similar);
}

// 개선: 단일 IN 쿼리
const similar = await db.query(
  'SELECT ... WHERE hash IN (?)',
  [hashes]
);
```

**해시 알고리즘 통합:**
```
services/imageSimilarity/
├── hashingService.ts            # 통합 해싱
├── similarityCalculator.ts      # 유사도 계산
└── batchQueryOptimizer.ts       # 배치 쿼리
```

**예상 시간:** 2시간
**우선순위:** MEDIUM
**영향도:** HIGH (성능 개선)

---

## 🗑️ 레거시 코드 제거 계획

### 1. ImageModel Wrapper 제거

**위치:** `backend/src/models/Image/index.ts`
**상태:** 6개 파일에서 여전히 사용 중
**영향도:** HIGH
**작업시간:** 1.5시간

**마이그레이션 체크리스트:**
- [ ] `images.routes.ts` - ImageModel → ImageMetadataModel + ImageUploadService
- [ ] `autoCollectionService.ts` - ImageModel → ImageMetadataModel
- [ ] `promptCollectionService.ts` - ImageModel → ImageMetadataModel
- [ ] `imageSimilarityService.ts` - ImageModel → ImageMetadataModel
- [ ] `folderScanService.ts` - ImageModel → ImageUploadService
- [ ] `imageUploadService.ts` - 자체 의존성 제거
- [ ] `models/Image/index.ts` 파일 삭제
- [ ] 관련 타입 정의 정리

---

### 2. Deprecated System Endpoints 제거

**위치:** `backend/src/routes/system.routes.ts`

**제거 대상:**
```typescript
// 4개의 deprecated endpoints
GET  /api/system/legacy-stats      // 사용되지 않음
POST /api/system/legacy-cleanup    // 새 cleanup으로 대체됨
GET  /api/system/old-health        // /health로 대체됨
POST /api/system/force-migration   // 자동화됨
```

**작업시간:** 30분
**영향도:** LOW (사용되지 않음)

---

### 3. 테스트/디버그 스크립트 정리

**현재 위치:** `backend/src/services/test-*.ts`

**파일 목록:**
```
backend/src/services/
├── test-autoCollection.ts       # 디버깅용
├── test-promptCollection.ts     # 디버깅용
├── test-similarity.ts           # 디버깅용
└── test-folderScan.ts          # 디버깅용
```

**새 위치:** `backend/scripts/dev/`

**작업:**
1. `backend/scripts/dev/` 디렉토리 생성
2. 파일 이동
3. import 경로 조정
4. .gitignore에 scripts/ 추가 (선택적)

**작업시간:** 30분
**영향도:** LOW

---

### 4. 사용되지 않는 함수 제거

**imageUploadService.ts:**
```typescript
// 사용되지 않음
function getLegacyImageId(filename: string): string {
  // deprecated, optimized_path 제거 후 불필요
}
```

**autoCollectionService.ts:**
```typescript
// 중복된 rating 검증 (4곳에 동일 코드)
// → validatorService.ts로 통합

// 중복된 JSON 파싱 (4곳에 동일 코드)
// → validatorService.ts로 통합
```

**작업시간:** 30분
**영향도:** LOW

---

## ⚡ Quick Wins (고효율 저노력)

### 1. 검증 함수 추출 (15분)

```typescript
// autoCollectionService.ts
// 현재: 4곳에 중복된 rating 검증

// 개선: validatorService.ts
export function validateRatingCondition(condition: any): ValidationResult {
  if (!condition.minScore && !condition.maxScore) {
    return { valid: false, error: 'Min or max score required' };
  }
  if (condition.minScore < 0 || condition.maxScore > 100) {
    return { valid: false, error: 'Score must be between 0-100' };
  }
  return { valid: true };
}
```

**절약:** 50줄
**시간:** 15분

---

### 2. JSON 파싱 함수 추출 (15분)

```typescript
// autoCollectionService.ts
// 현재: 4곳에 중복된 JSON 파싱

// 개선: validatorService.ts
export function parseAutoTags(condition: any): string[] {
  try {
    return typeof condition.tags === 'string'
      ? JSON.parse(condition.tags)
      : condition.tags;
  } catch (error) {
    console.error('Failed to parse auto tags:', error);
    return [];
  }
}
```

**절약:** 40줄
**시간:** 15분

---

### 3. Regex 컴파일 캐싱 (15분)

```typescript
// autoCollectionService.ts
// 현재: 매번 new RegExp() 생성

// 개선: 캐시 사용
const regexCache = new Map<string, RegExp>();

function getCompiledRegex(pattern: string, flags: string): RegExp {
  const key = `${pattern}:${flags}`;
  if (!regexCache.has(key)) {
    regexCache.set(key, new RegExp(pattern, flags));
  }
  return regexCache.get(key)!;
}
```

**성능 개선:** 20-30%
**시간:** 15분

---

### 4. 테스트 스크립트 이동 (30분)

```bash
# 현재 위치
backend/src/services/test-*.ts

# 새 위치
backend/scripts/dev/test-*.ts
```

**작업:**
1. 디렉토리 생성
2. 파일 이동
3. import 경로 수정

**시간:** 30분

---

### 5. Error Boundary 추가 (컴포넌트당 1시간)

```typescript
// RatingScoreSettings.tsx, TaggerSettings.tsx 등
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function RatingScoreSettings() {
  return (
    <ErrorBoundary fallback={<SettingsErrorFallback />}>
      {/* 기존 컴포넌트 */}
    </ErrorBoundary>
  );
}
```

**시간:** 1시간/컴포넌트
**영향:** 안정성 향상

---

### 6. Deprecated Endpoints 제거 (30분)

```typescript
// system.routes.ts
// 4개 endpoint 제거
// 관련 핸들러 제거
// 문서 업데이트
```

**시간:** 30분

---

## 📅 권장 실행 일정

### Week 1: Critical Issues (총 8시간)

**Day 1-2: Blocking Issues**
- [ ] ImageModel wrapper 제거 (1.5시간)
- [ ] Quick Wins 전부 실행 (2시간)
- [ ] api.ts 도메인 분리 (2시간)

**Day 3-5: 핵심 서비스 분리**
- [ ] folderScanService.ts 분리 (4시간)

### Week 2: High Priority Services (총 8시간)

**Day 1-2: autoCollectionService**
- [ ] Strategy 패턴 적용 (3시간)

**Day 3-4: workflows.ts**
- [ ] 라우트 분리 (2.5시간)

**Day 5: autoTagSearchService**
- [ ] 쿼리 빌더 분리 (2.5시간)

### Week 3: High Priority Components (총 6시간)

**Day 1-2: RatingScoreSettings**
- [ ] 컴포넌트 분리 (2시간)
- [ ] Custom hooks 생성 (1시간)

**Day 3-4: TaggerSettings**
- [ ] 컴포넌트 분리 (2시간)
- [ ] Custom hooks 생성 (1시간)

### Week 4: Medium Priority (총 8시간)

**Day 1-2:**
- [ ] metadataReader 중복 제거 (1.5시간)
- [ ] promptCollectionService 분리 (2시간)

**Day 3-4:**
- [ ] imageSimilarity 최적화 (2시간)

**Day 5: 정리 및 테스트**
- [ ] 전체 테스트 (2시간)
- [ ] 문서 업데이트 (0.5시간)

---

## 🎯 성공 지표

### 코드 메트릭스

**목표:**
- 500줄 이상 파일: 24개 → **10개 이하**
- 평균 파일 크기: 현재 → **30% 감소**
- 중복 코드: 현재 → **50% 감소**
- 테스트 커버리지: 현재 → **70% 이상**

### 성능 메트릭스

**목표:**
- API 응답 시간: **10% 개선**
- 프론트엔드 번들 크기: **15% 감소**
- 메모리 사용량: **20% 감소**

### 개발 생산성

**목표:**
- 새 기능 추가 시간: **30% 단축**
- 버그 수정 시간: **40% 단축**
- 코드 리뷰 시간: **25% 단축**

---

## 📝 체크리스트

### Phase 1 완료 조건
- [ ] ImageModel 완전 제거
- [ ] 모든 Quick Wins 완료
- [ ] api.ts 도메인 분리
- [ ] folderScanService 분리
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 통과

### Phase 2 완료 조건
- [ ] autoCollectionService 리팩토링
- [ ] workflows.ts 라우트 분리
- [ ] autoTagSearchService 분리
- [ ] 모든 기존 기능 정상 동작
- [ ] 성능 저하 없음

### Phase 3 완료 조건
- [ ] RatingScoreSettings 컴포넌트 분리
- [ ] TaggerSettings 컴포넌트 분리
- [ ] 레거시 코드 완전 제거
- [ ] 문서 업데이트
- [ ] 코드 리뷰 완료

### Phase 4 완료 조건
- [ ] metadataReader 중복 제거
- [ ] promptCollectionService 분리
- [ ] imageSimilarity 최적화
- [ ] 전체 테스트 통과
- [ ] 성능 메트릭스 목표 달성

---

## 🚨 위험 요소 및 완화 전략

### 위험 1: 기능 중단
**확률:** MEDIUM
**영향:** HIGH

**완화 전략:**
- 각 단계마다 통합 테스트 실행
- Feature flag 사용하여 점진적 전환
- Rollback 계획 수립

### 위험 2: 성능 저하
**확률:** LOW
**영향:** MEDIUM

**완화 전략:**
- 리팩토링 전후 벤치마크 측정
- 프로파일링으로 병목 지점 확인
- 캐싱 전략 최적화

### 위험 3: 일정 지연
**확률:** MEDIUM
**영향:** LOW

**완화 전략:**
- 우선순위 기반 점진적 진행
- Quick Wins 먼저 완료하여 조기 성과
- 병렬 작업 가능한 부분 식별

### 위험 4: 의존성 충돌
**확률:** LOW
**영향:** MEDIUM

**완화 전략:**
- 의존성 그래프 작성
- 점진적 마이그레이션
- TypeScript 타입 체크 활용

---

## 📚 참고 자료

### 내부 문서
- [Architecture Documentation](./architecture.md)
- [API Documentation](./api.md)
- [Setup Guide](../../SETUP.md)

### 리팩토링 패턴
- Strategy Pattern (autoCollectionService)
- Facade Pattern (folderScanService)
- Repository Pattern (데이터 접근)
- Factory Pattern (조건 평가기)

### 추천 도구
- **ESLint**: 코드 품질 검증
- **Prettier**: 코드 포맷팅
- **Jest**: 단위 테스트
- **k6**: 성능 테스트

---

## 💡 다음 단계

1. **이 계획서 검토 및 승인**
2. **팀과 우선순위 논의**
3. **Phase 1 착수**
4. **주간 진행상황 리뷰**
5. **완료 후 회고**

---

**문서 버전:** 1.0
**최종 업데이트:** 2025-11-06
**작성자:** Claude Code Analysis
**검토자:** [팀원 이름]
