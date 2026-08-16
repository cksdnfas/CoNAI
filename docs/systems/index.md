# 핵심 시스템 개요

CoNAI 문서는 여기부터 보는 게 맞습니다.
사용자가 화면에서 누르는 기능은 결국 아래 시스템들 위에 올라가 있으니까요.

## 우선순위 순서

1. [미디어 메타데이터 엔진](/systems/media-metadata)
2. [감시폴더 등록과 스캔](/systems/folder-watch-and-registration)
3. [생성 저장 파이프라인](/systems/generation-pipeline)
4. [워크플로우 실행 엔진](/systems/module-workflow-engine)
5. [MCP와 자동화 인터페이스](/systems/mcp-and-automation)
6. [Codex 이미지 생성 공급자 연동](/systems/codex-image-provider-integration)
7. [Danbooru 읽기 전용 탐색](/systems/danbooru-readonly-browser)
8. [Agent MCP opt-in 운영 계약](/systems/agent-mcp-opt-in-operation-contracts)

## 왜 이 순서인가

### 1) 미디어 메타데이터 엔진
- CoNAI의 거의 모든 화면은 메타데이터를 조회하고 가공해서 보여줍니다.
- 검색, 필터, 프롬프트 관련 기능의 기준이 됩니다.

### 2) 감시폴더 등록과 스캔
- 실제 파일이 라이브러리에 들어오는 출발점입니다.
- watched folder 구조와 자동 그룹의 뿌리입니다.

### 3) 생성 저장 파이프라인
- 생성물의 품질, 포맷, 저장 위치, 보존 전략을 통일합니다.
- 결과물이 산발적으로 저장되지 않게 잡아주는 축입니다.

### 4) 워크플로우 실행 엔진
- 단순 생성 UI를 넘어, 재사용 가능한 실행 구조를 담당합니다.
- 최근 확장 중인 Workflow 기능의 중심입니다.

### 5) MCP와 자동화 인터페이스
- 화면 밖에서 CoNAI를 호출하는 자동화 진입점입니다.
- AI 에이전트 연동과 외부 도구 호출의 연결부입니다.

### 6) Codex 이미지 생성 공급자 연동
- Codex CLI 기반 생성·편집 요청이 백엔드와 실행 환경을 통과하는 경계를 설명합니다.
- 공급자 설정과 결과 전달 흐름을 확인할 때 사용합니다.

### 7) Danbooru 읽기 전용 탐색
- 프롬프트 작성에 사용하는 Danbooru 읽기 전용 검색 흐름을 설명합니다.
- 외부 데이터 조회와 로컬 프롬프트 반영 경계를 확인할 때 사용합니다.

### 8) Agent MCP opt-in 운영 계약
- HTTP MCP의 opt-in, method boundary, agent preflight, dry-run stop conditions를 정리합니다.
- 에이전트가 live MCP 작업을 시작하기 전에 확인해야 할 승인 경계를 제공합니다.
