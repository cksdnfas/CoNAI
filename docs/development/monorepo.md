# Shared 패키지 사용 가이드

## 📦 새로운 기능을 Shared에 추가하는 방법

### 예시 1: 새로운 타입 추가

#### 1단계: Shared에 타입 정의 추가

```typescript
// shared/src/types/workflow.ts (새 파일)
export interface WorkflowRecord {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface WorkflowCreateData {
  name: string;
  description?: string;
}
```

#### 2단계: Shared index.ts에 export 추가

```typescript
// shared/src/types/index.ts
export * from './group';
export * from './promptCollection';
export * from './image';
export * from './rating';
export * from './workflow'; // 새로 추가
```

#### 3단계: Backend에서 사용

```typescript
// backend/src/models/Workflow.ts
import { WorkflowRecord, WorkflowCreateData } from '@comfyui-image-manager/shared';

export class WorkflowModel {
  static async create(data: WorkflowCreateData): Promise<WorkflowRecord> {
    // 타입이 자동으로 인식됨
  }
}
```

#### 4단계: Frontend에서 사용

```typescript
// frontend/src/services/api.ts
import type { WorkflowRecord, WorkflowCreateData } from '@comfyui-image-manager/shared';

export const workflowApi = {
  async create(data: WorkflowCreateData): Promise<WorkflowRecord> {
    // 타입이 자동으로 인식됨
  }
};
```

#### 5단계: 빌드

```bash
npm run build:integrated  # Shared → Backend → Frontend 순서로 자동 빌드
npm run build:bundle      # 모든 shared 코드가 bundle.js에 포함됨
npm run build:portable    # 포터블 패키지 생성
```

---

### 예시 2: 새로운 유틸리티 함수 추가

#### 1단계: Shared에 유틸 함수 추가

```typescript
// shared/src/utils/dateFormatter.ts (새 파일)
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = now.getTime() - target.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  // ... more logic
  return target.toLocaleDateString();
}
```

#### 2단계: Shared utils index에 export

```typescript
// shared/src/utils/index.ts
export * from './promptParser';
export * from './formatters';
export * from './validators';
export * from './responseHelpers';
export * from './dateFormatter'; // 새로 추가
```

#### 3단계: Backend/Frontend에서 사용

```typescript
// backend/src/services/someService.ts
import { formatRelativeTime } from '@comfyui-image-manager/shared';

const timeAgo = formatRelativeTime(image.created_date);
```

```typescript
// frontend/src/components/ImageCard.tsx
import { formatRelativeTime } from '@comfyui-image-manager/shared';

const timeAgo = formatRelativeTime(image.created_date);
```

---

### 예시 3: 새로운 상수 추가

#### 1단계: Shared에 상수 추가

```typescript
// shared/src/constants/workflow.ts (새 파일)
export const WORKFLOW_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;

export type WorkflowStatus = typeof WORKFLOW_STATUS[keyof typeof WORKFLOW_STATUS];

export const MAX_WORKFLOW_NAME_LENGTH = 100;
export const MAX_WORKFLOW_DESCRIPTION_LENGTH = 500;
```

#### 2단계: Shared constants index에 export

```typescript
// shared/src/constants/index.ts
export * from './network';
export * from './api';
export * from './image';
export * from './workflow'; // 새로 추가
```

#### 3단계: Backend/Frontend에서 사용

```typescript
// backend/src/models/Workflow.ts
import { WORKFLOW_STATUS, MAX_WORKFLOW_NAME_LENGTH } from '@comfyui-image-manager/shared';

static validate(name: string) {
  if (name.length > MAX_WORKFLOW_NAME_LENGTH) {
    throw new Error('Name too long');
  }
}
```

```typescript
// frontend/src/components/WorkflowForm.tsx
import { WORKFLOW_STATUS, MAX_WORKFLOW_NAME_LENGTH } from '@comfyui-image-manager/shared';

<TextField
  maxLength={MAX_WORKFLOW_NAME_LENGTH}
  helperText={`Max ${MAX_WORKFLOW_NAME_LENGTH} characters`}
/>
```

---

## 🔄 자동화된 빌드 프로세스

### 단일 명령으로 전체 빌드

```bash
npm run build:full
```

이 명령은 다음을 순차적으로 실행:
1. `build:integrated` - Shared → Backend → Frontend 빌드 및 통합
2. `build:bundle` - 모든 코드를 단일 bundle.js로 번들링
3. `build:portable` - 포터블 패키지 생성 (170MB)

### 개발 중 빌드

```bash
# Shared만 빌드 (타입 변경 시)
npm run build:shared

# Backend 빌드 (Shared 자동 포함)
cd backend && npm run build

# Frontend 빌드 (Shared 자동 포함)
cd frontend && npm run build
```

---

## ✅ 자동으로 처리되는 것들

### 1. TypeScript 타입 체크
- Shared의 타입 변경 시 Backend/Frontend에서 즉시 타입 에러 검출
- IDE에서 자동완성 및 타입 힌트 제공

