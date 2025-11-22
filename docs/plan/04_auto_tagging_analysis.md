# 자동 태그 (WD Tagger) 기능 분석 보고서

> **분석 날짜**: 2025-11-22
> **분석 범위**: WD v3 Tagger 자동 태깅 기능

---

## 📋 요약

WD Tagger 기능은 잘 설계된 설정 페이지와 여러 컴포넌트로 구성되어 있습니다. 백엔드는 `composite_hash`를 일관되게 사용하지만, **프론트엔드 타입 정의가 백엔드 응답과 일치하지 않는 중요한 문제**가 있습니다.

---

## 🗂️ 파일 구조

### 프론트엔드

```
frontend/src/pages/Settings/features/Tagger/
├── TaggerSettings.tsx                   # 메인 설정 컴포넌트
├── components/
│   ├── TaggerModelStatus.tsx            # 모델 상태 표시
│   ├── TaggerConfigForm.tsx             # 태거 설정 폼
│   ├── TaggerMemoryManagement.tsx       # 메모리 설정
│   ├── TaggerTestSection.tsx            # 단일 이미지 테스트
│   └── TaggerBatchOperations.tsx        # 배치 태깅 UI
└── hooks/
    ├── useTaggerSettings.ts              # 설정 관리
    ├── useTaggerModels.ts                # 모델 관리
    ├── useTaggerTest.ts                  # 테스트 로직
    └── useTaggerBatch.ts                 # 배치 작업

frontend/src/components/AutoTagDisplay.tsx  # 태그 결과 표시
```

### 백엔드

```
backend/src/routes/images/tagging.routes.ts  # 태깅 API 라우트
backend/src/services/imageTaggerService.ts   # 고수준 인터페이스
backend/src/services/taggerDaemon.ts         # Python 데몬 관리
backend/src/models/Image/ImageTaggingModel.ts  # DB 작업
```

---

## 🎯 주요 컴포넌트

### 1. TaggerSettings.tsx
메인 설정 컴포넌트:
- 활성화/비활성화 토글
- 모델 선택
- 설정 옵션
- 커스텀 훅으로 모든 기능 오케스트레이션

### 2. TaggerModelStatus.tsx
현재 모델 상태 표시:
- 로드/언로드 상태
- 디바이스 (CPU/CUDA)
- 마지막 사용 시간

### 3. TaggerTestSection.tsx
단일 이미지 테스트 인터페이스:
- composite_hash 입력으로 수동 선택
- API 엔드포인트: `POST /api/images/:id/tag` (여기서 :id는 composite_hash)
- **🔴 문제**: `validateImageId`가 숫자로 파싱 시도 (불일치)

### 4. TaggerBatchOperations.tsx
배치 태깅 작업 UI:
- 미처리 이미지 태그
- 모든 이미지 태그
- 선택된 이미지 태그 (현재 갤러리 UI에 노출 안 됨)

### 5. AutoTagDisplay.tsx
태그 결과 표시 컴포넌트:
- **등급 게이지**: HP 바 스타일 시각화 (색상 코딩)
  - General (녹색), Sensitive (노란색), Questionable (주황색), Explicit (빨간색)
  - 퍼센트 분포 표시
- **캐릭터**: 신뢰도 점수가 있는 진행 바 목록
- **태그 목록**: 쉼표로 구분된 태그 문자열
- **일반 태그**: 모든 태그 및 점수가 있는 접을 수 있는 아코디언
- **모델 정보**: 모델명, 임계값, 태그 생성 시간

---

## 📸 이미지 선택/표시 방식

### 단일 이미지 태깅
- 테스트 섹션에서 composite_hash로 수동 선택
- 사용자가 composite_hash 입력 (48자 hex 문자열)
- API 엔드포인트: `POST /api/images/:id/tag`

### 배치 태깅 - 3가지 모드

**1. 미처리 이미지** (`/batch-tag-unprocessed`):
- `auto_tags IS NULL`인 이미지 자동 선택
- `ImageTaggingModel.findUntagged(limit)` 사용
- 기본 제한: 100개 이미지

**2. 모든 이미지** (`/batch-tag-all`):
- 데이터베이스의 모든 이미지 처리 (선택적 제한)
- 태그 존재 시에도 강제 재태깅
- 사용자 확인 대화상자 필요

**3. 선택된 이미지** (`/batch-tag`):
- image_ids (composite_hashes) 배열 허용
- **현재 갤러리 UI에 노출 안 됨** - `BulkActionBar`에 배치 태그 버튼 없음

