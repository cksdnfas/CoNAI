# CoNAI 개발 구조와 연결 지점

확인: 2026-10-13, 현재 작업 트리 기준. 정책은 [AI_Guidelines.md](AI_Guidelines.md), 화면 규칙은 [프론트 구조](frontend/APP_ARCHITECTURE.md)와 [디자인 기준](frontend/DESIGN_PRESET.md)을 따른다. 이 문서는 전체 API 명세를 복제하지 않고 변경할 코드의 진입점을 안내한다.

## 기본 구조

| 영역 | 책임과 진입점 |
| --- | --- |
| `frontend/` | 화면, 공용 UI, 페이지 어시스턴트 어댑터. [라우터](frontend/src/app/router.tsx), [앱 셸](frontend/src/components/layout/app-shell.tsx) |
| `backend/` | HTTP API, 권한, DB, MCP, 채팅·작업 실행. [서버 진입점](backend/src/index.ts), `src/routes/`, `src/services/` |
| `shared/` | UI·API·도구가 공유하는 타입과 검증. `src/types/`, `src/utils/` |
| `docs/GUIDE/` | 현재 사용자 흐름. [목록](docs/GUIDE/index.md) |
| `user/` | 기본 런타임 데이터. 실제 위치는 [runtimePaths](backend/src/config/runtimePaths.ts)와 배포 설정을 따른다. |

개발 포트 기본값은 backend `1666`, frontend `1677`이다. 실행은 [README](README.md)를 따른다. 의존성 버전·검증 명령의 원본은 각 `package.json`이며 문서에 패치 버전을 중복 고정하지 않는다.

## 채팅과 페이지 어시스턴트

화면 연결은 현재 페이지의 등록된 상태·필드·작업을 사용한다. 페이지 연결은 1:1 채팅 경로이며 그룹 채팅의 서버 작업 도구와 구분한다.

| 변경 지점 | 코드 |
| --- | --- |
| 페이지 등록·스냅샷·적용·되돌리기 | [chat-page-context.tsx](frontend/src/features/codex-chat/chat-page-context.tsx), 각 기능의 페이지 어댑터 |
| 공유 스냅샷·작업 타입 | [chatPage.ts](shared/src/types/chatPage.ts), [chatPageAction.ts](shared/src/types/chatPageAction.ts) |
| 작업 분류·검증·권한 매핑 | [chatPageAction.ts](shared/src/utils/chatPageAction.ts) |
| 현재 페이지 조회·입력 변경 | [chatPageTools.ts](backend/src/mcp/tools/chatPageTools.ts) |
| 페이지 작업 실행·저장 제안 | [chatPageActionTools.ts](backend/src/mcp/tools/chatPageActionTools.ts) |
| 서버와 브라우저 연결 | [chatPageBridge.ts](backend/src/services/codex-chat/chatPageBridge.ts), [chatPageContext.ts](backend/src/services/codex-chat/chatPageContext.ts) |
| 네이티브 저장 경계 | [chatPageNativeActions.ts](backend/src/services/codex-chat/chatPageNativeActions.ts)와 각 기능의 기존 API |

현재 계약:

- `view`는 탐색·선택, `draft`는 초안 변경이다. 등록된 경로로 즉시 실행하고 결과 화면을 반환한다. 초안은 현재 상태가 맞을 때 되돌릴 수 있다.
- `commit`은 저장·실행 등 확정 작업으로 검토 카드를 거친다. 제안 생성과 실제 적용을 구분한다.
- 페이지·모달·선택·리비전이 달라진 제안은 덮어쓰지 않는다. 페이지 접근과 작업 권한은 각각 확인한다.
- 새 입력이나 버튼은 해당 기능의 상태 변경/API 경로와 어댑터를 함께 연결한다. 작업 ID를 추가할 때 공유 검증·권한 매핑·서버 적용·결과 반영을 같이 확인한다.
- 지원 여부는 실제 등록된 작업이 기준이다. 페이지 제목이나 이동 경로만 제공되는 상태를 기능 전체 지원으로 세지 않는다.

