# 메타데이터 동기화 - 구현 가이드

이 문서는 Frontend를 Backend와 동기화하기 위한 단계별 구현 가이드입니다.

---

## 현재 상태

### Frontend (부분 지원)
```
NovelAI ✅   WebUI ✅   ComfyUI ❌   LoRA ❌   Workflow Filter ❌
```

### Backend (완전 지원)
```
NovelAI ✅   WebUI ✅   ComfyUI ✅   LoRA ✅   Workflow Filter ✅
```

---

## 3단계 구현 계획

### PHASE 1: 필수 동기화 (ComfyUI, LoRA, Workflow 필터)

#### 파일 수정: `frontend/src/utils/metadataReader.ts`

##### Step 1: ComfyUI 파서 추가

```typescript
/**
 * ComfyUI Workflow Parser
 */
class ComfyUIParser {
  static isComfyUIFormat(data: any): boolean {
    // String JSON 확인
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return this.hasComfyUINodes(parsed);
      } catch {
        return false;
      }
    }

    // Object 확인
    if (typeof data === 'object' && data !== null) {
      if (data.textChunks?.prompt) {
        try {
          const parsed = JSON.parse(data.textChunks.prompt);
          return this.hasComfyUINodes(parsed);
        } catch {
          return false;
        }
      }
      return this.hasComfyUINodes(data);
    }

    return false;
  }

  private static hasComfyUINodes(obj: any): boolean {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    // ComfyUI 워크플로는 노드 ID(숫자)를 키로 가짐
    for (const key in obj) {
      const node = obj[key];
      if (node && typeof node === 'object' && node.class_type) {
        return true; // class_type이 있으면 ComfyUI 노드
      }
    }

    return false;
  }

  static parse(data: any): AIMetadata {
    try {
      let workflow: any;

      // Workflow 추출
      if (typeof data === 'string') {
        const sanitized = data.replace(/NaN/g, 'null');
        workflow = JSON.parse(sanitized);
      } else if (data.textChunks?.prompt) {
        const sanitized = data.textChunks.prompt.replace(/NaN/g, 'null');
        workflow = JSON.parse(sanitized);
      } else {
        workflow = data;
      }

      return this.extractMetadataFromWorkflow(workflow);
    } catch (error) {
      console.warn('ComfyUI parsing error:', error);
      return {};
    }
  }

  private static extractMetadataFromWorkflow(workflow: any): AIMetadata {
    const aiInfo: AIMetadata = {
      ai_tool: 'ComfyUI'
    };

    // 모든 노드 순회하여 프롬프트 찾기
    for (const nodeId in workflow) {
      const node = workflow[nodeId];

      if (!node || typeof node !== 'object') continue;

      // CLIPTextEncode 노드에서 프롬프트 추출
      if (node.class_type === 'CLIPTextEncode') {
        const input = node.inputs;
        if (input && input.text) {
          // 첫 번째 프롬프트를 positive로, 두 번째를 negative로 사용
          // (단순화된 로직, 실제로는 더 복잡할 수 있음)
          if (!aiInfo.positive_prompt) {
            aiInfo.positive_prompt = input.text;
            aiInfo.prompt = input.text;
          } else if (!aiInfo.negative_prompt) {
            aiInfo.negative_prompt = input.text;
          }
        }
      }

      // CheckpointLoader에서 모델명 추출
      if (node.class_type === 'CheckpointLoaderSimple' ||
          node.class_type === 'CheckpointLoader') {
        if (node.inputs?.ckpt_name) {
          aiInfo.model = node.inputs.ckpt_name;
        }
      }

      // KSampler에서 생성 파라미터 추출
      if (node.class_type === 'KSampler' ||
          node.class_type === 'KSamplerAdvanced') {
        const input = node.inputs;
        if (input) {
          if (input.steps) aiInfo.steps = input.steps;
          if (input.cfg) aiInfo.cfg_scale = input.cfg;
          if (input.seed !== undefined) aiInfo.seed = Number(input.seed);
          if (input.sampler_name) aiInfo.sampler = input.sampler_name;
          if (input.scheduler) aiInfo.scheduler = input.scheduler;
        }
      }

      // 이미지 크기 정보 추출
      if (node.class_type === 'LoadImage') {
        if (node.inputs?.image) {
          // 이미지 파일명에서 크기 추출은 어려우므로 스킵
        }
      }
    }

    return aiInfo;
  }
}
```

