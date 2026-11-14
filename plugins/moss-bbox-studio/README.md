# MOSS BBox Studio

MOSS-Image 레이아웃(JSON) 프롬프트를 영역 박스로 만들고 고치는 공식 플러그인. 사용법은 [선택 설치 확장 가이드](../../docs/GUIDE/PLUGINS.md#moss-bbox-studio)를 본다.

- 서버 모듈 없음. 설정·초안·최근 작업은 `api.storage`(계정별), 나머지는 기존 `/api` 경로(`/api/workflows`, `/api/custom-dropdown-lists`, `/api/generation-queue`와 `/api/generation-queue/:id`, `/api/generation-history`, `/api/images/:hash`, `/api/images/extract-metadata`).
- 워크플로우 칸: `dropdown_list_name`을 가진 선택 칸은 `/api/custom-dropdown-lists`의 항목을 선택지로 쓴다(`withDropdownOptions`). 플러그인이 역할(프롬프트·시드·크기)에 연결하지 않은 선택·숫자·텍스트 칸은 편집기의 **워크플로우 옵션**으로 조정하고(`splitOptionFields`), 사용자가 바꾼 값만 `prompt_data`에 넣는다. 설정 저장소 `setup.options`에 보관하며 워크플로우를 고르면 비운다.
- 작업 상태는 목록이 아니라 `GET /api/generation-queue/:id`로 작업마다 읽는다(목록은 끝난 작업을 오래된 것부터 한도 뒤에 둬서 완료·실패 뒤 작업이 사라진다).
- `layout.js`는 DOM·호스트 호출이 없는 순수 함수다. 박스는 캔버스 비율로 보관하고 내보낼 때만 MOSS 공식 포맷(`yxyx`, 중심 기준 `abs_centralized` 픽셀)으로 바꾼다. `frontend/src/lib/layout-prompt.ts`(프롬프트 추출 표시)와 같은 문서 규칙이지만 패키지는 독립이라 코드를 공유하지 않는다. 한쪽 규칙을 바꾸면 다른 쪽도 맞춘다.
- 필요한 호스트: `api.supports('launch.image')`(이미지 상세에서 열기), `api.supports('pickMedia')`(라이브러리 이미지 고르기, 없으면 그 버튼을 숨기고 파일 올리기만 남김), `app.fetch`, `storage`, `events`.
- 검증: `cd frontend && npx tsx --test test/plugin-moss-bbox-layout.test.ts`. 실제 ComfyUI 서버·MOSS 워크플로우로 생성하는 경로는 자동 테스트하지 않는다.
