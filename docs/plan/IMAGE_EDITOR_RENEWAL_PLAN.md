# Image Editor Renewal Plan (v2.1.0a)

## 1. 현황 분석

### 1.1 현재 구조

```
frontend/src/components/ImageEditorModal/
├── ImageEditorModal.tsx          # 메인 컴포넌트
├── components/
│   ├── EditorCanvas.tsx          # Konva 캔버스
│   ├── TopBar.tsx                # 줌/회전 컨트롤
│   ├── LeftToolbar.tsx           # 도구 선택
│   ├── RightPanel.tsx            # 브러시 속성
│   └── BottomActions.tsx         # 저장/취소
├── hooks/
│   ├── useHistory.ts             # Undo/Redo
│   ├── useDrawing.ts             # 브러시/지우개
│   └── useZoomPan.ts             # 줌/팬/회전
└── utils/
    ├── canvasExport.ts           # 내보내기
    ├── imageTransform.ts         # 변환 계산
    └── types/EditorTypes.ts      # 타입 정의

backend/src/
├── routes/image-editor.routes.ts  # API 엔드포인트
├── services/imageEditorService.ts # 이미지 처리 (Sharp)
└── services/tempImageService.ts   # 임시 파일 관리
```

### 1.2 사용 라이브러리

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| konva | ^10.0.8 | Canvas 2D 렌더링 |
| react-konva | ^19.2.0 | Konva React 바인딩 |
| sharp | ^0.33.0 | 백엔드 이미지 처리 |

### 1.3 발견된 심각한 버그

1. **pixelRatio 버그**: `1/zoom`으로 설정하여 품질 저하 (50% 이상 크기 감소)
2. **회전/뒤집기 미적용**: KonvaImage에만 적용, 경계선/그리기 좌표 미반영
3. **Drawing 좌표 오류**: 줌/팬 변경 시 그리기 위치 어긋남
4. **저장 미동작**: 그리기만 저장되고 원본 이미지와 병합 안 됨
5. **임시 파일 미정리**: 자동 삭제 스케줄러 미구현
6. **비활성화된 기능**: Crop, Layers 버튼 있지만 구현 안 됨

---

## 2. 리뉴얼 목표

### 2.1 핵심 요구사항

> **기본 플로우**: 이미지 뷰어 모달 → 편집 화면 진입 → 이미지 편집 → **WebP 파일로 저장**

### 2.2 기능 목표

| 우선순위 | 기능 | 설명 |
|---------|------|------|
| **P0** | WebP 저장 | 편집 결과를 WebP로 저장 (원본 대체 또는 신규) |
| **P0** | 이미지 로딩 | CORS 안전 로딩, 에러 핸들링 |
| **P0** | 줌/팬 | 마우스 휠, 드래그로 네비게이션 |
| **P1** | 회전/뒤집기 | 90도 회전, 좌우/상하 뒤집기 |
| **P1** | 크롭 | 영역 선택 후 자르기 |
| **P1** | 브러시/지우개 | 자유 그리기, 지우기 |
| **P2** | Undo/Redo | 작업 히스토리 |
| **P2** | 필터 | 밝기, 대비, 채도 조절 |
| **P3** | 텍스트 | 텍스트 오버레이 |
| **P3** | 레이어 | 다중 레이어 지원 |

---

## 3. 라이브러리 평가

### 3.1 현재 사용 중: Konva + react-konva

**장점:**
- Canvas 2D API 추상화
- React 통합 우수
- 풍부한 도형/이미지 지원

**단점:**
- 이미지 필터 기능 제한적
- 고급 편집 기능 직접 구현 필요
- 복잡한 상태 관리

### 3.2 대안 검토

#### Option A: Konva 유지 + 구조 개선 (권장)
- 기존 코드 활용 가능
- 버그 수정에 집중
- 개발 시간 절약

#### Option B: Fabric.js 전환
- 더 풍부한 편집 기능
- 객체 직렬화/역직렬화 내장
- 학습 곡선 있음, 마이그레이션 비용

