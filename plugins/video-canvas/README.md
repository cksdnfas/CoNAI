# Video Canvas — video-canvas

공식 번들 플러그인이야. 앱의 기존 라이브러리 이미지/영상, 오디오 후보, RefMod 번들을 노드로 가져와 컷의 타입 입력 슬롯에 연결해. 소재나 생성 엔진을 새로 만들지 않아.

## 준비

1. 설정에서 공식 **Video Canvas**를 켜.
2. ComfyUI 탭에 DaSiWa MiniMax-H3 Director 워크플로를 등록해. Director 노드(`minimax_h3_director_dasiwa`)와 숫자 시드를 Marked Field로 열어줘.
3. 캔버스 프로젝트를 만들고 컷의 **생성 설정**에서 워크플로만 골라. 서버가 `workflow_options`로 Director·시드 필드를 찾아주고(못 찾으면 이유를 보여줘) 필드 ID는 직접 입력하지 않아. 해상도·후처리 같은 설정은 폼으로 고치고 기본값에서 바뀐 값만 overrides로 저장해. 같은 워크플로의 다른 단순 Marked Field는 추가 `inputs`로 정할 수 있어. 서버와 서버 태그는 등록된 ComfyUI 서버 목록에서 둘 중 하나를 골라. 저장할 때 `get_workflow_details`로 검사해. 새 컷은 최근 쓴 프로필을 받아. 프로필이 하나도 없는 프로젝트에서 쓸 수 있는 워크플로가 정확히 하나면 컷을 추가·실행할 때 그 기본 프로필을 자동으로 만들고 결과의 `autoProfile`로 알려줘.

서버 모듈·`app.fetch`·`events`·이미지 launch를 지원하는 현재 호스트와 패키지에 동봉된 SDK가 필요해. 공식 패키지는 앱 시작 때 꺼진 채 설치되고 앱 업데이트로 제자리 갱신돼. `conai.db`에 계정별 프로젝트를 보관하고 additive 초기화(CREATE IF NOT EXISTS, 보관 컬럼 추가, 이어 생성용 `vc_chain` 테이블)로 기존 데이터를 유지해. 1.2.0은 이전 프로젝트를 그대로 읽고 `sequence`가 없으면 컷 생성 순서로 봐. ZIP/Git 덮어쓰기·제거는 공식 패키지에 허용되지 않아.

## 흐름

