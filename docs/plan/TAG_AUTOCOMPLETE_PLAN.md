# 태그 자동완성 기능 구현 계획

## 개요

검색 입력 시 프롬프트/태그 자동완성 기능을 추가하여 사용자 경험을 개선합니다.

## 현재 상태

### 사용 가능한 데이터 소스
- `prompt_collection` 테이블: 포지티브 프롬프트 저장 (usage_count 인덱싱됨)
- `negative_prompt_collection` 테이블: 네거티브 프롬프트 저장
- `prompt_groups` / `negative_prompt_groups` 테이블: 프롬프트 그룹화

### 사용 가능한 API
- `GET /api/prompt-collection/search`: 프롬프트 검색
- `GET /api/prompt-collection/top`: 가장 많이 사용된 프롬프트 조회
- `GET /api/prompt-collection/statistics`: 통계 정보

### 현재 구현 상태
- 자동완성 UI 컴포넌트: 미구현
- 검색 입력은 단순 TextField 사용 중

## 구현 방향

### 1단계: 프론트엔드 자동완성 컴포넌트 생성

**새로 생성할 파일:**
- `frontend/src/components/Autocomplete/AutocompletePromptInput.tsx`
- `frontend/src/hooks/usePromptAutocomplete.ts`

**기능:**
- Material-UI Autocomplete 컴포넌트 활용
- 디바운싱 적용 (300-500ms)
- 결과 캐싱
- 로딩 상태 표시
- usage_count 기반 정렬

### 2단계: 검색 UI 통합

**수정할 파일:**
- `frontend/src/components/SearchBar/SimpleSearchTab.tsx`
- `frontend/src/components/FilterBuilder/FilterBlockModal.tsx`

**적용 위치:**
- Simple Search 텍스트 입력
- 필터 조건 값 입력 (prompt_contains, auto_tag_general 등)

### 3단계: 백엔드 최적화 (선택사항)

**새로 생성할 엔드포인트:**
- `GET /api/prompt-collection/autocomplete`

**특징:**
- 자동완성에 최적화된 응답 (최소 필드)
- 기본 limit 10개
- 페이지네이션 없음

## UI/UX 고려사항

1. **제안 표시 정보:**
   - 프롬프트 텍스트
   - 사용 횟수 (인기도 표시)
   - 그룹 정보 (있는 경우)

2. **성능:**
   - 최대 10-15개 제안만 표시
   - 입력 디바운싱으로 API 호출 최소화
   - 결과 캐싱

3. **접근성:**
   - 키보드 네비게이션 지원
   - 스크린 리더 호환

## 관련 파일 위치

| 구분 | 파일 |
|------|------|
| 검색 UI | `frontend/src/components/SearchBar/SimpleSearchTab.tsx` |
| 필터 모달 | `frontend/src/components/FilterBuilder/FilterBlockModal.tsx` |
| 프롬프트 API | `backend/src/routes/promptCollection.ts` |
| 프롬프트 서비스 | `backend/src/services/promptCollectionService.ts` |
| 프론트엔드 API | `frontend/src/services/promptApi.ts` |

## 예상 작업량

- 프론트엔드 컴포넌트: 중간
- 검색 UI 통합: 낮음
- 백엔드 최적화: 낮음 (선택사항)

## 참고사항

- 기존 `GroupTreeSelector` 컴포넌트의 패턴을 참고할 수 있음
- `prompt_collection` 테이블에 이미 `usage_count` 인덱스가 있어 성능 문제 없음