사용자 흐름은 [채팅 가이드](docs/GUIDE/CHAT.md)에 기록한다. 변경한 기능별로 조회·입력·확정·결과 확인 중 어느 단계까지 연결했는지 확인하며 오래된 전체 지원 표를 별도로 늘리지 않는다.

## MCP와 화면 없는 자동화

| 변경 지점 | 코드 |
| --- | --- |
| 도구 등록과 공통 실행 경계 | [server.ts](backend/src/mcp/server.ts) |
| 호출자·계정·프로필·범위 | [context.ts](backend/src/mcp/context.ts), [toolAccess.ts](backend/src/mcp/toolAccess.ts) |
| 채팅용 도구 탐색 | [toolCatalog.ts](backend/src/mcp/toolCatalog.ts) |
| HTTP 진입과 요청 검증 | [index.ts](backend/src/mcp/index.ts), [httpAccess.ts](backend/src/mcp/httpAccess.ts), [requestSecurity.ts](backend/src/mcp/requestSecurity.ts) |
| 기능별 도구 | `backend/src/mcp/tools/` |

채팅은 필요한 도구를 `open_tools`로 탐색하고 `run_tool`로 호출하는 카탈로그와 직접 제공되는 도구를 함께 사용한다. 외부 클라이언트의 도구 노출과 채팅의 노출은 같지 않다. 새 도구는 적절한 카테고리·권한·설명·입출력 제한과 호출 후 상태 확인을 연결한다. 카탈로그를 통하더라도 기존 검증과 권한 검사를 유지한다.

HTTP MCP는 설정에서 활성화하고 키로 인증한다. 외부 노출·계정 경계는 엄격하게 유지한다. 신뢰된 내부 작업에 과거 문서의 “모든 변경마다 별도 승인·백업” 절차를 일괄 적용하지 않는다. 실제 제품의 검토 카드와 권한, 사용자가 승인한 작업 범위를 따른다. 사용법은 [MCP 가이드](docs/GUIDE/MCP_GUIDE.md)를 참고한다.

## 지식·작업 기록·평가

게시글/지식과 채팅 작업의 기존 기반을 확장한다. 별도 지식 저장소나 작업 관리 계층을 만들기 전에 아래 흐름을 확인한다.

| 책임 | 코드 |
| --- | --- |
| 게시글·버전·댓글 | [postStore.ts](backend/src/services/posts/postStore.ts), `frontend/src/features/posts/` |
| 지식 상태와 평가 저장 | [knowledgeStore.ts](backend/src/services/posts/knowledgeStore.ts), [knowledgeAssessment.ts](backend/src/services/posts/knowledgeAssessment.ts) |
| 실행 정체성·참조 버전·근거 | [knowledgeRuntime.ts](backend/src/services/posts/knowledge/knowledgeRuntime.ts), [knowledgeUseEvidence.ts](backend/src/services/posts/knowledge/knowledgeUseEvidence.ts) |
| 실제 작업 관측 | [knowledgeTaskObservations.ts](backend/src/services/posts/knowledge/knowledgeTaskObservations.ts) |
| 평가 작업·중복 방지·진행 상태 | [knowledgeEvaluation.ts](backend/src/services/posts/knowledge/knowledgeEvaluation.ts) |
| 지식 수정 제안 | [knowledgeProposals.ts](backend/src/services/posts/knowledge/knowledgeProposals.ts) |
| 채팅 단계·예산·중단·재개 | [chatTasks.ts](backend/src/services/codex-chat/chatTasks.ts), [chatTask.ts](shared/src/types/chatTask.ts) |
| 반복 작업 | [chatRoutines.ts](backend/src/services/codex-chat/chatRoutines.ts) |

실행 주체와 근거는 서버가 확인한 문맥으로 연결한다. 외부 MCP의 검증되지 않은 자기보고와 서버가 관측한 실행을 구분한다. 문서가 바뀌면 이전 버전에 대한 평가를 현재 버전의 평가처럼 사용하지 않는다. 결과·실패 원인·산출물 참조·다음 행동은 이어받을 수 있게 남기되 반복 메시지와 전체 원문을 중복 저장하지 않는다.

## 미디어 기반을 수정할 때