- 라이브러리 이미지/영상은 호스트 미디어 선택 창(`api.pickMedia`)으로 여러 개를 골라 라이브러리 이름 그대로 가져와. `pickMedia`가 없는 호스트에서는 썸네일 목록에서 하나씩 골라. 오디오는 그룹→후보(이름·길이·재생), 레퍼런스 번들은 이름·구성·설명 목록에서 골라. 해시는 입력하거나 이름으로 보여주지 않아.
- 프로젝트 홈: 카드 목록을 24개씩 이어 불러오고 이름 검색·정렬(수정/이름/생성)·보관함 필터는 서버가 처리해. 카드 메뉴에서 이름 바꾸기·복제·보관/해제·삭제를 해. 복제는 노드·연결·프로필·컷 순서만 새 ID로 복사하고 take·추출·내보내기는 가져가지 않아. 삭제는 화면에서 사람이 하거나 승인 카드로만 되고 headless 도구에는 없어. 마지막으로 연 프로젝트와 프로젝트별 화면 위치·배율을 `api.storage`에 기억해서 다시 열 때 복원해.
- 소재 가져오기 → 컷 만들기 → 포트에서 슬롯으로 끌어 연결하거나 **슬롯에 넣기** → 슬롯 순서/연결 속성 편집 → `@이름` 프롬프트 → 전체 체크 → 생성/제안 → 사람 검수 → 프레임 추출 → 컷 순서 정리·합본 내보내기.
- 연결·선택: 포트에서 끌면 실시간 선분이 따라오고 연결할 수 있는 슬롯이 강조돼. 연결선도 선택할 수 있고 Shift/Ctrl/Cmd로 여러 노드를 골라 함께 움직이거나 지워. 우클릭 메뉴와 선택한 노드 위의 플로팅 툴바가 있어. 상세 패널은 기본으로 닫혀 있고 여닫은 상태를 기억해. 노드에서 영상·오디오를 바로 재생하고, 컷 노드에서 생성과 take 전환을 해. 컷 노드의 결과 출력 포트를 `ref_video`·`start`·`end`·`ref_image` 슬롯에 연결할 수 있고(영상 참조는 결과 클립을 가져오고 이미지 슬롯은 프레임을 뽑아), **앞 컷에서 이어가기**는 시퀀스에서 앞 컷의 대표 결과 마지막 프레임을 이 컷의 시작 슬롯에 넣어(I2VA로 이어 생성하는 용도). 노드를 더블 클릭하면 `api.navigation.open('/images/<hash>')`로 앱 상세 화면을 열고, 돌아오면 보던 프로젝트와 위치로 돌아와.
- 시퀀스: 프로젝트는 컷 순서 `sequence`를 가져. 컷을 대표하는 take는 `pickTakeId`로 고르고 없으면 결과가 있는 최신 take를 써. 시퀀스 스트립은 대표 take를 끊김 없이 이어 재생하고(다음 클립을 미리 불러), 길이는 불러온 영상의 실제 길이를 쓰고 결과가 없을 때만 컷의 길이를 대신 써. **합본 내보내기**는 호스트 도구 `join_videos`로 대표 take를 한 영상으로 이어 라이브러리에 저장해. 결과가 있는 컷이 2개 이상 필요하고, 결과 없는 컷은 확인 뒤 빼고 내보내. 앱에 `join_videos`가 없으면 업데이트하라고 알려줘. 내보내기는 진행을 따라가고 취소할 수 있어.
- 이어 생성: 스트립의 **이어 생성**(`run_chain`)은 시퀀스 순서대로 컷마다 (대표 결과가 준비된 컷은 **다시 생성**을 고르지 않는 한 건너뛰고, **전부 다시 생성**/`regenerate`는 건너뛰지 않아) 앞 컷의 마지막 프레임을 시작 슬롯에 넣고 필요하면 모드를 바꿔(T2VA→I2VA, L2VA→FL2VA) 생성하고 끝나길 기다려. 호스트 백그라운드 작업이라 채팅 턴이나 화면이 끝나도 서버에서 계속 돌고, 진행 중인 체인은 스트립에 컷별 단계와 취소로 보여줘(어시스턴트가 시작한 것도 같아). 프로젝트마다 하나만 돌고, 호스트가 플러그인당 백그라운드 작업을 하나만 돌려서 앱 전체로도 하나야(다른 체인이 돌면 429). 컷에 이미 돌고 있는 생성(`run_cut`)은 새로 제출하지 않고 그 take를 기다려 이어받고, 컷의 대표 take가 다른 take를 가리키면 방금 만든 take로 옮겨 내보내기와 다음 컷이 같은 영상을 쓰게 해. 실패하면 그 컷과 이유를 남기고 멈추고, 앱 재시작 등으로 작업이 끊기면 다음 조회 때 실패(중단)로 닫아. 다시 실행하면 결과가 있는 컷은 건너뛰어. `keep_start`는 컷에 있는 시작 이미지를 그대로 써.
- 캔버스: 휠은 포인터 위치 기준 확대·축소(20–200%), 빈 곳 끌기는 이동이야. 새 노드는 보이는 영역의 빈 자리에 놓고 밖이면 그만큼 화면을 옮겨. **정렬**은 소재를 쓰는 컷·슬롯 순서대로 왼쪽에, 컷을 오른쪽에 쌓고 **맞춤**은 실제 노드 크기로 전체를 가운데에 맞춰. 같은 선택의 인스펙터를 다시 그릴 때 펼친 슬롯·take 상세와 입력 중인 칸을 유지하고, 선택한 컷을 다시 눌러도 열린 탭을 유지해. 오류는 헤더 상태줄에 나오고 다음 작업을 시작하면 지워져(이벤트로 인한 백그라운드 갱신은 지우지 않아). 대화상자가 열려 있으면 대화상자 안에도 보여줘.
- 모드: T2VA(없음), I2VA(시작 slot 0), FL2VA(시작 0+끝 1), L2VA(끝 1), REF2VA(이미지 9/영상 3/오디오 3/합계 12 + RefMod 슬롯 1–8). 모드를 바꿔도 미사용 연결은 보존·흐림 처리하고 생성에서 제외해.
- 영상/오디오 구간 2–15초, 종류별 합계 15초. 영상에 포함된 오디오는 앱 화면 스트림 기준을 추가 경고로 보여줘. 호스트 검증이 최종이야. 연결 props에 trim_start/trim_end, media_mode, audioSlot, 번들 slot/strength/description을 둬. 연결을 빼거나 소재를 지우면 순서를 다시 매기고 Director slot은 종류 안 순위, order는 전체 순위로 보내. 시작·끝 프레임에는 미사용 참조 경고를 띄우지 않아.
- `@이름`은 이미지→영상→오디오, 각 종류 slot→order 순서로 라벨을 매겨. 영상+소리는 영상/오디오 라벨을 함께 보여줘. 번들은 지정 슬롯 번호를 유지해. 공백 있는 이름도 쓸 수 있고 이름 뒤에는 공백이나 문장부호를 넣어줘. 중복·모르는 이름·미연결 이름은 오류, 미사용 연결은 경고야.
- 간단 프롬프트·사운드·음악·원문 칸을 제공해. 원문이 있으면 간단 프롬프트 대신 보내. 구조화 빌더 UI는 없어.
- 시드는 플러그인이 뽑아 보관하고 항상 숫자 seed 필드로 보내. 같은 시드/다른 프로필, 새 시드, take 입력 그대로/현재 입력 다시 생성을 구분해. 결과 유사도는 예측하지 않아.
- take는 해석된 프롬프트·라벨/슬롯·시드·프로필·job/history/result hash·검수·프로필 overrides 적용 전 Director 입력을 남겨. 다른 프로필로 다시 돌리면 새 overrides만 적용해. 프레임 레이트는 컷/프로필에서 지정하지 않으면 등록한 워크플로의 값을 유지해. 클릭마다 requestId를 만들고 버튼을 잠그되, 사람의 버튼 클릭은 대기 중인 필드 편집이 끝난 뒤 실행을 시작할 때 revision과 제안 digest를 읽어. 프롬프트·시드·길이를 바꾸고 바로 생성/제안을 눌러도 방금 편집한 값을 써. 반대로 어시스턴트가 expected_revision을 보냈다면 그 값을 그대로 검사하고, 조회 뒤 사람의 편집이 있었으면 409로 거절해. take 재실행도 같아. 서버가 재시도와 같은 컷/입력의 진행 중 제출을 중복 제거해. 생성 멱등 키는 전역 UUID `video-canvas-<take UUID>`야. 제출 오류 뒤 **같은 요청 재시도**는 같은 키/입력을 써.
- `generation.finished`는 이력 ID만 반영하고 후처리 중 해시는 채택하지 않아. `history.record.status`/상태 갱신에서 `get_generation_job`과 이력을 조회하고 준비된 `actual_composite_hash ?? composite_hash`를 써.
- 라이브러리 영상·준비된 take의 프레임을 PNG/WebP로 뽑아 frame 노드와 선택한 start/end/ref_image 연결을 만들어. 서버가 노드 이름을 `<원본 이름> 첫/가운데/마지막 프레임`(시간·프레임 번호는 `N초 프레임`/`N번 프레임`)으로 짓고 위치가 없는 노드는 겹치지 않는 자리에 놓아. 컷이 무시하는 start/end 슬롯으로 연결하면 같은 편집에서 모드를 바꾸고(start: T2VA→I2VA, L2VA→FL2VA / end: T2VA→L2VA, I2VA→FL2VA) 결과에 `modeChange`로 알려줘. 편집 `connect`로 이미지·생성 노드 결과를 컷이 무시하는 start/end 슬롯에 이어도 같은 규칙으로 모드를 바꾸고 그 연산 결과에 `modeChange`를 붙여. 추출은 진행률과 결과 해시를 게시하며, 취소 가능한 네이티브 대기로 기다려. 대화상자를 닫으면 대기 요청만 멈추고 추출 작업은 남아. 작업 자체를 멈추려면 **작업 취소**를 눌러줘. 연결 실패는 프레임마다 누적해서 보여줘. 호스트 오류는 그대로 보여주고 원본 파일 읽기 오류에는 서버 경로를 넣지 않아. 재생 위치는 한 프레임 어긋날 수 있어 정확한 추출은 프레임 번호를 써.
- 이미지 상세에서 열기는 자동으로 가져오지 않아. 프로젝트/새 노드/컷 슬롯을 선택한 뒤 `?image=`를 지워. 가져온 노드 이름은 원본 파일 이름이야. 영상 launch는 호스트에 없어.

