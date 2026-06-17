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
8. [agent MCP opt-in operation contracts](/systems/agent-mcp-opt-in-operation-contracts)
9. [agent MCP local evidence export](/systems/agent-mcp-local-evidence-export)
10. [local evidence export hardening contracts](/systems/local-evidence-export-hardening-contracts)
11. [local automation context operations map](/systems/local-automation-context-operations-map)
12. [26.6.17 generation history follow-up readiness](/systems/26.6.17-generation-history-followup-readiness)
13. [26.6.9 alpha release handoff packet](/systems/26.6.9-alpha-release-handoff)
14. [26.6.9 demo operation readiness checklist](/systems/26.6.9-demo-operation-readiness)
15. [workflow recovery runbook evidence](/systems/workflow-recovery-runbook-evidence)
16. [26.6.9 final readiness trend evidence](/systems/26.6.9-final-readiness-trend-evidence)
17. [operator evidence review console](/systems/operator-evidence-review-console)
18. [automation rehearsal contracts](/systems/automation-rehearsal-contracts)
19. [media/runtime release risk dashboard contracts](/systems/media-runtime-release-risk-dashboard-contracts)
20. [local automation context completion evidence](/systems/local-automation-context-completion-evidence)
21. [26.6.8 workflow-media-operations](/systems/26.6.8-workflow-media-operations)
22. [26.6.8 dependency hardening plan](/systems/26.6.8-dependency-hardening-plan)
23. [26.6.8 hardening-evidence-observability readiness](/systems/26.6.8-hardening-evidence-observability-readiness)

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

### 8) agent MCP opt-in operation contracts
- HTTP MCP의 opt-in, method boundary, agent preflight, dry-run stop conditions를 정리합니다.
- agent가 live MCP 작업을 시작하기 전에 확인해야 할 승인 경계를 제공합니다.

### 9) agent MCP local evidence export
- `npm run export:mcp-dry-run-evidence`로 로컬 review packet을 stdout JSON으로 내보내는 계약입니다.
- MCP tool side-effect class, `approvalRequired`, `dryRunOnly`, `externalSideEffects`를 기록하되 live MCP tools는 호출하지 않습니다.

### 10) local evidence export hardening contracts
- readiness Markdown, MCP dry-run JSON, recovery comparison bundle을 같은 로컬 export hardening 계약으로 묶습니다.
- live MCP 호출, rerun, cleanup, push/deploy/restart 없이 Settings readiness history와 Markdown handoff에 비교 가능한 근거를 남깁니다.

### 11) local automation context operations map
- 릴리즈 준비, 워크플로우 런타임, 미디어 리뷰, MCP 자동화 표면을 다음 로컬 작업 단위로 묶는 기준입니다.
- push, deploy, restart, package version bump 없이 agent/operator가 먼저 확인할 context map을 제공합니다.

### 12) 26.6.17 generation history follow-up readiness
- 생성 이력 재실행과 미디어 badge 확인을 로컬 검토 가능한 운영 메모로 묶습니다.
- push, deploy, restart, package version bump 없이 retry 경계와 검증 기준만 정리합니다.

### 13) 26.6.9 alpha release handoff packet
- `alphatest` 로컬 커밋 범위, 로컬 검증, live smoke 계획, 롤백 경계를 M2-CU1 기준으로 묶습니다.
- push, deploy, restart, protected service `3999` 조작 없이 승인 검토용 handoff packet을 제공합니다.

### 14) 26.6.9 demo operation readiness checklist
- alpha push, demo host update, configured demo service restart, live target `2999` smoke, rollback handoff의 승인 후 순서를 고정합니다.
- 실행 명령, 대상, 확인 기준, 중단 조건을 분리해 사용자 승인 전 외부 작업이 일어나지 않게 합니다.

### 15) workflow recovery runbook evidence
- 워크플로우 런타임 화면에 재실행, 롤백 인계, 중단 조건 evidence card를 추가한 로컬 runbook 기준입니다.
- queue/retry/recovery/terminal/retention 신호를 기존 health data에서 읽고, rollback/restart/destructive cleanup은 승인 경계로 유지합니다.

### 16) 26.6.9 final readiness trend evidence
- dependency/security 결과, release handoff, media/runtime observability, final local verification을 하나의 exportable trend evidence로 묶습니다.
- package version bump, push, deploy, restart, protected service `3999`, destructive cleanup은 사용자 승인 결정으로 분리합니다.

### 17) operator evidence review console
- Settings > Release readiness의 MCP dry-run, workflow recovery handoff, media approval packet 비교 콘솔 기준입니다.
- local storage snapshot과 Markdown export까지만 허용하고 MCP 호출, cleanup, rerun, push/deploy/restart는 승인 경계로 둡니다.

### 18) automation rehearsal contracts
- cleanup staging, workflow recovery replay, release-candidate command plan을 dry-run/local diff 리허설로 묶습니다.
- deletion, rerun, push/deploy/restart, external service 호출은 실행하지 않고 승인 경계로 유지합니다.

### 19) local automation context completion evidence
- automation context handoff, workflow recovery, media review continuity 로드맵의 최종 로컬 evidence packet입니다.
- push, deploy, restart, package version bump, auth/security/data/public API 변경, destructive cleanup, external side effect 없이 완료된 범위와 남은 승인 결정을 분리합니다.

### 20) 26.6.8 workflow-media-operations
- 워크플로우·미디어 운영 업그레이드를 로컬 검토 전에 어떤 순서로 검증할지 정리합니다.
- push, deploy, restart, protected service 조작 없이 확인 가능한 로컬 준비 경계입니다.

### 21) 26.6.8 dependency hardening plan
- `npm audit` 결과를 backend runtime, frontend routing, docs/build tooling 표면으로 분리합니다.
- 안전하게 적용할 수 있는 dependency update lane과 approval-needed 후보를 구분합니다.

### 22) 26.6.8 hardening-evidence-observability readiness
- dependency hardening, readiness evidence, media/runtime observability 로드맵의 최종 로컬 준비 경계를 정리합니다.
- 남은 `better-queue -> uuid`, `vitepress -> vite -> esbuild`, retention/destructive cleanup 승인 결정을 분리합니다.
