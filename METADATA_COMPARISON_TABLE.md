# 메타데이터 추출 - 상세 비교표

## 1. 포맷별 지원 매트릭스

```
┌─────────────────┬──────────────┬──────────────┬──────────────┐
│ 포맷            │ Frontend     │ Backend      │ 동기화       │
├─────────────────┼──────────────┼──────────────┼──────────────┤
│ NovelAI (기본)  │ ✅ 완전      │ ✅ 완전      │ ✅ OK        │
│ NovelAI (v4)    │ ⚠️ 부분      │ ✅ 완전      │ ❌ 필요      │
│ WebUI           │ ✅ 완전      │ ✅ 완전      │ ✅ OK        │
│ ComfyUI         │ ❌ 미지원    │ ✅ 완전      │ ❌ 필수      │
│ PNG tEXt/zTXt   │ ✅ 완전      │ ✅ 완전      │ ✅ OK        │
│ Stealth PNG     │ ✅ 완전      │ ✅ 조건부    │ ⚠️ 경미      │
│ JPEG EXIF       │ ✅ 기본만    │ ✅ 완전      │ ⚠️ 경미      │
└─────────────────┴──────────────┴──────────────┴──────────────┘
```

---

## 2. 필드별 지원 매트릭스

### A. 기본 필드 (모든 형식)

```
┌──────────────────┬──────────────┬──────────────┬──────────────┐
│ 필드             │ Frontend     │ Backend      │ 비고         │
├──────────────────┼──────────────┼──────────────┼──────────────┤
│ ai_tool          │ ✅ 감지함수  │ ✅ 감지함수  │ 동일         │
│ prompt           │ ✅           │ ✅           │ 동일         │
│ positive_prompt  │ ✅           │ ✅           │ 동일         │
│ negative_prompt  │ ✅           │ ✅           │ 동일         │
│ steps            │ ✅           │ ✅           │ 동일         │
│ cfg_scale        │ ✅           │ ✅           │ 동일         │
│ sampler          │ ✅           │ ✅           │ 동일         │
│ seed             │ ✅           │ ✅           │ 숫자 타입    │
│ scheduler        │ ✅           │ ✅           │ 동일         │
│ width            │ ✅           │ ✅           │ 동일         │
│ height           │ ✅           │ ✅           │ 동일         │
│ model            │ ✅           │ ✅           │ 동일         │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

### B. 웹UI 확장 필드

```
┌──────────────────┬──────────────┬──────────────┬──────────────┐
│ 필드             │ Frontend     │ Backend      │ 우선순위     │
├──────────────────┼──────────────┼──────────────┼──────────────┤
│ lora_models[]    │ ❌ 없음      │ ✅ 추출함수  │ 🔴 필수      │
│ lora_hashes      │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ model_hash       │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ denoising_strength│ ❌ 없음     │ ✅           │ 🟢 선택      │
│ clip_skip        │ ❌ 없음      │ ✅           │ 🟢 선택      │
│ version          │ ❌ 없음      │ ✅           │ 🟢 선택      │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

### C. NovelAI 확장 필드

```
┌──────────────────┬──────────────┬──────────────┬──────────────┐
│ 필드             │ Frontend     │ Backend      │ 우선순위     │
├──────────────────┼──────────────┼──────────────┼──────────────┤
│ cfg_rescale      │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ uncond_scale     │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ use_order        │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ sm (SMEA)        │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ sm_dyn           │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ dynamic_thresholding│ ❌ 없음    │ ✅           │ 🟡 권장      │
│ controlnet_strength│ ❌ 없음     │ ✅           │ 🟡 권장      │
│ legacy           │ ❌ 없음      │ ✅           │ 🟢 선택      │
│ add_original_image│ ❌ 없음      │ ✅           │ 🟢 선택      │
│ skip_cfg_above_sigma│ ❌ 없음    │ ✅           │ 🟢 선택      │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

### D. 메타데이터 필드

```
┌──────────────────┬──────────────┬──────────────┬──────────────┐
│ 필드             │ Frontend     │ Backend      │ 우선순위     │
├──────────────────┼──────────────┼──────────────┼──────────────┤
│ title            │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ description      │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ software         │ ❌ 없음      │ ✅           │ 🟡 권장      │
│ extractedAt      │ ❌ 없음      │ ✅           │ 🟢 선택      │
│ rawMetadata      │ ✅ 전체      │ ❌ 없음      │ 🟢 선택      │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

---

## 3. 추출 파이프라인 비교

### Frontend 파이프라인

