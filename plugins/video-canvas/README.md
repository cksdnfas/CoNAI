# 영상 캔버스 — video-canvas

공식 번들 플러그인이야. 앱의 기존 라이브러리 이미지/영상, 오디오 후보, RefMod 번들을 노드로 가져와 컷의 타입 입력 슬롯에 연결해. 소재나 생성 엔진을 새로 만들지 않아.

## 준비

1. 설정에서 공식 **영상 캔버스**를 켜.
2. ComfyUI 탭에 DaSiWa MiniMax-H3 Director 워크플로를 등록해. Director 노드(`minimax_h3_director_dasiwa`)와 숫자 시드를 Marked Field로 열어줘.
3. 캔버스 프로젝트를 만들고 **생성 프로필**에 워크플로·Director 필드·시드 필드를 연결해. 저장할 때 `get_workflow_details`로 검사해. 서버와 서버 태그는 등록된 ComfyUI 서버 목록에서 둘 중 하나를 고르고, Director overrides에는 해상도·후처리 등만 넣어.

서버 모듈·`app.fetch`·`events`·이미지 launch를 지원하는 현재 호스트와 패키지에 동봉된 SDK가 필요해. 공식 패키지는 앱 시작 때 꺼진 채 설치되고 앱 업데이트로 제자리 갱신돼. `conai.db`에 계정별 프로젝트를 보관하고 additive 테이블 초기화로 기존 데이터를 유지해. ZIP/Git 덮어쓰기·제거는 공식 패키지에 허용되지 않아.

## 흐름

- 라이브러리 이미지/영상은 호스트 미디어 선택 창(`api.pickMedia`)으로 여러 개를 골라 라이브러리 이름 그대로 가져와. `pickMedia`가 없는 호스트에서는 썸네일 목록에서 하나씩 골라. 오디오는 그룹→후보(이름·길이·재생), 레퍼런스 번들은 이름·구성·설명 목록에서 골라. 해시는 입력하거나 이름으로 보여주지 않아.
- 소재 가져오기 → 컷 만들기 → 포트에서 슬롯 행으로 끌거나 **슬롯에 넣기** → 슬롯 순서/연결 속성 편집 → `@이름` 프롬프트 → 전체 체크 → 생성/제안 → 사람 검수 → 프레임 추출.
- 모드: T2VA(없음), I2VA(시작 slot 0), FL2VA(시작 0+끝 1), L2VA(끝 1), REF2VA(이미지 9/영상 3/오디오 3/합계 12 + RefMod 슬롯 1–8). 모드를 바꿔도 미사용 연결은 보존·흐림 처리하고 생성에서 제외해.
- 영상/오디오 구간 2–15초, 종류별 합계 15초. 영상에 포함된 오디오는 앱 화면 스트림 기준을 추가 경고로 보여줘. 호스트 검증이 최종이야. 연결 props에 trim_start/trim_end, media_mode, audioSlot, 번들 slot/strength/description을 둬. 연결을 빼거나 소재를 지우면 순서를 다시 매기고 Director slot은 종류 안 순위, order는 전체 순위로 보내. 시작·끝 프레임에는 미사용 참조 경고를 띄우지 않아.
- `@이름`은 이미지→영상→오디오, 각 종류 slot→order 순서로 라벨을 매겨. 영상+소리는 영상/오디오 라벨을 함께 보여줘. 번들은 지정 슬롯 번호를 유지해. 공백 있는 이름도 쓸 수 있고 이름 뒤에는 공백이나 문장부호를 넣어줘. 중복·모르는 이름·미연결 이름은 오류, 미사용 연결은 경고야.
- 간단 프롬프트·사운드·음악·원문 칸을 제공해. 원문이 있으면 간단 프롬프트 대신 보내. 구조화 빌더 UI는 없어.
- 시드는 플러그인이 뽑아 보관하고 항상 숫자 seed 필드로 보내. 같은 시드/다른 프로필, 새 시드, take 입력 그대로/현재 입력 다시 생성을 구분해. 결과 유사도는 예측하지 않아.
- take는 해석된 프롬프트·라벨/슬롯·시드·프로필·job/history/result hash·검수·프로필 overrides 적용 전 Director 입력을 남겨. 다른 프로필로 다시 돌리면 새 overrides만 적용해. 프레임 레이트는 컷/프로필에서 지정하지 않으면 등록한 워크플로의 값을 유지해. 클릭마다 requestId를 만들고 버튼을 잠그되, 사람의 버튼 클릭은 대기 중인 필드 편집이 끝난 뒤 실행을 시작할 때 revision과 제안 digest를 읽어. 프롬프트·시드·길이를 바꾸고 바로 생성/제안을 눌러도 방금 편집한 값을 써. 반대로 어시스턴트가 expected_revision을 보냈다면 그 값을 그대로 검사하고, 조회 뒤 사람의 편집이 있었으면 409로 거절해. take 재실행도 같아. 서버가 재시도와 같은 컷/입력의 진행 중 제출을 중복 제거해. 생성 멱등 키는 전역 UUID `video-canvas-<take UUID>`야. 제출 오류 뒤 **같은 요청 재시도**는 같은 키/입력을 써.
- `generation.finished`는 이력 ID만 반영하고 후처리 중 해시는 채택하지 않아. `history.record.status`/상태 갱신에서 `get_generation_job`과 이력을 조회하고 준비된 `actual_composite_hash ?? composite_hash`를 써.
- 라이브러리 영상·준비된 take의 프레임을 PNG/WebP로 뽑아 frame 노드와 선택한 start/end/ref_image 연결을 만들어. 추출은 진행률과 결과 해시를 게시하며, 취소 가능한 네이티브 대기로 기다려. 대화상자를 닫으면 대기 요청만 멈추고 추출 작업은 남아. 작업 자체를 멈추려면 **작업 취소**를 눌러줘. 연결 실패는 프레임마다 누적해서 보여줘. 호스트 오류는 그대로 보여주고 원본 파일 읽기 오류에는 서버 경로를 넣지 않아. 재생 위치는 한 프레임 어긋날 수 있어 정확한 추출은 프레임 번호를 써.
- 이미지 상세에서 열기는 자동으로 가져오지 않아. 프로젝트/새 노드/컷 슬롯을 선택한 뒤 `?image=`를 지워. 가져온 노드 이름은 원본 파일 이름이야. 영상 launch는 호스트에 없어.

