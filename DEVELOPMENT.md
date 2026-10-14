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

채팅 요청 최적화: API 답변은 라우팅·의미 검색·판단·컨텍스트 준비에 같은 기록을 재사용하며, 번역된 사용자 메시지만 갱신한다. 상태 블록·인용 복원에 필요한 과거 기록은 유지한다. 요약 입력은 요약 모델의 서버 컨텍스트에 맞추고, 다른 모델의 토큰 보정률을 재사용하지 않는다. 현재 요청이 들어갈 수 있으면 진행 중인 선행 요약을 기다리지 않으며, 그룹 선행 요약도 낮은 요청 우선순위를 쓴다. 세션 엔진 전체 실행에는 외부 재시도를 걸지 않는다.

API 연결의 일시적 장애 재시도와 출력 이후 재전송 금지는 `streamChatCompletion`에서 공유한다. 답변 경로는 이미 표시한 출력과 일회성 반응의 추가 제한만 전달한다. 오류로 스트림 읽기를 끝내면 요청과 reader를 닫은 뒤 연결 슬롯을 반환한다. 입력 번역은 답변·방 실행의 취소 신호와 잠금을 공유한다. pi의 생성 설정은 `buildOpenAiGenerationFields`를 사용하고, 압축 및 실패 전에 완료한 호출의 사용량도 공통 원장에 전달한다. 워크플로 입력·JSON 처리만 `llmProviderService`에 남기며 별도 HTTP 실행 경로는 두지 않는다.

`llmUsage.ts`의 서버 실행 문맥은 자동 작업 ID와 답변 ID를 보조 모델 호출에 전달한다. API 요청은 라운드·큐 대기·첫 출력 시간도 기록하고, 계기판과 페이지 연결에서 집계를 읽는다. 세션 엔진 내부 라운드와 관측하지 못한 시간은 비워 둔다. 선택적 작업 토큰 예산은 기록된 입력·출력 합계를 다음 자동 턴 전에 검사한다. 작업 누계는 사용량 원장과 같은 트랜잭션으로 갱신해 원장의 보존 기간과 별개로 유지하며, 재개로 초기화하지 않는다. 서버가 사용량을 보고하지 않는 호출과 진행 중인 호출 때문에 과금의 엄격한 상한으로 사용하지 않는다.

## MCP와 화면 없는 자동화

| 변경 지점 | 코드 |
| --- | --- |
| 도구 등록과 공통 실행 경계 | [server.ts](backend/src/mcp/server.ts) |
| 호출자·계정·프로필·범위 | [context.ts](backend/src/mcp/context.ts), [toolAccess.ts](backend/src/mcp/toolAccess.ts) |
| 채팅용 도구 탐색 | [toolCatalog.ts](backend/src/mcp/toolCatalog.ts) |
| HTTP 진입과 요청 검증 | [index.ts](backend/src/mcp/index.ts), [httpAccess.ts](backend/src/mcp/httpAccess.ts), [requestSecurity.ts](backend/src/mcp/requestSecurity.ts) |
| 기능별 도구 | `backend/src/mcp/tools/` |

채팅은 필요한 도구를 `open_tools`로 탐색하고 `run_tool`로 호출하는 카탈로그와 직접 제공되는 도구를 함께 사용한다. 외부 클라이언트의 도구 노출과 채팅의 노출은 같지 않다. 새 도구는 적절한 카테고리·권한·설명·입출력 제한과 호출 후 상태 확인을 연결한다. 카탈로그를 통하더라도 기존 검증과 권한 검사를 유지한다.

`open_tools`는 `query`로 이름·설명을 검색하고 `detail: "summary"`로 짧은 목록을 조회한다. 기본 `schema`는 정의를 자르지 않으며 `max_tokens`와 API 채팅의 남은 컨텍스트 안에서 페이지를 나눈다. 개별 정의도 들어가지 않으면 필요한 크기를 알린다. 일반 도구의 큰 JSON 결과는 `truncated`와 재조회 안내를 포함한 JSON으로 축약한다. 정밀한 파일 편집·페이지 작업은 축약된 결과를 완전한 원문으로 취급하지 않는다.

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

프로젝트 작업 공간의 첫 단계는 셸 없는 서버 파일 도구다. `workspaceService.ts`의 공용 실제 폴더·리비전·프로젝트 쓰기 직렬화·요청별 결과를 HTTP `workspaces.routes.ts`와 MCP `workspaceTools.ts`가 공유한다. `chatWorkspace.ts`가 명시적인 1:1 채팅 연결과 지침을 해석하며 게시판 호출은 제외한다. 도구는 프로젝트를 연결한 채팅에만 직접 제공하고, `workspace.changed` 파일 조회 권한 구독자 이벤트로 해당 프로젝트 화면을 갱신한다.

