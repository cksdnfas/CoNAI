# 메타데이터 추출 로직 동기화 분석 보고서

## 분석 대상
- **Frontend**: `frontend/src/utils/metadataReader.ts`
- **Backend**: `backend/src/services/metadata/index.ts`
- **Backend Parsers**: `novelaiParser.ts`, `webuiParser.ts`, `comfyuiParser.ts`

---

## 1. 각 시스템의 메타데이터 추출 방식 요약

### Frontend (metadataReader.ts)
```
파일 입력 → EXIF 추출 → PNG 텍스트 청크 추출 → 포맷 감지 → 파서 선택 →
  ├─ NovelAI Parser
  ├─ WebUI Parser
  └─ Stealth PNG Info 추출 (실패 시 재시도)
→ AI 도구 자동 감지 → ParsedMetadata 반환
```

**주요 특징**:
- 클라이언트 측 처리 (브라우저에서 실행)
- 메모리 기반 처리 (File.arrayBuffer())
- Stealth PNG는 보조 추출 (primary 실패 시만)
- EXIF 라이브러리 활용 (exifr)

### Backend (MetadataExtractor)
```
파일 경로 → 버퍼 로드 → Primary 추출 (PNG/JPEG)
  ├─ PNG: PngExtractor
  └─ JPEG: JpegExtractor
→ 포맷 감지 및 파싱 → 설정 확인 → Secondary 추출 (조건부)
  ├─ 파일 크기 확인
  ├─ 해상도 확인 (Sharp 메타데이터)
  └─ StealthPngExtractor 실행
→ 워크플로 JSON 검증 필터링 → AI 도구 감지 → LoRA 처리 → ImageMetadata 반환
```

**주요 특징**:
- 서버 측 처리
- 파일 시스템 기반 (fs.promises)
- Secondary 추출에 설정 기반 조건부 로직 포함
- 워크플로 JSON 필터링 및 LoRA 모델 추출 포함
- Sharp를 활용한 고해상도 이미지 최적화

---

## 2. 지원하는 메타데이터 형식 비교

| 형식 | Frontend | Backend | 설명 |
|------|----------|---------|------|
| **NovelAI** | ✅ | ✅ | JSON 형식, Comment 필드 포함 |
| **WebUI** | ✅ | ✅ | 텍스트 기반 parameters 형식 |
| **ComfyUI** | ❌ | ✅ | Workflow JSON (노드 구조) |
| **PNG tEXt/zTXt** | ✅ | ✅ | PNG 청크 메타데이터 |
| **Stealth PNG** | ✅ | ✅ | 이미지 픽셀 기반 숨겨진 데이터 |
| **JPEG EXIF** | ✅ | ✅ | JPEG EXIF 데이터 |

**차이점**:
- Frontend는 **ComfyUI를 지원하지 않음** ⚠️
- Frontend는 기본 EXIF 추출만, Backend는 JPEG 전용 추출기 보유

---

## 3. 추출되는 필드 비교

### 기본 필드 (동일)
```
ai_tool, prompt, positive_prompt, negative_prompt,
steps, cfg_scale, sampler, seed, scheduler,
width, height, model
```

### Frontend 추출 필드
```typescript
{
  aiTool,           // AI 도구명
  prompt,           // 프롬프트
  positivePrompt,   // 긍정 프롬프트
  negativePrompt,   // 부정 프롬프트
  parameters: {     // 기타 파라미터 (동적)
    [key: string]: any
  },
  rawMetadata       // 전체 원본 메타데이터
}
```

### Backend 추출 필드
```typescript
{
  ai_info: {
    // 기본 필드
    ai_tool, prompt, positive_prompt, negative_prompt,
    steps, cfg_scale, seed, sampler, scheduler,
    width, height, model,

    // NovelAI 전용
    cfg_rescale, uncond_scale, use_order, sm, sm_dyn,
    dynamic_thresholding, controlnet_strength, legacy,
    add_original_image, skip_cfg_above_sigma,

    // 추가 필드
    lora_models[],    // LoRA 모델 배열 ✅ (Backend만)
    lora_hashes,      // LoRA 해시
    model_hash, denoising_strength, clip_skip,
    version, title, description, software
  },
  extractedAt,      // 추출 시간
  error?            // 에러 메시지
}
```

