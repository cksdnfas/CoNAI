# Release Notes

## Version 26.4.27 (2026-04-27)

v26.4.27은 프롬프트 관계/분류 그래프, 생성 예약과 큐 운영, Codex 기반 생성, 모듈 그래프 노드 확장, 이미지/비디오 뷰어 안정화, 권한 기반 삭제 보호를 중심으로 묶은 알파 릴리즈입니다.

---

### 프롬프트 관계 그래프 / 자동 분류

프롬프트 페이지가 단순 목록 관리에서 관계 탐색과 자동 분류 보조까지 확장됐습니다.

- 프롬프트 관계 추천과 그래프 탭을 추가해 유사·연관 프롬프트를 시각적으로 탐색 가능
- 전체 프롬프트 관계 그래프와 taxonomy 모드를 추가해 대량 프롬프트 구조를 한눈에 확인 가능
- 자동 프롬프트 taxonomy 기반을 추가하고, 분류 결과를 탐색/제안 패널에서 확인할 수 있도록 개선
- 그래프 노드/엣지 표현, 줌, 엣지 anchoring을 다듬어 탐색 중 시각적 흔들림 감소
- 프롬프트 페이지의 관련 패널과 검색 UI를 단순화해 탐색 흐름 정리

---

### 생성 예약 / 큐 운영

이미지 생성 화면의 예약 실행과 작업 큐가 더 명확히 분리되고, 반복 예약 동작도 실제 운영 의미에 맞게 정리됐습니다.

- 생성 예약 탭과 작업 큐를 분리해 예약작업과 실제 큐 실행을 따로 관리
- 예약 실행 횟수, 동시성 제어, 실패 시 중지/계속 정책을 추가
- 예약작업의 `1회 큐 등록수`를 저장 직후 즉시 등록이 아니라, 예약 1회 동작마다 등록되는 개수로 정정
- `max_run_count`를 초과하지 않도록 남은 예약 횟수만큼만 큐 등록
- ComfyUI 워크플로우별 ETA 분리와 upstream cancellation 전달을 보강
- 취소 상태와 실행 실패 표시를 다듬어 생성 중단 상황을 더 잘 보이게 개선

---

### Codex 생성 / 워크플로우 통합

Codex 기반 이미지 생성 흐름이 일반 생성 파이프라인과 모듈 그래프 쪽으로 확장됐습니다.

- Codex 이미지 생성 패널과 히스토리 실패 표시 추가
- 재사용 가능한 Codex graph module과 출력 복구 흐름 추가
- Codex queue prompt에서도 와일드카드 파싱과 ComfyUI item fallback 지원
- Codex graph 출력 저장이 이미지 저장 설정을 따르도록 정렬
- 이미지 저장 설정을 통합하고 Codex 상태 표시를 추가

---

### 모듈 그래프 / 워크플로우 노드 확장

워크플로우 편집과 실행 노드가 더 실사용 중심으로 확장됐습니다.

- 저장된 Comfy graph module을 생성 큐와 연결
- LLM connection 설정, message node, structured output 단순화 추가
- workflow stop 노드와 IF branch 노드 추가
- current LLM provider의 기본 모델을 올바르게 사용하도록 수정
- SVG 이미지 입력, random video node, JSON output polish, dropdown option 정합성 개선
- Power Lora Loader 입력/설정 포트 처리와 컨트롤 UI를 정리
- workflow output handle, structured port, dynamic output handle 갱신 안정화

---

### 이미지 / 비디오 / 미디어 관리

상세 뷰어와 미디어 저장·정리 흐름도 함께 다듬었습니다.

- 초기 이미지 리스트의 비디오 프리뷰 로드를 throttle 처리해 첫 화면 과부하 감소
- 비디오 최적화 설정/흐름의 1차 구현 추가
- 상세 플레이어 컨트롤과 볼륨 슬라이더를 테마와 반경 스타일에 맞게 정리
- tall image가 상세 뷰어에서 과도하게 커지는 문제 수정
- 자동 태그 라벨은 정리된 값을 우선 사용하도록 개선
- 선택 삭제와 휴지통 제어를 추가하고, destructive delete는 관리자 권한으로 제한
- 저장된 미디어를 즉시 처리해 생성 결과 반영 지연을 줄임
- metadata extraction 결과 저장 정합성 보강

---

### 리팩터링 / 유지보수

릴리즈 사이에 큰 폭의 정리 작업도 포함됐습니다.

- workflow route를 domain별로 분리하고, generation queue route/helper를 분리
- singleton implementation, private helper export, dead upload service, unused UI/API/helper exports 정리
- module save schema, data URL reader, image preview upload helper, base64 image normalization, constant node execution, system completion logging 공통화
- 검색 drawer와 header icon action을 더 간결하게 정리

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.4.20` 이후 `alphatest` 현재 상태까지의 변경을 바탕으로 정리했습니다.

예시 주요 커밋:
- `b24493e` perf(images): throttle initial list video preview loads
- `e6dc3c3` feat: add first-pass video optimization flow
- `aa57b10` Add lightweight prompt relation suggestions
- `632f565` Add full prompt relation graph tab
- `7cd21ed` Add automatic prompt taxonomy foundation
- `f12b9ac` feat(generation): split reservations from job queue
- `5509b82` Integrate wrapped Comfy graph modules with generation queue
- `1cb34c5` Integrate Codex image generation and history failures
- `9f82820` feat(graph): add schedule failure policy
- `bf11902` feat(graph): add llm connections and message nodes
- `3169f93` feat(graph): add workflow stop and IF branch nodes
- `774b7a9` feat(graph): add reservation concurrency controls
- `0dae01c` feat(graph): allow bulk reservation enqueue
- `2f95cc0` Fix scheduled queue enqueue count semantics

---

### 검증

릴리즈 준비 중 아래 검증을 진행합니다.

- frontend / backend / shared 빌드
- docs GitHub Pages 빌드
- portable 산출물 빌드 및 초기 실행 확인
- docker 산출물 빌드 및 clean volume 초기 실행 확인

---

### 버전

- 앱 버전: **26.4.27**
- frontend / backend / shared 패키지 버전도 동일하게 **26.4.27**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.4.20**
