# CoNAI 개발 구조와 연결 지점

그룹 이동의 `GroupMoveOptions.edit`는 단일 그룹의 동시 필드 편집을 같은 이동 트랜잭션에 포함한다(중첩 `parent_id` 불가). 편집·이동 초안 전체가 토큰에 포함되며 미리보기/취소/실패는 어느 필드도 저장하지 않는다. 원본 소속은 수동으로 승격하고 명시적 키워드만 합친다. 파일명 fallback은 유지하고 기존 무관한 대상 소속은 다시 쓰지 않는다. 일반 비충돌 이동은 소속 내용 해시/키워드 조회를 생략하며 충돌에서만 내용 스냅샷을 만든다. 조상 대상 병합과 완료 이력을 포함한 외부 참조는 원본 보존을 위해 거부한다. 선택 하위 그룹은 선택 조상과 동행하며 `moved`는 독립 선택 루트 수다.

그룹 이동은 `groupMutationService.moveCustomGroups` → `groupMoveService.executeGroupMove`를 HTTP 단건/대량·MCP·페이지 어시스턴트가 공유한다. `preview:true`는 롤백된 트랜잭션에서 최대 500개 그룹의 재귀 충돌 목록과 SHA-256 `merge_token`을 반환한다. 원본 설정 소실과 정확한 원본/대상 ID를 확인한 뒤에만 토큰으로 실행한다. 실행은 동일 행·소속·리소스를 다시 확인하며 변경 시 전체 롤백한다. 대상 설정은 보존하고 미디어 해시·리소스 키로 중복 제거한다. 외부 DB의 생성 큐/이력·채팅 프로필 참조와 키워드 충돌은 안전하게 거부한다. 기존 기능 권한과 페이지 어시스턴트 검토 카드는 유지한다.

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

### 프로필 에이전트