#### Option C: Canvas API 직접 사용
- 최대 유연성
- 모든 기능 직접 구현 필요
- 개발 시간 증가

### 3.3 결정: **Option A (Konva 유지)**

**이유:**
1. 기존 구조 활용으로 빠른 개선 가능
2. 버그 수정으로 대부분의 문제 해결
3. Fabric.js 전환 대비 50% 이상 시간 절약

---

## 4. 아키텍처 설계

### 4.1 새로운 구조

```
frontend/src/components/ImageEditorModal/
├── ImageEditorModal.tsx          # 메인 (Facade)
├── context/
│   └── EditorContext.tsx         # 중앙 상태 관리 (useReducer)
├── components/
│   ├── EditorCanvas.tsx          # Konva Stage/Layer
│   ├── TopBar.tsx                # 줌/네비게이션
│   ├── LeftToolbar.tsx           # 도구 패널
│   ├── RightPanel.tsx            # 속성 패널 (동적)
│   ├── BottomActions.tsx         # 저장/취소
│   └── CropOverlay.tsx           # 크롭 영역 (신규)
├── hooks/
│   ├── useEditorState.ts         # Context 소비 (신규)
│   ├── useHistory.ts             # Undo/Redo (개선)
│   ├── useDrawing.ts             # 브러시 (버그 수정)
│   ├── useZoomPan.ts             # 줌/팬 (버그 수정)
│   ├── useCrop.ts                # 크롭 (신규)
│   └── useFilters.ts             # 필터 (신규)
├── utils/
│   ├── canvasExport.ts           # WebP 내보내기 (수정)
│   ├── imageTransform.ts         # 변환 계산 (수정)
│   └── types/EditorTypes.ts      # 타입 확장
└── index.ts

backend/src/
├── routes/image-editor.routes.ts  # WebP 저장 API 추가
└── services/imageEditorService.ts # WebP 변환 로직
```

### 4.2 상태 관리 설계

```typescript
// EditorContext.tsx
interface EditorState {
  // 이미지 상태
  image: HTMLImageElement | null;
  originalSize: { width: number; height: number };

  // 변환 상태
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;       // 0, 90, 180, 270
  flipX: boolean;
  flipY: boolean;

  // 도구 상태
  tool: 'select' | 'brush' | 'eraser' | 'crop' | 'text';
  brushSize: number;
  brushColor: string;
  eraserSize: number;

  // 크롭 상태
  cropRect: { x: number; y: number; width: number; height: number } | null;

  // 그리기 상태
  lines: DrawLine[];

  // 필터 상태
  filters: {
    brightness: number;  // -100 ~ 100
    contrast: number;    // -100 ~ 100
    saturation: number;  // -100 ~ 100
  };

  // 히스토리
  history: HistoryState[];
  historyIndex: number;

  // UI 상태
  saving: boolean;
  error: string | null;
}

type EditorAction =
  | { type: 'SET_IMAGE'; payload: HTMLImageElement }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_PAN'; payload: { x: number; y: number } }
  | { type: 'ROTATE'; payload: 90 | -90 }
  | { type: 'FLIP_X' }
  | { type: 'FLIP_Y' }
  | { type: 'SET_TOOL'; payload: Tool }
  | { type: 'SET_CROP_RECT'; payload: CropRect | null }
  | { type: 'ADD_LINE'; payload: DrawLine }
  | { type: 'SET_FILTER'; payload: Partial<Filters> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET' };
```

---

## 5. 구현 계획

### Phase 1: 버그 수정 및 핵심 기능 (P0)

#### 1.1 WebP 저장 기능 구현

**Frontend (canvasExport.ts)**
```typescript
export const exportToWebP = async (
  layer: Konva.Layer,
  imageTransform: ImageTransform,
  rotation: number,
  flipX: boolean,
  flipY: boolean
): Promise<Blob> => {
  // 1. 변환 적용한 캔버스 생성
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // 2. 회전/뒤집기 적용
  // (구현 상세)

  // 3. WebP로 변환 (품질 90%)
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.9);
  });
};
```

