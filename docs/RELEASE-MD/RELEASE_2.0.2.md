# Release Notes

## Version 2.0.2 (2025-11-21)

### New Features
- **Civitai Integration**: 이미지 메타데이터의 모델 해시를 기반으로 Civitai API 연동
  - 모델/LoRA 정보 자동 조회 및 캐싱
  - 백그라운드 큐에서 비동기 처리 (Rate Limiting 지원)
  - 모델 썸네일 다운로드
  - Post Intent URL 생성 (Civitai 업로드용)
  - Settings → Civitai 탭에서 설정 및 통계 확인

---

## Version 2.0.2-beta (2025-11-19)

### Bug Fixes
- **그룹 다운로드**: Blob 기반 다운로드로 전환하여 새 창 열림 문제 해결
- **중국어 번역**: JSON 구문 오류 수정
- **TypeScript 오류**: FileVerificationLogModal 타입 수정

### Features
- **모델 로더 통합 스캔**: 하위폴더 병합 옵션 추가 (`mergeSubfolders`, `createBoth`)
- **계층형 모델 선택기**: 트리뷰 기반 모델 선택 UI 추가
  - 폴더 구조 시각화 및 실시간 검색 필터링

### Improvements
- **다국어 지원 완료**: 37개 컴포넌트, 5개 언어 (ko, en, ja, zh-CN, zh-TW)
- **그룹 다운로드 UX**: 스낵바 알림, UTF-8 파일명 지원
- **와일드카드 UI 전면 개편**: Explorer 스타일 2패널 레이아웃
  - 트리뷰(좌측) + 상세패널(우측) 구조
  - `parent_id` 기반 계층 관계 지원 (수동/자동 와일드카드 모두)
  - 폴더 클릭 시 확장+선택 동시 동작
  - 폴더 우선 정렬, 반응형 모바일 대응
  - 복사 시 스낵바 피드백 (`"++name++" 클립보드에 복사됨!`)

---

## Version 2.0.1a (2025-11-18)

### Bug Fixes
- **Metadata Extraction**: NovelAI V3/V4 형식 호환성 개선
- **Workflow Marked Fields**: 라벨 수정 시 필드 ID 변경 문제 해결
- **경로 구분자**: Windows/Unix 경로 구분자 자동 감지 및 유지
- **드롭다운 기본값**: 첫 번째 항목 자동 선택

### Features
- **ComfyUI Model Import**: 모델 타입별 경로 포함 옵션
- **자동 수집 목록**: 읽기 전용 보기 기능 추가
- **드롭다운 참조 시스템**: NAME 기반 참조로 자동 업데이트

### Improvements
- **Marked Fields UX**: 필드 ID 자동 생성, 그래프 뷰 자동 라벨링

---

## Version 2.0.0a (2025-11-16)

### Initial Alpha Release
- React + Material-UI 프론트엔드
- Node.js/TypeScript + SQLite 백엔드
- AI 메타데이터 추출 (ComfyUI, NovelAI, Stable Diffusion)
- 자동 수집 시스템
- 프롬프트 관리 및 분석
- Docker 배포 지원