- `chatAgentCalls.ts`는 `chat_agent_calls`의 최초 생성, 비동기 실행·결과 게시·재시작 실패·호출방 삭제 취소·1분 청소를 담당한다. `chatAgentTools.ts`의 `call_agent`는 현재 답변의 방 소유자 권한으로 사용 가능한 다른 에이전트만 호출한다. 게시판 호출·공개 페이지·에이전트 방에서는 도구 목록과 실행 양쪽에서 거부한다. 호출 프로필의 유효 도구 grant가 비어 있으면 제공하지 않으며 allowlist도 따른다. 후보는 `ChatProfileStore.listAgents`의 경량 projection으로 조회하고 도구 설명에는 최대 20개만 넣는다. 동시 실행·비용 상한은 두지 않는다.
- 프로필 API의 `agentEnabled`(기본 false), `agentDescription`(기본 빈 문자열, 최대 300자)은 관리자 저장·공개 목록·MCP 설정 제안에서 공통 검증한다. 공유 계약은 `ChatProfileAgentSettings`, `CHAT_PROFILE_TEXT_LIMITS.agentDescription`이다. 프로필 편집기의 도구 영역에 **에이전트로 사용** 스위치와 설명 입력이 있다.
- `ChatAutomationRoomKind`의 `agent`는 호출마다 새 `agent:<callId>` 자동화 방이다. 목록의 `automation`으로 전달되며 **자동화 → 에이전트** 그룹에 표시한다. 헤더 미읽음 집계에서는 제외한다.
- 도구 입력은 `agent_profile_id`, `instruction`, 선택 `media_composite_hashes`, `on_done`(`notify` 기본값 또는 `react`); 즉시 `{callId, status:'running'}`를 반환한다. `wakeChatRoom`은 미디어와 `ChatRoutineRouting.source:'agent'`를 지원한다. 에이전트 내부 재호출과 검토 카드 도구는 제공하지 않으며 `ChatProposalStore.add`에서도 거부한다.
- 호출방에 assistant 메시지 하나를 저장한다. `speaker_profile_id`는 에이전트 ID, `routing.agent`는 `{callId, profileId, name, status:'completed'|'failed', toolsTruncated}`이다. UI는 **에이전트** 칩과 `routing.agent.name`으로 발신자를 표시한다(프로필 삭제 후에도 유지). `routing.recipients:['room']`이며 `content`/`display_content`, `tool_calls`는 기존 메시지 계약이다. `chatAutomationResults.ts`의 플러그인/로그 요약은 최대 32개/24KiB이며 잘린 경우 표시한다. 호출방에 저장하는 이력·미디어·작업 참조는 개수를 자르지 않는다. 생성 연결, 파일 변경 칩, 파일 버전의 작성자·되돌리기 연결을 결과 방/답변으로 같은 트랜잭션에서 옮긴다. 삭제 직전에도 늦게 도착한 연결을 옮기며, 호출방이 남아 있는데 완료 결과가 게시되지 않았다면 작업방 삭제를 보류한다.
- `react`는 연결된 생성 작업이 모두 종료된 후 호출방을 `ChatRoutineRouting.source:'agent_result'`로 깨운다. 이 알림은 “에이전트가 작업을 마쳤으니 유용하면 반응”하는 요청이며 호출방의 검토 카드를 금지하지 않는다. 작업방의 지시는 기존 `'agent'`이다. 바쁜 방은 다음 sweep에서 최대 60번 시도한다. 생성 작업 대기는 방의 1시간 TTL과 독립적이며, 방을 삭제해도 호출 기록과 결과방의 작업 연결로 반응을 이어간다. 결과 게시와 ID는 같은 트랜잭션으로 중복을 막는다. 시작된 반응은 재시작 후 재생하지 않는다. 실행 중 재시작은 `서버 재시작으로 중단` 실패 메시지가 된다.
- 완료·실패·취소 방은 종료 1시간 후 서비스 삭제 경로로 정리한다. 실패는 먼저 인스턴스 공용 파일함 `에이전트 작업 기록/<YYYY-MM-DD>/<이름> (#<callId>).json`에 호출/에이전트 이름·ID·시각·상태·오류, **지시 최대 500자와 답변 최대 1,000자 발췌**, 제한된 도구 상태·산출물 참조만 남긴다(전체 지시·답변·도구 원문·인수·전체 프롬프트·시스템 문맥 제외). 로그 저장/삭제 실패는 해당 항목만 다음 sweep에서 재시도한다. 남은 반응이 없으면 기록 행도 청소하며 호출방의 결과 메시지와 실패 파일은 유지한다.
- `chatSessionMemory.pendingAgentResults`는 Codex 및 재개형 Claude/Pi 세션의 다음 턴 입력에 아직 전달하지 않은 결과를 ID·이름·상태·500자 발췌로 넣는다(한 턴 20개, 남은 것은 이후 턴/방 기록으로 조회). 전달 표시는 입력 수락/세션 완료 후 기존 sent-key 저장과 함께 갱신한다. 일반 API LLM은 기존 대화 history로 결과를 읽으며, 그룹 세션도 기존 missed-message 경로를 유지한다.
- `/admin/tools`는 채팅 문맥 없이도 `call_agent`를 도구 선택기의 `read` 그룹에 정적으로 제공한다(편집기 분류이며 실행 권한을 추가하지 않음). 제한된 allowlist에서는 이 항목을 선택해야 한다.
- 새 Codex/Claude/Pi 세션은 recap으로 결과를 한 번만 읽고 별도 결과 발췌 없이 `agent-results-through:<id>`만 전진시킨다. recap에서도 에이전트의 저장된 이름을 쓴다.
- 결과 게시 트랜잭션의 `chat.message.created` 알림은 커밋 뒤에만 보낸다. 게시 실패가 만료 시각 이후 1시간까지 이어지면 실패/게시 포기로 기록하고 로그 저장과 정상 청소를 진행한다. 로그·삭제 실패의 재시도는 유지하되 게시를 다시 시도하지 않는다.
- 호출방에는 도구 레코드를 그대로 복사하며 `routing.agent.toolsTruncated`는 메시지 자체의 손실만 뜻한다(현재 false). 플러그인/로그의 `toolsTruncated`는 별도의 제한된 요약 손실 표시다. `react`의 생성 대기는 완료 시각부터 최대 30분이며, 이후에는 남은 생성 작업이 있다는 설명과 함께 호출방을 깨운다.
- 결과 게시 전과 표시 번역 후에 호출방의 직접/그룹 실행 상태를 다시 확인한다. 답변 중이면 완료 상태와 미게시 결과를 DB에 남기고 답변 종료 알림/다음 sweep에서 재시도한다. 호출별 비동기 전달을 분리하므로 한 방의 대기나 번역은 다른 호출을 막지 않는다. `react`는 결과 메시지 커밋 이후에만 실행한다.
- 결과의 모델용 `content`는 보존한다. 에이전트 답변의 `display_content`가 있으면 재사용하고, 없으면 호출방 프로필(그룹은 호출한 멤버)의 기존 `translateReply`·번역 슬롯으로 표시 언어에 맞춘다. 일반 wake 답변도 프로필에 번역 슬롯이 있으면 번역하며, 슬롯이 없는 에이전트는 자체 표시 번역을 만들지 않는다.

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
- `direct`는 파일 이름·이동과 실행 중단이다. 현재 화면 리비전을 브라우저에서 확인하고 기존 API 권한·검증으로 즉시 실행하며 초안 되돌리기는 제공하지 않는다. 확장 플러그인은 이 등급을 선언할 수 없다.
- `commit`은 그 외 저장·실행 등 확정 작업으로 검토 카드를 거친다. 제안 생성과 실제 적용을 구분한다.
- 프로필의 `maxTokens`·`contextTokens`는 모델 토큰 수 설정이므로 페이지 스키마와 데이터에 허용한다. 인증 토큰 등 비밀 필드 차단과 숫자 범위 검증은 유지하며, `profile.draft`는 초안만 채우고 `profile.save`는 검토 카드를 거친다.
- 페이지·모달·선택·리비전이 달라진 제안은 덮어쓰지 않는다. 페이지 접근과 작업 권한은 각각 확인한다.
- 새 입력이나 버튼은 해당 기능의 상태 변경/API 경로와 어댑터를 함께 연결한다. 작업 ID를 추가할 때 공유 검증·권한 매핑·서버 적용·결과 반영을 같이 확인한다.
- 네이티브 `pageAction`의 ID는 공유 권한 목록에서 도출한 타입을 사용한다. 선택 스키마는 한 종류의 값만 나열하고 빈 목록의 대상 선택 작업은 등록하지 않는다. 대화상자 열기는 `view`, 초안 입력은 `draft`, 실제 저장은 `commit`으로 분리한다.
- 즉시 편집의 되돌리기는 화면·연결·대상 ID와 적용한 값을 확인한다. React 재렌더링으로 바뀌는 편집기 객체를 대상 판정에 쓰지 않는다. 네이티브 비동기 초안은 입력을 반영하기 직전에 화면 리비전을 다시 확인하고, 배열 편집도 공용 초안 트랜잭션으로 후속 수동 변경을 보호한다.
- 반복 전달하는 페이지 요약은 필드뿐 아니라 중첩 객체 데이터도 문맥 예산 안에서 줄인다. 원본 스냅샷을 변경하지 않으며 생략한 데이터는 `read_page_data`의 정확한 키로 다시 읽는다.
- 지원 여부는 실제 등록된 작업이 기준이다. 페이지 제목이나 이동 경로만 제공되는 상태를 기능 전체 지원으로 세지 않는다.
- 전체 화면 이미지 편집기는 연 화면 위에 `image_editor` 종류로 등록한다(`frontend/src/features/image-editor/use-image-editor-chat-page.ts`). `image_editor.*`는 확장 경로를 제외한 모든 경로에서 허용되고, 저장은 `commit`으로 편집기의 `onSave` 경로를 그대로 쓰며, 닫기·버리기는 등록하지 않는다.

사용자 흐름은 [채팅 가이드](docs/GUIDE/CHAT.md)에 기록한다. 변경한 기능별로 조회·입력·확정·결과 확인 중 어느 단계까지 연결했는지 확인하며 오래된 전체 지원 표를 별도로 늘리지 않는다.

채팅 화면의 조회·선택·폴링은 `use-chat-thread-data.ts`, 메시지 표시 범위·스트리밍 스크롤·검색 결과 위치 복원은 `use-chat-transcript-window.ts`가 맡는다. 패널과 전체 페이지는 같은 훅을 사용하며 메시지 저장·실행은 기존 채팅 provider와 서버 경로를 유지한다.