**Backend (image-editor.routes.ts)**
```typescript
// POST /api/image-editor/:id/save-webp
router.post('/:id/save-webp', asyncHandler(async (req, res) => {
  const { imageData, replaceOriginal } = req.body;

  // 1. Base64 → Buffer
  const buffer = Buffer.from(imageData.split(',')[1], 'base64');

  // 2. Sharp로 WebP 변환
  const webpBuffer = await sharp(buffer)
    .webp({ quality: 90 })
    .toBuffer();

  // 3. 저장 (신규 또는 대체)
  if (replaceOriginal) {
    // 원본 파일 대체
  } else {
    // 새 파일로 저장
  }

  return res.json({ success: true, newImageId });
}));
```

#### 1.2 pixelRatio 버그 수정

```typescript
// 수정 전
const dataURL = layer.toDataURL({
  pixelRatio: 1 / currentZoom,  // 버그!
});

// 수정 후
const dataURL = layer.toDataURL({
  x: cropRect.x,
  y: cropRect.y,
  width: cropRect.width,
  height: cropRect.height,
  pixelRatio: 1,  // 항상 원본 해상도
});
```

#### 1.3 회전/뒤집기 좌표 수정

```typescript
// imageTransform.ts
export const getImageTransform = (
  image: HTMLImageElement,
  canvasSize: Size,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
  viewportSize: Size
): ImageTransform => {
  const isRotated90or270 = rotation === 90 || rotation === 270;

  // 회전 시 가로/세로 교환
  const displayWidth = isRotated90or270 ? canvasSize.height : canvasSize.width;
  const displayHeight = isRotated90or270 ? canvasSize.width : canvasSize.height;

  return {
    x: viewportSize.width / 2,
    y: viewportSize.height / 2,
    width: displayWidth,
    height: displayHeight,
    rotation,
    scaleX: flipX ? -1 : 1,
    scaleY: flipY ? -1 : 1,
  };
};
```

### Phase 2: 추가 기능 (P1)

#### 2.1 크롭 기능

```typescript
// useCrop.ts
export const useCrop = () => {
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const startCrop = (pos: Position) => {
    setCropRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    setIsDragging(true);
  };

  const updateCrop = (pos: Position) => {
    if (!isDragging || !cropRect) return;
    setCropRect({
      ...cropRect,
      width: pos.x - cropRect.x,
      height: pos.y - cropRect.y,
    });
  };

  const applyCrop = () => {
    // 크롭 영역만 추출하여 새 이미지로
  };

  return { cropRect, startCrop, updateCrop, applyCrop };
};
```

#### 2.2 Drawing 버그 수정

```typescript
// useDrawing.ts - Ref 기반으로 변경
export const useDrawing = (options: DrawingOptions) => {
  const zoomRef = useRef(options.zoom);
  const panRef = useRef(options.pan);

  useEffect(() => {
    zoomRef.current = options.zoom;
    panRef.current = options.pan;
  }, [options.zoom, options.pan]);

  const getRelativePos = useCallback((pos: Position): Position => {
    return {
      x: (pos.x - panRef.current.x) / zoomRef.current,
      y: (pos.y - panRef.current.y) / zoomRef.current,
    };
  }, []);  // 의존성 없음 - 안정적

  // ...
};
```

### Phase 3: 고급 기능 (P2)

#### 3.1 필터 기능

```typescript
// useFilters.ts
export const useFilters = () => {
  const [filters, setFilters] = useState({
    brightness: 0,
    contrast: 0,
    saturation: 0,
  });

  // Konva 필터 적용
  const getKonvaFilters = () => {
    return [
      Konva.Filters.Brighten,
      Konva.Filters.Contrast,
      // HSL 필터는 커스텀 구현 필요
    ];
  };

  return { filters, setFilters, getKonvaFilters };
};
```

---

## 6. API 설계

### 6.1 새로운 엔드포인트