##### Step 2: parseRawData 함수 수정

기존 코드에서 NovelAI/WebUI 체크 후에 ComfyUI 추가:

```typescript
function parseRawData(rawData: any): AIMetadata {
  console.log('🔍 [parseRawData] Input type:', typeof rawData);

  // Try NovelAI parser
  if (NovelAIParser.isNovelAIFormat(rawData)) {
    console.log('📦 [parseRawData] Parsing as NovelAI format');
    return NovelAIParser.parse(rawData);
  }

  // Try WebUI parser
  if (WebUIParser.isWebUIFormat(rawData)) {
    console.log('📦 [parseRawData] Parsing as WebUI format');
    return WebUIParser.parse(rawData);
  }

  // Try ComfyUI parser (NEW)
  if (ComfyUIParser.isComfyUIFormat(rawData)) {
    console.log('📦 [parseRawData] Parsing as ComfyUI format');
    return ComfyUIParser.parse(rawData);
  }

  // Try stealth data with parsers
  if (rawData.stealthData) {
    console.log('🔍 [parseRawData] Attempting to parse stealth data...');

    if (NovelAIParser.isNovelAIFormat(rawData.stealthData)) {
      return NovelAIParser.parse(rawData.stealthData);
    }

    if (WebUIParser.isWebUIFormat(rawData.stealthData)) {
      return WebUIParser.parse(rawData.stealthData);
    }

    if (ComfyUIParser.isComfyUIFormat(rawData.stealthData)) {
      return ComfyUIParser.parse(rawData.stealthData);
    }
  }

  console.log('⚠️ [parseRawData] No recognized format found');
  return {};
}
```

##### Step 3: WebUIParser에 LoRA 추출 추가

```typescript
class WebUIParser {
  // ... 기존 코드 ...

  private static parseParametersText(text: string): AIMetadata {
    const aiInfo: AIMetadata = {};

    const lines = text.split(/\r?\n/);

    // Find "Negative prompt:" line
    let negPromptIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('Negative prompt:')) {
        negPromptIndex = i;
        break;
      }
    }

    // Extract prompts
    if (negPromptIndex > 0) {
      const positiveLines = lines.slice(0, negPromptIndex);
      aiInfo.positive_prompt = positiveLines.join('\n').trim().replace(/\u0000/g, '');
      aiInfo.prompt = aiInfo.positive_prompt;

      const negLine = lines[negPromptIndex];
      aiInfo.negative_prompt = negLine
        .substring('Negative prompt:'.length)
        .trim()
        .replace(/\u0000/g, '');

      const optionLines = lines.slice(negPromptIndex + 1);
      this.parseOptionLines(optionLines, aiInfo);
    } else {
      aiInfo.positive_prompt = text.trim().replace(/\u0000/g, '');
      aiInfo.prompt = aiInfo.positive_prompt;
      aiInfo.negative_prompt = '';
    }

    // NEW: Extract LoRA models from positive prompt
    if (aiInfo.positive_prompt) {
      const loras = this.extractLoRAInfo(aiInfo.positive_prompt);
      if (loras.length > 0) {
        aiInfo.lora_models = loras;
      }
    }

    return aiInfo;
  }

  // NEW: Extract LoRA information from prompt
  private static extractLoRAInfo(prompt: string): string[] {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras: string[] = [];
    let match;

    while ((match = loraRegex.exec(prompt)) !== null) {
      loras.push(match[1]); // Store only name
    }

    return loras;
  }
}
```

##### Step 4: AI 도구 감지 함수에 Workflow 필터 추가