채팅방 디렉터리는 `CodexChatStore`의 공용 요약 projection을 사용한다(문맥·요약 본문은 상세 조회만 읽음). `/api/codex-chat/threads`는 기존 UI의 전체 목록 배열을 유지하며 `limit`·`cursor`가 있으면 SQL 페이지와 별도 `pagination`을 반환한다. `archive`·`pinned`·`kind`·`query` 필터와 `pinned_first` 정렬도 SQL에서 적용한다. MCP `list_chat_rooms`는 기본 40개, 최대 100개와 `has_more`·`next_cursor`를 사용하며 다음 페이지는 같은 필터로 요청한다. 프로필 이름만 필요한 경로는 `ChatProfileStore.listNames`를 사용하고 전체 프로필 목록은 역할·프리셋·표시 블록 의존성을 일괄 조회한다.

프로필 저장과 MCP 설정 제안은 `chatProfiles.ts`의 공용 스칼라 검증 및 `@conai/shared`의 `CHAT_PROFILE_LIMITS`·`CHAT_PROFILE_TEXT_LIMITS`를 사용한다. 새로 입력한 초과 길이 문자열은 잘라 저장하지 않고 한국어 필드명과 한도를 알려주며 거부한다. 카드 가져오기는 편집 초안을 만들 때 공용 한도로 자르고, 부분 수정에서 전달하지 않은 기존 문자열·추가 JSON은 그대로 보존한다. 숫자 필드의 boolean, boolean 필드의 문자열, 필수 숫자의 null은 거부한다(범위 밖 숫자의 보정은 유지). 추가 파라미터 JSON은 20,000자를 넘으면 자르지 않고 거부하며, 레거시 연결·모델 쌍의 모델 행과 프로필은 함께 저장/롤백한다. 채팅 설정 카드 저장은 변경 대상 필드의 현재값과 제안 당시 값을 비교해 충돌이면 409를 반환하며, 변경과 저장 표시는 같은 트랜잭션이다. 저장 알림은 커밋 후 전달한다. 대표모델 대상·연결 종류를 바꿀 때 기존 채팅 역할과 호환되지 않으면 사용처를 알려주며 거부한다(판단 전용 TypeSafe는 허용).

`GET /api/codex-chat/lorebooks?summary=1`은 기존 목록·권한·항목 필드를 유지하되 `entries`를 제외하고 `entryCount`를 제공한다. 쿼리를 생략하면 기존 응답 그대로다. 공개 프로필·워크플로 선택 목록은 목적별 projection과 요청 범위 모델 스냅샷을 사용하며 레거시 이미지 대체 경로는 유지한다. 레거시 Codex 프로필 이전 완료는 `user.db`의 `chat_settings_migrations`에 이전 작업과 같은 트랜잭션으로 기록한다. 실패하면 한 번 경고하고 해당 프로세스에서는 재시도하지 않아 채팅 API를 막지 않으며, 재시작 때 다시 시도한다. 레거시 파일은 삭제하지 않는다.

채팅 모양은 `user.db`의 `user_preferences`에 계정별 슬롯과 채팅별 값을 분리해 저장한다. `chatAppearance.ts`는 기존 `save/chat-appearance/<account>.json`을 최초 접근 시 한 트랜잭션으로 이관하고 원본 파일을 보존한다. 이관 표시와 값이 함께 커밋되며 읽기·파싱·저장 실패는 빈 설정으로 확정하지 않는다. 이관 이후 DB가 정본이고 한 채팅 변경은 그 채팅의 행만 갱신한다.

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

일반 페이지 연결은 계정·프로필이 이미 허용한 도구와 연결 파일 접근을 유지한다. 공개 페이지와 게시판 봇 호출의 별도 제한은 유지하며 페이지 내용은 권한 부여로 취급하지 않는다. 생성 프리셋은 자유 생성만 제한하고 허용된 워크플로 조회·진단은 유지한다. 오디오 검수·메모·댓글·단건 삭제는 기존 서비스를 공유하며 도구 수정에는 조회 리비전을 요구하고 성공 시 `audio.changed`로 해당 그룹을 갱신한다.

채팅은 필요한 도구를 `open_tools`로 탐색하고 `run_tool`로 호출하는 카탈로그와 직접 제공되는 도구를 함께 사용한다. 외부 클라이언트의 도구 노출과 채팅의 노출은 같지 않다. 새 도구는 적절한 카테고리·권한·설명·입출력 제한과 호출 후 상태 확인을 연결한다. 카탈로그를 통하더라도 기존 검증과 권한 검사를 유지한다. 서버가 `tool_calls`로 바꾸지 못하고 본문에 남긴 도구 호출(Hermes JSON·Qwen XML)은 `backend/src/services/codex-chat/textToolCalls.ts`가 복구한다. 직접 API 라운드는 `llmChatService.ts`의 `streamReply`에서, pi는 `piChatCompletion.ts`의 `message_end` 확장에서 같은 함수를 쓰며, 제공된 도구와 카탈로그 도구(`run_tool` 경유)만 실행한다.

`open_tools`는 `query`로 이름·설명을 검색하고 `detail: "summary"`로 짧은 목록을 조회한다. 기본 `schema`는 정의를 자르지 않으며 `max_tokens`와 API 채팅의 남은 컨텍스트 안에서 페이지를 나눈다. 개별 정의도 들어가지 않으면 필요한 크기를 알린다. 일반 도구의 큰 JSON 결과는 `truncated`와 재조회 안내를 포함한 JSON으로 축약한다. 정밀한 파일 편집·페이지 작업은 축약된 결과를 완전한 원문으로 취급하지 않는다.

