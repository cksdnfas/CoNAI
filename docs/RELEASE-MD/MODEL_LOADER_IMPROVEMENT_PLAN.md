# 모델 로더 개선 계획

## 현재 문제점

### 1. 하위폴더가 각각 별도 리스트로 생성됨
- `checkpoints/SD1.5/`, `checkpoints/SDXL/` 등이 **각각 다른 드롭다운 리스트**로 생성
- 다른 폴더의 모델을 쓰려면 워크플로우 설정에서 매번 다른 리스트를 지정해야 함
- **필요한 것**: 하위폴더 전체를 **하나의 통합 리스트**로 생성하는 옵션

### 2. 드롭다운 UI 한계
- 통합 리스트로 만들면 모델 수가 많아져서 드롭다운으로는 탐색이 불편
- 폴더 구조를 시각적으로 확인하면서 선택할 수 없음

---

## 개선 사항

### A. 모델 스캔 시 통합 옵션 추가

#### 구현 위치
- `frontend/src/pages/Settings/` - 설정 페이지 모델 스캔 UI
- `backend/src/routes/customDropdownLists.ts` - `/scan-comfyui-models` 엔드포인트

#### 변경 내용

1. **스캔 옵션 추가**
   ```typescript
   interface ScanOptions {
     mergeSubfolders: boolean;  // 하위폴더를 하나로 통합할지 여부
     createBoth: boolean;       // 통합 + 개별 둘 다 생성
   }
   ```

2. **통합 처리 로직** (`customDropdownLists.ts`)

   **현재 동작:**
   ```
   checkpoints/
   ├── SD1.5/model1.safetensors  → "checkpoints_SD1.5" 리스트
   └── SDXL/model2.safetensors   → "checkpoints_SDXL" 리스트
   ```

   **통합 옵션 활성화 시:**
   ```
   checkpoints/
   ├── SD1.5/model1.safetensors  ─┐
   └── SDXL/model2.safetensors   ─┴→ "checkpoints" 통합 리스트
                                     items: ["SD1.5/model1.safetensors", "SDXL/model2.safetensors"]
   ```

   **둘 다 생성 옵션:**
   - 통합 리스트 1개 + 개별 리스트들 모두 생성

3. **UI 변경** (스캔 다이얼로그)
   - [x] 하위폴더를 하나의 리스트로 통합
   - [ ] 통합 리스트와 개별 리스트 모두 생성

---

### B. 계층형 모델 선택 UI 추가

#### 구현 위치
- `frontend/src/pages/Workflows/components/HierarchicalModelSelector.tsx` (신규)
- `frontend/src/pages/Workflows/components/WorkflowFormFields.tsx` - 기존 select 필드 개선

#### 새로운 컴포넌트: HierarchicalModelSelector

```
┌─────────────────────────────────────────┐
│ 🔍 검색: [________________]             │
├─────────────────────────────────────────┤
│ 📁 SD1.5                           [▼]  │
│    ├── realistic_v1.safetensors         │
│    └── anime_v2.safetensors             │
│ 📁 SDXL                            [▶]  │
│ 📁 Pony                            [▶]  │
├─────────────────────────────────────────┤
│ 선택됨: SD1.5/realistic_v1.safetensors  │
└─────────────────────────────────────────┘
```

**기능:**
- 트리 구조로 폴더/파일 탐색
- 폴더 열기/닫기 토글
- 검색 필터링 (파일명 기준)
- 드롭다운 ↔ 트리뷰 전환 버튼

#### 데이터 구조

items 배열에서 경로를 파싱하여 트리 구조 생성:
```typescript
// items: ["SD1.5/model1.safetensors", "SDXL/model2.safetensors"]
// → 프론트엔드에서 트리로 변환
function buildTree(items: string[]): TreeNode {
  // "SD1.5/model1.safetensors" → { SD1.5: { "model1.safetensors": file } }
}
```

---

## 구현 순서

### Phase 1: 백엔드 - 통합 스캔 옵션
1. `customDropdownLists.ts`에 `mergeSubfolders`, `createBoth` 파라미터 추가
2. 통합 로직 구현 (같은 루트 폴더의 하위폴더들을 하나로 병합)

### Phase 2: 프론트엔드 - 스캔 UI 개선
1. 모델 스캔 다이얼로그에 옵션 체크박스 추가
2. 옵션 상태 관리 및 API 호출 수정

### Phase 3: 프론트엔드 - 계층형 선택 UI
1. `HierarchicalModelSelector` 컴포넌트 생성
2. items 배열에서 트리 구조 생성하는 유틸 함수
3. 트리뷰 렌더링 및 상호작용 구현
4. 검색 필터링 기능 추가
5. `WorkflowFormFields`에 통합 (드롭다운/트리뷰 전환)

---

## 예상 파일 변경 목록

### 백엔드
- `backend/src/routes/customDropdownLists.ts` - 통합 스캔 옵션 추가

### 프론트엔드
- `frontend/src/pages/Settings/` - 스캔 옵션 UI (체크박스 추가)
- `frontend/src/pages/Workflows/components/HierarchicalModelSelector.tsx` (신규)
- `frontend/src/pages/Workflows/components/WorkflowFormFields.tsx` - 선택 UI 통합
- `frontend/src/services/api/customDropdownListApi.ts` - API 타입 수정