파일함·작업 공간은 인스턴스 공용이며 `files.view/edit/delete` 기능 권한은 유지한다. `fileStoreAccess.ts`의 계정 키는 실행 주체·개인 채팅 연결용이고 파일 조회 범위가 아니다. DB의 기존 `owner_key`는 생성 출처 기록으로 보존한다. 파일·검색·버전 조회는 안정된 ID로 접근하고 이름 유일성은 공용 부모 폴더 단위로 검사한다. `fileStoreSchema.ts`는 기존 이름 충돌을 ID 접미사로 해소하며, 시작 시 `fileStorePaths.ts`가 계정별 원본·버전·프로젝트 경로를 공용 경로로 이전한다. 충돌이나 링크 발견 시 시작을 중단하며 기존 자료를 덮어쓰지 않는다. `files.changed`와 `workspace.changed`는 해당 기능 권한이 있는 구독자의 캐시를 갱신한다. 계정별 파일함 선택 UI와 `/api/files/owners`는 제거했다. 이전 URL의 `owner`는 저장소 선택에 사용하지 않는다.

Codex 프로젝트 홈과 Claude·Pi 프로젝트 세션은 기존 일반 채팅 상태와 분리한다. 지침 버전이나 연결이 바뀌면 이전 도구 호출을 거부하고 다음 실행 문맥을 갱신한다. 중단 작업은 동일 호스트의 종료된 PID와 현재 PID에 남은 이전 실행을 구분한다. 다른 호스트의 잠금이나 다른 살아 있는 프로세스로 재사용된 PID는 자동 회수하지 않으며 아직 운영 복구 API가 없다. 로어북 시작 시 대조는 공용 파일의 ID로 존재를 확인하고, 로어북 관리 소유자는 별도로 유지한다. 프로젝트 도구 결과는 일반 출력 길이 축약으로 파일 내용·리비전을 잘라내지 않으며, 요청 문맥이 부족하면 기존 중단 안내 흐름을 따른다. 현재 검색은 관리 항목 100개씩·본문 앞 128KB의 제한된 조회이며 외부 디스크 변경 감시·재색인과 프로젝트 체크포인트 재개는 아직 없다. 미디어 원본은 기존 라이브러리에 남고 프로젝트 생성 연결은 후속 구현이다.

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

워크플로 진행 카드는 `/api/graph-workflows/executions/:id/progress`의 노드 이벤트만 폴링하고, 실행 상태 SSE는 해당 워크플로 목록·실행 조회를 갱신한다. `posts.changed`는 변경된 글의 상세 캐시와 공용 목록을 갱신한다. SSE 구독자의 미전송 버퍼가 256KB를 넘으면 연결을 닫고 기존 재연결·재생 경로로 복구한다.

큐 상태 이벤트의 `audio_scopes`는 실제 오디오 주문·결과가 속한 그룹과 프로젝트만 지정한다. 빈 배열은 오디오 갱신을 생략하며, 일반 ComfyUI 작업의 오디오 결과도 포함한다. 오디오 전체 검색은 `/api/audio/groups` 한 번으로 조회하고 `list_audio_groups`의 `project_id` 생략도 같은 서비스를 사용한다. SQL 검색은 기존 JavaScript의 유니코드 소문자·부분 문자열 비교를 유지한다. 주문 목록은 작업·큐 상태·결과를 목록 단위로 읽으며, 상태가 달라진 작업만 캐시에 기록한다.

워크플로 범위 삭제는 최종 결과와 산출물을 각각 500개씩 읽어 대상 ID를 확정한 뒤 삭제한다. 재사용된 최종 결과와 실행 중인 작업의 보호 규칙은 유지한다. 빈 실행 정리는 결과 본문 대신 개수를 조회한다. `imageSimilarity.ts`의 두 복합 해시 진입점은 같은 버퍼 계산 함수를 사용하며, 리사이즈·샘플링·해시 연결 순서를 바꾸지 않는다.

