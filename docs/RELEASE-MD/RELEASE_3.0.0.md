# Release Notes

## Version 3.0.0 (2026-02-10)

v3.0은 MCP 서버 통합, 이미지 모달 UI 전면 재설계, NAI 캐릭터 프롬프트 지원, 데이터베이스 성능 최적화 등 대규모 업데이트를 포함합니다.

---

### MCP (Model Context Protocol) 서버

AI 클라이언트(Claude Code, OpenClo 등)에서 이미지 매니저의 기능을 직접 활용할 수 있는 MCP 서버를 내장했습니다.

- **전송 방식**: Streamable HTTP (`/mcp` 엔드포인트, Stateless) + stdio 모드 지원
- **13개 MCP Tools** 제공:

| 카테고리 | Tool | 설명 |
|---------|------|------|
| **프롬프트** | `search_prompts` | 프롬프트 검색 (positive/negative/auto 타입) |
| | `get_most_used_prompts` | 가장 많이 사용된 프롬프트 조회 |
| | `list_prompt_groups` | 프롬프트 그룹 목록 조회 |
| **이미지 생성** | `list_workflows` | ComfyUI 워크플로우 목록 |
| | `get_workflow_details` | 워크플로우 상세 정보 (Marked Fields 포함) |
| | `list_comfyui_servers` | ComfyUI 서버 목록 |
| | `generate_comfyui` | ComfyUI 이미지 생성 |
| | `generate_comfyui_all_servers` | 모든 활성 서버에 병렬 생성 |
| | `generate_nai` | NovelAI 이미지 생성 (v4/v4.5 지원) |
| **이미지 조회** | `search_images` | 고급 이미지 검색 |
| | `search_images_by_tags` | WD Tagger 태그 기반 검색 |
| | `get_image_metadata` | 이미지 상세 메타데이터 조회 |
| | `get_generation_history` | 생성 이력 조회 |
| **리소스** | `list_custom_dropdown_lists` | 커스텀 드롭다운 목록 (LoRA 등) |
| | `search_custom_dropdown_items` | 드롭다운 항목 검색 |
| | `search_wildcards` | 와일드카드 검색 (계층 구조 지원) |

- 설정 가이드: [MCP_GUIDE.md](../MCP_GUIDE.md)

---

### 이미지 모달 UI 전면 재설계

이미지 상세 보기 모달을 공간 효율성과 사용성 중심으로 전면 재설계했습니다.

#### AI Info 섹션
- 각 생성 파라미터(Tool, Model, Steps, CFG, Sampler, Seed)를 개별 카드로 표시
- 클릭 시 값 복사 기능
- 라벨과 값 사이 점선 구분자로 시각적 구분 강화
- 라이트/다크 모드 최적화된 색상 체계

#### 파일 정보 섹션
- 확장형 섹션에서 컴팩트 버튼 + 툴팁 방식으로 변경
- 호버 시 파일명, 해상도, 크기, 날짜 정보 표시
- 해시 복사 버튼과 나란히 배치

#### 사이드바 레이아웃
- 접이식 섹션 제거 → 항상 펼쳐진 깔끔한 구조
- 헤더 텍스트 제거로 공간 절약
- 프롬프트 표시 영역 최대화 (flex 레이아웃)

#### 이미지 컨트롤
- 좁은 화면(<420px)에서 오버플로우 메뉴 자동 전환
- 회전/뒤집기/리셋 논리적 그룹화
- 모바일 최적화된 버튼 크기

#### 그룹 정보 칩
- 라이트/다크 모드별 최적화된 색상 대비
- 자동 그룹(블루), 수동 그룹(퍼플) 색상 구분
- 호버 시 변환 및 그림자 효과

---

### NAI 캐릭터 프롬프트 지원

NovelAI v4/v4.5의 캐릭터별 프롬프트를 개별적으로 표시합니다.

- `v4_prompt.caption.char_captions` 배열에서 캐릭터 프롬프트 추출
- 캐릭터별 독립 접이식 카드로 표시 ("Character 1", "Character 2" 등)
- 각 캐릭터 프롬프트 개별 복사 기능
- 메인 프롬프트와 구분되는 보조 색상 테마
- DB에 `raw_nai_parameters` 컬럼 추가로 전체 NAI 파라미터 보존

