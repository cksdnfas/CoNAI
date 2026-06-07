# Release Notes

## Version 26.7.0 readiness (2026-06-07 준비)

v26.7.0은 최근 26.6.x 런타임, 그래프, 검색, 데모 기반을 "워크플로우 운영" 단계로 묶는 알파 리뷰 준비 문서입니다. 목표는 사용자가 재사용 가능한 생성 워크플로우를 작성하고, 실행 결과와 artifact를 확인하고, 생성된 미디어를 다시 찾고 정리하며, 외부 도구에는 통제된 MCP/demo 표면만 열어 둘 수 있게 하는 것입니다.

---

### 워크플로우 작성과 모듈 그래프

모듈 그래프의 작성 진입점과 Comfy workflow wrapping 경로를 한 operator flow로 정리했습니다.

- module library grouping과 quick create 흐름 보강
- 저장된 Comfy workflow를 module graph entry로 감싸는 authoring path 정리
- bypass node, random text node, API request/encoding node contract 보강
- random text dynamic input row order와 connected value override 동작 고정
- workflow entry, reusable asset, system API node 검증 alias 정렬

---

### 실행 운영과 결과 확인

생성 실행 중 무엇이 대기 중이고, 어떤 결과가 최종 결과인지, 어디에서 경고가 생겼는지 확인하기 쉽게 정리했습니다.

- graph execution panel과 latest run detail 확장
- artifact list, final result overlay, warning source 표시 보강
- queue lane, wait, duration metadata 노출
- unrunnable ComfyUI server/tag lane의 misleading ETA 제거
- split runtime launcher의 API/worker role 조합 검증

---

### 생성 후 미디어 정리

생성 결과를 검색, 선별, 그룹화, 보호, 삭제 검토까지 이어지는 하나의 정리 흐름으로 묶었습니다.

- search suggestion query와 rating tier local filter 보강
- image list hover/focus detail prefetch와 modal/page detail cache 재사용
- model metadata에서 gallery search를 바로 다시 열 수 있는 경로 정리
- auto tag index, stats cache, group rematch job contract 보강
- image similarity, thumbnail default settings, recycle bin, deletion lock 검증 정렬

---

### 안전한 demo/MCP 노출

알파 리뷰 전에 외부 접근 표면을 명시적인 opt-in과 trusted-client 문서로 제한했습니다.

- HTTP MCP endpoint는 `CONAI_MCP_HTTP_ENABLED=true`가 있을 때만 열림
- MCP guide에 trusted client 전제와 local/private network 주의사항 명시
- anonymous image demo, wildcard guest access, header/settings permission 검증 보강
- generation tool registry contract로 MCP generation tool 등록 회귀 방지

---

### 릴리즈 준비 체크리스트

릴리즈 준비 절차와 승인 경계는 [`docs/systems/26.7.0-release-readiness.md`](../systems/26.7.0-release-readiness.md)에 따로 정리했습니다.

로컬 준비 확인 alias:

```bash
npm run verify:release-readiness
```

이 alias는 다음 항목을 순서대로 실행합니다.

- `npm run verify:workspace-script-aliases`
- `npm run docs:build`
- `npm run build`

이번 준비 문서 작성 기준으로 별도 확인해야 하는 canonical check:

- `python -m graphify update .`

---

### 승인 경계

이 준비 패키지는 문서, script alias, local verification 정리까지만 포함합니다. 다음 작업은 별도 승인이 필요합니다.

- push, deploy, live demo update, server restart
- protected service `3999` 조작
- auth model redesign, security policy change, public API expansion
- DB schema/data retention/destructive cleanup
- package version bump, git tag, public release announcement

---

### 버전

- 릴리즈 준비 표기: **26.7.0 readiness**
- 현재 앱/package 기준: **26.6.3**
- 준비 범위: 26.7.0 workflow-operations upgrade local readiness
- 기준 이전 문서: [26.6.3](./RELEASE_26.6.3.md)