MCP 결과의 라이브러리 텍스트(프롬프트·메타데이터·자동 태그)는 호출 문맥의 허용 등급을 따른다. `chatContentRating.ts`의 `ratingRestrictedHashes`와 `hideRatingRestrictedRows`/`hideRatingRestrictedText`가 등급을 넘는 항목에 `rating_restricted: true`를 붙이고 설명 텍스트를 가린다. 저장된 점수만 보며(태거 실행 없음) 호출당 한 번 조회한다. 라이브러리 프롬프트나 태그를 반환하는 새 도구도 이 헬퍼를 사용한다. 페이지 어시스턴트 화면은 `chatPageView.ts`의 `ratingFilteredPage`가 `PAGE_MEDIA_TEXT` 표(화면 종류별 가릴 필드·데이터)를 기준으로 저장된 스냅샷을 바꾸지 않고 사본에서 가린다. 미디어 프롬프트나 태그를 보여 주는 새 페이지 어댑터는 이 표에 등록한다.

배경화면 도구(`list_wallpapers`·`set_live_wallpaper`·`save_wallpaper_schedule`)는 편집 화면과 같은 `services/wallpaperSettings.ts` 검증과 `updateAppearanceSettings` 저장을 쓰고, 변경 도구는 `toolAccess.ts`의 `ADMIN_ONLY_TOOLS`로 관리자만 실행한다. 일정 판정은 라이브 화면과 공유하는 `@conai/shared`의 `resolveScheduledWallpaperPresetId`를 사용한다. 라이브 화면은 설정을 5분 주기로 다시 읽는다. 위젯·배경 편집은 페이지 연결(`wallpaper-chat-page.ts`)이 담당한다.

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

일반 게시글 화면·페이지 어시스턴트의 이전 판 목록은 `GET /api/posts/:id/revisions?detail=summary`로 본문 없이 조회한다. 미리보기·복원은 `GET /api/posts/:id/revisions/:revision`으로 선택한 본문만 읽으며, 페이지 작업은 읽기 후 화면 리비전을 다시 확인하고 기존 `expectedRevision` 저장을 사용한다. MCP의 판 지정 조회·복원도 같은 `PostStore.revisions`의 단건 조건을 사용한다. 기존 전체 이력 API와 MCP 목록의 발췌 계약, 편집 권한 및 보존 규칙은 유지한다.

댓글은 `postCommentQueries.ts`의 `(created_at, id)` 커서로 루트 40개와 각 루트의 최근 답글 40개를 읽는다. 답글의 추가 페이지는 `parentId`·`before`, 오래된 직접 링크·편집 대상은 최대 3개 `focusIds`로 조회하고 인용 문맥을 별도로 반환한다. 숨김·계정·게시글 범위는 SQL 조회 전에 적용하며 `PostStore`의 게시글 접근 검사를 공유한다. `use-post-comments.ts`가 화면과 페이지 어시스턴트의 조회 상태를 공유하고, `posts.comments_more`·`posts.comments_at`은 조회 작업이다. MCP와 지식 참조는 필요한 최근 댓글 또는 지정 ID만 읽는다. 게시판 도구가 없는 봇의 대체 문맥도 루트와 최근 답글 40개·호출 댓글로 제한한다.

## 미디어 기반을 수정할 때

프로젝트 작업 공간의 첫 단계는 셸 없는 서버 파일 도구다. `workspaceService.ts`의 공용 실제 폴더·리비전·프로젝트 쓰기 직렬화·요청별 결과를 HTTP `workspaces.routes.ts`와 MCP `workspaceTools.ts`가 공유한다. `chatWorkspace.ts`가 명시적인 1:1 채팅 연결과 지침을 해석하며 게시판 호출은 제외한다. 도구는 프로젝트를 연결한 채팅에만 직접 제공하고, `workspace.changed` 파일 조회 권한 구독자 이벤트로 해당 프로젝트 화면을 갱신한다.

파일함·작업 공간은 인스턴스 공용이며 `files.view/edit/delete` 기능 권한은 유지한다. `fileStoreAccess.ts`의 계정 키는 실행 주체·개인 채팅 연결용이고 파일 조회 범위가 아니다. DB의 기존 `owner_key`는 생성 출처 기록으로 보존한다. 파일·검색·버전 조회는 안정된 ID로 접근하고 이름 유일성은 공용 부모 폴더 단위로 검사한다. `fileStoreSchema.ts`는 기존 이름 충돌을 ID 접미사로 해소하며, 시작 시 `fileStorePaths.ts`가 계정별 원본·버전·프로젝트 경로를 공용 경로로 이전한다. 충돌이나 링크 발견 시 시작을 중단하며 기존 자료를 덮어쓰지 않는다. `files.changed`와 `workspace.changed`는 해당 기능 권한이 있는 구독자의 캐시를 갱신한다. 계정별 파일함 선택 UI와 `/api/files/owners`는 제거했다. 이전 URL의 `owner`는 저장소 선택에 사용하지 않는다.

Codex 프로젝트 홈과 Claude·Pi 프로젝트 세션은 기존 일반 채팅 상태와 분리한다. 지침 버전이나 연결이 바뀌면 이전 도구 호출을 거부하고 다음 실행 문맥을 갱신한다. 중단 작업은 동일 호스트의 종료된 PID와 현재 PID에 남은 이전 실행을 구분한다. 다른 호스트의 잠금이나 다른 살아 있는 프로세스로 재사용된 PID는 자동 회수하지 않으며 아직 운영 복구 API가 없다. 로어북 시작 시 대조는 공용 파일의 ID로 존재를 확인하고, 로어북 관리 소유자는 별도로 유지한다. 프로젝트 도구 결과는 일반 출력 길이 축약으로 파일 내용·리비전을 잘라내지 않으며, 요청 문맥이 부족하면 기존 중단 안내 흐름을 따른다. 현재 검색은 관리 항목 100개씩·본문 앞 128KB의 제한된 조회이며 외부 디스크 변경 감시·재색인과 프로젝트 체크포인트 재개는 아직 없다. 미디어 원본은 기존 라이브러리에 남고 프로젝트 생성 연결은 후속 구현이다.

