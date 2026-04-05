# CoNAI 26.4.5 Release Notes

## 요약
26.4.5는 워크플로우/모듈 그래프 UX 정리, 메타데이터 저장 안정화 후속 정리, ComfyUI/와일드카드 편의 개선, 그리고 배포 산출물 검증에 집중한 버전이다.

## 핵심 변경사항

### 1) 이미지 메타데이터 저장 흐름 보강
- 메타데이터 저장 시 DB만 갱신하는 임시 흐름에서 확장해, 실제 운영 파일 교체 기반 저장 흐름을 안정화했다.
- 저장 시 기존 운영 파일은 RecycleBin 보존 대상으로 처리하고, 새 메타데이터 반영 파일을 active로 승격하는 구조를 정리했다.
- 메타데이터 편집 revision 기록 구조를 추가했다.

### 2) ComfyUI / 모듈 저장 UX 개선
- ComfyUI 워크플로우에서 모듈 저장 진입점을 추가했다.
- 모듈 라이브러리 모달 내부의 불필요한 접기 동작을 제거했다.
- ComfyUI 워크플로우 목록/상세에서 모듈 저장 버튼 위치를 더 자연스럽게 정리했다.

### 3) Workflows 탭 UI/운영성 개선
- `generation?tab=workflows` 및 module graph 영역에서 섹션 이동 버튼을 헤더 하단 고정 위치로 올려, 스크롤에 가려지지 않도록 개선했다.
- 실행 상세 / 워크플로우 편집 지원 패널에서 섹션 점프 UX를 정리했다.
- 워크플로우 폴더/워크플로우 관리 패널을 보강해 폴더 생성, 할당, 수정, 삭제 흐름을 다듬었다.
- 저장된 워크플로우 목록, 실행 결과, 최종 결과 표시를 전반적으로 정리했다.

### 4) Wildcards / 기타 UI 다듬기
- `generation?tab=wildcards` 사이드바 상단 액션 버튼 정렬을 정리했다.
- 삭제 버튼에 위험 액션 색 포인트를 추가해 식별성을 높였다.
- 일부 LoRA auto collect / inline media preview 연동부를 함께 정리했다.

### 5) 문서 정리
- 오래된 릴리즈 문서 및 과거 작업 계획 문서를 대량 정리했다.
- 현재 기준에서 유지 가치가 낮은 구형 계획/릴리즈 문서를 제거해 문서 트리를 정돈했다.

## 배포/빌드 검증
다음 항목을 실제로 확인했다.

- 전체 워크스페이스 빌드 성공
  - `npm run build`
- Portable 빌드 성공 및 초기 스타트 확인
  - `npm run build:portable`
  - `build-output/portable/start.bat`
  - `/health` 응답 OK 확인
- Docker 빌드 성공 및 초기 스타트 확인
  - `npm run build:docker`
  - `docker compose up -d --build`
  - 컨테이너 healthy 확인
  - `/health` 응답 OK 확인

## 버전
- 앱 버전을 `26.4.5`로 올렸다.
- portable / docker 산출물 내부 package version도 동일하게 `26.4.5`로 맞췄다.

## 비고
- 프론트 빌드 시 큰 chunk 경고는 여전히 존재하지만, 이번 릴리즈 기준 blocking issue는 아니다.
- 이번 노트는 변경량이 많아 핵심만 요약한 버전이다.