```
┌─────────────────────────────────────────────────────────────┐
│ File (File API)                                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ EXIF 추출       │ (exifr library)
        │ (모든 포맷)     │
        └────────┬────────┘
                 │
     ┌───────────┴───────────┐
     │                       │
     ▼                       │
   PNG?                      │
    │                        │
    ├─ Yes                   │
    │   ▼                    │
    │  PNG tEXt 추출         │
    │   │                    │
    │   ▼                    │
    │  포맷 감지             │
    │  ├─ NovelAI?          │
    │  ├─ WebUI?            │
    │  └─ Unknown           │
    │   │                    │
    │   ▼                    │
    │  파싱                  │
    │   │                    │
    │   ▼                    │
    │  Prompt 있음?          │
    │   │                    │
    │   ├─ No                │
    │   │  ▼                 │
    │   │  Stealth PNG 추출  │ (항상)
    │   │  파싱              │
    │   │   │                │
    │   └──┘                 │
    │   │                    │
    └─ No (기타 포맷)         │
       └──────────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ AI 도구 감지    │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ ParsedMetadata  │
        │ 반환            │
        └─────────────────┘
```

### Backend 파이프라인

```
┌─────────────────────────────────────────────────────────────┐
│ File Path                                                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ 파일 로드       │ (fs.promises)
        └────────┬────────┘
                 │
     ┌───────────┴───────────┐
     │                       │
     ▼                       │
   PNG?                      │
    │                        │
    ├─ Yes                   │
    │   ▼                    │
    │  PngExtractor          │
    │   │                    │
    │   ▼                    │
    │  포맷 감지 및 파싱     │
    │  ├─ NovelAI?          │
    │  ├─ WebUI?            │
    │  └─ ComfyUI?          │
    │   │                    │
    ├─ JPG?                  │
    │   ▼                    │
    │  JpegExtractor         │
    │   │                    │
    └─ Unknown               │
       │                     │
       ▼                     │
   Prompt 있음?               │
    │                        │
    ├─ Yes                   │
    │  └─ 워크플로 검증      │
    │     필터링             │
    │                        │
    ├─ No (PNG만)            │
    │  ▼                     │
    │  설정 확인             │
    │  ├─ Secondary 활성화?  │
    │  ├─ AI 도구 스킵?      │
    │  ├─ 파일 크기 확인     │
    │  ├─ 해상도 확인        │
    │  └─ 조건 통과?         │
    │      ▼                 │
    │    Stealth PNG 추출    │ (조건부)
    │    파싱                │
    │      │                 │
    └──────┘                 │
       │                     │
       ▼                     │
   AI 도구 감지               │
    │                        │
    ▼                        │
   LoRA 모델 추출             │
    │                        │
    ▼                        │
   ImageMetadata 반환        │
└─────────────────────────────┘
```

---

## 4. 성능 비교

```
┌─────────────────────────────────────────────────────────────┐
│ 측정항목      │ Frontend    │ Backend     │ 비고             │
├─────────────────────────────────────────────────────────────┤
│ 실행 위치     │ 브라우저    │ 서버        │ 부하 위치 다름   │
│ I/O          │ 메모리 기반 │ 파일 기반   │ 백엔드 오버헤드  │
│ Stealth PNG │ 항상 시도   │ 조건부      │ 백엔드 최적화    │
│ 대용량 파일 │ 메모리 병목 │ Sharp 최적화│ 백엔드 효율적   │
│ 고해상도    │ 성능 저하   │ 해상도 체크 │ 백엔드 보호      │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 데이터 흐름 비교

### Frontend → Backend 동작

```
User Upload (Frontend)
    ▼
metadataReader.extractMetadata()
    ▼
ParsedMetadata {
  aiTool: "ComfyUI"?,      ❌ ComfyUI 미지원!
  positivePrompt: "..."
  lora_models: undefined,  ❌ 미추출!
  ...
}
    ▼
API 요청 (FormData)
    ▼
Backend 수신
    ▼
ImageProcessor.processImage()
    ▼
MetadataExtractor.extractMetadata()
    ▼
ImageMetadata {
  ai_tool: "ComfyUI" ✅     (Backend가 다시 추출)
  lora_models: [...] ✅     (Backend가 추출)
  ...
}
    ▼
DB 저장

⚠️ 문제: Frontend와 Backend 추출 결과 불일치!
         Frontend: ComfyUI 미지원, LoRA 없음
         Backend: ComfyUI 지원, LoRA 있음
```

### 동기화 후 동작

```
User Upload (Frontend)
    ▼
metadataReader.extractMetadata()
    ▼
ParsedMetadata {
  aiTool: "ComfyUI" ✅      (추가된 파서)
  positivePrompt: "..."
  lora_models: [...] ✅     (추가된 추출)
  ...
}
    ▼
API 요청 (FormData)
    ▼
Backend 수신
    ▼
ImageProcessor.processImage()
    ▼
MetadataExtractor.extractMetadata()
    ▼
ImageMetadata {
  ai_tool: "ComfyUI" ✅
  lora_models: [...] ✅
  ...
}
    ▼