## 생성 노드

`＋ 생성`(우클릭 메뉴의 **생성 노드 추가**)으로 만드는 `gen` 노드는 컷처럼 프롬프트·시드로 생성하고 take를 쌓지만 Director 영상이 아니라 **생성 설정**(프로필)이 정한 결과를 만들어. 결과 종류는 이미지·영상·오디오고 노드에 종류 배지가 붙어. 컷과 같은 생성/다시 생성, take 전환·대표 지정, 이력·같은 시드/새 시드 다시 생성을 써. 프로젝트에 생성 설정이 없으면 노드를 만들 때 등록하거나 가져오라고 물어보고(나중에 골라도 돼), 있으면 마지막에 쓴 설정을 받아.

생성 설정은 어댑터가 셋이야.

- `director`: 컷 전용(DaSiWa Director). 생성 노드에는 못 써.
- `workflow`: 등록된 ComfyUI 워크플로 아무거나(Director 워크플로 제외). 결과 종류를 정하고(워크플로 종류에서 미리 채우지만 추정이라 바꿀 수 있어) 프롬프트·시드·입력 이미지 필드를 지정해. 나머지 단순 필드는 **워크플로 기본값 / 고정값 / 노드마다 채움** 중 하나야: 고정값은 설정에 저장돼 모든 노드가 같이 쓰고, 노드마다 채움은 노드 상세에서 노드별로 입력해. 서버·태그, 안내(이 생성이 뭘 만드는지)와 가이드(프롬프트 쓰는 법) 글도 적어둘 수 있어. 입력 이미지 필드를 지정하면 노드에 이미지 입력 슬롯이 그 개수만큼 생기고, N번째 연결이 N번째 필드로 가.
- `nai`: 앱 생성 프리셋을 복사한 NovelAI 설정(결과는 이미지). 노드는 프롬프트·시드·크기(설정에 있는 크기 이름)만 정해. NovelAI 설정은 프리셋에서 가져와서만 만들고 여기서 고치지는 못해(이름·안내·가이드만 바꿔). 한 번에 1장만 만들어.