자동 체크와 사람 검수는 별개야. 삭제/소재 없음/권한/필수 슬롯/한도/토큰 오류만 막고, 변경된 지문/미사용 참조는 경고야. 지문 갱신은 사람이 선택해. 검수는 사람이 화면에서 대기/통과/다시와 메모로 기록해. 어시스턴트 자기보고는 검수로 저장하지 않아.

## 어시스턴트와 저장 계약

`domain.mjs`는 DOM 없는 연산·슬롯·체크·프롬프트·Director 변환, `assistant-state.mjs`는 게시 결과와 페이지 처리, `store.mjs`/`server.mjs`는 계정별 SQLite CAS와 네이티브 연결이야. UI `api.server`, 페이지 작업과 headless 도구가 같은 서비스를 호출해. revision은 캔버스 편집에만 증가하고 take/추출 진행률·자동 체크는 별도 상태에 저장해. 추출 결과의 노드/연결 추가는 실제 편집이라 revision이 증가해. jobId 인덱스로 완료 훅의 take를 찾아 다른 계정의 프로젝트 JSON을 훑지 않아. 초기화는 additive CREATE IF NOT EXISTS만 사용해.

편집 `expected_revision` + `ops`: add_node{kind,ref,at,tempId}, connect{from,to,port,position,props}, disconnect{id}, reorder{cut,port,order:[edgeId]}, set{id,fields}, move{id,x,y}, remove{id}, import_image/video/audio/bundle/launch, review{id,status,memo}. 실패한 연산은 원상태로 두고 나머지를 적용해 `{revision,applied,rejected,tempIds}`를 돌려줘. 페이지 edit은 이 결과를 먼저 게시하고 거절된 연산이 있으면 한국어 오류를 던져. tempId는 같은 배치 안에서만 유효해. set은 이름 또는 컷 mode/prompt/soundscape/music/raw/seed/duration/frame_rate/profileId, 연결 props만 허용해. 어시스턴트 편집만 프로젝트당 최신 한 배치를 기록해. 뒤에 편집이 없으면 undo할 수 있고, job 상태 갱신은 undo를 무효화하지 않아. 생성 이력/외부 job은 undo하지 않아.

