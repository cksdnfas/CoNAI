# Release Notes

## Version 26.4.20 (2026-04-20)

v26.4.20은 이미지/비디오 뷰어 안정화, 설정 및 파일 검증 운영 개선, 워크플로우 결과 관리 확장, 모바일 오버레이 동작 정리, 배포 후 초기 실행 안정화 보강을 중심으로 묶은 업데이트입니다.

---

### 이미지 / 비디오 로딩 안정화

이번 버전에서 가장 크게 손본 축입니다. 목록, 상세, 모달을 오갈 때 영상이 다시 흔들리거나 불필요하게 다시 받아지는 문제를 집중적으로 줄였습니다.

- 이미지 리스트 비디오 프리뷰에서 `src`를 분리하지 않도록 정리해 작은 스크롤 왕복에도 재로딩이 덜 일어나도록 개선
- 목록과 상세/모달 사이에서 비디오 캐시 재사용 흐름을 보강하고, blob URL 수명 관리 문제를 줄여 `ERR_FILE_NOT_FOUND` 계열 오류 완화
- 비디오 프리뷰 경로를 더 안정적인 파일 라우트 기준으로 정리해 `/download/original` 404 재시도 노이즈 감소
- 모달 비디오 마운트 타이밍을 안정화해 Plyr DOM 충돌로 인한 `removeChild` 예외 방지
- 이미지 모달 하단 썸네일 스트립을 비활성화해 불필요한 추가 로딩 제거
- Plyr 아이콘 자산 경로를 정리하고, 브라우저가 실제 지원하는 컨트롤만 노출하도록 비디오 컨트롤 구성을 정규화
- 이미지 상세 화면의 모바일 탭, 뷰어 높이, 컨트롤 접힘 상태, 뒤로가기 닫기 동작을 연속적으로 다듬어 손에 걸리는 부분을 정리

---

### 설정 / 계정 / 파일 검증 운영 개선

운영자가 실제로 만지는 설정과 파일 정리 흐름을 더 실용적으로 맞췄습니다.

- 설정의 계정 목록과 권한 그룹 멤버 목록을 같은 관리 UI로 통합
- 그룹 멤버 목록에서도 기본 그룹 변경, 비밀번호 변경, 계정 삭제, 멤버 제거를 같은 패턴으로 처리 가능
- 계정 목록은 페이지당 20개, 그룹 멤버 목록은 검색 + 페이지당 10개로 정리
- 파일 검증을 기본 활성 상태로 전환하고, 설정 변경 시 스케줄이 즉시 반영되도록 보강
- 감시 폴더 운영 헤더에 수동 파일 검증 버튼 추가
- 원본/썸네일 상태에 따라 이미지, 비디오, animated 자산을 더 보수적으로 정리하도록 파일 검증 규칙 개선
- 감시 폴더 `unlink` 시점에는 즉시 DB 정리로 반영되도록 조정해 목록 잔상 감소

---

### 워크플로우 / 모듈 그래프 / 결과 관리 확장

워크플로우 실행 결과를 실제로 다시 쓰기 쉽게 만드는 쪽도 꽤 많이 들어갔습니다.

- 생성된 미디어 출력물을 히스토리에 지속적으로 남기도록 보강
- 모듈 그래프 실행 결과에서 비디오 출력도 다룰 수 있도록 확장
- step-aware number field 지원으로 워크플로우 입력 조절 정밀도 개선
- rgthree Power Lora Loader 노드 지원 추가
- 텍스트 유틸리티 노드와 선택/클립보드 흐름 추가
- 자동 수집 드롭다운의 모델 경로 처리와 ComfyUI 모델 경로 정합성 보강

---

### UI / 상호작용 정리

최근 진행된 표면 정리 작업도 이번 버전에 함께 묶였습니다.

- 이미지 상세/모달의 오버레이 뒤로가기 처리 일관성 강화
- 모바일에서 두 손가락 선택 시작, 오버레이 닫기, 터치 기반 탐색 흐름 개선
- 와일드카드, 프롬프트, 그룹, 설정, 생성 패널 전반에서 더 컴팩트한 공통 표면 스타일을 확장
- 여러 편집기와 패널의 입력 표면을 통일해 화면 간 인상 차이를 줄임

---

### 배포 / 초기 실행 안정화

릴리즈 직전 검증에서 잡힌 초기 실행 문제도 같이 정리했습니다.

- lazy route 청크가 배포 직후 꼬일 때 자동 새로고침으로 회복하도록 보강
- HTML 캐시 정책을 강화해 오래된 앱 셸이 사라진 청크를 계속 물지 않도록 조정
- 포터블 / 도커 산출물의 첫 실행 마이그레이션이 외부 유틸 상대경로에 의존하지 않도록 정리해 깨끗한 초기 기동이 가능하게 수정

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.4.15` 이후 현재 상태까지의 변경을 바탕으로 정리했습니다.

예시 주요 커밋:
- `f007198` feat(settings): unify account and group member management lists
- `f6815fe` feat(files): automate verification cleanup and settings controls
- `f246ab5` feat(module-graph): support video outputs in workflow results
- `2359d22` feat(workflows): persist generated media outputs in history
- `2f89807` perf(images): persist cached video reuse across list and modal
- `505d7be` fix(images): avoid fragile blob preview promotion
- `0e549e5` fix(app): recover from stale lazy route chunks
- `e4dacff` fix(images): normalize supported video player controls
- `5900916` Fix auto-collected dropdown model paths
- `124d5fc` Handle mobile back close across modals

---

### 검증

- frontend / backend / shared 빌드가 현재 `26.4.20` 기준으로 다시 통과함
- integrated build + bundle 재생성 완료
- portable 빌드 후 새 출력물 기준 첫 실행 및 `/health` 확인 완료
- docker base image 재빌드 후 clean volume 기준 `docker compose up -d --build` 첫 실행 및 health check 확인 완료

---

### 버전

- 앱 버전: **26.4.20**
- frontend / backend / shared 패키지 버전도 동일하게 **26.4.20**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.4.15**