| 영역 | 코드 진입점 | 사용 흐름 |
| --- | --- | --- |
| 라이브러리·목록 | [MediaMetadataModel.ts](backend/src/models/Image/MediaMetadataModel.ts), [ImageSearchModel.ts](backend/src/models/Image/ImageSearchModel.ts), [image-list](frontend/src/features/images/components/image-list/image-list.tsx) | [라이브러리](docs/GUIDE/MEDIA_LIBRARY_BASICS.md) |
| 감시 폴더 | [fileWatcherService.ts](backend/src/services/fileWatcherService.ts) | [감시 폴더](docs/GUIDE/WATCHED_FOLDERS.md) |
| 생성 큐 | [generationQueueService.ts](backend/src/services/generationQueueService.ts), [queueJobExecutors.ts](backend/src/services/generation-queue/queueJobExecutors.ts) | [생성](docs/GUIDE/GENERATION_OVERVIEW.md) |
| 생성물 저장 | [APIImageProcessor.ts](backend/src/services/APIImageProcessor.ts), [fileSaver.ts](backend/src/utils/fileSaver.ts) | [업로드](docs/GUIDE/UPLOAD_AND_METADATA_EXTRACT.md), [메타데이터 수정](docs/GUIDE/EDIT_IMAGE_METADATA.md) |
| Codex 이미지 생성 | [codexGenerationExecutor.ts](backend/src/services/codexGenerationExecutor.ts) | [Codex 생성](docs/GUIDE/CODEX_GENERATION.md) |
| 노드 워크플로 | [graphWorkflowExecutor.ts](backend/src/services/graphWorkflowExecutor.ts), `frontend/src/features/module-graph/` | [워크플로 편집](docs/GUIDE/WORKFLOW_EDITOR.md) |
| 파일 보관함 | [fileStoreService.ts](backend/src/services/fileStoreService.ts), `frontend/src/features/files/` | [파일](docs/GUIDE/FILES.md) |
| AI 워커 | `backend/python/`, [설명](backend/python/README.md) | [설정](docs/GUIDE/SETTINGS_OVERVIEW.md) |

와일드카드 탐색과 인라인 추천은 `/api/wildcards?hierarchical=true&withItems=false`의 메타데이터·도구별 `item_counts` 트리를 공유한다. 선택 상세·편집은 `GET /api/wildcards/:id`에서 자신의 항목과 완전한 레코드의 편집 리비전을 읽는다. 미리보기의 `GET /api/wildcards/:id/items?tool=general|nai|comfyui|codex&limit=10`는 `WildcardService`의 요청별 선택 조회를 재사용해 `include_children`·`only_children`과 노드별 도구 fallback이 적용된 항목을 `limit`개까지 반환한다(기본 50, 최대 200). 두 조회 모두 기존 `wildcards.view` 권한을 유지하며, 생성·파싱과 MCP 조회 계약은 바뀌지 않는다.

이미지·영상·생성물의 식별과 저장 흐름을 재사용한다. 히스토리 항목 제거, 라이브러리 등록 해제, 원본 파일 삭제는 영향이 다르므로 섞지 않는다. 임시 생성 자산은 `runtimePaths`의 런타임 영역에 두고 수명과 정리 경로를 확인한다. 오디오는 별도 저장 흐름을 가지므로 모든 생성 결과를 이미지 저장 경로에 강제로 합치지 않는다.

목록 성능은 공용 가상 목록·선택 엔진, 쿼리 범위와 인덱스, 썸네일/영상 프리뷰를 함께 확인한다. 화면별로 별도 목록 엔진을 만들지 않는다. 캐시 갱신은 [app-query-client.ts](frontend/src/lib/app-query-client.ts)와 `frontend/src/features/runtime-events/`의 이벤트 연결을 확인한다.

정적 이미지 썸네일은 `ThumbnailGenerator`에서 출력 경로별 진행 중 작업을 공유하고 임시 파일을 완성한 뒤 이름을 바꿔 공개한다. 생성 실패는 임시 파일과 진행 상태를 정리해 재시도할 수 있고, temp 폴더 정리 뒤에도 디렉터리를 다시 만든다. 서버 폴더 썸네일도 같은 파일 상태의 요청을 합치며 디코딩 후 원본의 경로·크기·수정 시각을 다시 확인한다.

업로드 목록의 `useLocalFilePreviews`는 표시 범위 안에 남은 File 객체의 URL과 행 키를 유지하고, 범위에서 빠진 파일과 화면 종료 시에만 URL을 해제한다. 배경화면 슬라이드쇼는 전환 시간 동안만 이전 미디어를 유지하며, 이전 이미지 로딩 결과를 무시하고 그룹 변경 시 이전 배경을 비운다. 영상은 호스트 일시정지 상태를 따르며 화면에서 제거될 때 재생을 멈춘다.

이미지 상세의 픽셀 필터는 `renderPixelPreviewSample`이 화면·PNG 저장에 같은 설정과 워커·실패 시 처리를 제공한다. 화면 캔버스는 필터 샘플 해상도를 유지하고 CSS로 표시 크기를 맞추며, PNG 저장만 선택한 소스 크기로 확대한다. 취소된 로딩과 워커 요청은 종료 결과를 반환하고 임시 캔버스를 해제한다. 공용 오디오 플레이어는 현재 재생 요청의 실패만 반영하고 지연된 미디어 이벤트는 실제 재생 상태로 판단한다. 편집기를 닫을 때는 해당 편집기의 구간·편집본 미리듣기를 중단한다.

그룹 다운로드는 소속 해시를 먼저 선택한 뒤 메타데이터를 최대 500개씩 읽는다. 파일 개수 조회도 같은 배치 조회를 쓰고 원본·썸네일 존재 여부를 한 번씩 확인한다. `utils/zipArchive.ts`는 그룹과 스프라이트의 ZIP 기록을 공유하며, 항목 하나의 기록이 끝난 뒤 다음 파일·캡션을 읽는다. 그룹 ZIP은 최대 2개 생성·20개 대기로 제한하고 요청별 임시 경로를 사용한다. HTTP 연결 종료 시 생성을 취소하며 실패한 부분 ZIP과 전송이 끝난 파일은 정리한다. 이미지 이름뿐 아니라 캡션 이름도 예약해 확장자가 다른 동명 이미지나 자동 접미사와의 충돌을 막는다.