```typescript
function detectAITool(metadata: any): string {
  // NEW: Check for Workflow JSON and invalidate it
  if (metadata.prompt) {
    if (isWorkflowJSON(metadata.prompt)) {
      console.warn('⚠️ Workflow JSON detected in prompt - invalidating');
      metadata.prompt = undefined;
      metadata.positive_prompt = undefined;
    }
  }

  // Check negative prompt too
  if (metadata.negative_prompt) {
    if (isWorkflowJSON(metadata.negative_prompt)) {
      console.warn('⚠️ Workflow JSON detected in negative prompt - invalidating');
      metadata.negative_prompt = undefined;
    }
  }

  // Existing AI tool detection
  if (metadata.ai_tool) return metadata.ai_tool;

  const text = JSON.stringify(metadata).toLowerCase();

  if (text.includes('comfyui') || text.includes('comfy ui')) {
    return 'ComfyUI';
  } else if (text.includes('novelai') || text.includes('novel ai')) {
    return 'NovelAI';
  } else if (text.includes('automatic1111') || text.includes('webui')) {
    return 'Automatic1111';
  } else if (text.includes('invokeai') || text.includes('invoke ai')) {
    return 'InvokeAI';
  } else if (text.includes('stable diffusion') || text.includes('sd ')) {
    return 'Stable Diffusion';
  }

  return 'Unknown';
}

// NEW: Helper function to detect Workflow JSON
function isWorkflowJSON(text: string): boolean {
  if (typeof text !== 'string') return false;

  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return false;

    const obj = JSON.parse(trimmed);

    // Check if it looks like ComfyUI workflow
    // (numeric keys with nodes containing class_type)
    for (const key in obj) {
      const node = obj[key];
      if (node && typeof node === 'object' && node.class_type) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
```

---

### PHASE 2: 권장 - NovelAI 확장 필드 지원 (선택사항)

NovelAIParser의 parse 함수를 다음과 같이 확대:

```typescript
class NovelAIParser {
  static parse(data: any): AIMetadata {
    // ... 기존 코드 ...

    const aiInfo: AIMetadata = {};

    // ... 기본 필드 처리 ...

    // NEW: NovelAI v4 specific fields
    if (naiData.cfg_rescale !== undefined) {
      aiInfo.cfg_rescale = naiData.cfg_rescale;
    }
    if (naiData.uncond_scale !== undefined) {
      aiInfo.uncond_scale = naiData.uncond_scale;
    }
    if (naiData.v4_prompt?.use_order !== undefined) {
      aiInfo.use_order = naiData.v4_prompt.use_order;
    }

    // NEW: Additional NovelAI parameters
    if (naiData.sm !== undefined) aiInfo.sm = naiData.sm;
    if (naiData.sm_dyn !== undefined) aiInfo.sm_dyn = naiData.sm_dyn;
    if (naiData.dynamic_thresholding !== undefined) {
      aiInfo.dynamic_thresholding = naiData.dynamic_thresholding;
    }
    if (naiData.controlnet_strength !== undefined) {
      aiInfo.controlnet_strength = naiData.controlnet_strength;
    }
    if (naiData.legacy !== undefined) aiInfo.legacy = naiData.legacy;
    if (naiData.add_original_image !== undefined) {
      aiInfo.add_original_image = naiData.add_original_image;
    }
    if (naiData.skip_cfg_above_sigma !== undefined) {
      aiInfo.skip_cfg_above_sigma = naiData.skip_cfg_above_sigma;
    }

    // NEW: Metadata fields
    if (topLevelData.Title) aiInfo.title = topLevelData.Title;
    if (topLevelData.Description) aiInfo.description = topLevelData.Description;
    if (topLevelData.Software) aiInfo.software = topLevelData.Software;

    // Mark as NovelAI
    aiInfo.ai_tool = 'NovelAI';

    return aiInfo;
  }
}
```

---

### PHASE 3: 선택사항 - Stealth PNG 성능 최적화

현재는 모든 실패한 PNG에 대해 Stealth PNG 시도:

```typescript
// 기존 코드
if (!hasPrompt) {
  const stealthData = await extractStealthPngInfo(file);
  // ... 항상 처리
}
```

최적화 버전 (선택):