등록은 두 길이야. **새로 등록**은 설정 대화상자에서 워크플로를 골라 직접 정하고(앱의 채팅 생성 프리셋 편집기처럼 필드별로 고정/채움을 골라), **프리셋에서 가져오기**는 앱의 생성 프리셋을 복사해(`import_preset`). 가져오기는 **관리자만** 돼서 프리셋 목록을 불러올 수 있을 때만 버튼이 보이고, 쓸 수 없는 프리셋은 이유와 함께 흐리게 나와. 복사는 그 시점의 값(워크플로·서버·고정/채움 필드·프롬프트 필드·NovelAI 설정·안내·가이드 글)이라 나중에 프리셋을 고쳐도 따라가지 않아. 반대로 **가이드 스킬**은 복사가 아니라 `{skillId, path}` 링크라서 읽을 때마다 스킬 섹션의 현재 내용을 가져와. 링크는 노드 상세의 **가이드**에 제목과 함께 읽기 전용으로 보여. 설정 대화상자에서는 관리자만 링크를 바꿀 수 있어: `workflow_options`의 `skills: true`가 돌려주는 스킬 목록에서 스킬을 고르고, 그 스킬의 섹션이나 그룹(`group/`)을 골라 잇거나 **연결 없음**으로 끊어. 꺼진 스킬도 목록에 나오지만 켜기 전에는 가이드를 읽지 않는다고 알려줘. 관리자가 아니면 `skills`가 응답에서 빠져서(실패가 아니야) 현재 링크의 제목만 읽기 전용으로 보여. 가져온 프리셋의 링크는 그대로 따라와. 설정을 쓰는 노드가 여럿이면 설정을 고칠 때 모두에 반영돼.

노드 상세의 **가이드**에는 설정의 안내·가이드 글과 링크한 스킬 섹션(제목·내용, 읽지 못했으면 경고)이 보여. 어시스턴트도 `read_node`의 `preview.guide`로 같은 걸 읽고 프롬프트를 쓰기 전에 따라야 해.

연결 규칙은 결과 종류가 정해: 생성 노드의 출력 포트를 끌면 맞는 슬롯만 강조돼. 이미지 → 컷의 시작/끝 프레임·참조 이미지(그리고 다른 생성 노드의 이미지 입력), 영상 → 참조 영상, 오디오 → 참조 오디오. 컷의 결과 연결(프레임 추출·영상 가져오기)과 달리 생성 노드는 결과를 그대로 슬롯에 이어서 대표 take를 그 자리에서 써. 결과가 아직 없으면 그 컷이 막히고(`결과가 아직 없어` 체크는 서버가 결과를 반영해서 판단해) 이어 생성은 대신 만들어주지 않으니 먼저 생성 노드를 돌려줘. 설정이 없는 노드는 아직 종류를 몰라서 아무 슬롯에도 못 이어.

컷의 시작/끝 슬롯에 이었는데 컷 모드가 그 슬롯을 안 쓰면 서버가 모드를 바꾸고(T2VA→I2VA 등, 프레임 추출과 같은 규칙) `connect`와 `target`을 가진 `add_node`/`import_*` 연산 결과에 `modeChange {cutId, from, to}`를 붙여. 화면은 끌어서 이을 때와 런치 이미지를 컷의 시작/끝 프레임으로 가져올 때 "모드는 A → B로 바뀌었어." 토스트로 알려줘(프레임 추출과 같은 문구).

컷과 생성 노드에 다 있는 것: 복제(우클릭 메뉴·Ctrl+D·선택 막대)는 이름·프롬프트·시드·생성 설정·노드별 값·크기와 입력 연결을 한 번의 `add_node`(`fields`)와 `connect`로 복사해. take는 복사하지 않고, 컷은 새 시드를 받지만 생성 노드는 같은 시드를 가져. **정렬**은 컷을 한 줄로 놓고 그 아래에 소재, 그 오른쪽(컷 쪽)에 생성 노드 열을 놓아. 생성 노드는 컷·슬롯 순서대로 쌓고, 다른 생성 노드에 이어진 노드는 그 노드의 왼쪽 열로 가.

컷에만 있는 것: Director 모드·길이·슬롯, 프레임 추출, 시퀀스·이어 생성·합본 내보내기, 제안(`propose`)과 승인. 생성 노드의 `run_cut`/`get_take`/`wait_take`는 컷과 같지만 생성 노드 결과를 프레임 추출하지는 못해.