| 영역 | 코드 진입점 | 사용 흐름 |
| --- | --- | --- |
| 라이브러리·목록 | [ImageModel.ts](backend/src/models/ImageModel.ts), [image-list](frontend/src/features/images/components/image-list/image-list.tsx) | [라이브러리](docs/GUIDE/MEDIA_LIBRARY_BASICS.md) |
| 감시 폴더 | [fileWatcherService.ts](backend/src/services/fileWatcherService.ts) | [감시 폴더](docs/GUIDE/WATCHED_FOLDERS.md) |
| 생성 큐 | [generationQueueService.ts](backend/src/services/generationQueueService.ts), [queueJobExecutors.ts](backend/src/services/generation-queue/queueJobExecutors.ts) | [생성](docs/GUIDE/GENERATION_OVERVIEW.md) |
| 생성물 저장 | [APIImageProcessor.ts](backend/src/services/APIImageProcessor.ts), [fileSaver.ts](backend/src/utils/fileSaver.ts) | [업로드](docs/GUIDE/UPLOAD_AND_METADATA_EXTRACT.md), [메타데이터 수정](docs/GUIDE/EDIT_IMAGE_METADATA.md) |
| Codex 이미지 생성 | [codexGenerationExecutor.ts](backend/src/services/codexGenerationExecutor.ts) | [Codex 생성](docs/GUIDE/CODEX_GENERATION.md) |
| 노드 워크플로 | [graphWorkflowExecutor.ts](backend/src/services/graphWorkflowExecutor.ts), `frontend/src/features/module-graph/` | [워크플로 편집](docs/GUIDE/WORKFLOW_EDITOR.md) |
| 파일 보관함 | [fileStoreService.ts](backend/src/services/fileStoreService.ts), `frontend/src/features/files/` | [파일](docs/GUIDE/FILES.md) |
| AI 워커 | `backend/python/`, [설명](backend/python/README.md) | [설정](docs/GUIDE/SETTINGS_OVERVIEW.md) |

이미지·영상·생성물의 식별과 저장 흐름을 재사용한다. 히스토리 항목 제거, 라이브러리 등록 해제, 원본 파일 삭제는 영향이 다르므로 섞지 않는다. 임시 생성 자산은 `runtimePaths`의 런타임 영역에 두고 수명과 정리 경로를 확인한다. 오디오는 별도 저장 흐름을 가지므로 모든 생성 결과를 이미지 저장 경로에 강제로 합치지 않는다.

목록 성능은 공용 가상 목록·선택 엔진, 쿼리 범위와 인덱스, 썸네일/영상 프리뷰를 함께 확인한다. 화면별로 별도 목록 엔진을 만들지 않는다. 캐시 갱신은 [app-query-client.ts](frontend/src/lib/app-query-client.ts)와 `frontend/src/features/runtime-events/`의 이벤트 연결을 확인한다.

## 검증 선택

문서만 바꾸면 링크와 설명의 실제 코드 일치 여부를 확인하고 공개 문서는 `npm run docs:build`로 빌드한다. 애플리케이션 전체 테스트를 관성적으로 실행하지 않는다.

코드 변경에는 관련 명령을 선택한다. 최신 정의는 각 `package.json`에서 확인한다.

- 공유 계약: `npm run build:shared`, 이후 영향을 받는 backend/frontend 타입 검사.
- 타입 검사: `npm run typecheck --prefix backend`, `npm run typecheck --prefix frontend`.
- 프론트 린트: frontend 디렉터리에서 변경 파일 대상으로 `npx eslint <files>`.
- 채팅: `npm run test:chat --prefix backend` 또는 해당 기존 테스트 파일.
- 지식·게시글: `npm run test:posts-knowledge --prefix backend`.
- 권한/계정 경계: `npm run test:permissions --prefix backend`.
- 문서 검색: `npm run test:documents --prefix backend`.
- 번들·라우팅·의존성 변경: 영향을 받는 빌드.

새 도구/어댑터는 해당 사용 흐름과 오류·충돌·결과 상태를 검증한다. 타입 검사만으로 실제 모델 호출이나 화면 조작이 검증됐다고 보고하지 않는다. 외부 비용이 드는 실행은 사용자가 허용한 범위에서만 수행한다.