페이지 작업의 반환값은 호스트가 버리므로 **결과는 snapshot.data에 게시해**. `projects`는 프로젝트 ID·이름·노드 수 목록이고 프로젝트를 연 상태에서도 항상 있어. 이 목록으로 프로젝트를 고를 수 있어 headless 도구가 없어도 돼. `lastRead`는 노드/연결 페이지, `lastNode`는 선택/조회 노드·서버 작성 preview·입력 digest·연결/take 페이지, `lastEdit`는 적용/거절과 tempId→ID, `lastRun`은 take ID·시드·해석된 프롬프트·라벨 표·체크, `lastCheck`는 자동 체크, `lastExtraction`/`pendingExtractions`는 추출 ID·진행률·상태·결과 해시야. 루트에는 선택/revision/대기 launch를 둬. 네이티브 URL·서버 경로·비밀값이나 전체 프로젝트를 게시하지 않아.

게시된 lastEdit의 tempIds는 `[{tempId,id}]` 배열이고 applied/rejected의 op는 JSON 문자열이야. 프로필은 선언된 필드만 저장하고, 노드/take 조회·lastRun·lastEdit.profiles에 게시하는 overrides는 JSON 문자열로 바꿔. 실제 저장·생성에는 원래 객체를 써서 `prompt_enhancer_token_limit` 같은 워크플로 설정도 그대로 유지해. 일반 객체도 크기뿐 아니라 `shared/src/utils/chatPageAction.ts`의 보호 키 규칙과 예외를 검사하고, 안전하지 않으면 결과를 JSON 문자열 조각으로 게시해. 패키지 경계의 검사는 실제 호스트 검증기와 대조하는 회귀로 확인해. 사용자가 정한 키 때문에 전체 스냅샷이 거절되지 않으며, headless 편집 응답의 원래 tempIds 맵/연산 객체는 바뀌지 않아.

각 결과는 `{summary,data,nextCursor}` 또는 큰 결과의 `{summary,json,encoding:'json-string',cursor,nextCursor}`야. 실제 호스트 경계(스냅샷 JSON 200,000자, 컬렉션 512개, 깊이 20)에 맞춰 페이지를 나누고 내용을 잘라 버리지 않아. `read{section:'lastNode',cursor:nextCursor}`처럼 같은 결과의 다음 조각을 읽어. projects도 같은 방식으로 이어 읽어. 조각은 `JSON.parse(json)`로 풀어 이어 붙인 뒤 전체 JSON을 해석하면 돼. 잘못되거나 범위를 벗어난 결과 커서는 첫 페이지로 되돌리고 이후 게시를 막지 않아. 캔버스 자체는 read의 cursor/edge_cursor, 노드 연결·이력은 read_node의 edge_cursor/take_cursor로 이어 읽어.

headless 도구:

| 도구 접미사 (`p_video_canvas_`) | 사용 |
| --- | --- |
| list_projects | 프로젝트 40개씩, offset |
| read_canvas | ID/종류/연결/revision 페이지; cursor/edge_cursor, node_id는 상세와 edge_cursor/take_cursor |
| apply_ops | 프로젝트+revision+ops; create_name은 프로젝트 생성, profile은 검증/저장, undo는 마지막 배치 취소 |
| check | 전체 또는 cut_id 체크; 편집 revision을 바꾸지 않음 |
| run_cut | 새 실행은 requestId+expected_revision; 제안은 cut_id+input_digest; take_id + inputs take/canvas, profile_id, new_seed; action retry/cancel |
| get_take | take 상태·결과 해시 갱신 |
| extract_frame | 새 작업은 revision+영상 node_id/take_id, position/at_seconds/frame_index, target{cut,port}; extraction_id로 조회·0~120초 대기·취소 |

페이지 edit은 `ops` JSON 배열 문자열로 같은 연산을 받아. 페이지 `propose_run_cut`(commit)은 lastNode.data.preview.review를 그대로 인자로 써. cut_id/input_digest뿐 아니라 cut_mode·duration·seed·profile_id/profile_label·prompt·soundscape·music·slot_summary가 들어 있어서 카드에서 사람이 모드·길이·시드·프로필 이름·전송 프롬프트·슬롯/라벨 표를 읽을 수 있어. 서버는 모든 검토 값과 digest를 현재 컷에 대조하고, 하나라도 다르면 409로 거절해. slot_summary는 JSON 내용으로 비교해. review_json은 받지 않아. 삭제도 commit이야. digest는 해석된 Director 입력(안정 소재 참조·파일 지문, 슬롯/연결 속성·프롬프트), 시드, 프로필로 만들어 다른 job의 완료에 영향받지 않아.