연결한 생성 노드를 다시 생성했거나 다른 take를 대표로 골라서 컷·생성 노드의 지금 결과가 그 노드의 예전 결과로 만든 것이면, 서버가 `check`와 `read_node`의 `preview.checks.warnings`에 코드 `stale-input` 경고를 담아(막지는 않아). 카드에는 **예전 생성물** 배지(툴팁이 메시지)가, 노드 상세와 체크 탭에는 같은 메시지가 보여. 이 경고는 서버를 부르지 않고도 알 수 있어서, 화면은 프로젝트를 읽을 때마다 같은 규칙(`staleUpstream`)을 직접 돌려(페이지가 읽은 프로젝트에 대표 take가 만들 때 쓴 입력의 스냅샷이 있고, `withResults`가 생성 노드의 지금 결과를 채워줘). 그래서 프로젝트를 다시 열어도 선택하지 않은 노드에 배지가 바로 떠. 서버의 체크(열어 둔 노드의 조회, 또는 전체 체크)가 있고 그 뒤로 캔버스 revision과 완료된 결과가 그대로면 그 체크의 메시지를 보여줘. 열어 둔 노드는 완료된 결과가 바뀌면 다시 읽어.

페이지 작업: `edit`의 `preset_json`(프리셋 복사, 관리자만, 프로젝트 `create_name`과 함께도 가능)과 `profile_json`으로 설정을 만들고, `workflow_options`의 `presets: true`가 프리셋 목록, `skills: true`가 가이드로 이을 스킬 섹션 목록을 게시해(둘 다 관리자만, 아니면 응답에서 빠져). 페이지 `edit`·`sequence`·`remove`는 어시스턴트가 준 `expected_revision`을 그대로 서버에 보내고 안 줬으면 `null`이라 서버가 "필요해"라고 거절해(페이지의 현재 revision으로 대신하지 않아). 사람이 화면에서 하는 편집만 현재 revision을 써. 프로젝트 `create_name`은 `expected_revision` 없이도 돼.

자동 체크와 사람 검수는 별개야. 삭제/소재 없음/권한/필수 슬롯/한도/토큰 오류만 막고, 변경된 지문/미사용 참조는 경고야. 지문 갱신은 사람이 선택해. 검수는 사람이 화면에서 대기/통과/다시와 메모로 기록해. 어시스턴트 자기보고는 검수로 저장하지 않아.

## 어시스턴트와 저장 계약

`domain.mjs`는 DOM 없는 연산·슬롯·체크·프롬프트·Director 변환, `assistant-state.mjs`는 게시 결과와 페이지 처리, `store.mjs`/`server.mjs`는 계정별 SQLite CAS와 네이티브 연결이야. UI `api.server`, 페이지 작업과 headless 도구가 같은 서비스를 호출해. revision은 캔버스 편집에만 증가하고 take/추출 진행률·자동 체크는 별도 상태에 저장해. 추출 결과의 노드/연결 추가는 실제 편집이라 revision이 증가해. jobId 인덱스로 완료 훅의 take를 찾아 다른 계정의 프로젝트 JSON을 훑지 않아. 초기화는 additive CREATE IF NOT EXISTS만 사용해.

편집 `expected_revision` + `ops`: add_node{kind,ref,at,tempId}(컷·생성 노드는 {kind,name,at,tempId,target,profileId,seed,fields}이고 `fields`는 `set`과 같은 키; 모르는 연산 키는 거절해), connect{from,to,port,position,props}, disconnect{id}, reorder{cut,port,order:[edgeId]}, sequence{order:[cutId]}, set{id,fields}, move{id,x,y}, remove{id}, import_image/video/audio/bundle/launch, review{id,status,memo}. 실패한 연산은 원상태로 두고 나머지를 적용해 `{revision,applied,rejected,tempIds}`를 돌려줘. 페이지 edit은 이 결과를 먼저 게시하고 거절된 연산이 있으면 한국어 오류를 던져. tempId는 같은 배치 안에서만 유효해. set은 이름 또는 컷 mode/prompt/soundscape/music/raw/seed/duration/frame_rate/profileId/pickTakeId, 연결 props만 허용해. sequence에 없는 컷은 기존 순서대로 뒤에 붙어. 어시스턴트 편집만 프로젝트당 최신 한 배치를 기록해. 뒤에 편집이 없으면 undo할 수 있고, job 상태 갱신은 undo를 무효화하지 않아. 생성 이력/외부 job은 undo하지 않아.