워크플로 진행 카드는 노드 시작·완료·실패 로그가 기록될 때 발행되는 `graph.execution.progress`로 `/api/graph-workflows/executions/:id/progress`를 다시 읽고, 스트림이 끊기면 3초 폴링으로 돌아간다. 실행 상태 SSE는 해당 워크플로 목록·실행 조회를 갱신한다. 플러그인 서버 상태는 `plugin.server.changed`(식별자 없음), 채팅 루틴은 `chat.routine.changed`(관리자 한정), 지식 평가 요청 상태는 `posts.changed`(kind `run`)로 갱신하고 기존 폴링은 폴백으로만 남긴다. `posts.changed`는 변경된 글의 상세 캐시와 공용 목록을 갱신한다. SSE 구독자의 미전송 버퍼가 256KB를 넘으면 연결을 닫고 기존 재연결·재생 경로로 복구한다.

`chat.task.updated`는 공용 이벤트 브리지가 작업·채팅 상세·목록을 갱신하며, 변경 전 시작된 최초 조회도 취소하고 다시 읽는다. 연결 복구 시 작업 상태를 포함해 재조회하고 한 연결의 `hello`·`reset`은 재동기화를 한 번만 요청한다. 생성 이력과 채팅 생성 이벤트는 200ms 디바운스·기존 최대 대기 시간 안에서 묶어 대상별로 갱신하며, 대기 항목이 256개에 도달하면 즉시 비운다. 화면 종료 시 남은 갱신 타이머와 대기 항목을 정리한다.

워크플로 실행 이력의 더 보기는 20개 단위 offset 조회를 이어 붙인다. 서버의 요청당 200개 제한을 전체 이력 제한으로 사용하지 않으며, 목록 갱신 중 다음 페이지 요청을 겹치지 않는다. 선택한 실행 상태의 폴링은 SSE가 살아 있으면 중지하고 연결이 끊기면 재개한다. `files.changed`의 파일함 재조회는 400ms 지연·최대 2.5초 대기로 병합한다.

`RuntimeJobRunner`는 `RuntimeJobStore.markRunning`의 원자적 `queued → running` 전환에 성공한 실행만 핸들러·로컬 취소 제어·하트비트를 시작한다. 이미 실행 중이거나 종료된 작업을 다시 실행하려는 요청은 기존 작업 행과 실행 소유권을 바꾸지 않는다.

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

Git 저장소 설치·업데이트는 `pluginSources.ts`가 담당한다. 호스트 HTTPS API(GitHub·GitLab·Gitea/Forgejo)로 ref를 커밋으로 해석하고 그 커밋의 압축 파일을 공개 주소 전용 `download`(`chatCardAssets.ts`)로 받아 플러그인 폴더를 `packagePluginAssets`·`sdkAssets`로 패키징한다. 검토는 메모리에 보관하고 적용은 `installPlugin` 하나로 실행하며, 연결은 `pluginDb()`의 `plugin_sources` 표(설치 digest와 비교해 `modified` 계산)에 둔다. 라우트는 `plugins.routes.ts`의 `/sources/*`·`/:pluginId/source`, MCP는 `check_plugin_updates`(확인만), 회귀는 `backend/test/plugin-sources.test.ts`다. 화면은 `plugin-management.tsx`와 `plugin-source-install.tsx`이며, `plugin_source.*` 페이지 작업은 한 페이지에 활성 등록이 하나뿐이라 `plugin-authoring.tsx`의 초안 목록 등록에 합쳐 제공한다. 관리 목록은 `/extensions`에도 있으므로 `plugin_author.*`·`plugin_source.*`는 `/settings`·`/extensions`에서 허용하고, `/extensions`에서는 `/settings` 전용인 `settings` 대신 `page` 종류로 등록한다.

앱 내부 제작은 `pluginAuthoring.ts`의 비실행 초안·파일 리비전·검증·패키징 서비스, `plugin-authoring.routes.ts`의 관리자 HTTP, `pluginAuthoringTools.ts`의 관리자 1:1 채팅 도구, `plugin-authoring.tsx`의 편집기를 사용한다. `shared/src/types/pluginAuthoring.ts`가 응답 계약이다. `plugin_author.*` 페이지 작업은 현재 편집기 초안·저장·설치 검토에 연결한다. 실제 적용은 검토 리비전/해시와 기존 설치 digest를 검사한 뒤 `installPlugin`으로 실행하고, ZIP 내보내기는 패키지 자산만 읽는다. `plugin.draft.changed`는 기존 SSE에서 관리자에게 초안 ID만 보내 관련 목록을 갱신한다. SDK는 백엔드 빌드의 `copy:plugin-sdk`와 portable/SEA 복사 경로로 배포한다. 중요한 경계는 `backend/test/plugin-authoring.test.ts`에서 검증하며 세부 한도와 호출 계약은 SDK 문서의 In-app authoring and distribution을 참고한다.

제작 순서·연결 선택·공용 확장 기록은 [플러그인 제작 가이드](docs/GUIDE/PLUGIN_DEVELOPMENT.md)를 따른다. 플러그인 작업으로 메인 연결을 추가·변경하면 해당 가이드의 공용 연결 목록과 SDK 계약을 같은 작업에서 갱신한다.

프로젝트 완료 자료 연결은 `workspacePublishResources.ts`의 `workspace_publish_resources`를 사용한다. `WorkspaceService.apply`의 프로젝트 쓰기 잠금 안에서 입력 리비전·원본 권한을 검사하고, 기존 이미지 그룹 관계와 `group_resources`의 오디오/문서 참조를 등록한 뒤 완료 문서와 진행 목록을 순서대로 저장한다. 그룹 등록은 멱등이며 파일 저장 실패 시 후속 목록 갱신을 실행하지 않는다. 완료 요청은 진행 목록 전체 대신 항목 ID·리비전만 받으며 서버가 문서 target과 함께 일치하는 항목 하나만 제거한다. 요청 ID는 자료와 그룹 입력까지 비교한다. `groupResources.ts`, `groups.resources.routes.ts`, `GroupLinkedResources`가 그룹의 추가 자료 조회·재생·파일함 연결을 담당하며 `list_group_resources`도 같은 조회를 사용한다. 원본 저장소와 파일 위치는 유지한다.