### 2. 번들링
- esbuild가 모든 shared import를 자동으로 bundle.js에 포함
- Native modules(sharp, sqlite3)만 external로 분리

### 3. 포터블 빌드
- Shared 코드는 이미 bundle.js에 포함되어 있음
- 추가 복사 작업 불필요

---

## 🚨 주의사항

### 1. Shared에 추가하면 안 되는 것들

❌ **Node.js 전용 모듈** (backend only)
```typescript
// ❌ 잘못된 예시 - shared/src/utils/fileSystem.ts
import fs from 'fs'; // Frontend에서 사용 불가능!

export function readFileSync(path: string) {
  return fs.readFileSync(path);
}
```

✅ **올바른 방법** (backend에만 구현)
```typescript
// ✅ backend/src/utils/fileSystem.ts
import fs from 'fs';

export function readFileSync(path: string) {
  return fs.readFileSync(path);
}
```

❌ **브라우저 전용 API** (frontend only)
```typescript
// ❌ 잘못된 예시 - shared/src/utils/dom.ts
export function getElementByIdSafe(id: string) {
  return document.getElementById(id); // Backend에서 사용 불가능!
}
```

✅ **올바른 방법** (frontend에만 구현)
```typescript
// ✅ frontend/src/utils/dom.ts
export function getElementByIdSafe(id: string) {
  return document.getElementById(id);
}
```

### 2. Shared에 추가하면 좋은 것들

✅ **타입 정의** - Backend와 Frontend 모두 사용
```typescript
// ✅ shared/src/types/api.ts
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

✅ **순수 함수 유틸리티** - 환경 독립적
```typescript
// ✅ shared/src/utils/validation.ts
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

✅ **상수 및 Enum** - 공유 설정값
```typescript
// ✅ shared/src/constants/limits.ts
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
```

✅ **비즈니스 로직 유틸** - 플랫폼 독립적
```typescript
// ✅ shared/src/utils/promptParser.ts
export function parsePromptWeights(prompt: string): Array<{text: string, weight: number}> {
  // 순수 문자열 처리 로직
}
```

---

## 📊 빌드 출력 검증

빌드 후 shared 코드가 올바르게 포함되었는지 확인:

```bash
# Bundle 크기 확인 (shared 코드 포함 시 증가)
npm run build:bundle

# 출력 예시:
# 📊 Bundle size: 2620.27 KB  <- shared 타입/유틸 포함
# 📦 Top 10 largest dependencies:
#    (shared 모듈들이 번들에 포함됨)
```

---

## 🎯 모범 사례

### 1. Shared 구조 유지
```
shared/src/
├── types/          # 모든 TypeScript 인터페이스
├── utils/          # 순수 함수 유틸리티
├── constants/      # 공유 상수 및 설정
└── index.ts        # 단일 진입점
```

### 2. Export 체계
```typescript
// shared/src/index.ts - 단일 진입점
export * from './types';
export * from './utils';
export * from './constants';
```

### 3. Import 패턴
```typescript
// ✅ 권장: Named imports
import { GroupRecord, formatRelativeTime, API_ENDPOINTS } from '@comfyui-image-manager/shared';

// ❌ 지양: Namespace import (번들 크기 증가)
import * as Shared from '@comfyui-image-manager/shared';
```

---

## 🔧 트러블슈팅

### 문제: Frontend에서 shared 타입을 찾지 못함
```bash
error TS2307: Cannot find module '@comfyui-image-manager/shared'
```

**해결책:**
```bash
# 1. Shared 먼저 빌드
cd shared && npm run build

# 2. Frontend tsconfig 확인
# frontend/tsconfig.json에 reference 있는지 확인
# frontend/tsconfig.app.json에 paths 설정 있는지 확인
```

### 문제: Backend에서 shared 타입 변경이 반영 안 됨

**해결책:**
```bash
# 1. Shared 재빌드
npm run build:shared

# 2. Backend 재빌드
cd backend && npm run build

# 또는 전체 재빌드
npm run build:integrated
```

### 문제: 포터블 빌드에 shared 코드가 빠짐

**해결책:**
```bash
# 전체 빌드 프로세스 재실행
npm run build:full

# 개별 확인
npm run build:integrated  # Shared 포함 확인
npm run build:bundle      # Bundle에 shared 포함 확인
npm run build:portable    # 포터블 패키지 생성
```

---

## ✅ 결론

**추후 shared에 추가되는 모든 코드는 자동으로 처리됩니다:**

1. ✅ Shared에 타입/유틸/상수 추가
2. ✅ `npm run build:integrated` 실행
3. ✅ Shared 자동 컴파일
4. ✅ Backend/Frontend에서 자동 인식
5. ✅ Bundle.js에 자동 포함
6. ✅ 포터블 패키지에 자동 번들링

**추가 작업 없이 즉시 사용 가능합니다!**