---

### 프롬프트 표시 컴포넌트 모듈화

- **PromptCard**: 재사용 가능한 접이식 카드 컴포넌트 신규 작성
  - localStorage를 통한 접힘 상태 유지 (이미지 전환 시에도 유지)
  - 헤더에 복사 버튼 통합
  - 부드러운 펼침/접힘 애니메이션
- Positive / Character / Negative / AUTO Tags 프롬프트를 통일된 카드 디자인으로 표시

---

### 데이터베이스 성능 최적화

#### 인덱스 추가 (Migration 008)
- `idx_auto_folder_groups_folder_path` - 자동 폴더 그룹 조회
- `idx_image_files_original_file_path` - 파일 경로 검색
- `idx_prompt_collection_prompt` - 프롬프트 텍스트 검색
- `idx_image_groups_group_composite` - 그룹 멤버십 복합 인덱스
- `idx_api_generation_history_status_created` - 생성 이력 필터링 + 정렬

#### 쿼리 최적화
- N+1 쿼리 문제 해결 (CTE 재귀 쿼리 활용)
- 모델 클래스에서 불필요한 async/await 제거 (better-sqlite3는 동기 API)

---

### 그룹 다운로드 개선

- **LoRA 데이터셋 다운로드**: 그룹 이미지를 LoRA 학습용 데이터셋으로 다운로드
  - 이미지 + 캡션 파일(.txt) 쌍으로 구성
  - 캡션 모드 선택: Auto Tags 또는 프롬프트 병합(Merged)
  - 자동 폴더 그룹/커스텀 그룹 모두 지원

---

### UI/UX 개선

#### 헤더 재설계
- 데스크톱: 아이콘 전용 네비게이션 (텍스트 라벨 제거, 툴팁 표시)
- 활성 상태: 하이라이트 배경 + 테두리 표시
- 컴팩트한 간격으로 공간 효율화

#### 검색 기능 강화
- **셔플 모드**: Fisher-Yates 알고리즘 기반 결과 랜덤 정렬
  - 전체 결과 ID를 먼저 가져온 후 셔플 적용
  - 셔플 상태에서 페이지네이션 유지
- **복합 검색**: 다중 필터 지원 고급 검색 API 추가
- **페이지 크기 저장**: localStorage에 페이지 크기 설정 유지

#### 접근성 향상
- 라이트/다크 모드 간 최적화된 색상 대비
- WCAG 기준에 맞춘 콘트라스트 비율 개선

---

### 백엔드 리팩토링

#### 외부 API 단순화
- LLM 외부 인증 제거 (`llmService.ts` 삭제)
- Civitai 설정을 일반 외부 API 시스템으로 통합
- Provider 타입을 `'general'`로 단순화

#### 프론트엔드 API 클라이언트 통합
- 모든 API 호출을 중앙 `apiClient`로 통합
  - 일관된 에러 처리 및 인터셉터
  - 단일 Base URL 관리
  - 전역 헤더 추가 용이

#### 기타
- vite-plugin-svgr 설정 추가
- preconnect 최적화, memo 최적화, 레이아웃 시프트 방지

---

### 다국어 지원

- 5개 언어 지원: English, 한국어, 日本語, 简体中文, 繁體中文
- 신규 기능(MCP, 그룹 다운로드, 워크플로우) 관련 번역 키 추가

---

## Breaking Changes

- **Gallery 페이지 제거**: 홈 페이지로 기능 통합 (통합 ImageList 컴포넌트)
- **LLM 외부 인증 제거**: 외부 API 제공자 타입이 `'general'`로 단순화
- **DB 마이그레이션**: 새로운 인덱스(008) 및 `raw_nai_parameters` 컬럼(009) 자동 적용

---

## Previous Releases

- [Version 2.1.1a](RELEASE_2.1.1a.md)
- [Version 2.1.0a](RELEASE_2.1.0a.md)
- [Version 2.0.2](RELEASE_2.0.2.md)
- [Version 2.0.1a](RELEASE_2.0.1a.md)