페이지 작업의 반환값은 호스트가 버리므로 **결과는 snapshot.data에 게시해**. `projects`는 프로젝트 ID·이름·노드/컷 수 목록이고 프로젝트를 연 상태에서도 항상 있어. 이름 검색·정렬·보관함 목록은 `list_projects`가 같은 자리에 게시하고(`nextOffset`으로 이어 읽어), `workflow_options`는 `workflowOptions`, 합본 내보내기는 `lastExport`/`pendingExports`, 이어 생성은 `lastChain`/`pendingChains`(id·status·current·steps)에 게시해. 게시한 모든 섹션에는 호출마다 바뀌는 신선도 표시(`fresh {seq, at}`)가 붙어 같은 답을 다시 받아도 새 답인지 알 수 있어. `canvas` 발췌의 노드 행은 자동 체크 `checkStatus`와 사람 검수 `humanReview`를 따로 갖고, 컷 행은 생성 상태(`newestTakeId/Status/Error`, `hasReadyResult`, `representingTakeId`, `resultHash`)를 함께 줘. `humanReview`는 생성 상태가 아니야. 이 목록으로 프로젝트를 고를 수 있어 headless 도구가 없어도 돼. 프로젝트 이름 바꾸기·보관·복제는 `rename_project`/`archive_project`/`duplicate_project`(direct), 삭제는 `delete_project`(commit, 이름 일치 필요)로 제안해. `lastRead`는 노드/연결 페이지, `lastNode`는 선택/조회 노드·서버 작성 preview·입력 digest·연결/take 페이지, `lastEdit`는 적용/거절과 tempId→ID, `lastRun`은 take ID·시드·해석된 프롬프트·라벨 표·체크, `lastCheck`는 자동 체크, `lastExtraction`/`pendingExtractions`는 추출 ID·진행률·상태·결과 해시야. 루트에는 선택/revision/대기 launch를 둬. 네이티브 URL·서버 경로·비밀값이나 전체 프로젝트를 게시하지 않아.

게시된 lastEdit의 tempIds는 `[{tempId,id}]` 배열이고 applied/rejected의 op는 JSON 문자열이야. 프로필은 선언된 필드만 저장하고, 노드/take 조회·lastRun·lastEdit.profiles에 게시하는 overrides는 JSON 문자열로 바꿔. 실제 저장·생성에는 원래 객체를 써서 `prompt_enhancer_token_limit` 같은 워크플로 설정도 그대로 유지해. 일반 객체도 크기뿐 아니라 `shared/src/utils/chatPageAction.ts`의 보호 키 규칙과 예외를 검사하고, 안전하지 않으면 결과를 JSON 문자열 조각으로 게시해. 패키지 경계의 검사는 실제 호스트 검증기와 대조하는 회귀로 확인해. 사용자가 정한 키 때문에 전체 스냅샷이 거절되지 않으며, headless 편집 응답의 원래 tempIds 맵/연산 객체는 바뀌지 않아.

각 결과는 `{summary,data,nextCursor}` 또는 큰 결과의 `{summary,json,encoding:'json-string',cursor,nextCursor}`야. 실제 호스트 경계(스냅샷 JSON 200,000자, 컬렉션 512개, 깊이 20)에 맞춰 페이지를 나누고 내용을 잘라 버리지 않아. `read{section:'lastNode',cursor:nextCursor}`처럼 같은 결과의 다음 조각을 읽어. projects도 같은 방식으로 이어 읽어. 조각은 `JSON.parse(json)`로 풀어 이어 붙인 뒤 전체 JSON을 해석하면 돼. 잘못되거나 범위를 벗어난 결과 커서는 첫 페이지로 되돌리고 이후 게시를 막지 않아. 캔버스 자체는 read의 cursor/edge_cursor, 노드 연결·이력은 read_node의 edge_cursor/take_cursor로 이어 읽어.

**채팅 경로**: 채팅이 캔버스를 페이지 작업으로 다루려면 입력창의 **페이지 연결**이 열린 캔버스 페이지에 켜져 있어야 해. 꺼져 있으면 프로필의 도구 범위가 허용한 headless 도구만 받아. 권장 흐름은 `edit`(프로젝트 `create_name`+`profile_json`을 한 번에 만들고, 컷마다 같은 스타일·인물·배경 설명을 prompt에 똑같이 넣고 달라지는 동작만 써서 한 번에 추가) → `run_chain` → `wait_take`로 끝날 때까지 → `export_sequence` → `wait_take`야. `propose_run_cut`은 사람이 먼저 검토하겠다고 할 때만 써. 호스트의 채팅→페이지 브리지(`backend/src/services/codex-chat/chatPageBridge.ts`)가 페이지 작업 응답을 20초 기다리므로 페이지 작업의 대기는 호출당 최대 15초고, `video-canvas.wait_take`가 take·컷(`cut_id`는 그 컷의 최신 take)·체인·내보내기·추출 중 정확히 하나의 ID와 `wait_seconds`(0~15)로 기다리는 유일한 view 작업이야. status가 completed·failed·cancelled가 될 때까지 같은 ID로 다시 불러. 실패한 take에는 작업의 실패 메시지가 `error`로 붙어. 시작하는 작업(`expected_revision` 필요)과 달리 ID만 쓰는 조회·대기·취소에는 `expected_revision`이 필요 없어. headless 도구의 대기는 그대로 0~120초야.

headless 도구:

| 도구 접미사 (`p_video_canvas_`) | 사용 |
| --- | --- |
| list_projects | 프로젝트 40개씩, offset; query 이름 검색, sort updated/name/created, archived 보관함; total·nextOffset |
| manage_project | rename(name)/archive(archived, 기본 true)/duplicate(name 선택); 삭제는 없어 |
| workflow_options | 워크플로별 usable/reason, 찾은 Director·시드 필드, 조정할 기본값·추가 입력, 활성 서버·태그; 생성 노드용 `generator`; presets:true는 생성 프리셋, skills:true는 가이드로 이을 스킬 섹션(관리자만, 아니면 생략) |
| read_canvas | ID/종류/연결/revision 페이지; cursor/edge_cursor, node_id는 상세와 edge_cursor/take_cursor |
| apply_ops | 프로젝트+revision+ops(sequence·pickTakeId 포함); create_name은 프로젝트 생성(revision 무시, profile을 같이 주면 한 번에 만들고 id·revision·profileId 반환), profile{workflowId, label?, serverId\|serverTag?, overrides?, inputs?}은 검증/저장(workflowId만 있어도 돼), undo는 마지막 배치 취소 |
| check | 전체 또는 cut_id 체크; 편집 revision을 바꾸지 않음; 연결한 생성 노드를 다시 생성했으면 `stale-input` 경고 |
| run_cut | 새 실행은 requestId+expected_revision, wait_seconds(0~120)로 같은 호출에서 결과 해시까지 대기; 제안은 mode propose; take_id + inputs take/canvas, profile_id, new_seed; action retry/cancel(둘 다 revision 불필요) |
| get_take | take_id 또는 cut_id(그 컷의 최신 take)의 상태·결과 해시·실패 메시지, wait_seconds 0~120으로 끝날 때까지 대기 |
| run_chain | 새 실행은 expected_revision(+cut_ids, regenerate, keep_start); 백그라운드로 컷마다 앞 컷 마지막 프레임을 이어 생성; `{id,status,current,steps[{cutId,status,takeId,error}]}`; chain_id로 조회·0~120초 대기, cancel:true로 취소; 프로젝트·앱당 하나 |
| extract_frame | 새 작업은 revision+영상 node_id/take_id, position/at_seconds/frame_index, target{cut,port}; extraction_id로 조회·0~120초 대기·취소; 무시되는 슬롯이면 모드를 바꾸고 `modeChange` 반환 |
| export_sequence | 새 작업은 revision(+cut_ids 순서); 대표 take를 한 영상으로 이어 `{id,status,jobId,progress,resultHash}`; 결과 없는 컷이 있거나 컷이 2개 미만이면 거절; export_id로 조회·0~120초 대기·취소 |

페이지 작업은 19개고(조회 `read`·`read_node`·`list_projects`·`workflow_options`·`wait_take`는 view, 선택 `select`는 draft, 편집·`run_cut`·`run_chain`·`extract_frame`·`export_sequence`·프로젝트 이름 바꾸기/보관/복제·`sequence`·`check`는 direct, `propose_run_cut`·`delete_project`·`remove`는 commit) 도구와 같은 서비스를 불러. 페이지 `run_cut`·`run_chain`·`extract_frame`·`export_sequence`의 `wait_seconds`는 15초로 잘리고, 더 기다리려면 `wait_take`를 써. 페이지 edit은 `ops` JSON 배열 문자열로 같은 연산을 받고 `create_name`+`profile_json`으로 프로젝트와 프로필을 한 번에 만들어. 페이지 `propose_run_cut`(commit)은 lastNode.data.preview.review를 그대로 인자로 써. cut_id/input_digest뿐 아니라 cut_mode·duration·seed·profile_id/profile_label·prompt·soundscape·music·slot_summary가 들어 있어서 카드에서 사람이 모드·길이·시드·프로필 이름·전송 프롬프트·슬롯/라벨 표를 읽을 수 있어. 서버는 모든 검토 값과 digest를 현재 컷에 대조하고, 하나라도 다르면 409로 거절해. slot_summary는 JSON 내용으로 비교해. review_json은 받지 않아. 삭제도 commit이야. digest는 해석된 Director 입력(안정 소재 참조·파일 지문, 슬롯/연결 속성·프롬프트), 시드, 프로필로 만들어 다른 job의 완료에 영향받지 않아.

제안의 프롬프트·사운드·음악·슬롯 요약·프로필 이름, 편집 ops/profile_json과 프로젝트 이름은 호스트의 실제 텍스트 한도인 200,000자를 명시해 기본 8,000자 제한에 걸리지 않아. 전체 요청 등 다른 호스트 전송 경계는 그대로 적용돼.

화면의 **제안으로 올리기**와 headless mode:propose는 `proposed` take를 남겨. 이 take의 승인·폐기는 **사람만** 캔버스에서 할 수 있어. 어시스턴트가 스키마 밖 action이나 origin을 넘겨도 서버가 거절해. 승인 때 컷 입력이 바뀌었으면 409로 다시 검토하게 해. 원본 파일 지문만 비교하므로 오디오 이름·메모·검수 변경은 파일 변경 경고가 아니야.