**주요 차이**:
- ✅ Backend는 **LoRA 모델 추출** 지원
- ✅ Backend는 **추가 메타데이터 필드** 지원 (title, description, software)
- ✅ Backend는 **추출 시간 정보** 포함
- ❌ Frontend는 AI 도구를 detectAITool() 함수로 감지만 수행

---

## 4. 파싱 로직의 차이점

### NovelAI Parser 비교

| 항목 | Frontend | Backend |
|------|----------|---------|
| v4_prompt 지원 | ✅ | ✅ |
| Comment 필드 파싱 | ✅ | ✅ |
| cfg_rescale | ❌ | ✅ |
| uncond_scale | ❌ | ✅ |
| v4 필드 (sm, sm_dyn 등) | ❌ | ✅ |
| Title/Description | ❌ | ✅ |
| Software 필드 | ❌ | ✅ |

**차이점**:
- Frontend는 **기본 NovelAI 필드만** 지원
- Backend는 **v4 전용 필드 및 확장 메타데이터** 지원

### WebUI Parser 비교

| 항목 | Frontend | Backend |
|------|----------|---------|
| 기본 파싱 | ✅ (동일) | ✅ (동일) |
| LoRA 추출 | ❌ | ✅ |
| lora_hashes | ❌ | ✅ |
| version | ❌ | ✅ |
| 에러 처리 | 동일 | 동일 |

**차이점**:
- Backend는 **WebUI 파싱 중 LoRA 정보 자동 추출**

### ComfyUI Parser 비교

| 항목 | Frontend | Backend |
|------|----------|---------|
| ComfyUI 지원 | ❌ | ✅ |
| 워크플로 감지 | ❌ | ✅ |
| 노드 파싱 | ❌ | ✅ |

**차이점**:
- Frontend는 **ComfyUI를 완전히 미지원** ⚠️

---

## 5. 아키텍처 및 실행 흐름 차이

### Secondary Extraction (Stealth PNG) 처리

**Frontend**:
```
Primary 실패 → 즉시 Stealth PNG 시도 → 성공/실패
(추가 조건 없음)
```

**Backend**:
```
Primary 실패 → 설정 확인 (enableSecondaryExtraction)
             ├─ 비활성화: 스킵
             ├─ AI 도구별 스킵 설정 확인
             ├─ 파일 크기 확인 (stealthMaxFileSizeMB)
             ├─ 해상도 확인 (stealthMaxResolutionMP)
             └─ 조건 통과: Stealth PNG 실행
```

**차이점**:
- ✅ Backend는 **설정 기반 조건부 처리**로 성능 최적화
- ✅ Backend는 **파일 크기/해상도 필터링**으로 불필요한 처리 방지
- ❌ Frontend는 모든 실패한 PNG에 대해 Stealth PNG 시도

### 추가 처리

**Backend만**:
1. **Workflow JSON 필터링** (ComfyUI 워크플로를 프롬프트로 저장 방지)
2. **LoRA 모델 자동 추출** (정규식으로 `<lora:name:weight>` 파싱)
3. **타이밍 로깅** (각 단계별 실행 시간 측정)

---

## 6. 프론트엔드와 백엔드 메타데이터 동기화 분석

### 동기화 상태 평가

| 항목 | 상태 | 심각도 |
|------|------|--------|
| NovelAI 기본 필드 | ✅ 동기화됨 | - |
| WebUI 기본 필드 | ✅ 동기화됨 | - |
| AI 도구 감지 | ✅ 동기화됨 (로직 동일) | - |
| Stealth PNG 처리 | ⚠️ 부분 차이 | 중간 |
| **ComfyUI 지원** | ❌ **미동기화** | **높음** |
| LoRA 추출 | ❌ **미동기화** | **높음** |
| NovelAI 확장 필드 | ❌ **미동기화** | **중간** |
| Workflow JSON 필터링 | ❌ **미동기화** | **중간** |

