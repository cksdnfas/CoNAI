# Release Notes

## Version 26.4.8 (2026-04-08)

v26.4.8은 generation history 안정화, module graph / workflow output UX 개선, Docker 재시작 안정성 보강, 프론트 빌드 청크 정리를 중심으로 한 업데이트입니다.

---

### Generation History 안정화

NAI / ComfyUI 생성 히스토리에서 생성 중 → 완료 전환 시점의 표시 안정성을 보강했습니다.

- pending 히스토리 아이템이 더 빠르게 보이도록 초기 반영 흐름 정리
- 히스토리 정렬 / 갱신 시 아이템 식별 안정성 보강
- ComfyUI 결과가 실제 저장 이미지 기준으로 완료 처리되도록 보정
- 생성 완료 후 히스토리 썸네일이 빈 박스로 남는 문제 수정
- NAI / ComfyUI 공용 히스토리 리스트 미리보기 재시도 흐름 개선

---

### Module Graph / Workflow Output UX 개선

`generation?tab=workflows` 및 module graph 출력 관리 흐름을 더 다듬었습니다.

- workflow output management 구조 정리 및 책임 분리
- generated outputs / artifact 관리 UI 개선
- 노드 출력에서 긴 텍스트 / metadata / JSON은 축약 표시 후 전체 보기 모달로 확인 가능
- 상단 대표 이미지와 하단 포트 이미지가 같은 경우 중복 미리보기 노출 완화
- 텍스트 artifact 선택 및 출력 확인 흐름 정리

---

### Docker 배포 안정성 개선

Docker 환경에서 재시작 후 세션이 무효화되던 문제를 줄였습니다.

- `SESSION_SECRET`이 없을 때 매번 랜덤 생성하던 기존 동작 보완
- 런타임 데이터 경로에 persisted session secret 파일을 생성 / 재사용하도록 변경
- 컨테이너 재시작 후에도 동일 secret을 유지하는 흐름 확인
- docker-compose / README 생성본에 `SESSION_SECRET` 안내 추가

---

### 빌드 / 배포 점검

릴리즈 전 빌드 및 초기 실행 검증도 함께 진행했습니다.

- 일반 빌드 정상 확인
- portable 빌드 및 첫 실행 정상 확인
- docker 빌드 / 첫 실행 / health check 정상 확인
- frontend chunk 분리를 보강해 대형 feature/vendor chunk를 더 명확하게 분리
- 남아 있는 `PLUGIN_TIMINGS` 경고는 치명 오류가 아닌 빌드 성능 힌트 수준으로 확인

---

### 버전

- 앱 버전: **26.4.8**
- frontend / backend / shared 패키지 버전도 동일하게 **26.4.8**로 정렬
- portable / docker 산출물 내부 버전도 동일한 기준으로 사용