`shared/src/types/plugin.ts`, `backend/src/services/plugins/`, `frontend/src/features/plugins/`가 manifest·설치·실행·격리 화면을 담당한다. `/settings?section=plugins`에서 관리하고 `/extensions`에서 실행·작업을 조회한다. `/ext/<pluginId>/<pageId>`는 `kind: extension` 어시스턴트 계약을 사용한다. 설치·활성화한 플러그인은 앱 기능이며 `capabilities`·`appTools`는 호환 정보다. 서버 모듈 유무와 무관하게 현재 계정의 앱 권한을 적용하고, 페이지를 여는 데 파일 권한을 요구하지 않는다.

자산·미디어는 전역 CORS 이전의 credential-free 라우트다. iframe·MessageChannel·null origin 검증은 유지한다. 파일 선택은 초기 문맥이며 실제 파일 접근은 FileStoreService의 계정 기능 권한을 따른다. 프로젝트는 호스트가 연결하며 UI 편집 여부는 계정의 files.edit에서 정한다. `pluginInstanceAppContext`와 `pluginServerRuntime`이 서버 모듈에도 프로젝트 문맥을 전달하고, WorkspaceService의 쓰기 잠금·리비전 검사를 재사용한다. `pluginAppPolicy`는 활성 채팅처럼 없는 실행 문맥이 필요한 도구를 제외한다. 화면의 직접 앱 호출은 멱등 plugin-action 작업으로 즉시 시작한다. AI/MCP 변경과 명시적인 propose* 저장은 기존 호스트 검토를 유지한다. `server.entry`가 있으면 Node worker와 전용 저장소를 사용한다. [SDK](plugins/README.md), [사용자 가이드](docs/GUIDE/PLUGINS.md)를 참고한다.

서버 모듈의 `conai.llm`과 모든 활성 플러그인 페이지의 `api.llm`은 `pluginLlm.ts`에서 사용 가능한 프로필 조회·프로필 이미지 조회(`asset`)·단일 답변 시작·상태/본문 조회·취소를 제공한다. 이미지는 `chatProfileAssets.ts`의 기존 라이브러리·레거시·안전 설정과 이미지 조회 권한을 재사용하며, 크기가 제한된 WebP와 크롭 정보를 반환한다. `chatProfileReply.ts`의 프롬프트 구성과 기존 모델 실행 경로를 워크플로와 공유하고, `plugin-llm` 런타임 작업으로 동시 실행·취소·재시작 실패 처리를 재사용한다. `text` 호출의 프로필 로어는 인증된 요청자의 `fileOwnerKey`를 내부 `loreOwner`로 전달해 global·공용 파일 기반 로어북을 실행마다 조회한다. 개인 채팅과 채팅 로어북은 읽지 않으며 호출자가 소유자나 채팅을 지정할 수 없다. 요청 ID는 플러그인·계정에 묶으며 원본 입력은 영구 작업 인자에 저장하지 않는다. 어항 같은 개별 기능의 화면·기억·행동 규칙은 플러그인에 둔다. 실행·이미지 권한·멱등·취소 회귀는 `backend/test/plugin-server.test.ts`, 로어 범위는 `backend/test/chat-lore-context.test.ts`, 기존 프롬프트 호환성은 `backend/test/workflow-llm-nodes.test.ts`로 확인한다.

플러그인의 네이티브 HTTP 연결은 `shared/src/utils/pluginNativeApi.ts`의 기능 경로 검증과 `frontend/src/features/plugins/plugin-native-api.ts`의 호스트 fetch를 사용한다. 인증정보·외부 URL·플러그인 승인 API는 제외하고 나머지는 원래 라우트의 권한·리비전·multipart 계약을 따른다. Response body를 transferable stream으로 전달해 바이너리와 SSE를 전체 JSON으로 복사하지 않는다. `pluginArtifactMedia.ts`는 서명된 결과 ID를 계정·세션·원본 변경 검사와 함께 스트리밍 미디어로 제공한다. `pluginStorage.ts`는 plugin+account 설정에 SQLite CAS와 크기 상한을 적용한다. 변경 이벤트는 기존 탭당 SSE를 공유한다. SDK→호스트→HTTP/MCP→서버 모듈의 요청 취소와 영구 작업의 명시적 취소를 구분한다. 경로·격리·저장 충돌·미디어 회귀는 기존 plugin 테스트, 바이너리·스트림·취소 프로토콜은 `frontend/test/plugin-sdk.test.ts`에서 검증한다.

로어 원문·번역은 `BilingualLore` 계약의 `language`와 별도 `translation`(제목·키·본문·sourceHash)으로 보관한다. `loreTranslation.ts`는 기존 프로필 번역 모델을 사용하며, 정규화 시 원문 해시가 달라진 번역을 버린다. `proposeTranslatedLore`는 취소·프로필 변경·동시 로어 수정 검사 뒤 기존 제안/저장 경로를 호출한다. `chatTranslation.ts`의 `translateStructuredFields`는 선택한 JSON 문장 필드만 번역한다. 플러그인은 `translation.fields`로 이를 요청하고 원문 `result.json`과 표시용 `result.translation.json`을 구분한다. 원문 생성 후 번역 실패·시간 초과는 원문을 보존하며 권한 회수·사용자 취소는 기존 작업 계약을 따른다. 편집기 번역 API는 저장하지 않는 초안 작업이다.

공개 `plugins/`에는 SDK와 `text-editor`·`app-workbench`·`chat-instructions` 개발 예제를 둔다. 개인 플러그인과 전용 테스트·문서는 Git/Docker에서 제외한 `local-plugins/`에 보관한다. `node scripts/build-plugin.mjs --local <이름>`으로 `build-output/local-plugins/`에 개인 ZIP을 만들며, 공용 테스트는 개인 소스에 의존하지 않는다.

조사 상태·요약의 라이브 자료 경계는 `PostStore.publishedSources`의 단일 배치 조회를 사용한다. `ChatResearchExecution.validateSources`는 API 제공자 요청 직전, 네이티브 실행 시작·도구 호출·완료와 실행 중 1초마다 모든 지정 ID를 확인한다. 네이티브 내부 요청 직전의 원자적 확인은 보장하지 않는다. `finalModelRound`는 API 마지막 호출을 텍스트 전용으로 만들고 `purpose:'summary'`는 모든 엔진의 도구를 제거한다. 기존 `posts_search`의 `post_ids`(1–100, published 전용)와 페이지 한도 50은 같은 SQL을 사용하며 `revision`·`content_version`·`content_hash`를 반환한다. 플러그인은 상태 반환 전에 현재 자료로 인용/결과 접근과 변경 여부를 검사한다. 회귀는 `backend/test/plugin-server.test.ts`와 `backend/test/mcp-posts-files-tools.test.ts`에 둔다.