### 동기화 필요 이유

#### 1️⃣ **ComfyUI 지원 부족** (우선순위: 높음)
- Frontend는 ComfyUI 워크플로를 파싱하지 못함
- 백엔드에서는 ComfyUI 이미지 업로드 시 정보 추출 가능
- **프론트엔드 미리보기와 백엔드 저장 데이터 불일치 위험**

#### 2️⃣ **LoRA 모델 추출 부재** (우선순위: 높음)
- Backend는 프롬프트에서 LoRA 정보 자동 추출
- Frontend는 추출하지 않음
- **DB에 저장되는 데이터와 클라이언트 표시 정보 불일치**

#### 3️⃣ **NovelAI 확장 필드** (우선순위: 중간)
- Backend는 v4 필드 및 추가 메타데이터 지원
- Frontend는 기본 필드만 지원
- **고급 NovelAI 이미지의 부분 정보 손실**

#### 4️⃣ **Stealth PNG 조건부 처리** (우선순위: 중간)
- Frontend는 항상 시도 (성능 영향 가능)
- Backend는 조건 확인 후 선택적 실행
- **메모리 사용 패턴 불일치**

#### 5️⃣ **Workflow JSON 필터링** (우선순위: 중간)
- Backend만 ComfyUI 워크플로 JSON을 프롬프트로 저장하지 않음
- Frontend에서는 이를 프롬프트로 인식할 가능성
- **파일 크기 및 디스플레이 문제 발생 가능**

---

## 7. 필드명 표기법 차이

### camelCase vs snake_case
```
Frontend: aiTool, positivePrompt, negativePrompt
Backend:  ai_tool, positive_prompt, negative_prompt
```

**영향**: API 응답 및 DB 저장 시 변환 필요 (현재 구현되어 있음으로 보임)

---

## 8. 권장 동기화 사항

### 즉시 적용 필요 (높은 우선순위)

1. **Frontend에 ComfyUI 파서 추가**
   ```
   - ComfyUIParser 클래스 추가
   - Workflow JSON 감지 로직 추가
   - 노드 기반 프롬프트 추출
   ```

2. **Frontend에 LoRA 추출 로직 추가**
   ```
   - WebUI/ComfyUI 프롬프트에서 <lora:name:weight> 정규식 추출
   - lora_models 배열 구성
   ```

3. **Frontend에 Workflow JSON 필터링 추가**
   ```
   - WorkflowDetector.isWorkflowJSON() 검증
   - JSON 프롬프트 자동 무효화
   ```

### 중기 적용 필요 (중간 우선순위)

4. **Frontend에 NovelAI v4 필드 지원 추가**
   ```
   - v4_prompt, v4_negative_prompt 파싱
   - cfg_rescale, uncond_scale 등 추가 필드
   ```

5. **Frontend에 Stealth PNG 조건부 처리 추가**
   ```
   - 파일 크기 및 해상도 확인 로직
   - 성능 최적화를 위한 조건 추가
   ```

6. **타입 정의 통일**
   ```
   - Frontend ParsedMetadata와 Backend AIMetadata 통일
   - 필드명 일관성 (snake_case로 통일 권장)
   ```

### 장기 개선사항

7. **Shared 메타데이터 라이브러리 구성**
   ```
   - monorepo에서 공유 타입 정의
   - 파서 로직 공유 (TypeScript 사용 가능)
   - 단일 소스 유지보수
   ```

---

## 9. 현재 호환성 평가

### 작동 가능성
- ✅ NovelAI 이미지: 대부분 호환 (기본 필드)
- ✅ WebUI 이미지: 호환 (기본 필드)
- ⚠️ ComfyUI 이미지: **Frontend 미리보기 불가, Backend 저장 가능**
- ⚠️ LoRA 포함 이미지: **Frontend 미리보기 부분, Backend 완전 추출**

