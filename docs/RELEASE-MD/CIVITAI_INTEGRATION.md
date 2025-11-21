# Civitai Integration Implementation Plan

## 목차
1. [개요](#개요)
2. [기능 1: 모델/LoRA 정보 자동 수집](#기능-1-모델lora-정보-자동-수집)
3. [기능 2: Civitai 이미지 업로드](#기능-2-civitai-이미지-업로드)
4. [데이터베이스 스키마](#데이터베이스-스키마)
5. [Civitai API 스펙](#civitai-api-스펙)
6. [구현 순서](#구현-순서)
7. [설정 옵션](#설정-옵션)

---

## 개요

ComfyUI Image Manager에 Civitai 통합 기능을 추가하여:
1. 이미지 메타데이터에서 추출한 모델/LoRA 정보를 Civitai API로 조회하여 상세 정보를 캐싱
2. 관리하는 이미지를 Civitai에 업로드하는 기능 제공

### 핵심 원칙
- **캐싱 우선**: DB에 정보가 있으면 API 호출 안 함
- **백그라운드 처리**: 메타데이터 추출과 별도로 비동기 처리
- **Rate Limiting**: 사용자 설정 가능한 API 호출 간격
- **실패 추적**: 실패한 조회는 재시도 안 함 (플래그로 표시)

---

## 기능 1: 모델/LoRA 정보 자동 수집

### 1.1 동작 흐름

```
이미지 업로드
    ↓
메타데이터 추출 (기존 - 빠르게 처리)
    ↓
image_models 테이블에 해시 저장
    ↓
백그라운드 큐에 Civitai 조회 작업 추가
    ↓
[백그라운드 처리]
    ↓
1. image_models에서 civitai_checked = false인 레코드 조회
    ↓
2. model_info 테이블에서 해시로 캐시 확인
    ├─ 있음 → image_models.civitai_checked = true, 완료
    └─ 없음 → 3번으로
    ↓
3. Civitai API 호출 (rate limit 적용)
    ├─ 성공 → model_info 저장, 썸네일 다운로드
    └─ 실패 → image_models.civitai_failed = true
    ↓
4. image_models.civitai_checked = true
```

### 1.2 메타데이터에서 해시 추출

**현재 상황**:
- WebUI 파서: `backend/src/services/metadata/parsers/webuiParser.ts`
- 추출되는 정보:
  - `Model hash: 15012c538f` (AutoV2 해시 - 10자리)
  - `Lora hashes: "name1: hash1, name2: hash2"` (AutoV2 해시들)

**Hash 형식 설명**:
- **AutoV1**: SHA256의 처음 4바이트 (8자리 hex) - 레거시
- **AutoV2**: SHA256의 처음 10자리 hex - **현재 표준, Civitai 사용**
- **AutoV3**: 모델 메타데이터에 포함된 해시 파싱

참고: https://github.com/AUTOMATIC1111/stable-diffusion-webui/discussions/16203

### 1.3 개선할 파서 로직

**파일**: `backend/src/services/metadata/parsers/webuiParser.ts`

**현재 코드 (line 191-230)**:
```typescript
// 모델 해시만 추출
const modelHash = this.extractValue(params, 'Model hash');

// LoRA는 이름만 배열로 저장
const loraModels = this.extractLoraModels(params);
const loraHashes = this.extractValue(params, 'Lora hashes'); // 문자열
```

**개선 방향**:
```typescript
// 1. 모델 정보 구조화
interface ModelReference {
  name: string;
  hash: string;      // AutoV2 해시
  type: 'checkpoint' | 'lora';
  weight?: number;   // LoRA의 경우
}

// 2. 추출 후 image_models 테이블에 저장
// 3. 백그라운드 큐에 작업 추가
```

### 1.4 Civitai API 호출

**엔드포인트**:
```
GET https://civitai.com/api/v1/model-versions/by-hash/{hash}
Authorization: Bearer {api_key}
```

**응답 구조** (확인됨):
```json
{
  "id": 128713,                    // ModelVersion ID
  "name": "v5.1",                  // 버전명
  "updatedAt": "2024-01-01T...",
  "model": {
    "name": "Realistic Vision",   // 모델명
    "type": "Checkpoint",          // "Checkpoint" | "LORA" | "Embedding"
    "nsfw": false,
    "poi": false
  },
  "files": [
    {
      "id": 143906,
      "name": "realisticVision_v51.safetensors",
      "sizeKB": 2082642,
      "type": "Model",
      "metadata": {
        "fp": "fp16",
        "size": "full",
        "format": "SafeTensor"
      },
      "hashes": {
        "AutoV2": "15012C538F",   // ← 매칭에 사용
        "SHA256": "abc123...",
        "CRC32": "...",
        "BLAKE3": "..."
      },
      "downloadUrl": "https://civitai.com/api/download/models/...",
      "primary": true
    }
  ],
  "images": [
    {
      "url": "https://image.civitai.com/...",  // 썸네일
      "nsfw": "None",
      "width": 512,
      "height": 512,
      "hash": "...",
      "meta": { ... }
    }
  ],
  "stats": {
    "downloadCount": 12345,
    "ratingCount": 100,
    "rating": 4.8
  },
  "description": "Realistic Vision 5.1 is..."
}
```

**Rate Limiting**:
- Civitai는 공식적으로 rate limit을 공개하지 않음
- API 키 사용 시 더 높은 한도 제공
- 응답 헤더에 rate limit 정보 포함될 수 있음 (`X-RateLimit-*`)
- **권장**: 기본 2초 간격, 사용자가 조정 가능하도록 설정

### 1.5 썸네일 다운로드 및 저장

**저장 경로**: `temp/civitai/thumbnails/{model_hash}.jpg`

**로직**:
```typescript
// images[0].url에서 다운로드
const thumbnailUrl = response.images[0]?.url;
if (thumbnailUrl) {
  await downloadThumbnail(thumbnailUrl, `temp/civitai/thumbnails/${hash}.jpg`);
}
```

### 1.6 백그라운드 작업 통합

**파일**: `backend/src/services/backgroundQueue.ts`

**TaskType 추가**:
```typescript
enum TaskType {
  METADATA_EXTRACTION = 'metadata_extraction',
  PROMPT_COLLECTION = 'prompt_collection',
  CIVITAI_MODEL_LOOKUP = 'civitai_model_lookup'  // 새로 추가
}
```

**작업 추가 메서드**:
```typescript
static addCivitaiModelLookupTask(compositeHash: string): void {
  const task: BackgroundTask = {
    id: `${compositeHash}_civitai_${Date.now()}`,
    type: TaskType.CIVITAI_MODEL_LOOKUP,
    filePath: '',
    compositeHash,
    priority: 3,  // 낮은 우선순위 (메타데이터보다 나중)
    retries: 0,
    maxRetries: 1,  // 1번만 시도
    createdAt: new Date()
  };
  this.queue.push(task);
}
```

**처리 로직**:
```typescript
private static async processCivitaiModelLookup(task: BackgroundTask): Promise<void> {
  const settings = await CivitaiSettings.get();
  if (!settings.enabled) {
    return; // 기능 비활성화
  }

  // 1. image_models에서 미확인 해시 조회
  const uncheckedModels = await ImageModel.getUncheckedModels(task.compositeHash);

  for (const imageModel of uncheckedModels) {
    // 2. model_info 캐시 확인
    const cached = await ModelInfo.findByHash(imageModel.model_hash);
    if (cached) {
      await ImageModel.markAsChecked(imageModel.id);
      continue;
    }

    // 3. Rate limiting 적용
    await sleep(settings.apiCallInterval * 1000);

    // 4. Civitai API 호출
    try {
      const data = await CivitaiService.getModelByHash(imageModel.model_hash);

      // 5. model_info 저장
      await ModelInfo.create({
        model_hash: imageModel.model_hash,
        model_name: data.model.name,
        model_version_id: data.id.toString(),
        civitai_model_id: data.modelId,
        model_type: data.model.type.toLowerCase(),
        civitai_data: JSON.stringify(data)
      });

      // 6. 썸네일 다운로드
      if (data.images[0]?.url) {
        await CivitaiService.downloadThumbnail(
          data.images[0].url,
          imageModel.model_hash
        );
      }

      await ImageModel.markAsChecked(imageModel.id, false);
    } catch (error) {
      // 실패 기록
      await ImageModel.markAsChecked(imageModel.id, true);
      logger.error('Civitai API call failed:', error);
    }
  }
}
```

---

## 기능 2: Civitai 이미지 업로드

### 2.1 Civitai API 현황

**중요**: Civitai API는 **이미지 직접 업로드 엔드포인트를 제공하지 않습니다**.

**대안: Post Intent System**

Civitai는 "Post Intent URL" 방식을 제공합니다:

```
https://civitai.com/intent/post?mediaUrl={url}&title={title}&description={desc}&tags={tags}&detailsUrl={url}
```

**동작 방식**:
1. 우리 서버가 이미지를 공개 URL로 제공
2. Post Intent URL을 생성하여 사용자에게 제공
3. 사용자가 URL 클릭 → Civitai 페이지로 이동
4. Civitai가 우리 서버에서 이미지 다운로드
5. 사용자가 Civitai 웹 UI에서 최종 확인 및 게시

**참고**: https://developer.civitai.com/docs/post-intent-system

### 2.2 구현 방식

**Option 1: Post Intent System (권장)**
- 우리 이미지를 임시 공개 URL로 제공
- Intent URL 생성 및 제공
- 사용자가 브라우저에서 Civitai로 이동하여 게시

**Option 2: 향후 API 대기**
- Civitai가 공식 업로드 API를 제공할 때까지 대기
- 현재는 Post Intent만 구현

### 2.3 Post Intent 구현 계획

**기능**:
1. 이미지 선택 (단일/다중, 최대 20개)
2. 메타데이터 포함/제외 옵션
3. 제목, 설명, 태그 입력
4. Intent URL 생성 및 클립보드 복사 또는 새 창 열기

**API 엔드포인트** (우리 서버):
```
POST /api/civitai/create-intent
Body: {
  compositeHashes: string[],
  includeMetadata: boolean,
  title?: string,
  description?: string,
  tags?: string[]
}

Response: {
  intentUrl: string
}
```

**Intent URL 생성 로직**:
```typescript
function createIntentUrl(params: {
  mediaUrls: string[],
  title?: string,
  description?: string,
  tags?: string[],
  detailsUrl?: string
}): string {
  const baseUrl = 'https://civitai.com/intent/post';
  const query = new URLSearchParams();

  params.mediaUrls.forEach(url => query.append('mediaUrl', url));
  if (params.title) query.append('title', params.title);
  if (params.description) query.append('description', params.description);
  if (params.tags) query.append('tags', params.tags.join(','));
  if (params.detailsUrl) query.append('detailsUrl', params.detailsUrl);

  return `${baseUrl}?${query.toString()}`;
}
```

**임시 공개 URL**:
- 토큰 기반 임시 URL 생성
- 유효기간: 1시간
- 경로: `/api/civitai/temp-image/:token`

---

## 데이터베이스 스키마

### 3.1 model_info 테이블

```sql
CREATE TABLE model_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 기본 정보
  model_hash TEXT UNIQUE NOT NULL,           -- AutoV2 해시 (10자리)
  model_name TEXT,                            -- 모델명
  model_version_id TEXT,                      -- Civitai ModelVersion ID
  civitai_model_id INTEGER,                   -- Civitai Model ID
  model_type TEXT,                            -- 'checkpoint' | 'lora' | 'embedding'

  -- Civitai 데이터
  civitai_data TEXT,                          -- 전체 API 응답 (JSON)
  thumbnail_path TEXT,                        -- 로컬 썸네일 경로

  -- 메타 정보
  last_checked_at DATETIME,                   -- 마지막 API 호출 시각
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_model_hash ON model_info(model_hash);
CREATE INDEX idx_model_version ON model_info(model_version_id);
CREATE INDEX idx_civitai_model ON model_info(civitai_model_id);
CREATE INDEX idx_model_type ON model_info(model_type);
```

### 3.2 image_models 테이블

```sql
CREATE TABLE image_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 관계
  composite_hash TEXT NOT NULL,               -- 이미지 해시
  model_hash TEXT NOT NULL,                   -- 모델 해시

  -- 모델 역할
  model_role TEXT NOT NULL,                   -- 'base_model' | 'lora' | 'vae'
  weight REAL,                                -- LoRA weight (예: 0.8)

  -- Civitai 조회 상태
  civitai_checked BOOLEAN DEFAULT 0,          -- API 조회 완료 여부
  civitai_failed BOOLEAN DEFAULT 0,           -- API 조회 실패 여부
  checked_at DATETIME,                        -- 조회 시각

  -- 메타
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE,
  FOREIGN KEY (model_hash) REFERENCES model_info(model_hash) ON DELETE SET NULL,
  UNIQUE(composite_hash, model_hash, model_role)
);

CREATE INDEX idx_image_models_composite ON image_models(composite_hash);
CREATE INDEX idx_image_models_hash ON image_models(model_hash);
CREATE INDEX idx_image_models_unchecked ON image_models(civitai_checked, civitai_failed);
```

### 3.3 civitai_settings 테이블

```sql
CREATE TABLE civitai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),      -- 싱글톤 레코드

  -- 기능 활성화
  enabled BOOLEAN DEFAULT 1,                  -- 전체 기능 ON/OFF

  -- Rate Limiting
  api_call_interval INTEGER DEFAULT 2,        -- API 호출 간격 (초)

  -- 통계
  total_lookups INTEGER DEFAULT 0,            -- 총 조회 시도
  successful_lookups INTEGER DEFAULT 0,       -- 성공 건수
  failed_lookups INTEGER DEFAULT 0,           -- 실패 건수
  last_api_call DATETIME,                     -- 마지막 API 호출 시각

  -- 메타
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본값 삽입
INSERT INTO civitai_settings (id) VALUES (1);
```

### 3.4 civitai_temp_urls 테이블 (Post Intent용)

```sql
CREATE TABLE civitai_temp_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  token TEXT UNIQUE NOT NULL,                 -- 랜덤 토큰
  composite_hash TEXT NOT NULL,               -- 이미지 해시
  include_metadata BOOLEAN DEFAULT 1,         -- 메타데이터 포함 여부

  expires_at DATETIME NOT NULL,               -- 만료 시각 (1시간 후)
  access_count INTEGER DEFAULT 0,             -- 접근 횟수

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE
);

CREATE INDEX idx_temp_urls_token ON civitai_temp_urls(token);
CREATE INDEX idx_temp_urls_expires ON civitai_temp_urls(expires_at);
```

---

## Civitai API 스펙

### 4.1 인증

```
Authorization: Bearer {api_key}
```

또는 Query String:
```
?token={api_key}
```

API 키는 Civitai 계정 설정에서 생성.

### 4.2 모델 조회 엔드포인트

**URL**: `GET https://civitai.com/api/v1/model-versions/by-hash/{hash}`

**파라미터**:
- `{hash}`: AutoV2 해시 (10자리 hex, 대소문자 무관)

**응답**: 위 섹션 1.4 참조

**에러 응답**:
```json
{
  "error": "Model version not found"
}
```

### 4.3 Rate Limiting

- 공식 한도 미공개
- API 키 사용 권장
- 응답 헤더 확인:
  - `X-RateLimit-Limit`: 최대 요청 수
  - `X-RateLimit-Remaining`: 남은 요청 수
  - `X-RateLimit-Reset`: 리셋 시각 (Unix timestamp)

### 4.4 Post Intent System

**URL**: `https://civitai.com/intent/post`

**Query Parameters**:
- `mediaUrl` (required, 반복 가능): 이미지 URL (최대 20개)
- `title` (optional): 포스트 제목
- `description` (optional): 설명
- `tags` (optional): 쉼표로 구분된 태그
- `detailsUrl` (optional): 추가 정보 URL

**예시**:
```
https://civitai.com/intent/post
  ?mediaUrl=https://example.com/image1.png
  &mediaUrl=https://example.com/image2.png
  &title=My%20Art
  &description=Created%20with%20RealisticVision
  &tags=realistic,portrait
```

---

## 구현 순서

### Phase 1: 데이터베이스 및 기본 구조 (우선순위: 높음)

1. **마이그레이션 작성**
   - `model_info` 테이블 생성
   - `image_models` 테이블 생성
   - `civitai_settings` 테이블 생성
   - 파일: `backend/src/database/migrations/XXX_create_civitai_tables.ts`

2. **모델 클래스 생성**
   - `backend/src/models/ModelInfo.ts`
   - `backend/src/models/ImageModel.ts`
   - `backend/src/models/CivitaiSettings.ts`

3. **Civitai 서비스 기본 구조**
   - `backend/src/services/civitaiService.ts`
   - API 키 가져오기 (ExternalApiProvider 활용)
   - 기본 HTTP 클라이언트 설정

### Phase 2: 메타데이터 파서 개선 (우선순위: 높음)

4. **WebUI 파서 수정**
   - 파일: `backend/src/services/metadata/parsers/webuiParser.ts`
   - 모델 해시 추출 개선
   - LoRA 해시 파싱 및 구조화
   - `image_models` 테이블에 저장 로직 추가

5. **타입 정의 업데이트**
   - 파일: `backend/src/services/metadata/types.ts`
   - `ModelReference` 인터페이스 추가

### Phase 3: Civitai API 연동 (우선순위: 높음)

6. **CivitaiService 구현**
   - `getModelByHash(hash: string)` 메서드
   - `downloadThumbnail(url: string, hash: string)` 메서드
   - Rate limiting 로직
   - 에러 핸들링

7. **썸네일 관리**
   - `temp/civitai/thumbnails/` 디렉토리 자동 생성
   - 다운로드 및 저장 로직
   - 이미지 최적화 (선택사항)

### Phase 4: 백그라운드 큐 통합 (우선순위: 높음)

8. **BackgroundQueueService 수정**
   - 파일: `backend/src/services/backgroundQueue.ts`
   - `CIVITAI_MODEL_LOOKUP` TaskType 추가
   - `addCivitaiModelLookupTask()` 메서드
   - `processCivitaiModelLookup()` 메서드

9. **메타데이터 추출 후 큐 연동**
   - 파일: `backend/src/services/ImageProcessor.ts` (추정)
   - 메타데이터 추출 성공 후 Civitai 작업 추가

### Phase 5: 설정 시스템 (우선순위: 중간)

10. **Settings API 라우트**
    - 파일: `backend/src/routes/civitai.ts` (신규)
    - `GET /api/civitai/settings` - 설정 조회
    - `PUT /api/civitai/settings` - 설정 업데이트
    - `GET /api/civitai/stats` - 통계 조회

11. **Frontend 설정 페이지**
    - 파일: `frontend/src/pages/Settings/features/Civitai/` (신규)
    - 기능 활성화 토글
    - API 호출 간격 설정
    - 통계 표시 (성공/실패 건수)

### Phase 6: 모델 정보 조회 API (우선순위: 중간)

12. **모델 정보 API**
    - `GET /api/civitai/models/:hash` - 특정 모델 정보
    - `GET /api/civitai/models` - 캐시된 모델 목록
    - `GET /api/images/:hash/models` - 이미지에 사용된 모델 목록

13. **Frontend UI 표시**
    - 이미지 상세 페이지에 모델 정보 표시
    - 썸네일, 모델명, Civitai 링크 등

### Phase 7: Post Intent 시스템 (우선순위: 낮음)

14. **임시 URL 시스템**
    - 파일: `backend/src/services/civitaiTempUrlService.ts` (신규)
    - 토큰 생성 및 관리
    - 만료 처리
    - `civitai_temp_urls` 테이블 활용

15. **Intent API**
    - `POST /api/civitai/create-intent` - Intent URL 생성
    - `GET /api/civitai/temp-image/:token` - 임시 이미지 제공

16. **Frontend 업로드 UI**
    - 이미지 선택
    - 메타데이터 포함/제외 옵션
    - 제목, 설명, 태그 입력
    - Intent URL 생성 및 새 창 열기

### Phase 8: 테스트 및 최적화 (우선순위: 중간)

17. **단위 테스트**
    - CivitaiService 테스트
    - ModelInfo, ImageModel 테스트

18. **통합 테스트**
    - 전체 워크플로우 테스트
    - 에러 시나리오 테스트

19. **성능 최적화**
    - 배치 처리 최적화
    - DB 인덱스 튜닝

---

## 설정 옵션

### 7.1 Backend 설정 (civitai_settings 테이블)

```typescript
interface CivitaiSettings {
  enabled: boolean;              // 기능 활성화
  apiCallInterval: number;       // API 호출 간격 (초)
}
```

**기본값**:
- `enabled`: `true`
- `apiCallInterval`: `2` (2초)

### 7.2 Frontend 설정 UI

**위치**: Settings → External APIs → Civitai

**항목**:
1. **Enable Civitai Integration**
   - 토글 스위치
   - 설명: "Automatically fetch model information from Civitai"

2. **API Call Interval**
   - 슬라이더: 1초 ~ 10초
   - 설명: "Minimum interval between API calls (recommended: 2s)"

3. **Statistics** (읽기 전용)
   - Total Lookups: `{total}`
   - Successful: `{success}` ({percentage}%)
   - Failed: `{failed}` ({percentage}%)
   - Last API Call: `{timestamp}`

4. **Actions**
   - "Re-check Failed Models" 버튼
   - "Clear Model Cache" 버튼 (주의 필요)

---

## 추가 고려사항

### 8.1 보안

- API 키는 암호화 저장 (기존 ExternalApiProvider 활용)
- 임시 URL 토큰은 암호학적으로 안전한 랜덤 생성
- Rate limiting으로 API 키 남용 방지

### 8.2 에러 처리

- Network 에러: 재시도 없음, 실패 기록
- 404 Not Found: Civitai에 모델 없음, 실패 기록
- 429 Too Many Requests: Rate limit 초과, 경고 로그
- 500 Server Error: Civitai 서버 문제, 실패 기록

### 8.3 모니터링

- 모든 API 호출 로깅
- 성공/실패 통계 업데이트
- 비정상적인 실패율 감지 시 알림

### 8.4 향후 확장

- Civitai 이미지 직접 업로드 API 출시 시 통합
- 모델 정보 기반 검색/필터 기능
- 자동 업데이트 (모델 정보 주기적 갱신)
- Civitai 컬렉션 연동

---

## 참고 자료

- **Civitai API 문서**: https://developer.civitai.com/docs/api/public-rest
- **REST API Reference**: https://github.com/civitai/civitai/wiki/REST-API-Reference
- **Post Intent System**: https://developer.civitai.com/docs/post-intent-system
- **AutoV2 Hash 설명**: https://github.com/AUTOMATIC1111/stable-diffusion-webui/discussions/16203
- **Civitai Helper Extension**: https://github.com/civitai/sd_civitai_extension

---

**작성일**: 2025-11-21
**버전**: 1.0
**상태**: 계획 단계
