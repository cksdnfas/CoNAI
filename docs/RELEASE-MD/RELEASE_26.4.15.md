# Release Notes

## Version 26.4.15 (2026-04-15)

v26.4.15는 피드 안전성 강화, 생성 큐와 공개 워크플로우 흐름 정비, 계정/권한 UX 개선, 통합 런타임 및 배포 안정화, Kaloscope 상주형 실행 정리를 중심으로 묶은 업데이트입니다.

---

### 피드 안전성 / 숨김 이미지 보호 강화

숨김 등급과 안전성 규칙이 노출 경로마다 어긋나지 않도록 전반적으로 보강했습니다.

- 점수 기반 피드 안전성 제어 추가
- 숨김 이미지가 상세, 파일 접근, 에디터, 유사도, 임시 URL 등으로 우회 노출되지 않도록 차단 범위 확장
- 숨김 등급이 리스트/쿼리 계산에 섞여 결과를 흐리지 않도록 정리
- unrated 점수와 0점 상태를 분리해 안전성 해석 오류 완화
- 리스트형 스트립 프리뷰 blur 유지 및 메타데이터 안전성 처리 보강
- 관련 쿼리의 숨김 등급 서브쿼리 비용을 줄여 목록 성능 개선

---

### 이미지 / 그룹 / 다운로드 UX 개선

이미지 탐색과 다운로드 흐름을 더 일관되게 다듬었습니다.

- 이미지 모달 브라우징과 다운로드 흐름 개선
- 다운로드 옵션 모달 추가
- 그룹 다운로드 시 해시 기준으로 전체 세트를 더 정확히 로드하도록 수정
- 이미지 리스트/파일/유사도 라우트 헬퍼를 분리 정리해 이후 유지보수성 개선
- 브라우저 표면용 이미지 리스트 payload를 더 가볍게 줄여 응답 부담 완화

---

### 생성 큐 / 공개 워크플로우 / 히스토리 정비

생성 작업 상태 표시와 공개 워크플로우 접근 흐름을 더 실사용 중심으로 다듬었습니다.

- durable generation queue 구조를 계속 정리해 enqueue/refresh/라우팅 정합성 보강
- queue recovery와 위치 계산, 진행 상태 캡션을 더 정확하게 맞춤
- running job 기준으로만 진행률을 계산하도록 보정
- 공개 워크플로우 접근 흐름 추가
- 이미지 첨부 로딩 복구
- history 화면의 수동 필터/불필요 안내를 걷어내고, 관리자의 전체 히스토리 가시성 복구
- 상단 헤더에 계정/큐 위젯 추가로 현재 상태 접근성 향상

---

### 계정 / 권한 / 보안 UX 개선

권한 관리와 게스트 계정 흐름을 더 짧고 명확하게 정리했습니다.

- 계정 접근 제어 기반 구조 추가
- guest 가입/로그인 흐름 단순화
- compact access overview 페이지 추가
- auth UI 문구와 권한 그룹 복사 정리
- 보안 설정 화면 구성 간소화
- integrated app shell에서 auth 상태 preload로 초기 체감 속도 개선
- 원격 이미지 로드 오버헤드 감소

---

### 통합 런타임 / 빌드 / 배포 안정화

이번 버전은 배포 산출물과 통합 실행 경로 안정화 작업이 많이 들어갔습니다.

- integrated frontend dist 경로 해석 수정
- public asset 기본 URL을 same-origin으로 정리
- backend HTTP compression 활성화
- integrated build 자산 캐싱 추가
- integrated auto-build runner 추가
- docker / portable 패키지에서 integrated frontend 지원 보강
- integrated build에서 불필요한 `fs-extra` 의존성 제거
- 누락된 workspace dependency 복구
- 루트 `.env` 로딩과 runtime env path 해석을 프로젝트 루트 기준으로 정렬
- `APIImageProcessor` 파일 casing 정규화

---

### Kaloscope 실행 구조 정리

작가 추출 쪽도 WD tagger와 비슷한 운용 방향으로 정리했습니다.

- Kaloscope 모델을 요청마다 새로 띄우지 않고 재사용 가능한 상주형 흐름으로 정리
- 반복 추출 시 모델 재로드 비용 감소
- 통합 런타임에서 Kaloscope 관련 실행 안정성 개선

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.4.13` 이후 현재 상태까지의 변경을 바탕으로 정리했습니다.

예시 주요 커밋:
- `eb3cc7f` feat(rating): add score-based feed safety controls
- `3489e10` feat(image-generation): refine durable generation queue
- `6eeb6fb` feat(auth): add account access control foundations
- `5dd9dfc` feat(shell): add header account and queue widgets
- `f59e529` feat(image-generation): add public workflow access flow
- `63801a0` feat(images): add download option modal
- `371b831` feat(runtime): add integrated auto-build runner
- `e2e6e81` feat(kaloscope): keep daemon model loaded between runs
- `64bd681` fix(runtime): anchor env paths to project root

---

### 버전

- 앱 버전: **26.4.15**
- frontend / backend / shared 패키지 버전도 동일하게 **26.4.15**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.4.13**