### 데이터 손실 위험
- 🔴 **ComfyUI 이미지**: 프론트엔드에서 메타데이터 미추출
- 🔴 **LoRA 정보**: 프론트엔드에서 표시 불가
- 🟡 **NovelAI v4 필드**: 프론트엔드에서 부분 손실
- 🟡 **Workflow JSON**: 프론트엔드에서 프롬프트로 인식 가능

---

## 10. 권장 최소 동기화 안(MVA)

### Phase 1: 데이터 무결성 확보 (필수)

**파일**: `frontend/src/utils/metadataReader.ts`

```typescript
// 1. ComfyUI 지원 추가
class ComfyUIParser {
  static isComfyUIFormat(data: any): boolean { ... }
  static parse(data: any): AIMetadata { ... }
}

// 2. parseRawData에 ComfyUI 처리 추가
if (ComfyUIParser.isComfyUIFormat(rawData)) {
  return ComfyUIParser.parse(rawData);
}

// 3. WebUI 파서에 LoRA 추출 추가
static parseParametersText(text: string): AIMetadata {
  // ... 기존 코드 ...
  if (aiInfo.positive_prompt) {
    const loras = this.extractLoRAInfo(aiInfo.positive_prompt);
    if (loras.length > 0) {
      aiInfo.lora_models = loras;
    }
  }
}

// 4. Workflow JSON 필터링 추가
function detectAITool(metadata: any): string {
  // Workflow JSON 감지 후 필터링
  if (metadata.prompt && WorkflowDetector.isWorkflowJSON(metadata.prompt)) {
    metadata.prompt = undefined;
  }
  // ... 기존 감지 로직 ...
}
```

### Phase 2: 성능 최적화 (권장)

Stealth PNG 조건부 처리는 현재 구현 상태를 고려하여 선택적으로 적용

---

## 결론

### 동기화 필요 여부
**✅ YES - 동기화 필수**

### 핵심 이유
1. **ComfyUI 지원 부재**: 데이터 손실 위험
2. **LoRA 정보 불일치**: 메타데이터 불완전성
3. **Workflow JSON 처리 부재**: 데이터 품질 저하
4. **사용자 경험 차이**: 프리뷰와 실제 저장 데이터 불일치

### 권장 접근법
- **단기**: ComfyUI + LoRA + Workflow 필터링 추가 (필수)
- **중기**: NovelAI v4 필드 + Stealth PNG 최적화 (권장)
- **장기**: 메타데이터 라이브러리 공유화 (선택)

### 예상 작업 시간
- Phase 1 (필수): **2-3시간**
- Phase 2 (권장): **2-3시간**
- Phase 3 (장기): **4-6시간**

---

## 첨부: 상세 필드 매핑표

### 기본 필드 (완전 동기화)
```
prompt              ↔ prompt
positive_prompt     ↔ positive_prompt
negative_prompt     ↔ negative_prompt
ai_tool             ↔ ai_tool
steps               ↔ steps
cfg_scale           ↔ cfg_scale
seed                ↔ seed
sampler             ↔ sampler
scheduler           ↔ scheduler
width               ↔ width
height              ↔ height
model               ↔ model
```

### 누락 필드 (Backend 추가)
```
Backend 전용:
- lora_models[]     (LoRA 이름 배열)
- lora_hashes       (LoRA 해시)
- model_hash        (모델 해시)
- version           (생성기 버전)
- title             (이미지 제목)
- description       (이미지 설명)
- software          (생성 소프트웨어)
- extractedAt       (추출 시간)
```

### 노벨AI 확장 필드 (Backend만 지원)
```
cfg_rescale, uncond_scale, use_order, sm, sm_dyn,
dynamic_thresholding, controlnet_strength, legacy,
add_original_image, skip_cfg_above_sigma
```