```typescript
if (!hasPrompt) {
  // 파일 크기 확인 (10MB 초과 시 스킵)
  if (file.size > 10 * 1024 * 1024) {
    console.log('⚡ File too large for Stealth PNG scan, skipping');
  } else {
    // 해상도 확인을 위해 이미지 로드 (선택사항)
    // 현재는 정보가 없으므로 항상 시도
    const stealthData = await extractStealthPngInfo(file);
    // ... 처리
  }
}
```

> **주의**: 이 단계는 기능 변경이 아닌 성능 최적화이므로 우선순위가 낮습니다.

---

## 테스트 체크리스트

각 수정 후 다음으로 테스트:

### ComfyUI 테스트
- [ ] ComfyUI 이미지 업로드
- [ ] 메타데이터 추출 확인
- [ ] 프롬프트 표시 확인
- [ ] ai_tool이 "ComfyUI"로 설정됨 확인

### LoRA 테스트
- [ ] LoRA 포함 WebUI 이미지 업로드
- [ ] lora_models 배열에 모델명 포함됨 확인
- [ ] Backend DB 저장 데이터와 일치 확인

### Workflow 필터 테스트
- [ ] ComfyUI JSON이 프롬프트로 인식되지 않음 확인
- [ ] 실제 프롬프트는 추출됨 확인

### 호환성 테스트
- [ ] 기존 NovelAI 이미지: 정상 작동
- [ ] 기존 WebUI 이미지: 정상 작동
- [ ] 기존 이미지: 메타데이터 변화 없음

---

## 타입 정의 확인

Frontend의 AIMetadata 인터페이스에 다음 필드 확인:

```typescript
export interface AIMetadata {
  ai_tool?: string;
  prompt?: string;
  positive_prompt?: string;
  negative_prompt?: string;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  model?: string;

  // Phase 1: 추가
  lora_models?: string[];     // NEW

  // Phase 2: 추가 (선택)
  cfg_rescale?: number;       // NEW
  uncond_scale?: number;      // NEW
  sm?: boolean;               // NEW
  sm_dyn?: boolean;           // NEW
  dynamic_thresholding?: boolean; // NEW
  controlnet_strength?: number;   // NEW
  legacy?: boolean;           // NEW
  add_original_image?: boolean;   // NEW
  skip_cfg_above_sigma?: number;  // NEW
  title?: string;             // NEW
  description?: string;       // NEW
  software?: string;          // NEW

  [key: string]: any;
}
```

---

## 예상 결과

### Phase 1 완료 후
```
✅ ComfyUI 이미지 메타데이터 추출 가능
✅ LoRA 정보 인식
✅ Workflow JSON 필터링
```

### Phase 2 완료 후
```
✅ 고급 NovelAI 파라미터 지원
✅ 추가 메타데이터 필드 지원
```

### 최종 상태
```
Frontend: ComfyUI ✅   WebUI ✅   NovelAI ✅   LoRA ✅   Advanced ✅
Backend:  ComfyUI ✅   WebUI ✅   NovelAI ✅   LoRA ✅   Advanced ✅
동기화: 100% ✅
```

---

## 문제 해결

### 문제: ComfyUI 워크플로가 여전히 프롬프트로 표시됨
**원인**: Workflow JSON 필터링이 제대로 작동하지 않음
**해결**: isWorkflowJSON 함수 로직 검토 필요

### 문제: LoRA 모델이 추출되지 않음
**원인**: 프롬프트 형식이 `<lora:name:weight>` 형식이 아님
**해결**: 실제 프롬프트 확인 및 정규식 수정

### 문제: ComfyUI 파라미터가 추출되지 않음
**원인**: 워크플로 구조가 예상과 다름
**해결**: 실제 워크플로 JSON 구조 분석 및 파서 수정

---

## 참고자료

- Backend ComfyUI Parser: `backend/src/services/metadata/parsers/comfyuiParser.ts`
- Backend WebUI Parser: `backend/src/services/metadata/parsers/webuiParser.ts`
- WorkflowDetector: `backend/src/services/metadata/parsers/workflowDetector.ts`

