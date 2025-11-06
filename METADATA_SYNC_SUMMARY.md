# 메타데이터 추출 동기화 - 빠른 요약

## 상황

**Frontend와 Backend의 메타데이터 추출 로직이 부분적으로 다릅니다.**

---

## 주요 차이점 (5가지)

### 1️⃣ ComfyUI 지원 부재 (중대)
| 항목 | Frontend | Backend |
|------|----------|---------|
| ComfyUI 워크플로 | ❌ 미지원 | ✅ 지원 |
| 결과 | 프리뷰 불가 | 저장 가능 |

**영향**: ComfyUI로 생성한 이미지의 메타데이터가 프론트엔드에서 표시되지 않음

```typescript
// Frontend에 추가 필요
class ComfyUIParser {
  static isComfyUIFormat(data: any): boolean {
    // workflow 형식 감지
  }
  static parse(data: any): AIMetadata {
    // 노드에서 프롬프트 추출
  }
}
```

### 2️⃣ LoRA 모델 추출 부재 (중대)
| 항목 | Frontend | Backend |
|------|----------|---------|
| LoRA 추출 | ❌ 없음 | ✅ 자동 추출 |
| lora_models[] | ❌ | ✅ |
| lora_hashes | ❌ | ✅ |

**영향**: DB에는 LoRA 정보 저장되지만, 프론트엔드는 모르는 상황

```typescript
// Frontend WebUI 파서에 추가 필요
static parseParametersText(text: string): AIMetadata {
  // ... 기존 코드 ...
  // LoRA 추출 추가
  const loras = this.extractLoRAInfo(aiInfo.positive_prompt);
  if (loras.length > 0) {
    aiInfo.lora_models = loras;
  }
}

private static extractLoRAInfo(prompt: string): string[] {
  const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
  const loras: string[] = [];
  let match;
  while ((match = loraRegex.exec(prompt)) !== null) {
    loras.push(match[1]);
  }
  return loras;
}
```

### 3️⃣ Workflow JSON 프롬프트 필터링 부재 (중간)
| 항목 | Frontend | Backend |
|------|----------|---------|
| Workflow JSON 필터링 | ❌ 없음 | ✅ 있음 |
| 결과 | JSON이 프롬프트로 저장됨 | 필터링되어 저장 안됨 |

**영향**: Frontend에서 ComfyUI 워크플로(JSON)를 프롬프트로 인식 가능

```typescript
// Frontend에 추가 필요
function detectAITool(metadata: any): string {
  // Workflow JSON 검증 추가
  if (metadata.prompt &&
      WorkflowDetector.isWorkflowJSON(metadata.prompt)) {
    metadata.prompt = undefined;
  }
  // ... 기존 감지 로직 ...
}
```

### 4️⃣ NovelAI 확장 필드 부재 (낮음)
| 필드 | Frontend | Backend |
|------|----------|---------|
| v4_prompt | ❌ | ✅ |
| cfg_rescale | ❌ | ✅ |
| uncond_scale | ❌ | ✅ |
| sm (SMEA) | ❌ | ✅ |

**영향**: 고급 NovelAI 파라미터 손실

```typescript
// Frontend NovelAI 파서 확대 필요
if (naiData.cfg_rescale !== undefined) aiInfo.cfg_rescale = naiData.cfg_rescale;
if (naiData.uncond_scale !== undefined) aiInfo.uncond_scale = naiData.uncond_scale;
if (naiData.sm !== undefined) aiInfo.sm = naiData.sm;
// ... 등등
```

### 5️⃣ Stealth PNG 조건부 처리 차이 (낮음)
| 항목 | Frontend | Backend |
|------|----------|---------|
| 처리 방식 | 항상 시도 | 조건 확인 후 |
| 조건 | 없음 | 파일크기, 해상도 확인 |

**영향**: 메모리 사용 및 성능 차이 (기능 영향은 없음)

---

## 동기화 상태 요약

```
✅ 완벽히 동기화
  - 기본 NovelAI 필드 (prompt, cfg_scale 등)
  - 기본 WebUI 필드 (steps, sampler 등)
  - AI 도구 감지 로직

⚠️ 부분 차이
  - Stealth PNG 처리 (기능은 동일, 조건부 로직 다름)

❌ 미동기화 (필수 해결)
  - ComfyUI 지원
  - LoRA 추출
  - Workflow JSON 필터링

❌ 미동기화 (권장 해결)
  - NovelAI v4 필드
```

---

## 동기화 필요 여부

### ✅ **YES - 동기화 필수**

#### 이유:
1. **데이터 무결성**: ComfyUI 메타데이터 손실
2. **정보 불일치**: 프롬프트의 LoRA 정보 미인식
3. **품질 저하**: JSON이 프롬프트로 저장될 수 있음

---

## 권장 수정 순서

### Priority 1: 필수 (1-2시간)
1. ComfyUI 파서 추가
2. LoRA 추출 로직 추가
3. Workflow JSON 필터링 추가

### Priority 2: 권장 (1-2시간)
4. NovelAI v4 필드 확대
5. 추가 메타데이터 필드 지원 (title, description 등)

### Priority 3: 선택 (시간)
6. Stealth PNG 조건부 처리 최적화

---

## 빠른 체크리스트

Frontend (`frontend/src/utils/metadataReader.ts`)에 다음이 있는지 확인:

- [ ] ComfyUIParser 클래스
- [ ] parseRawData에서 ComfyUI 처리
- [ ] LoRA 추출 로직 (`<lora:name:weight>` 정규식)
- [ ] Workflow JSON 필터링
- [ ] NovelAI v4 필드 지원
- [ ] metadata.lora_models 생성

Backend (이미 완벽히 구현됨) ✅

---

## 추정 작업량

| 항목 | 시간 | 난이도 |
|------|------|--------|
| ComfyUI 파서 추가 | 45분 | 중간 |
| LoRA 추출 | 30분 | 낮음 |
| Workflow 필터링 | 30분 | 낮음 |
| 테스트/검증 | 60분 | 중간 |
| **합계** | **2.5시간** | **중간** |

---

## 다음 단계

1. 이 분석 리뷰 확인
2. Priority 1 항목부터 수정 시작
3. 각 수정 후 테스트
4. ComfyUI/LoRA 이미지로 검증

---

## 참고

- 상세 분석: `METADATA_SYNC_ANALYSIS.md` 참조
- Backend 파서 구현: `backend/src/services/metadata/parsers/` 참조
- Frontend 파서: `frontend/src/utils/metadataReader.ts` 참조
