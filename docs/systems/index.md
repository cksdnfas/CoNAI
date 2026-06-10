# 핵심 시스템 개요

CoNAI 문서는 여기부터 보는 게 맞습니다.
사용자가 화면에서 누르는 기능은 결국 아래 시스템들 위에 올라가 있으니까요.

## 우선순위 순서

1. [미디어 메타데이터 엔진](/systems/media-metadata)
2. [감시폴더 등록과 스캔](/systems/folder-watch-and-registration)
3. [생성 저장 파이프라인](/systems/generation-pipeline)
4. [워크플로우 실행 엔진](/systems/module-workflow-engine)
5. [모듈 그래프 노드 UX 개편안](/systems/module-graph-node-ux-redesign-plan)
6. [LLM and Codex Graph Nodes Plan](/systems/llm-and-codex-graph-nodes-plan)
7. [MCP와 자동화 인터페이스](/systems/mcp-and-automation)
8. [local automation context operations map](/systems/local-automation-context-operations-map)
9. [26.6.9 alpha release handoff packet](/systems/26.6.9-alpha-release-handoff)
10. [26.6.9 demo operation readiness checklist](/systems/26.6.9-demo-operation-readiness)
11. [26.6.9 final readiness trend evidence](/systems/26.6.9-final-readiness-trend-evidence)
12. [26.6.8 workflow-media-operations](/systems/26.6.8-workflow-media-operations)
13. [26.6.8 dependency hardening plan](/systems/26.6.8-dependency-hardening-plan)
14. [26.6.8 hardening-evidence-observability readiness](/systems/26.6.8-hardening-evidence-observability-readiness)

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

### 5) 모듈 그래프 노드 UX 개편안
- 워크플로우 캔버스를 ComfyUI에 가까운 직접 편집형 경험으로 끌어올리기 위한 개편 기준입니다.
- 노드 인라인 편집, 값 가시성, 포트 표현 축소 원칙을 정리합니다.

### 6) LLM and Codex Graph Nodes Plan
- LM Studio, Ollama, 외부 OpenAI 호환 API, Codex 메시지 노드를 그래프 엔진에 어떻게 붙일지 정리한 영어 설계 문서입니다.
- 현재 진행 중인 node UX 개편과 provider 저장 구조를 함께 고려한 구현 기준입니다.

### 7) MCP와 자동화 인터페이스
- 화면 밖에서 CoNAI를 호출하는 자동화 진입점입니다.
- AI 에이전트 연동과 외부 도구 호출의 연결부입니다.

### 8) local automation context operations map
- 릴리즈 준비, 워크플로우 런타임, 미디어 리뷰, MCP 자동화 표면을 다음 로컬 작업 단위로 묶는 기준입니다.
- push, deploy, restart, package version bump 없이 agent/operator가 먼저 확인할 context map을 제공합니다.

### 9) 26.6.9 alpha release handoff packet
- `alphatest` 로컬 커밋 범위, 로컬 검증, live smoke 계획, 롤백 경계를 M2-CU1 기준으로 묶습니다.
- push, deploy, restart, protected service `3999` 조작 없이 승인 검토용 handoff packet을 제공합니다.

### 10) 26.6.9 demo operation readiness checklist
- alpha push, demo host update, configured demo service restart, live target `2999` smoke, rollback handoff의 승인 후 순서를 고정합니다.
- 실행 명령, 대상, 확인 기준, 중단 조건을 분리해 사용자 승인 전 외부 작업이 일어나지 않게 합니다.

### 11) 26.6.9 final readiness trend evidence
- dependency/security 결과, release handoff, media/runtime observability, final local verification을 하나의 exportable trend evidence로 묶습니다.
- package version bump, push, deploy, restart, protected service `3999`, destructive cleanup은 사용자 승인 결정으로 분리합니다.

### 12) 26.6.8 workflow-media-operations
- 워크플로우·미디어 운영 업그레이드를 로컬 검토 전에 어떤 순서로 검증할지 정리합니다.
- push, deploy, restart, protected service 조작 없이 확인 가능한 로컬 준비 경계입니다.

### 13) 26.6.8 dependency hardening plan
- `npm audit` 결과를 backend runtime, frontend routing, docs/build tooling 표면으로 분리합니다.
- 안전하게 적용할 수 있는 dependency update lane과 approval-needed 후보를 구분합니다.

### 14) 26.6.8 hardening-evidence-observability readiness
- dependency hardening, readiness evidence, media/runtime observability 로드맵의 최종 로컬 준비 경계를 정리합니다.
- 남은 `better-queue -> uuid`, `vitepress -> vite -> esbuild`, retention/destructive cleanup 승인 결정을 분리합니다.