제안의 프롬프트·사운드·음악·슬롯 요약·프로필 이름, 편집 ops/profile_json과 프로젝트 이름은 호스트의 실제 텍스트 한도인 200,000자를 명시해 기본 8,000자 제한에 걸리지 않아. 전체 요청 등 다른 호스트 전송 경계는 그대로 적용돼.

화면의 **제안으로 올리기**와 headless mode:propose는 `proposed` take를 남겨. 이 take의 승인·폐기는 **사람만** 캔버스에서 할 수 있어. 어시스턴트가 스키마 밖 action이나 origin을 넘겨도 서버가 거절해. 승인 때 컷 입력이 바뀌었으면 409로 다시 검토하게 해. 원본 파일 지문만 비교하므로 오디오 이름·메모·검수 변경은 파일 변경 경고가 아니야.

**호스트 제안 카드 대안**: 처음에는 manifest `serverActions`→`p_video_canvas_run_cut`을 검토했지만 최초 설치에서 등록 전 도구는 `pluginRegistry.parsePluginManifest`→`pluginAppToolScope`→`getMcpToolScope` 검증에 실패해. 실행 중일 때만 도구가 존재하는 순환이므로 이 패키지는 소유자가 승인한 캔버스 제안을 사용해. 호스트 코드는 바꾸지 않았어.

라이브러리 소재는 Director `assets[id].composite_hash`, 오디오 후보/파일함 소재는 서버 내부 `conai.media.resolve` 후 multipart `/api/workflow-input-assets` 참조로 보내. 계정/소재 지문별 업로드를 재사용하고, 제안 폐기 때 다른 take가 쓰지 않는 업로드만 `DELETE /api/workflow-input-assets/:id`로 정리 표시해. 실제 삭제는 호스트의 30일 유예와 큐 참조 보호를 따라. 폐기된 제안은 저장된 입력 그대로 다시 돌릴 수 없고 버튼도 숨겨. 현재 캔버스 입력으로 새로 돌리면 필요한 파일을 다시 올려. 정리 실패는 take의 cleanupErrors에 남겨. 한 체크 패스의 RefMod 목록/레코드와 같은 소재 조회는 공유하고 제출에서 같은 원격 체크를 두 번 하지 않아. raw timeline_data와 assets를 사용하며 friendly media[]는 쓰지 않아.

## 검증과 한계

빌드: `node scripts/build-plugin.mjs --bundled video-canvas`.
회귀: 루트에서 `npx tsx --test backend/test/plugin-video-canvas.test.ts`와 `npx tsx --test backend/test/plugins.test.ts`, frontend에서 `npx tsx --tsconfig tsconfig.app.json --test test/plugin-video-canvas-page.test.ts test/plugin-sdk.test.ts`. 페이지 모듈의 가짜 브리지 테스트는 게시 결과·부분 실패·더블 클릭을 검사하지만 실제 렌더링 QA를 대신하지 않아.

실제 DaSiWa/ComfyUI 서버가 없어 생성·오디오 업로드·서버 RefMod 확인·취소를 end-to-end로 검증하지 못했어. 도메인과 가짜 conai로 요청/제안/완료/추출 계약을 검사해. Docker QA(`compose.qa.yaml`, `http://localhost:17666`)에 최종 ZIP 설치를 시도했지만 구형 호스트가 `pages.0: Unrecognized key: "opensImages"`로 거절해 UI 확인은 막혔어. 현재 소스의 manifest/package 검증은 통과했고, QA는 현재 호스트로 다시 빌드한 뒤 1200+·900–1199·900 미만 너비와 대화상자를 확인해야 해. 패키지에서 필수 opensImages를 빼거나 호스트 코드를 수정하지 않았어. 타임라인 편집/병합·외부 영상 API·소재 생성·캐릭터 노드·파일함 영상 직접 프레임 추출은 지원하지 않아. 파일함 영상은 먼저 라이브러리에 가져와줘.
