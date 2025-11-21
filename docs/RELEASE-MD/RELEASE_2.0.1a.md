# Build Notes

## Version 2.0.1a (2025-11-18)

### Bug Fixes
- **Metadata Extraction**: NovelAI V3/V4 형식 호환성 개선 - `TypeError: aiInfo.prompt.trim is not a function` 오류 수정
- **Type Safety**: 메타데이터 파서에 타입 가드 추가하여 문자열/객체 형식 모두 처리
- **Workflow Marked Fields**: 필드 편집 시 발생하던 문제 수정
  - 라벨 수정 시 필드 ID가 동시에 변경되던 문제 해결
  - 필드 ID 입력 시 카드가 축소되고 커서가 해제되던 문제 해결
- **Marked Fields Preview**: 경로 검증 결과의 현재 값 표시 오버플로우 수정
  - 긴 텍스트가 영역을 벗어나던 문제 해결
  - 여러 줄로 깔끔하게 표시되도록 레이아웃 개선
  - 가독성 향상을 위해 monospace 폰트 적용
- **Workflow Path Separator**: 워크플로우 실행 시 경로 구분자 불일치 문제 수정
  - 원본 워크플로우의 Windows 경로(백슬래시)가 Unix 경로(슬래시)로 치환되던 문제 해결
  - 치환 시 원본 값의 경로 구분자 형식을 자동으로 감지하여 유지
  - ComfyUI에서 모델 파일을 찾지 못하는 오류 방지
- **Workflow Dropdown Default Value**: 커스텀 드롭다운 필드의 기본값 자동 선택 기능 추가
  - 워크플로우 진입 시 드롭다운의 첫 번째 항목이 자동으로 선택되도록 수정
  - 값이 비어있을 때 발생하던 빈 값 전송 문제 해결

### Improvements
- **Group Download**: 그룹 다운로드 경로 처리 로직 개선
- **Image Loading**: 이미지 로딩 폴백 및 다운로드 기능 안정성 향상
- **Workflow UI/UX**: Marked Fields 편집 경험 개선
  - 필드 ID를 UI에서 제거하고 내부적으로만 자동 생성되도록 변경
  - 사용자는 라벨(표시 이름)과 JSON Path(워크플로우 경로)만 관리
  - 필드 ID는 최초 생성 시 라벨 기반으로 자동 생성되며 이후 변경되지 않음
  - 확장 상태 추적을 field.id에서 배열 index로 변경하여 안정성 향상
- **Marked Fields Auto-labeling**: 그래프 뷰에서 우클릭으로 필드 추가 시 자동 라벨 생성
  - 형식: `#[노드ID]_[노드제목]([입력타입])` (예: `#190_QP(TEXT)`)
  - 노드 제목과 입력 타입 정보를 자동으로 포함하여 가독성 향상
  - 특수문자는 언더스코어로 자동 변환

### Features
- **ComfyUI Model Import**: 모델 타입별 경로 포함 옵션 추가
  - checkpoints, unet, upscale_models 각각에 대해 전체 경로 포함 여부 선택 가능
  - checkpoints는 기본적으로 전체 경로 포함 (예: `Illustrious/ETC/model.safetensors`)
  - unet, upscale_models는 기본적으로 파일명만 포함 (예: `model.safetensors`)
  - UI에 실시간 예시 표시로 사용자 이해도 향상
- **Custom Dropdown Lists**: 자동 수집 목록 읽기 전용 보기 기능 추가
  - 자동 수집된 커스텀 드롭다운 목록의 항목을 확인할 수 있는 읽기 전용 다이얼로그 추가
  - 편집 버튼을 보기 버튼(눈 아이콘)으로 교체
  - 목록 이름, 설명, 경로 및 전체 항목 목록 표시
  - 편집 불가, 내용 확인만 가능
- **Workflow Dropdown Reference System**: 커스텀 드롭다운 목록 NAME 기반 참조 시스템 구현
  - 워크플로우의 select 필드에서 커스텀 드롭다운 목록을 **이름으로 참조** 가능
  - 드롭다운 목록 수정 시 **연결된 모든 워크플로우에 자동 반영**
  - 자동수집 목록 재생성 시에도 name이 동일하면 연결 유지 (ID 변경에 안전)
  - 워크플로우 실행 시 참조된 목록의 최신 항목 자동 로드
  - UI 개선: 참조 중인 목록 이름 Chip으로 표시, 자동 업데이트 안내
  - 목록 삭제/에러 시 저장된 options 배열로 안전하게 폴백
  - 100% 하위 호환성 유지 (기존 워크플로우는 options 배열 계속 사용)

---

## Version 2.0.0a (2025-11-16)

### Initial Alpha Release
- React-based frontend with Material-UI
- Node.js/TypeScript backend with SQLite
- AI metadata extraction (ComfyUI, NovelAI, Stable Diffusion)
- Auto-collection system
- Prompt management and analysis
- Docker deployment support
