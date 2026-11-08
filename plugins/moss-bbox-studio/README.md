# MOSS BBox Studio

MOSS-Image 레이아웃(JSON) 프롬프트를 영역 박스로 만들고 고치는 공식 플러그인. 사용법은 [선택 설치 확장 가이드](../../docs/GUIDE/PLUGINS.md#moss-bbox-studio)를 본다.

- 서버 모듈 없음. 설정·초안·최근 작업은 `api.storage`(계정별), 나머지는 기존 `/api` 경로(`/api/workflows`, `/api/generation-queue`, `/api/generation-history`, `/api/images/:hash`, `/api/images/extract-metadata`).
- `layout.js`는 DOM·호스트 호출이 없는 순수 함수다. 박스는 캔버스 비율로 보관하고 내보낼 때만 MOSS 공식 포맷(`yxyx`, 중심 기준 `abs_centralized` 픽셀)으로 바꾼다. `frontend/src/lib/layout-prompt.ts`(프롬프트 추출 표시)와 같은 문서 규칙이지만 패키지는 독립이라 코드를 공유하지 않는다. 한쪽 규칙을 바꾸면 다른 쪽도 맞춘다.
- 필요한 호스트: `api.supports('launch.image')`(이미지 상세에서 열기), `app.fetch`, `storage`, `events`.
- 검증: `cd frontend && npx tsx --test test/plugin-moss-bbox-layout.test.ts`. 실제 ComfyUI 서버·MOSS 워크플로우로 생성하는 경로는 자동 테스트하지 않는다.