지식 순위 계산은 후보 본문을 200개씩 읽고 별칭·태그·유효한 평가 집계를 묶어 조회한다. 벡터 검색은 DB 행을 순회해 행렬에 적재하며, 대상 제한에는 소스별 슬롯을, 결과 수 제한에는 top-K 선택을 쓴다. 캐시는 최대 16개 공간·모델과 행렬 합계 256MB 안에서 유지한다. 공간 하나가 상한을 넘으면 소유자·소스 범위를 SQL에 적용한 DB 순회로 검색하며, 동점은 소스 키와 청크 순으로 정한다. SQLite의 `vector_db.data_version`으로 다른 연결의 변경도 감지해 MCP stdio와 웹 서버의 검색 캐시를 갱신한다. ComfyUI 썸네일의 모델 목록은 서버·폴더별로 30초간 재사용한다.

임베딩의 텍스트·이미지·토큰 분할은 같은 활성 상태·런타임·취소·실패 검사 경로를 사용한다. 단일·다중 질의는 최대 128개 질의 캐시와 진행 중 배치를 공유하며, 마지막 소비자가 취소하면 요청을 취소한다. 차가운 모델의 대기 시간 초과는 다음 검색을 위해 모델을 올려 두되 설정 변경은 이전 요청을 무효화한다. 백그라운드와 즉시 색인은 같은 소스·내용의 작업을 공유하고 저장 직전에 원본과 버전을 확인한다. 삭제된 텍스트·이미지·화풍 벡터 정리는 임베딩을 꺼도 계속하며, 일시적 이미지 배치 실패는 탐색 위치를 되돌려 다음에 재시도한다.

파일 편집은 내용과 리비전을 함께 읽고 `expectedRevision`으로 저장 충돌을 검사한다. 폴더 트리 삭제는 참조 검사·삭제 표시를 한 트랜잭션에서 처리한 뒤 물리 삭제를 32개씩 나누며, 남은 삭제 표시는 재시작 후 정리한다. 오디오 내보내기는 렌더링뿐 아니라 ZIP 기록 단계에도 취소 신호를 전달하고 핸들을 닫은 뒤 임시 파일을 정리한다.

프로젝트 본문 검색은 `(project_id, target)` 색인으로 후보를 정렬하고 최대 4개 파일씩 읽으며 원래 결과 순서와 페이지 경계를 유지한다. 실패·취소 시 시작한 읽기 묶음의 종료를 기다린다. 본문 일치 결과의 발췌문과 실제 리비전은 전체 재읽기 없이 정확한 부분 편집에 사용할 수 있으며, 이름 일치만으로 리비전을 만들지 않는다.

오디오 생성 탭과 주문 결과는 `audioGenerationOutputs.ts`의 공용 저장 루프를 사용하며 대상·이름·출처와 실패 정책은 호출부가 정한다. 목록과 편집기는 계정·권한·파일 해시·조회 URL별 파형 로딩을 공유하고, 최대 두 파일만 디코딩한다. 캐시에는 원본 버퍼 대신 파형과 길이만 최대 400개 보관하며, 모든 소비자가 취소하면 남은 로딩도 취소한다. 오디오와 스프라이트의 미디어 프로세스는 `utils/mediaProcess.ts`를 공유한다. 실행 파일을 시작하지 못할 때만 시스템 바이너리로 재시도하며 취소·시간 제한·처리 오류는 다시 실행하지 않는다.

스프라이트의 프레임 선택과 256장 제한은 `shared/src/utils/spriteSampling.ts`가 화면과 서버에 같은 계산을 제공한다. 제한은 중복 프레임 제거 전에 적용한다. 대기 작업을 취소해도 앞 작업이 끝나기 전에는 다음 작업이 진입하지 않는다. 영상 정보는 파일 상태가 같을 때 5분·최대 64개까지 재사용하고 워커에 전달한다. 추출 시 메타데이터를 포함한 시트를 한 번 만들며, 같은 출력 설정의 저장·미리보기는 그 파일을 재사용한다.

정규화는 16개 이하의 전체 성공 정책과 대량 처리의 개별 실패 정책을 유지한다. 대량 그룹 처리는 공통 경계만 남겨 둔 뒤 시트를 다시 읽고, 각 결과를 파일에 기록해 원시 이미지가 목록에 쌓이지 않게 한다. 시트 ZIP도 파일을 지연 읽기하며, 취소나 파일 누락은 다운로드 가능한 부분 ZIP으로 처리하지 않는다. 파일함과 서버 폴더는 `file-preview-shared.tsx`의 아이콘·미디어 표시·이동 UI 및 `renderPreviewWebp`를 공유하되 소유권, 읽기 범위, 편집·버전·복원 권한은 기존 경로에서 검사한다.