```
POST /api/image-editor/:id/save-webp
  Body: { imageData: base64, replaceOriginal: boolean }
  Response: { success: true, newImageId: number }

POST /api/image-editor/:id/apply-crop
  Body: { x, y, width, height }
  Response: { success: true, newImageId: number }

POST /api/image-editor/:id/apply-filters
  Body: { brightness, contrast, saturation }
  Response: { success: true, newImageId: number }
```

### 6.2 기존 엔드포인트 유지

```
GET  /api/image-editor/temp/:tempId/image  (임시 이미지 조회)
DELETE /api/image-editor/temp/:tempId      (임시 파일 삭제)
```

---

## 7. 일정 계획

### Phase 1: 핵심 기능 (1주차)

| 작업 | 예상 시간 |
|------|----------|
| EditorContext 설계 및 구현 | 4h |
| pixelRatio 버그 수정 | 1h |
| 회전/뒤집기 좌표 수정 | 3h |
| WebP 저장 API 구현 | 3h |
| 프론트엔드 저장 로직 수정 | 2h |
| 테스트 | 2h |

### Phase 2: 추가 기능 (2주차)

| 작업 | 예상 시간 |
|------|----------|
| 크롭 기능 구현 | 5h |
| Drawing 버그 수정 | 2h |
| 크롭 API 구현 | 2h |
| UI 개선 | 3h |
| 테스트 | 2h |

### Phase 3: 고급 기능 (3주차, 선택)

| 작업 | 예상 시간 |
|------|----------|
| 필터 기능 | 4h |
| Undo/Redo 개선 | 3h |
| 성능 최적화 | 3h |
| 문서화 | 2h |

---

## 8. 마이그레이션 전략

### 8.1 단계적 적용

1. **Phase 1 완료 후**: 기존 편집기 대체
2. **Phase 2 완료 후**: 크롭 기능 활성화
3. **Phase 3 완료 후**: 필터 기능 활성화

### 8.2 롤백 계획

- 기존 코드를 `ImageEditorModal.legacy.tsx`로 백업
- Feature flag로 신규/기존 전환 가능하게 구현

---

## 9. 테스트 계획

### 9.1 단위 테스트

- `useDrawing`: 좌표 변환 정확성
- `useZoomPan`: 줌/팬 경계값
- `canvasExport`: WebP 품질 검증

### 9.2 통합 테스트

- 이미지 로드 → 편집 → 저장 플로우
- 회전 → 크롭 → 저장 순서
- Undo/Redo 히스토리 정합성

### 9.3 E2E 테스트

- 다양한 이미지 포맷 (PNG, JPG, WebP)
- 대용량 이미지 (8K+)
- 모바일 터치 이벤트

---

## 10. 체크리스트

### Phase 1 완료 조건

- [ ] WebP 저장 동작 확인
- [ ] 회전/뒤집기 후 저장 시 정확한 결과
- [ ] 줌 상태와 무관하게 원본 해상도 유지
- [ ] 에러 핸들링 완료

### Phase 2 완료 조건

- [ ] 크롭 영역 선택 및 적용
- [ ] 그리기 좌표 정확성
- [ ] 줌/팬 중 그리기 안정성

### Phase 3 완료 조건

- [ ] 필터 적용 및 저장
- [ ] Undo/Redo 모든 작업 지원
- [ ] 성능 최적화 (60fps 유지)

---

## 부록: 참고 코드 위치

| 파일 | 주요 수정 사항 |
|------|---------------|
| [canvasExport.ts](../../frontend/src/components/ImageEditorModal/utils/canvasExport.ts) | pixelRatio 수정, WebP 변환 |
| [imageTransform.ts](../../frontend/src/components/ImageEditorModal/utils/imageTransform.ts) | 회전/뒤집기 좌표 계산 |
| [useDrawing.ts](../../frontend/src/components/ImageEditorModal/hooks/useDrawing.ts) | Ref 기반 좌표 변환 |
| [image-editor.routes.ts](../../backend/src/routes/image-editor.routes.ts) | WebP 저장 API |
| [imageEditorService.ts](../../backend/src/services/imageEditorService.ts) | Sharp WebP 처리 |