---

## 🔄 배치 태깅 작업

### 백엔드 라우트 (tagging.routes.ts)

| 엔드포인트 | 메서드 | 목적 |
|------------|--------|------|
| `POST /:id/tag` | POST | composite_hash로 단일 이미지 태그 |
| `POST /batch-tag` | POST | 특정 이미지 태그 (`image_ids` 배열 기대) |
| `POST /batch-tag-unprocessed` | POST | NULL auto_tags 이미지 태그 |
| `POST /batch-tag-all` | POST | 강제 옵션으로 모든 이미지 태그 |
| `GET /untagged-count` | GET | 태그 안 된 이미지 개수 |
| `POST /recalculate-rating-scores` | POST | 모든 이미지의 등급 점수 재계산 |

### 서비스 레이어
- `imageTaggerService.ts` - 데몬 사용 고수준 인터페이스
- `taggerDaemon.ts` - Python 데몬 관리 (영구 프로세스)
- 이미지와 비디오 모두 지원 (비디오는 태깅을 위해 7 프레임 추출)

### 처리 흐름
1. 태그할 이미지 데이터베이스 쿼리
2. 각 이미지에 대해:
   - `media_metadata` + `image_files`에서 composite_hash 및 파일 경로 가져오기
   - `resolveUploadsPath()`로 절대 파일 경로 해결
   - 디스크에 파일 존재 확인
   - `imageTaggerService.tagImage()` 또는 `.tagVideo()` 호출
   - 등급 데이터에서 rating_score 계산
   - `auto_tags` 및 `rating_score`로 `media_metadata` 테이블 업데이트

---

## 📊 결과 표시

### 설정 페이지
- 테스트 결과가 auto_tags 데이터의 JSON 미리보기 표시
- 배치 작업이 진행 카운트 표시 (성공/실패)
- 완료 상태에 대한 알림 메시지

### 이미지 상세 뷰 (AutoTagDisplay.tsx)
- **등급 게이지**: HP 바 스타일 시각화 (색상 코딩)
- **캐릭터**: 신뢰도 점수가 있는 진행 바
- **태그 목록**: 쉼표로 구분
- **일반 태그**: 접을 수 있는 아코디언
- **모델 정보**: 모델명, 임계값, 타임스탬프

### 시각적 기능
- 태그 신뢰도를 위한 색상 코딩 진행 바
- 상세 데이터를 위한 아코디언 컴포넌트
- 태그 누락 시 "태그 생성" 버튼

---

## 🆔 식별자 사용 및 이슈

### 🔴 주요 식별자 불일치 발견!

### 백엔드 (올바름 - composite_hash)

```typescript
// tagging.routes.ts line 24
const compositeHash = req.params.id;

// composite_hash를 다음에 전체적으로 사용:
// - 데이터베이스 쿼리 (media_metadata.composite_hash)
// - 파일 조회 (image_files.composite_hash)
// - API 응답
```

### 프론트엔드 이슈

**1. 테스트 섹션** (`useTaggerTest.ts` + `taggerHelpers.ts`):
```typescript
// taggerHelpers.ts line 16-22
export const validateImageId = (value: string): { isValid: boolean; imageId?: number } => {
  const imageId = parseInt(value);  // ❌ composite_hash를 숫자로 처리
  if (isNaN(imageId) || imageId <= 0) {
    return { isValid: false };
  }
  return { isValid: true, imageId };
};
```

**문제점**:
- 입력이 composite_hash 문자열 기대
- 검증이 숫자로 파싱 시도
- composite_hash 문자열이 숫자일 수 있어서 우연히 작동

**2. API 인터페이스** (`settingsApi.ts`):
```typescript
// Line 232-236: BatchTagResult 인터페이스
results: Array<{
  image_id: number;  // ❌ composite_hash: string이어야 함
  success: boolean;
  auto_tags?: any;
  error?: string;
}>;

// Line 265: testImage 함수
testImage: async (imageId: string): Promise<any> => {  // ✅ 올바름 - 문자열 사용
  const response = await imageApi.post(`/${imageId}/tag`);
  return response.data.data;
}
```

**3. 백엔드 응답** (`tagging.routes.ts`):
```typescript
// Line 262-267: 배치 결과
results.push({
  composite_hash: compositeHash,  // ✅ 백엔드는 composite_hash 사용
  success: true,
  auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
});
```

**타입 불일치**: 백엔드는 `composite_hash` (string) 반환, 프론트엔드는 `image_id` (number) 기대

---