스프라이트 워커 진입점은 추출·정규화뿐 아니라 재렌더·프레임 ZIP·프레임 미리보기·이미지 크기 변경에도 한 실행 슬롯과 최대 200개 대기를 적용한다. 대기 중 취소한 요청은 실행하지 않으며 사용 중인 작업 폴더는 정리에서 보호한다. 미리보기의 프레임 읽기는 비동기이고 프레임 ZIP은 인코딩 결과를 임시 파일로 기록해 이미지를 모두 메모리에 쌓지 않는다. HTTP 다운로드는 파일 오류와 연결 종료를 처리하고, 요청용 파일은 전송이 끝난 뒤 정리한다.

정규화의 라이브러리 저장은 항목 사이에서 취소를 확인하며 완료한 저장은 유지한다. 64KB를 넘는 정규화 결과는 `runtimeJobResults.ts`가 `artifacts/runtime-job-results/`의 비공개 파일로 최대 8MB까지 보존한다. 작업 DB·목록·진행 이벤트에는 작은 참조만 남기고, 소유권을 확인한 단일 작업 조회와 MCP 결과 조회가 전체 결과를 읽는다. 파일은 작업 보존 기간(24시간)에 맞춰 정리하며 스프라이트 작업 폴더의 1시간 만료와 분리한다.

오디오 편집의 요청 키 충돌은 초기 조회와 동시 저장의 DB 충돌 경로 모두에서 편집 옵션을 비교한다. 편집 미리듣기는 편집창 종료 시 요청과 서버 렌더를 취소하고 오래된 응답의 재생을 차단한다. 파일함의 텍스트 이어 읽기는 처음 조회한 리비전을 전달하며 변경 충돌이면 처음부터 다시 읽는다.

## 페이지 설정 연결

페이지별 공용 설정 항목·필드 허용 목록·권한·경로 매핑은 `shared/src/constants/pageSettings.ts`가 정의한다. 앱 셸의 `PageSettingsProvider`와 상단 `PageSettingsButton`은 현재 페이지에 맞는 모달을 열며, `page-settings-dialog.tsx`는 필요한 항목만 조회하고 변경 필드만 저장한다. 오디오의 작업 설정 등 기존 기능 모달은 별도로 유지한다.

`/api/page-settings/:scope`는 명시적 설정 권한과 `If-Match`를 요구한다. 일반·미디어·분석·외형은 기존 설정 라우터를 재사용하되 허용된 필드만 입력·응답에 통과시킨다. 비동기 의존성 검사 뒤에도 실제 저장 직전에 권한과 버전을 재확인한다. 네이티브 설정 응답의 `pageSettingsRevisions`는 전송용 정보이며 저장 파일에 쓰지 않는다. 중앙 설정 편집기도 초안 시작 시 버전을 유지해 같은 공용 항목의 오래된 저장을 막는다.

어시스턴트의 `page.settings_open`은 조회 작업, `page_settings.save`는 검토 카드 작업이다. `page_settings` 스냅샷은 원래 페이지 경로와 허용된 설정 범위에 결합되며, 기존 관리자용 `settings.*` 작업을 다른 경로에 개방하지 않는다. 미저장 변경은 `UnsavedSettingsGuardProvider`가 페이지·모달을 합쳐 하나의 라우터 차단기로 보호한다.

## 선택 설치 확장

`shared/src/types/plugin.ts`, `backend/src/services/plugins/`, `frontend/src/features/plugins/`가 manifest, 설치·권한·승인, 격리 화면을 담당한다. `/settings?section=plugins`에서 앱 전체 플러그인을 관리한다. `/extensions`는 별도 실행·작업 화면이며 `/ext/<pluginId>/<pageId>`는 `kind: 'extension'` 페이지 계약으로 기존 어시스턴트에 연결한다. 서버는 설치 manifest와 작업 스키마를 대조한다. 플러그인 콜백의 등급은 view/draft만 허용하고, 실제 파일 쓰기는 호스트 검토 카드와 서버 승인·리비전 검사로 수행한다.