**호스트 제안 카드 대안**: 처음에는 manifest `serverActions`→`p_video_canvas_run_cut`을 검토했지만 최초 설치에서 등록 전 도구는 `pluginRegistry.parsePluginManifest`→`pluginAppToolScope`→`getMcpToolScope` 검증에 실패해. 실행 중일 때만 도구가 존재하는 순환이므로 이 패키지는 소유자가 승인한 캔버스 제안을 사용해. 호스트 코드는 바꾸지 않았어.

라이브러리 소재는 Director `assets[id].composite_hash`, 오디오 후보/파일함 소재는 서버 내부 `conai.media.resolve` 후 multipart `/api/workflow-input-assets` 참조로 보내. 계정/소재 지문별 업로드를 재사용하고, 제안 폐기 때 다른 take가 쓰지 않는 업로드만 `DELETE /api/workflow-input-assets/:id`로 정리 표시해. 실제 삭제는 호스트의 30일 유예와 큐 참조 보호를 따라. 폐기된 제안은 저장된 입력 그대로 다시 돌릴 수 없고 버튼도 숨겨. 현재 캔버스 입력으로 새로 돌리면 필요한 파일을 다시 올려. 정리 실패는 take의 cleanupErrors에 남겨. 한 체크 패스의 RefMod 목록/레코드와 같은 소재 조회는 공유하고 제출에서 같은 원격 체크를 두 번 하지 않아. raw timeline_data와 assets를 사용하며 friendly media[]는 쓰지 않아.

## 검증과 한계

빌드: `node scripts/build-plugin.mjs --bundled video-canvas`.
회귀: 루트에서 `npx tsx --test backend/test/plugin-video-canvas.test.ts`와 `npx tsx --test backend/test/plugins.test.ts`, frontend에서 `npx tsx --tsconfig tsconfig.app.json --test test/plugin-video-canvas-page.test.ts test/plugin-sdk.test.ts`. 페이지 모듈의 가짜 브리지 테스트는 게시 결과·부분 실패·더블 클릭을 검사하지만 실제 렌더링 QA를 대신하지 않아.

2026-11-15에 Docker QA(`compose.qa.yaml`, `http://localhost:17666`)에서 등록한 DaSiWa 워크플로로 2초 컷 10개 프로젝트(T2VA, 라이브러리 이미지 I2VA, 이어가기 I2VA, 이미지·영상 참조 REF2VA, FL2VA)를 실제로 생성하고 23.1초 960x544 영상 하나로 내보냈어. 같은 QA에서 우클릭 메뉴, 실시간 연결선, 상세 화면 이동과 복귀, 시퀀스 재생, 결과 출력 포트를 브라우저로 확인했어. 같은 날 채팅 프로필 "QA LiteLLM Direct"(페이지 연결 켬)로 메시지 하나에서 시작해 승인 카드나 추가 입력 없이 끝까지 확인했어: 이어 생성한 5컷 영상과 합본 내보내기(289초), 컷 이름 변경·프롬프트 하나 수정·세 컷 `regenerate` 이어 생성·다시 내보내기(216초), `run_chain`과 `wait_take`로 만든 3컷 영상(200초). 2026-11-16에 같은 QA·같은 채팅 프로필로 생성 노드를 확인했어: ComfyUI 생성 프리셋을 가져온 이미지 생성 노드 → 컷 시작 프레임(`modeChange` T2VA→I2VA) → 컷 영상, NovelAI 생성 프리셋을 가져온 이미지 생성 노드(가이드 스킬 연결 유지), Stable Audio 워크플로의 오디오 생성 노드(생성 노드마다 채우는 `seconds`) → REF2VA 컷의 `ref_image`·`ref_audio` → 컷 영상, 앞 생성 노드 재생성 뒤 `stale-input` 경고, 화면의 생성 노드 복제·정렬·가이드 스킬 고르기. 오디오 후보처럼 라이브러리 밖 소재를 쓰는 생성은 호스트가 플러그인의 `submit_generation_job`에 `/api/workflow-input-assets` 참조를 허용해야 해서 그 수정이 들어간 앱이 필요해. 아직 확인하지 못한 것: 홈 메뉴의 프로젝트 이름 바꾸기·복제·보관·삭제, 오디오와 RefMod 번들 노드, 제안, 프레임 추출 대화상자, 1200px 미만 너비, 페이지 연결 없는 채팅의 headless 도구 경로(그 프로필의 도구 범위가 조회 도구만 열었어), Codex 엔진 프로필(사용 한도), 실제 호스트에서 이어 생성 취소·실패 경로, 여러 계정의 동시 이어 생성. 이 부분과 오디오 업로드·서버 RefMod 확인·취소는 도메인과 가짜 conai 계약 테스트로만 검사해. 타임라인 편집(컷 안쪽 자르기·겹치기)·외부 영상 API·소재 생성·캐릭터 노드·파일함 영상 직접 프레임 추출은 지원하지 않아. 파일함 영상은 먼저 라이브러리에 가져와줘.
