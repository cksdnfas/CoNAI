# Release Notes

## Version 2.1.0a (2025-11-25)

### Image Editor Overhaul
- **WebP 이미지 로딩**: 원본 이미지를 WebP로 변환하여 로드 (품질 100%, 용량 최적화)
  - 기존 썸네일 404 에러 문제 해결
  - 백엔드 API `/api/image-editor/:id/webp` 추가
- **WebP 저장 기능**: 편집된 이미지를 WebP 포맷으로 저장
  - `temp/canvas` 디렉토리에 저장 (파일 핸들 문제 해결)
  - 품질 설정 가능 (기본 90%)
  - TempImageService를 통한 파일 관리 및 자동 정리
- **pixelRatio 버그 수정**: 줌 레벨과 무관하게 원본 해상도로 저장
  - 기존: `pixelRatio: 1/zoom` (품질 저하)
  - 수정: `pixelRatio: 1` (원본 품질 유지)
- **그리기 좌표 버그 수정**: Ref 기반 좌표 계산으로 줌/팬 변경 시 정확도 개선
  - stale closure 문제 해결
  - 줌/팬 중에도 정확한 그리기 위치 유지
- **컬러 피커 렉 수정**: 디바운싱 적용 (50ms)
  - 드래그 시 발생하던 심각한 렉 해결
  - 로컬 상태와 부모 상태 분리로 UI 반응성 개선
- **회전/뒤집기 좌표 계산 수정**: 90/270도 회전 시 가로/세로 교환 적용

### New Features
- **캔버스 클리핑**: 이미지 영역 내에서만 그리기 가능
  - Konva Group의 clipFunc를 사용하여 이미지 경계 외부 그리기 차단
  - 원치 않는 비율/크기 변경 방지
- **마우스 휠 클릭 팬**: 마우스 휠 버튼 클릭으로 임시 팬 모드 전환
  - 현재 도구와 무관하게 휠 클릭으로 즉시 팬 가능
  - 휠 버튼 놓으면 원래 도구로 복귀
- **이미지 중앙 배치**: 편집기 진입 시 이미지가 뷰포트 중앙에 위치
  - calculateCenteredPosition 함수로 초기 위치 계산
  - 화면 맞춤(Fit Screen) 버튼도 중앙 배치 적용

### Improvements
- **저장 경로 변경**: `temp/canvas` 디렉토리로 저장 위치 변경
  - 원본 이미지 디렉토리 보호
  - TempImageService를 통한 일괄 관리
- **파일 핸들 문제 해결**: Sharp 메타데이터를 버퍼에서 직접 읽어 파일 핸들 문제 방지

### Bug Fixes
- 이미지 로드 시 구석에 배치되는 문제 수정
- 이미지 경계 밖에서 그리기 가능한 문제 수정
- **이미지 생성 시 그룹 자동 할당 버그 수정**: NAI/ComfyUI 이미지 생성 시 선택한 그룹에 자동 할당되지 않던 문제 해결
  - 원인: 외래 키 제약조건으로 인해 `media_metadata` 테이블에 해시가 등록되기 전에는 `image_groups`에 삽입 불가
  - 해결: `BackgroundProcessorService`에서 해시 생성 완료 후 `api_generation_history`의 `assigned_group_id`를 확인하여 그룹에 자동 할당

### UI/UX Improvements
- **페이지 레이아웃 일관성 개선**: 모든 주요 페이지(그룹, 생성, 설정, 갤러리)의 좌우 여백 및 레이아웃을 통일
  - ImageGroupsPage, ImageGenerationPage, SettingsPage의 불필요한 패딩 및 Container 제한 제거
  - 전체 화면 너비를 사용하는 일관된 디자인 적용

### Refactoring: Unified Image List
- **통합 ImageList 컴포넌트**: `ImageGrid`와 `ImageMasonry`를 통합하여 단일 `ImageList` 컴포넌트로 리팩토링
  - 모든 리스트 뷰(홈, 검색, 그룹)에서 동일한 기능 제공
- **사용자 경험 일관성**:
  - 홈,검색, 그룹 등 컨텍스트별로 뷰 모드(Masonry/Grid), 컬럼 수, 이미지 크기 설정 저장
  - Masonry 및 Grid 뷰 모드 자유 전환 가능
- **Gallery 페이지 제거**: 중복되던 Gallery 페이지 삭제 및 기능을 ImageList 통합
- **성능 최적화**: 무한 스크롤 및 페이지네이션 로직 통합 및 최적화

---

## Previous Releases

- [Version 2.0.2](RELEASE_2.0.2.md)
- [Version 2.0.1a](RELEASE_2.0.1a.md)