## 📝 주요 발견사항 요약

### 강점
- 영구 모델 로딩을 위한 데몬으로 잘 설계됨
- 포괄적인 배치 작업
- 등급 게이지로 좋은 시각적 피드백
- 이미지와 비디오 모두 지원
- 백엔드에서 composite_hash 일관되게 사용

### 🔴 이슈
1. **프론트엔드 타입 정의가 백엔드와 일치하지 않음** - `image_id: number` vs `composite_hash: string`
2. **갤러리 통합 없음** - `BulkActionBar`에서 배치 태그 옵션 누락
3. **검증 헬퍼에 숫자 가정** - `validateImageId`가 문자열을 숫자로 파싱
4. **BatchTagResult 인터페이스 불일치** - 프론트엔드 타입이 백엔드 응답과 맞지 않음

---

## 🔧 권장사항

### 우선순위 1 (필수)
1. **BatchTagResult 인터페이스 업데이트**:
   ```typescript
   results: Array<{
     composite_hash: string;  // image_id에서 변경
     success: boolean;
     auto_tags?: any;
     error?: string;
   }>;
   ```

2. **validateImageId 수정**:
   ```typescript
   export const validateCompositeHash = (value: string): { isValid: boolean; hash?: string } => {
     const hashPattern = /^[0-9a-fA-F]{48}$/;  // 48자 hex
     if (!hashPattern.test(value)) {
       return { isValid: false };
     }
     return { isValid: true, hash: value };
   };
   ```

### 우선순위 2 (권장)
3. **갤러리 배치 태깅 추가**:
   - `BulkActionBar`에 "배치 태그" 버튼 추가
   - 선택된 이미지의 composite_hash 배열로 `/batch-tag` 호출

4. **프론트엔드 전체에서 composite_hash 일관성 보장**:
   - 모든 API 호출 검토
   - 타입 정의 업데이트
   - `imageId` → `compositeHash`로 변수명 변경

### 우선순위 3 (개선)
5. **테스트 섹션 UX 개선**:
   - 최근 이미지에서 composite_hash 선택기 추가
   - 갤러리에서 직접 테스트 옵션 제공

---

## 📊 API 엔드포인트 요약

| 엔드포인트 | 입력 | 출력 | 비고 |
|------------|------|------|------|
| `POST /:id/tag` | composite_hash (string) | auto_tags, rating | 단일 이미지 |
| `POST /batch-tag` | composite_hash[] | results[] | 선택된 이미지 |
| `POST /batch-tag-unprocessed` | limit (optional) | results[] | NULL 태그만 |
| `POST /batch-tag-all` | force, limit | results[] | 모든 이미지 |
| `GET /untagged-count` | - | count | 통계 |

---

## 🎓 학습 포인트

### WD Tagger 작동 방식
1. Python 데몬 프로세스가 ML 모델 로드
2. 이미지/비디오를 데몬에 전송
3. 데몬이 추론 실행 (CUDA/CPU)
4. 결과 반환: 태그, 신뢰도, 등급, 캐릭터
5. `media_metadata`에 JSON으로 저장

### 지원 모델
- WD v3 (기본값)
- 커스터마이징 가능한 임계값
- 디바이스 선택 (CPU/CUDA)

### 메모리 관리
- "로드 유지" 옵션 (빠른 연속 태깅용)
- 자동 언로드 타이머 (메모리 절약)
- 수동 로드/언로드 제어

---

## 📁 분석된 파일

### 프론트엔드:
- `frontend/src/pages/Settings/features/Tagger/**/*.tsx` (모든 컴포넌트)
- `frontend/src/pages/Settings/features/Tagger/hooks/**/*.ts` (훅)
- `frontend/src/components/AutoTagDisplay.tsx`
- `frontend/src/services/settingsApi.ts` (API 클라이언트)
- `frontend/src/utils/taggerHelpers.ts`

### 백엔드:
- `backend/src/routes/images/tagging.routes.ts`
- `backend/src/services/imageTaggerService.ts`
- `backend/src/services/taggerDaemon.ts`
- `backend/src/models/Image/ImageTaggingModel.ts`

---

## ✅ 결론

WD Tagger 기능은 백엔드에서 잘 구현되었지만, **프론트엔드 타입 정의와 백엔드 응답 간 중요한 불일치**가 있습니다. 모든 수정이 `composite_hash: string`을 주 식별자로 사용하도록 해야 합니다.

갤러리에 배치 태깅 통합을 추가하면 기능의 유용성이 크게 향상될 것입니다.