DB 저장

✅ 완벽히 동기화됨!
```

---

## 6. 오류 시나리오

### ComfyUI 이미지 업로드

```
Frontend:
  ├─ PNG 형식 감지        ✅
  ├─ tEXt 청크 추출       ✅
  ├─ ComfyUI 감지         ❌ FAILED (미지원)
  ├─ NovelAI 시도         ❌ No
  ├─ WebUI 시도           ❌ No
  ├─ Stealth PNG 시도     ❌ No
  ├─ AI 도구 감지         ❌ "Unknown"
  └─ Result: ai_tool = "Unknown"

Backend:
  ├─ PNG 형식 감지        ✅
  ├─ PngExtractor         ✅
  ├─ ComfyUI 감지         ✅ SUCCESS
  ├─ ComfyUIParser        ✅
  └─ Result: ai_tool = "ComfyUI"

❌ 불일치 발생!
```

### LoRA 포함 WebUI 이미지

```
Frontend:
  ├─ WebUI 형식 감지      ✅
  ├─ 프롬프트 파싱       ✅ "<lora:model:0.8>, ......"
  ├─ LoRA 추출           ❌ 없음
  └─ Result: lora_models = undefined

Backend:
  ├─ WebUI 형식 감지      ✅
  ├─ 프롬프트 파싱       ✅ "<lora:model:0.8>, ......"
  ├─ LoRA 추출           ✅ regex로 추출
  └─ Result: lora_models = ["model"]

❌ 불일치 발생! (정보 손실)
```

---

## 7. 동기화 우선순위 요약

```
Priority    필드/기능                동작        작업량   난이도
────────────────────────────────────────────────────────────────
🔴 높음    ComfyUI 지원          필수        30분    중간
🔴 높음    LoRA 추출             필수        30분    낮음
🔴 높음    Workflow 필터         필수        30분    낮음

🟡 중간    NovelAI v4 필드       권장        60분    낮음
🟡 중간    Stealth 최적화        권장        30분    중간
🟡 중간    메타데이터 필드       권장        30분    낮음

🟢 낮음    JPEG 최적화           선택        60분    중간
🟢 낮음    추출 시간 로깅        선택        15분    낮음
────────────────────────────────────────────────────────────────
           합계 (필수)                       90분    중간
           합계 (권장)                      180분    중간
```

---

## 8. 테스트 시나리오

### Test Case 1: ComfyUI 이미지

```
입력: ComfyUI 워크플로 JSON이 포함된 PNG

Frontend (현재):
  ai_tool: "Unknown" ❌
  prompt: undefined
  metadata: incomplete

Frontend (동기화 후):
  ai_tool: "ComfyUI" ✅
  prompt: "extracted from workflow" ✅
  metadata: complete ✅

Backend:
  ai_tool: "ComfyUI" ✅
  prompt: "extracted from workflow" ✅
  metadata: complete ✅

결과: ✅ PASS
```

### Test Case 2: LoRA 포함 WebUI

```
입력: "<lora:model:0.8> a cat" 프롬프트

Frontend (현재):
  prompt: "<lora:model:0.8> a cat"
  lora_models: undefined ❌

Frontend (동기화 후):
  prompt: "<lora:model:0.8> a cat"
  lora_models: ["model"] ✅

Backend:
  prompt: "<lora:model:0.8> a cat"
  lora_models: ["model"] ✅

결과: ✅ PASS
```

### Test Case 3: 기존 NovelAI 이미지

```
입력: 기본 NovelAI 메타데이터

Frontend (현재):
  ai_tool: "NovelAI" ✅
  positive_prompt: "..." ✅
  negative_prompt: "..." ✅

Frontend (동기화 후):
  ai_tool: "NovelAI" ✅
  positive_prompt: "..." ✅
  negative_prompt: "..." ✅

Backend:
  ai_tool: "NovelAI" ✅
  positive_prompt: "..." ✅
  negative_prompt: "..." ✅

결과: ✅ PASS (호환성 유지)
```

---

## 요약

```
┌─────────────────────────────────────────┐
│ 현재 상태                               │
├─────────────────────────────────────────┤
│ ✅ 완벽히 동기화     : 기본 NovelAI/WebUI │
│ ⚠️  부분 차이         : Stealth PNG 조건  │
│ ❌ 미동기화 (필수)    : ComfyUI, LoRA     │
│ ❌ 미동기화 (권장)    : v4 필드, 메타데이터 │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 동기화 후 상태                          │
├─────────────────────────────────────────┤
│ ✅ 완벽히 동기화     : 모든 주요 포맷     │
│ ✅ 동기화됨          : 전체 필드          │
│ 데이터 손실           : 0%               │
│ 호환성              : 100%              │
└─────────────────────────────────────────┘
```