`mode: profile`의 선택적 `research`는 `shared/src/types/plugin.ts`의 `PluginResearchInput`/`PluginResearchResult` 계약이다. `backend/src/services/plugins/pluginLlm.ts`가 입력·엔진·권한을 확인하고 `backend/src/services/plugins/pluginProfileRun.ts`가 계정/플러그인/프로필/슬롯/활동/요청별 방과 reply registry를 연결한다. `buildChatProfileReplyMessages(useLorebooks:false)` 문맥으로 기존 `llmChatService.generateLlmGroupReply`의 API/Claude/Pi 실행기를 사용하며 Pi는 새 private session만 사용한다. Codex는 `codexChatService.runCodexResearchReply`가 기존 app-server 시작·설정 검증·알림·사용량 처리를 공유하고 `codexChatAccess`→MCP 인증에 호스트 전용 research capability를 연결한다. 임시 홈/토큰은 종료·취소 시 정리하고 셸·외부 도구·파일 변경은 열지 않는다. API 요청 1–32(기본 8), Claude/Pi 턴 1–32(기본 8), 모든 엔진 도구 1–100(기본 24), 기존 timeout 최대 600초다. `modelCalls:null`은 네이티브 내부 호출 수 미관측, `turns:null`은 API/Codex 턴 수 미관측이며 `limits`는 실제 적용 상한만 반환한다. Codex 모델/턴/출력 토큰 상한은 지원하지 않는다. MCP 범위·게시글 SQL·실제 원문 증거·jobs 멱등/취소/권한은 그대로 재사용한다. 상세는 [SDK 조사 계약](plugins/README.md#isolated-read-only-post-research), 공개 회귀는 `backend/test/plugin-server.test.ts`와 `backend/test/chat-pi-sessions.test.ts`를 참조한다.

`pluginLlm.ts`의 `mode: profile`은 `pluginProfileRun.ts` → `ensureAutomationRoom` / `wakeChatRoom` → 기존 채팅 엔진으로 실행한다. 플러그인·계정·프로필별 전용 대화에서 프로필의 도구 카탈로그·권한·생성 프리셋·검토를 재사용하며 별도 도구 실행 루프를 만들지 않는다. `profileRun`은 실제 메시지의 도구 결과를 크기 제한 안에서 반환하고, 재조회 시 `attachJobResults`로 지연 생성 결과를 갱신한다. 대화는 자동화 목록의 `plugin` 종류로 남고 SDK `navigation.openChat`으로 연다. 기존 생략/`text` 모드는 상태 없는 답변 계약을 유지한다. `plugin-server.test.ts`에서 모델 도구 호출 → 실제 파일 작업 → 모델 결과 재입력, 권한 회수·계정 격리·멱등·취소를 검증한다.

`npx tsx --test backend/test/plugins.test.ts`로 계정·세션·선택 범위, 승인 재사용·권한 회수·저장 충돌, ZIP과 opaque-origin 경계를 검증한다.

플러그인 서버의 긴 처리는 `pluginTasks.ts`의 `conai.onJob`·`conai.jobs`로 기존 `plugin-task` 런타임 작업을 사용한다. 인스턴스 동시 2개·패키지당 1개, 요청 멱등·계정 경계·권한 회수·취소·재시작 실패 처리를 공유한다. 내부 소재는 `pluginWorkspace.ts`의 공용 참조 해석을 `pluginServerMedia.ts`에서 재사용하며, 경로는 신뢰된 서버 모듈에만 전달한다. 결과 등록은 패키지 데이터 폴더의 일반 파일만 네이티브 미디어 처리로 복사한다. 개인 플러그인별 제작 화면·엔진·원본 프로젝트 형식은 `local-plugins/`에 두고 공용 호스트에는 포함하지 않는다. 관련 경계는 `backend/test/plugin-server.test.ts`로 검증한다.

## 검증 선택

문서만 바꾸면 링크와 설명의 실제 코드 일치 여부를 확인하고 공개 문서는 `npm run docs:build`로 빌드한다. 애플리케이션 전체 테스트를 관성적으로 실행하지 않는다.

코드 변경에는 관련 명령을 선택한다. 최신 정의는 각 `package.json`에서 확인한다.

- 공유 계약: `npm run build:shared`, 이후 영향을 받는 backend/frontend 타입 검사.
- 타입 검사: `npm run typecheck --prefix backend`, `npm run typecheck --prefix frontend`.
- 프론트 린트: frontend 디렉터리에서 변경 파일 대상으로 `npx eslint <files>`.
- 오디오 파형 공유·취소·계정 경계: `npm run test:audio-waveform --prefix frontend`.
- 미리보기 자원 해제·필터 워커 취소·오디오 재생 경합·배경화면 로딩 취소: `npm run test:media-previews --prefix frontend`. 썸네일 동시 생성·실패 복구는 `backend/test/media-lifecycle.test.ts`, 서버 폴더 원본 변경 검사는 `backend/test/system-folders.test.ts`.
- 그룹 ZIP 선택 범위·동시 다운로드·캡션 무결성·HTTP 취소: `npx tsx --test backend/test/group-download.test.ts`.
- 채팅: `npm run test:chat --prefix backend` 또는 해당 기존 테스트 파일.
- 지식·게시글: `npm run test:posts-knowledge --prefix backend`.
- 댓글 페이지·직접 링크·조회 중 숨김 반영: `npm run test:post-comments --prefix frontend`.
- 권한/계정 경계: `npm run test:permissions --prefix backend`.
- 문서 검색: `npm run test:documents --prefix backend`.
- 번들·라우팅·의존성 변경: 영향을 받는 빌드.

새 도구/어댑터는 해당 사용 흐름과 오류·충돌·결과 상태를 검증한다. 타입 검사만으로 실제 모델 호출이나 화면 조작이 검증됐다고 보고하지 않는다. 외부 비용이 드는 실행은 사용자가 허용한 범위에서만 수행한다.