자산·미디어 라우트는 전역 CORS 이전의 credential-free 종단 라우트다. 일반 호스트 API의 null origin 거부와 Wallpaper Engine 예외를 합치지 않는다. 공용 파일함에서 명시적으로 선택한 자료는 FileStoreService로 제공한다. `pluginWorkspace.ts`는 호스트에서 연결한 프로젝트의 목록·읽기·검토 저장과 미디어 참조를 제공하며 WorkspaceService의 쓰기 잠금·리비전·멱등 처리를 재사용한다. 연결·승인은 요청 계정과 세션에 묶고 미디어 원본을 프로젝트에 자동 복제하지 않는다. `pluginMediaProcessing.ts`는 호스트 승인 후 제한된 crop/audio 처리만 기존 런타임 작업·라이브러리/오디오 저장으로 연결한다. 서버 모듈 없는 플러그인은 임의 서버 코드를 실행하지 않는다. `workspace.proposeChanges`는 공통 쓰기 잠금과 리비전으로 파일·폴더 이동을 처리하며 부분 실패 내역을 보존한다. `pluginAppActions.ts`와 `pluginAppBridge.ts`는 manifest의 appTools/serverActions를 기존 MCP 네이티브 서비스로 연결한다. 기능 권한·프로젝트 연결·키 범위를 교차 검사하며 변경은 호스트 검토와 plugin-action 작업으로 실행한다. MCP list_plugin_pages/run_plugin_action/get_plugin_action/cancel_plugin_action과 페이지 serverActions는 같은 계약을 공유한다. 명시적으로 server 기능을 선언하고 관리자가 활성화한 신뢰된 패키지는 pluginServerRuntime.ts의 Node worker와 전용 저장소를 사용한다. 설치하지 않은 개별 도구는 기본 번들에 포함하지 않는다. [개발 계약과 SDK](plugins/README.md), [사용자 가이드](docs/GUIDE/PLUGINS.md)를 참고한다.

신뢰된 서버 플러그인의 `conai.llm`과 페이지의 `api.llm`은 `pluginLlm.ts`에서 사용 가능한 프로필 조회·단일 답변 시작·상태/본문 조회·취소를 제공한다. `chatProfileReply.ts`의 프롬프트 구성과 기존 모델 실행 경로를 워크플로와 공유하고, `plugin-llm` 런타임 작업으로 동시 실행·취소·재시작 실패 처리를 재사용한다. 요청 ID는 플러그인·계정에 묶으며 원본 입력은 영구 작업 인자에 저장하지 않는다. 어항 같은 개별 기능의 화면·기억·행동 규칙은 플러그인에 둔다. 실행 권한·멱등·취소 회귀는 `backend/test/plugin-server.test.ts`, 기존 프롬프트 호환성은 `backend/test/workflow-llm-nodes.test.ts`로 확인한다.

공개 `plugins/`에는 SDK와 `text-editor`·`app-workbench`·`chat-instructions` 개발 예제를 둔다. 개인 플러그인과 전용 테스트·문서는 Git/Docker에서 제외한 `local-plugins/`에 보관한다. `node scripts/build-plugin.mjs --local <이름>`으로 `build-output/local-plugins/`에 개인 ZIP을 만들며, 공용 테스트는 개인 소스에 의존하지 않는다.

`npx tsx --test backend/test/plugins.test.ts`로 계정·세션·선택 범위, 승인 재사용·권한 회수·저장 충돌, ZIP과 opaque-origin 경계를 검증한다.

## 검증 선택

문서만 바꾸면 링크와 설명의 실제 코드 일치 여부를 확인하고 공개 문서는 `npm run docs:build`로 빌드한다. 애플리케이션 전체 테스트를 관성적으로 실행하지 않는다.

코드 변경에는 관련 명령을 선택한다. 최신 정의는 각 `package.json`에서 확인한다.

- 공유 계약: `npm run build:shared`, 이후 영향을 받는 backend/frontend 타입 검사.
- 타입 검사: `npm run typecheck --prefix backend`, `npm run typecheck --prefix frontend`.
- 프론트 린트: frontend 디렉터리에서 변경 파일 대상으로 `npx eslint <files>`.
- 오디오 파형 공유·취소·계정 경계: `npm run test:audio-waveform --prefix frontend`.
- 채팅: `npm run test:chat --prefix backend` 또는 해당 기존 테스트 파일.
- 지식·게시글: `npm run test:posts-knowledge --prefix backend`.
- 권한/계정 경계: `npm run test:permissions --prefix backend`.
- 문서 검색: `npm run test:documents --prefix backend`.
- 번들·라우팅·의존성 변경: 영향을 받는 빌드.

새 도구/어댑터는 해당 사용 흐름과 오류·충돌·결과 상태를 검증한다. 타입 검사만으로 실제 모델 호출이나 화면 조작이 검증됐다고 보고하지 않는다. 외부 비용이 드는 실행은 사용자가 허용한 범위에서만 수행한다.
