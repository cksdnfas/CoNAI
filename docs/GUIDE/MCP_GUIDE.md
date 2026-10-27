# MCP 가이드

CoNAI는 MCP(Model Context Protocol) 서버를 제공합니다. Claude Code, Hermes Agent, Cursor류 MCP 클라이언트에서 CoNAI의 프롬프트, 이미지, 생성 이력, ComfyUI/NAI 생성 기능을 도구처럼 호출할 수 있습니다.

## 핵심 요약

### 채팅 전용 `call_agent`

1:1·그룹 채팅에서 목록에 제공하고 실행 시 활성 답변을 확인합니다. 호출 프로필에 비어 있지 않은 도구 grant가 있어야 하며 allowlist가 있으면 `call_agent`도 허용해야 합니다. 현재 방의 소유자가 사용할 수 있는 다른 `agentEnabled` 프로필이 있어야 하며 에이전트 작업방·게시판 호출·공개 페이지에서는 제공/실행하지 않습니다. 도구 설명에는 최대 20개 대상의 ID·이름·`agentDescription`만 나열합니다.

- 입력: `agent_profile_id`(양의 정수), `instruction`(1~20,000자), 선택 `media_composite_hashes`(첨부 미디어 해시 배열), `on_done`(`notify` 기본값 / `react`).
- 출력: `{callId, status:"running"}`. 호출 모델은 대기하지 않습니다. 새 자동화 방에서 대상 프로필 자신의 도구 권한(방 소유자 권한으로 제한)으로 실행합니다.
- 결과: 호출방에 에이전트 이름과 답변·생성물 참조·파일 변경을 게시합니다. `notify`는 게시만, `react`는 생성 작업 종료 뒤 `agent_result` 완료 알림으로 원래 방을 깨웁니다. 에이전트 작업방의 지시는 `agent`로 구분합니다. 에이전트 내부 재호출·검토 카드 생성만 금지하며 원래 방의 검토 카드는 유지합니다.
- 방은 종료 1시간 뒤 삭제합니다. 실패 시 먼저 인스턴스 공용 파일함 `에이전트 작업 기록/<날짜>/<이름> (#호출번호).json`에 지시 최대 500자·답변 최대 1,000자 발췌, 상태·오류·이름·ID·시각·제한된 도구 메타데이터를 보존합니다(전체 원문 제외). 호출방 삭제는 진행 중 호출을 취소하며, 서버 재시작은 실패로 알립니다. 호출 수·비용 상한은 없습니다.
- 프로필 설정 제안은 `agentEnabled`/`agentDescription`(최대 300자), 또는 `agent_enabled`/`agent_description` 별칭을 지원합니다.
- `/admin/tools`에도 `call_agent`가 표시되므로 프로필의 제한된 도구 목록에서 선택할 수 있습니다(편집기에서는 읽기 그룹). `react`의 생성 대기는 완료 후 최대 30분이며 이후에는 미완료 작업을 명시하고 반응을 요청합니다. 결과 게시 실패는 원래 만료 시각 이후 1시간까지만 재시도하고 실패 로그/청소로 전환합니다.

- 기본 HTTP 엔드포인트: `http://localhost:1666/mcp`
- 전송 방식: Streamable HTTP(권장), stdio(로컬 전용)
- HTTP 서버는 stateless 방식이라 `POST /mcp`만 사용합니다.
- HTTP MCP는 기본 비활성이고 API 키 인증이 필수입니다.
- 기본 백엔드 포트는 `1666`, 프론트엔드 포트는 `1677`입니다. 헷갈리면 바로 터집니다.

## 사전 조건


CoNAI 백엔드가 실행 중이어야 합니다.

```bash
npm run dev
```

HTTP 방식은 설정 → 계정 및 시스템 → MCP에서 활성화합니다. 같은 화면에서 MCP URL과 API 키를 확인·복사·교체할 수 있으며 재시작은 필요 없습니다.

API 키마다 **권한 그룹**을 하나 고릅니다. 키는 계정처럼 그 그룹의 기능 권한만큼만 도구를 보고 실행하며, 키에 권한을 따로 주는 방법은 없습니다. 그룹의 권한을 바꾸면 키에도 바로 반영됩니다. 그룹이 없는 예전 키는 그룹을 고르기 전까지 어떤 도구도 쓰지 못합니다.

클라이언트는 모든 `/mcp` 요청에 다음 헤더 중 하나를 전송해야 합니다.

```http
Authorization: Bearer <MCP_API_KEY>
```

`X-ConAI-MCP-Key`와 `X-API-Key`도 지원합니다. MCP 도구는 조회뿐 아니라 생성·복원 같은 변경 작업을 포함하므로 API 키를 외부에 공개하지 마세요.

프로덕션 실행 환경에서는 앱을 실행한 뒤 백엔드 URL을 확인합니다.

확인:

```bash
curl http://localhost:1666/health
```

MCP 엔드포인트는 브라우저 GET으로 보는 페이지가 아닙니다. 인증된 `GET /mcp`는 405가 정상입니다.

## 연결 방식 선택

| 방식 | 추천 상황 | 특징 |
| --- | --- | --- |
| Streamable HTTP | 대부분의 클라이언트 | 실행 중인 CoNAI 백엔드에 연결 |
| stdio | 로컬 Claude Code/개발용 | Express 서버 없이 MCP 서버를 직접 실행, DB에 직접 접근 |

대부분은 HTTP를 쓰면 됩니다. stdio는 로컬에서 CoNAI 프로젝트 루트를 알고 있는 클라이언트에만 권장합니다.

## Claude Code 연결

### HTTP 방식

```bash
claude mcp add --transport http conai http://localhost:1666/mcp --header "Authorization: Bearer <MCP_API_KEY>"
```

다른 PC에서 접근한다면 `localhost` 대신 서버 IP를 씁니다.

```bash
claude mcp add --transport http conai http://<서버IP>:1666/mcp --header "Authorization: Bearer <MCP_API_KEY>"
```

확인:

```bash
claude mcp list
```

Claude Code 안에서는 다음 명령으로 연결 상태를 확인합니다.

```text
/mcp
```

### stdio 방식

CoNAI 프로젝트 루트에서 실행하도록 등록합니다.

```bash
claude mcp add --transport stdio conai -- npx tsx backend/src/mcp/stdio.ts
```

빌드된 파일을 쓸 때:

```bash
claude mcp add --transport stdio conai -- node backend/dist/backend/src/mcp/stdio.js
```

## Hermes Agent 연결

Hermes Agent는 native MCP 클라이언트를 지원합니다. `~/.hermes/config.yaml`에 서버를 추가하고 Hermes를 재시작합니다.

```yaml
mcp_servers:
  conai:
    url: "http://localhost:1666/mcp"
    headers:
      Authorization: "Bearer <MCP_API_KEY>"
    timeout: 180
    connect_timeout: 30
```

재시작 후 도구 이름은 보통 `mcp_conai_<tool_name>` 형태로 노출됩니다.

예:

- `mcp_conai_search_prompts`
- `mcp_conai_generate_nai`
- `mcp_conai_search_images`

## `.mcp.json` 공유 설정

프로젝트 루트에 `.mcp.json`을 두면 팀 단위로 설정을 공유할 수 있습니다.

HTTP:

```json
{
  "mcpServers": {
    "conai": {
      "type": "http",
      "url": "http://localhost:1666/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

stdio:

```json
{
  "mcpServers": {
    "conai": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "backend/src/mcp/stdio.ts"]
    }
  }
}
```

## 제공 도구

### Codex 원본·역할 참조·엄격 인페인트

`get_codex_generation_options`는 전체 요청 스키마, 역할, 파일 제한, 일반/엄격 예시와 모델 후보를 제공합니다. `submit_generation_job(service_type="codex")`에서 `image`는 generate의 참조, edit/infill의 유일한 편집 원본입니다. `references`는 순서 있는 `[{role, label?, data_url}]`입니다. 역할은 `reference|style|material|scale|item`이며 참조를 합친 시트를 만들지 않습니다. 원본/마스크 포함 5장, 각 10 MiB·합계 32 MiB(디코딩 기준), 최대 4096px입니다. 표준 입력은 PNG·JPEG·WebP data URL, 마스크는 같은 크기 PNG입니다. 기존 image/mask의 raw base64·MIME 별칭/대소문자·빈 문자열은 정규화하며 지원되는 단일 프레임 래스터는 필요하면 PNG로 변환합니다.

`operation:"infill"`에 `preserve:"strict"`를 명시하면 `size`를 측정한 원본 크기로 덮어쓰고, 다른 생성 크기는 거부합니다. 원본은 회전 없는 8비트 sRGB/회색조(ICC 없음 또는 Sharp 표준 sRGB)만 지원합니다. 마스크는 불투명 PNG(알파 255)이며 검정 보호 픽셀이 있어야 합니다. 흰색=편집, 검정=보호, 회색=혼합이고 알파는 사용하지 않습니다. 검정 영역을 고정한 무손실 PNG를 staging에서 검사한 뒤에만 라이브러리에 공개합니다. 기존 infill은 advisory이며 일반 `size`는 요청이지 보장이 아닙니다. `get_generation_history_request`는 역할·설명·순서를 바이트/첨부 경로 없이 반환하므로 재사용 시 이미지를 다시 첨부합니다. 자세한 예시는 [Codex 생성](./CODEX_GENERATION.md)을 참고합니다.

그룹 이동에서 선택한 하위 그룹은 선택한 조상과 함께 한 번만 이동하며 `moved`는 독립적으로 이동한 선택 루트 수입니다. 충돌 목록은 전체 원본·대상 경로와 ID를 포함합니다. 조상 대상 병합은 거부합니다. 원본 자동 소속은 병합 시 수동 소속으로 보존합니다. 완료된 생성 이력도 병합을 막는 참조입니다. 이력을 삭제하지 말고 원본을 유지하거나 이름을 바꿔 일반 이동하세요.

`move_image_groups`는 기본적으로 이름 충돌을 거부합니다. `preview:true`로 재귀 병합 목록과 `merge_token`을 조회하고 원본·대상 ID 및 원본 설정 소실을 사용자에게 알린 뒤 명시적으로 승인된 토큰만 실행에 사용하세요. 미리보기는 저장하지 않으며 변경된 그룹/소속은 다시 확인해야 합니다. 최상위 이동도 지원합니다. 일반 이동은 `images.edit`, 병합 실행은 `images.delete`도 검사합니다. 외부 DB 참조(생성 큐/이력·런타임 작업·채팅 프로필)가 있는 원본은 병합을 거부하며 원본을 보존합니다.

표의 **도구 범위**는 채팅 프로필·도구 프리셋에서 고르는 범위입니다. HTTP 키는 범위가 아니라 권한 그룹의 기능 권한(웹에서 같은 기능에 필요한 권한, 표의 **계정 권한**)으로 정해집니다. `configure` 도구는 HTTP 키에 제공되지 않습니다.

### 프롬프트 탐색

| Tool | 용도 |
| --- | --- |
| `search_prompts` | positive/negative/auto 프롬프트 검색 |
| `get_most_used_prompts` | 많이 사용된 프롬프트 조회 |
| `list_prompt_groups` | 프롬프트 그룹과 프롬프트 수 조회 |

### 프롬프트 그룹 정리

| Tool | 용도 |
| --- | --- |
| `get_prompt_group_structure` | 그룹 계층, 프롬프트 수, 미분류 수 조회 |
| `get_prompts_in_group` | 그룹 페이지 조회 (`group_id=0`은 미분류, 기본 50/최대 100개). `query`·`sort_by`·`sort_order` 지원. `include_total=false`는 정확한 `total`을 생략하며 `has_more`·`next_page`로 계속 조회 |
| `batch_create_groups` | 하나 또는 여러 그룹 생성 (`groups` 배열) |
| `move_prompts_between_groups` | 프롬프트 그룹 배정·이동 (지정 ID 1–100개 또는 원본 그룹 지정, 대상 0은 미분류) |
| `backup_prompt_data` | 프롬프트/그룹/설정 JSON 백업 생성 |
| `restore_prompt_data` | 백업에서 프롬프트 데이터 복원 |
| `list_backups` | 백업 파일 목록 조회 |

그룹 정리 작업은 실제 DB를 바꿉니다. 먼저 `backup_prompt_data`를 실행하고 구조를 확인한 뒤 이동하세요.

### 이미지 생성

| Tool | 용도 |
| --- | --- |
| `list_workflows` | 등록된 ComfyUI 워크플로우 조회 (기본은 이미지 워크플로, `kind: "audio"`·`"all"`로 음향 포함) |
| `list_comfyui_servers` | 등록된 ComfyUI 서버 조회 |
| `get_workflow_details` | 워크플로우 상세와 marked fields 조회 (시드 필드에는 `seed_rule` 표시) |
| `check_comfy_workflow` | 등록된 워크플로(`workflow_id`)나 초안(`workflow_json`, 일반 workflow는 먼저 API 형식으로 변환)을 저장·실행 없이 서버 검사 |
| `generate_comfyui` | 특정 ComfyUI 서버에서 생성 |
| `generate_comfyui_all_servers` | 활성 ComfyUI 서버 전체에서 병렬 생성 |
| `generate_nai` | NovelAI 생성 |

생성 도구는 실제 파일과 생성 이력을 만듭니다. 프롬프트, 서버, 그룹 ID를 확인하고 실행합니다.

ComfyUI 시드(`seed`·`noise_seed`)는 실행마다 새로 뽑힙니다. marked field로 0 이상의 값을 넘기거나, 워크플로 노드의 `_meta.conai_fixed_seeds`에 들어 있는 시드만 그대로 유지됩니다. `import_workflow_definition`은 ComfyUI 편집기 workflow도 받아 API 형식으로 바꿔 등록합니다(fixed였던 시드는 고정 유지).

### 이미지 조회

| Tool | 용도 |
| --- | --- |
| `search_images` | 프롬프트, 모델, 크기, 날짜, 그룹 등으로 이미지 검색 |
| `get_image_metadata` | composite hash로 이미지 메타데이터 조회 |
| `get_media_download` | composite hash(최대 50개)로 라이브러리 원본 파일(저장된 스프라이트 시트, 애니메이션, 이미지·영상) 다운로드 링크. 링크는 약 15분 유효 |
| `get_generation_history` | ComfyUI/NovelAI 생성 이력 조회 |
| `search_images_by_tags` | 자동 태거(WD 또는 PixAI) 태그, 캐릭터, 등급 조건으로 검색 |
| `search_images_by_meaning` | 그림 내용을 문장으로 설명해 뜻이 가까운 이미지 검색(라이브러리 설명 검색과 같음). 이미지 임베딩이 켜져 있어야 함 |
| `find_similar_images` | 이미지 하나와 내용(`content`, 이미지 임베딩) 또는 화풍(`style`, Kaloscope 화풍 벡터)이 비슷한 이미지 검색 |

### 이미지 그룹 정리

프롬프트 그룹과 별개인 **커스텀 이미지 그룹**을 관리합니다. 감시폴더나 실제 파일 경로를 이동하는 기능은 아닙니다.

| Tool | 용도 | 도구 범위 |
| --- | --- | --- |
| `list_image_groups` | 그룹 ID, 전체 경로, 이미지 수 조회 | `read` |
| `get_image_groups` | 이미지의 직접 소속 그룹과 수동/자동수집 구분 조회 | `read` |
| `get_image_group` | 그룹 하나의 이름·설명·색·이미지 수·자동수집 규칙 조회 | `read` |
| `resolve_image_group_path` | 경로로 그룹 조회·생성 (`create` 기본값 `true`) | `organize` |
| `create_image_group` | 그룹 생성. 자동수집 규칙을 주면 켜고 첫 수집을 바로 시작 | `organize` |
| `update_image_group` | 이름·설명·색·자동수집 켜기/끄기·규칙 교체 | `organize` |
| `run_group_auto_collect` | 자동수집이 켜진 그룹을 한 번 더 수집 (백그라운드 작업) | `organize` |
| `move_image_groups` | 그룹 여러 개를 다른 그룹 아래나 최상위로 이동. 잘못된 이동이 하나라도 있으면 전체 취소 | `organize` |
| `delete_image_groups` | 그룹 여러 개 삭제. `confirm_names`에 각 그룹의 지금 이름을 같은 순서로 적어야 함(다르면 거부). 하위 그룹은 기본적으로 최상위로 올리고 `cascade: true`면 함께 삭제. 이미지는 지우지 않음. `images.delete` 권한 필요 | `organize` |
| `add_images_to_group` | 기존 이미지를 그룹에 추가, 자동수집 소속은 수동으로 전환 | `organize` |
| `move_images_between_groups` | 선택 이미지를 원본 그룹에서 대상 그룹으로 이동 | `organize` |
| `remove_images_from_group` | 특정 그룹에서 선택 이미지의 소속 제거 | `organize` |

- 이미지 식별자는 `search_images` 또는 생성 결과의 `composite_hash`입니다. 변경 도구는 `composite_hashes` 배열로 1~500개를 받으며 중복은 한 번만 처리합니다.
- 그룹은 ID 또는 경로 중 하나로 지정합니다. 추가 도구의 `group_path`는 없는 그룹을 생성합니다. 이동·제외는 기존 그룹만 사용하므로, 새 대상 그룹이 필요하면 `resolve_image_group_path`로 먼저 생성합니다.
- 추가는 다른 그룹 소속을 유지합니다. `added`, `converted`, `skipped`, `missing_hashes`를 반환하며, 없는 이미지는 `skipped`에도 포함됩니다.
- 이동은 원본에 직접 속한 이미지만 처리합니다. 대상에 이미 있으면 원본 소속만 제거하고, 대상의 자동수집 소속은 수동으로 전환합니다. 원본과 대상이 같으면 오류입니다. `moved`, `added`, `converted`, `already_in_target`, `skipped`, `skipped_hashes`를 반환합니다.
- 제외는 원본 파일을 삭제하지 않습니다. `removed`, `skipped`, `skipped_hashes`를 반환합니다. 하위 그룹 소속으로 상위 그룹 목록에 보이는 이미지는 실제 소속 그룹을 조회한 뒤 제거해야 합니다.
- 추가·이동·제외는 요청 단위 트랜잭션으로 처리합니다. DB 오류가 나면 해당 요청 전체를 되돌립니다. 없는 이미지나 소속은 위 규칙대로 건너뜁니다.
- **이동·제외는 영구적인 자동수집 차단이 아닙니다.** 원본 그룹의 조건에 맞으면 자동수집 때 다시 들어올 수 있으며, 응답의 `auto_collection_may_readd: true`로 안내합니다.

- 자동수집 규칙(`auto_collect_rules`)은 그룹 편집기의 칩과 같은 형식입니다. `scope`는 `positive`/`negative`(프롬프트에 포함된 글), `auto_tag`(오토 태그, 일반·캐릭터), `model`, `lora`, `ai_tool`(`nai`/`comfyui`/`other`)이고, `operator`는 `AND`(모두 만족, 기본값), `OR`(하나 이상), `NOT`(제외)입니다. 규칙을 주면 기존 조건 전체를 교체합니다.
- 규칙으로 표현할 수 없는 조건(정규식, 등급 점수 등)이 저장된 그룹은 `get_image_group`이 `rules: null`과 원본 `custom_conditions`를 돌려줍니다. 이런 그룹에 규칙을 넘기면 기존 조건은 사라집니다.
- 자동수집을 끄면 앞으로의 수집만 멈추고, 이미 모은 이미지와 저장된 조건은 남습니다. 다시 켜면 저장된 조건으로 다시 수집합니다. 그룹 이동·삭제 도구는 없습니다.
- 채팅에서 그룹 페이지를 연결하면 같은 작업이 페이지 작업(`group.create`, `group.update`, `group.auto_collect`, `group.select`)으로 제안되고, 사용자가 적용을 눌러야 저장됩니다.

자동수집 그룹 생성 (`create_image_group`):

```json
{
  "name": "Misty",
  "parent_path": "Characters",
  "auto_collect_rules": [
    { "scope": "auto_tag", "operator": "AND", "value": "misty_(pokemon)" },
    { "scope": "negative", "operator": "NOT", "value": "lowres" }
  ]
}
```

이미지 소속 확인 (`get_image_groups`):

```json
{ "composite_hash": "대상 이미지의 composite_hash" }
```

그룹 추가 (`add_images_to_group`):

```json
{
  "composite_hashes": ["대상 이미지의 composite_hash"],
  "group_path": "프로젝트/선별"
}
```

그룹 이동 (`move_images_between_groups`, 두 그룹이 존재해야 함):

```json
{
  "composite_hashes": ["대상 이미지의 composite_hash"],
  "source_group_path": "프로젝트/검토중",
  "target_group_path": "프로젝트/선별"
}
```

그룹에서 제외 (`remove_images_from_group`):

```json
{
  "composite_hashes": ["대상 이미지의 composite_hash"],
  "group_path": "프로젝트/선별"
}
```

### 이모티콘 그룹

채팅 이모티콘으로 쓰는 그룹(커스텀 그룹에서 **LLM 이모티콘 그룹**을 켠 것)의 키워드를 관리합니다.

| Tool | 용도 | 도구 범위 |
| --- | --- | --- |
| `list_emoticon_groups` | 이모티콘 그룹과 이미지·키워드 수 조회 | `read` |
| `list_emoticons` | 그룹의 이미지별 키워드, 파일명, 상위 태그 조회 (`explicit: false`는 파일명 키워드) | `read` |
| `view_images` | 이미지(composite hash) 또는 파일 보관함 이미지(file id)를 최대 6개까지 작은 미리보기로 받아 보기 | `read` |
| `view_media_frames` | 영상이나 움직이는 GIF·WebP 하나(composite hash 또는 file id)를 시간대별 프레임으로 받아 보기. 기본 8장, 최대 16장을 전체 또는 `start_seconds`~`end_seconds` 구간에 고르게 뽑아 그림 한 장에 최대 4프레임씩(`frames_per_image`, 기본 4) 번호를 붙여 묶어 줌. 프레임별 시각은 텍스트로 함께 줌 | `read` |
| `set_emoticon_keywords` | 이미지별 키워드 지정 (`null`은 파일명으로 되돌림, `[]`은 키워드 없음). 겹치는 키워드는 건너뛰고 `conflicts`로 알림 | `organize` |
| `set_emoticon_group` | 커스텀 그룹을 이모티콘 그룹으로 켜고 끄기 | `organize` |

- `view_media_frames`는 채팅 자체 도구라서 **이미지를 볼 수 있는 모델**(Codex, 또는 비전을 켠 API LLM·Claude)이면 프로필의 도구 사용 설정·도구 목록과 상관없이 항상 제공됩니다. 라이브러리 미디어를 열 때는 계정의 이미지 보기 권한, 보관함 파일은 파일 조회 권한을 확인합니다.
- 채팅에서 `view_images`는 프로필에 **이미지를 볼 수 있는 모델**이 켜져 있을 때만 API LLM에 제공됩니다. 꺼져 있으면 모델은 파일명과 태그로 판단합니다.

### 월페이퍼

저장된 라이브 월페이퍼를 편집 화면 없이 조회·전환하고 시간대별 일정을 저장합니다(채팅 루틴·자동화용). 위젯·배경·테마 편집은 채팅에 연결한 월페이퍼 페이지의 작업으로 합니다.

| Tool | 용도 | 도구 범위 |
| --- | --- | --- |
| `list_wallpapers` | 저장된 월페이퍼(`id`, 이름, 수정 시각, 위젯 수, 캔버스), 라이브 월페이퍼, 일정, 지금 라이브 화면에 나오는 월페이퍼(`showing_now`: 일정·라이브·첫 저장본 중 무엇으로 정해졌는지와 서버 시각) 조회 | `read` |
| `set_live_wallpaper` | 저장된 월페이퍼(`preset_id`)를 라이브로 지정. 관리자 전용 | `organize` |
| `save_wallpaper_schedule` | 일정 전체 교체: `{ enabled, entries: [{ preset_id, days, start, end }] }`, 최대 48개. `days`는 0(일)~6(토), 생략·`[]`은 매일, 시각은 `HH:MM`. 관리자 전용 | `organize` |

- 세 도구 모두 이미지 보기 권한(`images.view`, 월페이퍼 화면과 같은 권한)이 필요하고, 변경 두 개는 편집 화면의 저장처럼 **관리자 계정**만 실행합니다. 관리자가 아닌 계정이나 HTTP 키의 호출은 `Administrator access required` 오류로 거부됩니다. 추가 승인 카드는 없습니다.
- 저장은 편집 화면과 같은 검증·저장 경로를 씁니다. 없는 월페이퍼 ID, 잘못된 시각·요일, 49개 이상의 구간은 거부되고 아무것도 바뀌지 않습니다.
- 겹치는 구간은 **위쪽(앞) 항목**이 이깁니다. 끝이 시작보다 이르면 자정을 넘기며 시작한 요일에 속하고, 시작과 끝이 같으면 하루 종일입니다. 일정 밖에서는 라이브 월페이퍼가 나옵니다.
- 런타임 키·`?preset` 링크·Lively/Wallpaper Engine 선택으로 고정된 화면은 일정과 라이브 지정보다 우선합니다. 일정 시각은 라이브 화면을 띄운 기기의 시계로 계산되며 `showing_now`는 서버 시계 기준입니다.
- 열려 있는 라이브 화면은 다음 설정 새로고침(최대 약 5분) 또는 새로고침 때 바뀐 값을 반영합니다. 편집 화면에서 저장했을 때와 같습니다.

### 파일 보관함

인스턴스 공용 파일 보관함입니다. 조회·편집·삭제 기능 권한은 유지합니다. 이미지 라이브러리와 따로 저장됩니다. 계정과 연결되지 않은 HTTP 키에는 제공되지 않습니다.

| Tool | 용도 | 도구 범위 |
| --- | --- | --- |
| `list_files` | 폴더 내용 조회 | `read` |
| `get_file_info` | 파일·폴더 정보 조회 | `read` |
| `read_file_text` | UTF-8 텍스트 파일을 나눠 읽기 | `read` |
| `search_files` | 이름·내용으로 파일 찾기 (띄어 쓴 단어 모두 포함, `"문장"`은 그대로) | `read` |
| `list_file_versions` | 텍스트 파일의 이전 버전 목록(최대 30개)과 누가 언제 바꿨는지 | `read` |
| `read_file_version` | 이전 버전 하나를 나눠 읽기 (`read_file_text`처럼 16KB까지) | `read` |
| `write_text_file` | md·html·txt 같은 텍스트 문서 새로 쓰기 (`overwrite`면 같은 이름 파일을 통째로 교체) | `organize` |
| `update_file_text` | 텍스트 파일 내용 전체 교체, `mode: "append"`면 끝에 이어 쓰기 | `organize` |
| `edit_file_text` | 텍스트 파일에서 `old_text`를 찾아 `new_text`로 바꾸기 (한 군데만 맞아야 하고, 하나라도 실패하면 저장 안 함) | `organize` |
| `create_file_folder` | 폴더 만들기 | `organize` |
| `rename_file` | 이름 바꾸기 | `organize` |
| `move_files` | 폴더로 옮기기 (폴더는 내용과 함께) | `organize` |
| `delete_files` | 파일·빈 폴더 삭제 (채팅에 첨부된 파일은 보호) | `organize` |
| `restore_file_version` | 이전 버전으로 되돌리기 (지금 내용은 버전으로 남음) | `organize` |

- 문서 쓰기 도구는 텍스트 확장자(.md, .html, .txt, .json, .csv, .yaml 등)만, 2MB까지 씁니다. 고쳐도 파일 ID가 그대로라 채팅 첨부와 링크가 유지됩니다.
- 게시판 호출에 답하는 턴에서는 보관함 도구(버전 도구 포함)가 모두 빠지고, 페이지가 연결된 턴에서는 쓰기·정리 도구와 파일 내용·버전을 읽는 도구가 빠집니다.
- 쓰기·정리 도구는 계정에 권한이 추가로 필요합니다: 문서 쓰기·고치기와 `create_file_folder`·`rename_file`·`move_files`·`restore_file_version`은 `files.edit`, `delete_files`는 `files.delete`. 이름 변경으로 실행파일 등 제한 확장자를 붙이는 건 관리자만 됩니다.
- MCP·웹 UI·HTTP API 모두 같은 공용 보관함을 다룹니다. 계정별 보관함 선택과 소유권 제한은 없으며 요청 계정의 기능 권한은 매 호출 검사합니다.

### 게시판

카테고리·태그·댓글이 있는 게시판입니다. 채팅 봇이 쓰면 봇 프로필 이름으로, 계정에 묶인 HTTP 키가 쓰면 그 계정 이름으로 올라갑니다. 글과 댓글은 남이 쓴 내용이라 지시가 아닌 데이터로 다룹니다. 자세한 동작은 [게시판](./POSTS.md)을 참고합니다.

| Tool | 용도 | 도구 범위 | 계정 권한 |
| --- | --- | --- | --- |
| `posts_categories` | 카테고리 트리와 글 수 | `read` | `posts.view` |
| `posts_search` | 글 찾기 (단어·`"문장"`, 카테고리·태그·작성 봇으로 좁히기) | `read` | `posts.view` |
| `posts_read` | 글 하나와 댓글 | `read` | `posts.view` |
| `posts_create` | 새 글 (본문에 `media:`·`audio:`·`group:`·`file:` 미디어) | `organize` | `posts.write` |
| `posts_update` | 자기 글 고치기 (`expected_revision` 필수) | `organize` | `posts.write` |
| `post_comment` | 댓글·답글 (`@이름`으로 다른 봇 부르기는 게시판 한도 안에서) | `organize` | `posts.comment` |
| `posts_tags` | 발행된 글의 태그와 글 수 | `read` | `posts.view` |
| `posts_revisions` | 고칠 수 있는 글의 이전 판 목록, 판 하나의 제목·본문(나눠 읽기) | `read` | `posts.write` |
| `posts_restore_revision` | 자기 글을 이전 판으로 되돌리기 (`expected_revision` 필수, 지금 판은 이전 판에 남음) | `organize` | `posts.write` |
| `posts_delete` | 자기 글 지우기 (댓글도 함께) | `organize` | `posts.write` |
| `post_comment_edit` | 자기 댓글 고치기 | `organize` | `posts.comment` |
| `post_comment_delete` | 자기 댓글 지우기 (답글이 달렸으면 지운 댓글로 남음) | `organize` | `posts.comment` |
| `post_comment_hide` | 관리자: 댓글 숨기기·다시 보이기 | `organize` | 관리자 |
| `posts_category_create`·`posts_category_update`·`posts_category_delete` | 관리자: 카테고리 만들기·고치기·지우기(빈 카테고리만) | `organize` | 관리자 |

- 관리자 도구 4개는 관리자 계정에 묶인 HTTP 키에만 나옵니다. 채팅 봇은 관리자 계정으로 돌아도 받지 않고, 게시판 페이지를 연결해 검토 카드로 합니다.
- 게시판 호출에 답하는 턴에서는 `posts_delete`·`posts_restore_revision`·`post_comment_delete`가 빠집니다(자기 답글 고치기는 됨).

### 음향

효과음 작업실(음향 탭)입니다. 프로젝트 → 그룹 → 후보(생성 테이크·업로드·편집본) 구조이고, 이미지 라이브러리와 따로 `audio.db`에 저장됩니다. 후보 식별자는 `candidate_id`이며 이미지의 `composite_hash`가 아닙니다. 도구의 "그룹"(audio group)은 화면의 효과음 하나이고, 화면에서 "그룹"이라 부르는 분류(UI, BGM 등)는 도구에서 폴더(`folder_id`)입니다. 효과음의 `description`은 사람이 읽는 설명이고, 생성 프롬프트는 `prompt`(대표 프롬프트)입니다.

`list_audio_projects`와 `list_audio_groups`는 `{ items, limit, offset, has_more, next_cursor }`를 반환합니다. `has_more`가 참이면 같은 프로젝트·검색·필터·`limit`을 유지하고 `next_cursor`를 다음 요청의 `cursor`로 넘깁니다. 커서는 0부터 시작하는 오프셋 문자열이며 `cursor`와 `offset`을 함께 주면 `cursor`가 우선합니다. 프로젝트는 생성 시각·ID 순, 효과음은 받은 파일 우선 후 생성 시각·ID 순입니다. 검색은 기존 Unicode 대소문자 처리를 유지합니다. 목록을 순회하는 중 추가·삭제가 일어나면 첫 페이지부터 다시 읽어 최신 상태를 확인하세요.

| Tool | 용도 | 도구 범위 | 계정 권한 |
| --- | --- | --- | --- |
| `list_audio_projects` | 프로젝트와 그룹·후보 수, 프로젝트별 받은 파일 그룹 ID. `limit`(기본/최대 200), `cursor` 또는 `offset`으로 페이지 조회 | `read` | `audio.view` |
| `list_audio_groups` | 프로젝트의 그룹, 설명·대표 프롬프트, 폴더, 파일명 규칙(`label`), 채택·코멘트 수, `project_name`. `project_id` 생략 시 전체 프로젝트의 같은 검색·필터를 조회. `limit`(기본/최대 200), `cursor` 또는 `offset` 지원 | `read` | `audio.view` |
| `list_audio_folders` | 프로젝트의 폴더(화면의 그룹)와 폴더별 효과음 수 | `read` | `audio.view` |
| `list_audio_candidates` | 그룹의 후보 목록(검수 상태, 길이, 출처) | `read` | `audio.view` |
| `get_audio_candidate` | 후보 하나의 출처(프롬프트, seed, 워크플로, 서버)와 검수 메모 | `read` | `audio.view` |
| `list_audio_group_comments` | 그룹에 남긴 작업 요청 코멘트(리비전 포함) | `read` | `audio.view` |
| `get_audio_download` | 후보 파일 또는 백그라운드 내보내기 결과의 다운로드 링크 | `read` | `audio.view` |
| `list_audio_workflows` | 음향 생성에 연결된 워크플로, 역할 필드, 호환성 검사 결과 | `read` | `audio.view` |
| `get_audio_order` | 생성 주문의 잡별 상태와 만들어진 후보 ID | `read` | `audio.view` |
| `create_audio_project` / `update_audio_project` | 프로젝트 만들기(받은 파일 그룹이 같이 생김)·수정 | `organize` | `audio.edit` |
| `create_audio_group` / `update_audio_group` | 그룹 만들기·수정(`label`이 내보내기 파일명 규칙, `folder_id`로 폴더 이동, `null`이면 폴더 밖) | `organize` | `audio.edit` |
| `create_audio_folder` / `update_audio_folder` | 폴더 만들기·이름 바꾸기 | `organize` | `audio.edit` |
| `delete_audio_group` / `delete_audio_folder` / `delete_audio_project` | 효과음(후보·코멘트·주문 포함)·폴더(안의 효과음은 프로젝트 바로 아래로 남음)·프로젝트 전체 삭제. 웹의 삭제 버튼과 같고, `confirm_name`에 지금 이름을 정확히 적어야 함(다르면 거부). 받은 파일 그룹은 못 지움 | `organize` | `audio.edit` |
| `move_audio_candidates` | 후보를 같은 프로젝트의 다른 그룹으로 이동 | `organize` | `audio.edit` |
| `import_audio` | `data_url`(audio/*, 최대 50MB) 또는 공용 파일 `file_id`(복사)를 후보로 추가 | `organize` | `audio.edit` (+`files.view`) |
| `set_audio_candidate_review` | 요청한 검수 상태·메모 반영 (`candidate_id`, `expected_revision`, `review`/`notes`) | `organize` | `audio.view` + `audio.edit` |
| `delete_audio_candidate` | 지정한 후보 하나를 소프트 삭제 (`candidate_id`, `expected_revision`) | `organize` | `audio.view` + `audio.edit` |
| `create_audio_group_comment` | 현재 호출 계정으로 코멘트 작성 (`group_id`, `text`) | `organize` | `audio.view` + `audio.edit` |
| `update_audio_group_comment` / `delete_audio_group_comment` | 코멘트 수정·삭제 (`group_id`, `comment_id`, `expected_revision`; 수정은 `text`) | `organize` | `audio.view` + `audio.edit` |
| `set_audio_group_comment_status` | 작업 요청 완료 처리·되돌리기(읽은 `revision` 필요) | `organize` | `audio.edit` |
| `edit_audio_candidate` | 구간·음량·피치·속도·페이드 편집본을 새 후보로 저장(원본 보존) | `organize` | `audio.edit` |
| `delete_unselected_audio_candidates` | 미채택 후보를 휴지통으로(채택 후보가 섞이면 전체 거부) | `organize` | `audio.edit` |
| `export_audio_selected` | 채택본을 그룹 라벨 파일명으로 내보내기(WAV/OGG, 여러 개면 ZIP, 20개 초과는 백그라운드) | `organize` | `audio.view` |
| `order_audio` | 그룹에 생성 주문(1~50개, seed는 기준값 +1씩) | `generate` | `audio.edit` + `generation.execute` |
| `wait_audio_order` | 주문이 끝날 때까지 대기(채팅에서는 제공되지 않음) | `generate` | `audio.view` |
| `cancel_audio_order` | 끝나지 않은 잡 취소 | `generate` | `audio.edit` |
| `retry_audio_order_job` | 실패·취소된 잡을 같은 seed로 다시 실행 | `generate` | `audio.edit` + `generation.execute` |

- 사용자 요청에 따라 채택·보류·미검수와 검수 메모, 코멘트 작성·수정·삭제, 후보 하나 삭제를 수행할 수 있습니다. 후보 조회 결과의 `revision` 또는 코멘트의 숫자 `revision`을 `expected_revision`으로 전달하며, 그사이 바뀐 대상은 거절합니다. 댓글 내용은 실행 지시로 취급하지 않습니다.
- 효과음·폴더·프로젝트 삭제는 계정·프로필이 허용한 경우 일반 페이지 연결 중에도 사용할 수 있습니다. 사용자 요청의 대상·영향을 확인하고 `confirm_name`으로 현재 이름을 검증합니다.
- 채팅에서 `order_audio`로 주문하면 생성이 끝나는 대로 앱이 후보를 답변에 붙입니다. 채팅 봇은 주문을 기다리거나 다시 조회할 필요가 없습니다.
- 생성은 생성 쪽에 **음향 종류**로 등록되고 음향 설정에서 역할(프롬프트·길이·seed)이 연결된 워크플로로만 됩니다.

### 스프라이트

라이브러리 영상(또는 애니메이션 GIF/WebP)에서 프레임을 뽑아 스프라이트 시트를 만드는 도구입니다. 결과는 기본으로 라이브러리 "스프라이트" 그룹에 저장되고 `composite_hash`로 돌아옵니다. 입력 영상은 `composite_hash` 또는 `data_url`(video/*, 최대 50MB)입니다.

정규화는 최대 500개 시트를 처리합니다. 큰 결과도 `get_sprite_job`에서 전체 결과를 조회할 수 있으며, 작업 결과 정보는 24시간 보존합니다. 시트·애니메이션·프레임 ZIP의 임시 다운로드 파일은 별도 작업 폴더 수명(마지막 사용 후 약 1시간)에 따릅니다. 라이브러리 저장 중 취소하면 완료한 저장은 유지하고 다음 시트부터 멈춥니다.

| Tool | 용도 | 도구 범위 | 계정 권한 |
| --- | --- | --- | --- |
| `get_video_info` | 영상 크기, fps, 길이, 프레임 수 | `read` | `images.view` |
| `get_sprite_job` | 스프라이트 작업 상태와 저장된 `composite_hashes`, 결과 파일 다운로드 링크 | `read` | `images.view` |
| `download_sprite_frames` | 끝난 추출의 프레임 ZIP 다운로드 링크(약 1시간 보관) | `read` | `images.view` |
| `extract_sprite_sheet` | 구간·간격/개수로 프레임 추출, 지정색 제거(디스필 선택), 자동 크롭·리사이즈·배치 | `generate` | `images.edit` + `images.upload` |
| `extract_sprite_sheets_batch` | 같은 옵션으로 영상 여러 개를 각각 시트로(작업 ID 반환, `zip: true`면 ZIP도) | `generate` | `images.edit` + `images.upload` |
| `normalize_sprite_sheets` | 기준점을 지키며 시트들의 셀 크기를 맞춤(시트별 / 묶음 공통) | `generate` | `images.edit` + `images.upload` |
| `create_sprite_animation` | 시트를 WebP(기본)·GIF·MP4 애니메이션으로 | `generate` | `images.edit` + `images.upload` |

- 지정색은 최대 8개입니다. 디스필은 색 1개일 때만 켤 수 있고, 마젠타 `#FF00FF`는 원래 도구와 같은 알고리즘입니다.
- 한 영상의 추출은 최대 256장입니다. 간격으로 계산한 요청 장수를 중복 프레임 제거 전에 검사하며, 화면 미리보기도 같은 제한을 사용합니다. 개수 추출은 선택한 구간에 실제로 있는 프레임 수를 넘을 수 없습니다.
- `extract_sprite_sheet`는 일정 시간 안에 끝나면 결과 해시를 바로 돌려주고, 길어지면 `job_id`를 돌려줍니다.
- 끝난 작업에는 저장된 결과마다 다운로드 링크(`downloads`)가 붙습니다. 배치는 요청 순서대로 `items`에 원본 영상(`video_hash`, 라이브러리 파일명 `video_name`)과 시트(`sheet_hash`, `download`) 또는 실패 사유(`error`)를 짝지어 주고, `zip: true`로 요청했으면 `zip_download`로 시트 전부와 매니페스트를 한 번에 받을 수 있습니다.
- 링크가 만료되면 `get_media_download`(시트·애니메이션) 또는 `refresh_artifact_download`로 새로 받습니다.

### 사용자 가이드

| Tool | 용도 | 도구 범위 | 계정 권한 |
| --- | --- | --- | --- |
| `get_app_guide` | 이 가이드(docs/GUIDE)를 읽음. 인자 없이 목차, `topic`이면 그 문서의 소개와 섹션 제목, `topic`+`section`이면 그 섹션, `offset`이면 문서 전체를 나눠서 | `read` | 없음(로그인만) |

- 채팅 봇이 앱 기능을 설명하거나 조언하기 전에 실제 화면·설정 설명을 확인하는 용도입니다. 모든 빌드(Docker·포터블·SEA)에 가이드 파일이 같이 들어갑니다.

### 캐릭터 라이브러리

[캐릭터 라이브러리](CHARACTER_LIBRARY.md)의 REST API·화면과 같은 서비스와 검증을 사용합니다.

| Tool | 주요 인자와 결과 | 도구 범위 / 계정 권한 |
| --- | --- | --- |
| `list_character_library` | `folder_id`(생략: 전체 설정, `null`: 최상위), `query`, `limit`, `offset`. 경로·바로 아래 폴더·페이지형 설정 요약을 반환하며 외형 본문은 제외합니다. | `read` / `characters.view` |
| `get_character_setting` | `setting_id`. 외형 태그·이미지 해시·표정 키워드 맵·그룹·`revision`을 조회합니다. | `read` / `characters.view` |
| `manage_character_folders` | `action: create`는 `name`, 선택 `parent_id`; `rename`은 `folder_id`, `name`; `move`는 `folder_id`, `parent_id`(`null`: 최상위). 즉시 정리하며 순환 이동·형제 이름 중복을 거부합니다. | `organize` / `characters.edit` |
| `propose_character_library` | `save_setting`, `delete_setting`, `delete_folder` 검토 카드. **채팅 전용**이며 카드 저장 전에는 변경하지 않습니다. | `organize` / `characters.edit` |

`save_setting`의 생성은 `input: {folderId, name, ...}`이며 `folderId: null`은 최상위입니다. 수정은 `setting_id`, 현재 `revision`, 바꿀 `input`을 전달합니다. `input` 필드명은 REST와 같은 camelCase입니다. `delete_setting`은 `setting_id`와 `revision`, `delete_folder`는 `folder_id`를 받습니다.

이미지 해시·표정 조회에는 `images.view`도 필요합니다. 연결 프로필 이름은 관리자에게만 보입니다. 오래된 설정 저장은 `409 revision_conflict`, 이름 중복은 `409 name_conflict`로 거부합니다. 충돌 후에는 설정을 다시 읽어 변경안을 확인하고 재제안하며, 사라진 폴더는 목록부터 다시 조회합니다. 설정·폴더 삭제는 동기화 프로필에 현재 외형을 복사하고 연결을 해제합니다.

`propose_profile_assets` / `get_asset_batch`는 동기화된 프로필을 지정하면 연결 설정의 배치를 사용합니다. 단, **배경만 생성하는 제안은 프로필 소유**이며 명시한 프로필 소유 `batch_id`의 조회·적용도 그 배치를 유지합니다. 명시적인 `setting_id`도 지원하며 `profile_id`와 함께 지정하지 않습니다. 설정 자산에는 배경 슬롯을 넣을 수 없고 배경은 프로필에서 관리합니다. 생성과 후보 적용은 각각 별도 승인 카드이며, 이 채팅 자산 도구는 기존 관리자 경계를 유지합니다.

### 채팅 설정 (configure)

채팅 에이전트가 채팅 프로필과 표시 블록의 설정을 읽고, 새 설정을 **제안**하는 도구입니다. `configure` 권한은 채팅 전용이며 관리자 전용입니다(계정 권한 `chat.tools.configure`). HTTP MCP 키에는 이 권한이 없습니다.

| Tool | 용도 |
| --- | --- |
| `get_chat_setup_guide` | 표시 블록(`display_block`), 프로필(`profile`: 제안할 수 있는 항목과 범위, 직접 바꿔야 하는 항목의 위치, 모델·판단 프리셋·평가 등급·로어북·공유 블록), 캐릭터 자산(`profile_assets`), 채팅 기능 사용법(`features`: `$` 나레이션, 답변 지시·분기, 파일 버전, 회의록, 기록할 곳, 연결 파일, 웹 검색, 외부 MCP) 가이드 조회 |
| `list_chat_profiles` | 프로필 목록: 이름, 소개, 엔진, 모델 표기, 연결된 블록·로어북 |
| `get_chat_profile` | 프로필 설정 조회(기본값은 지금 말하는 프로필): 텍스트, 역할별 모델·판단, 모델 값, 컨텍스트·요약, 번역 언어, 답장 추천, 이미지 보기·허용 등급, 로어 재귀, 연결 파일. 도구 권한·연결 정보는 포함되지 않고, 엔진·페이지 어시스턴트는 읽기 전용으로 보입니다. |
| `list_display_blocks` | 공유 표시 블록 목록: 이름, 키, 필드 이름, 연결된 프로필 |
| `get_display_block` | 표시 블록 하나를 전체로 조회 |
| `propose_display_block` | 새 표시 블록 제안 |
| `propose_chat_profile` | 새 프로필 제안(`settings`로 그 밖의 제안 가능 항목도 함께) |
| `propose_profile_update` | 기존 프로필의 변경 제안(변경 전·후 비교). 텍스트와 역할별 모델·판단 프리셋, 모델 값, 컨텍스트·요약, 번역 언어·지시, 답장 추천, 이미지 보기·허용 등급, 로어 재귀·로어 제안, 연결 파일을 제안할 수 있습니다. 엔진, 도구 권한, 허용 목록, 페이지 어시스턴트, 허용 그룹, 프리셋, 연결·모델 지정은 제안할 수 없습니다. |

- `propose_*` 도구는 답변 아래에 카드를 보여 줄 뿐 아무것도 저장하지 않습니다. 사용자가 카드에서 **저장**을 눌러야 반영됩니다.
- 제안 도구는 진행 중인 채팅 답변 안에서만 쓸 수 있습니다.
- 이 채팅 자체의 설정은 범위와 관계없이 `get_chat_settings`(연결 계정 로어북·기록할 곳·연결 파일·회의록 폴더 조회)와 `propose_chat_settings`(변경 카드, 채팅 주인이 저장)로 다룹니다. 도구 목차가 있는 채팅에서만, 페이지·게시판 호출 답변이 아닐 때만 제공되며 외부 MCP 클라이언트에는 없습니다.

### 리소스 조회

| Tool | 용도 |
| --- | --- |
| `list_custom_dropdown_lists` | LoRA, 체크포인트 등 커스텀 드롭다운 목록 조회 |
| `search_custom_dropdown_items` | 드롭다운 항목 검색 |
| `search_wildcards` | wildcard 이름, 계층, 루트 목록 검색 |
| `preview_random_prompt` | 와일드카드·`__tag:`·`__my:`·체인·가중치 범위가 들어간 프롬프트를 생성 화면 미리보기와 같은 해석기로 펼친 예시(최대 10개). 예시마다 따로 뽑으며 실제 생성은 다시 뽑습니다. 권한은 `wildcards.view` |
| `list_chat_rooms` | 내 채팅·그룹방 목록(ID, 제목, 캐릭터·참가자). 워크플로 노드의 채팅방 칸(`room_id`)에 쓸 ID 확인. 계정에 묶인 키는 그 계정의 방만, 계정이 설정된 뒤 묶이지 않은 키는 빈 목록 |

## 사용 예시

### 프롬프트 검색

요청 예:

```text
positive 프롬프트에서 "1girl"을 10개 찾아줘.
```

도구 인자 예:

```json
{
  "query": "1girl",
  "type": "positive",
  "limit": 10
}
```

### 그룹 정리 전 백업

요청 예:

```text
프롬프트 그룹 정리 전에 백업 만들고, 미분류 positive 프롬프트 50개를 보여줘.
```

권장 순서:

1. `backup_prompt_data`
2. `get_prompt_group_structure`
3. `get_prompts_in_group` (`group_id: 0`)
4. `batch_create_groups` (그룹 하나도 배열로 전달)
5. `move_prompts_between_groups` (`prompt_ids`, `target_group_id`)

### ComfyUI 생성

먼저 워크플로우와 서버를 확인합니다.

```text
ComfyUI 워크플로우 목록과 서버 목록을 보여줘.
```

그다음 marked field를 확인합니다.

```text
워크플로우 1번의 입력 필드를 보여줘.
```

생성 예:

```json
{
  "workflow_id": 1,
  "server_id": 1,
  "prompt_data": {
    "positive_prompt": "1girl, solo, beautiful scenery",
    "negative_prompt": "low quality"
  },
  "group_id": 12
}
```

### 모든 ComfyUI 서버에서 병렬 생성

```json
{
  "workflow_id": 1,
  "prompt_data": {
    "positive_prompt": "1girl, solo, sunset",
    "negative_prompt": "low quality"
  }
}
```

활성 서버 전체에 요청이 들어갑니다. 서버 수만큼 결과가 생깁니다.

### NovelAI 생성

```json
{
  "prompt": "1girl, solo, long hair, sunset",
  "negative_prompt": "low quality, bad anatomy",
  "model": "nai-diffusion-4-5",
  "width": 1024,
  "height": 1024,
  "steps": 28,
  "scale": 5,
  "n_samples": 1
}
```

NovelAI 생성은 웹 UI에서 NAI 토큰 로그인이 먼저 필요합니다.

### 이미지 검색

```json
{
  "search_text": "landscape",
  "min_width": 1024,
  "min_height": 1024,
  "limit": 20
}
```

### 태그 기반 검색

```json
{
  "tag_query": "blue eyes",
  "rating": "safe",
  "limit": 20
}
```

## 안전한 작업 순서

### 조회만 할 때

1. `search_*` 또는 `list_*`로 후보를 봅니다.
2. ID, hash, group_id를 확인합니다.
3. `get_*` 상세 도구로 확정합니다.

### 생성할 때

1. 서버/워크플로우/token 상태를 확인합니다.
2. marked field 이름을 확인합니다.
3. 작은 샘플로 1회 생성합니다.
4. 결과와 생성 이력을 확인합니다.
5. 대량 생성은 그다음에 합니다.

### 프롬프트 그룹을 바꿀 때

1. `backup_prompt_data`
2. 현재 그룹 구조 확인
3. 미분류/대상 그룹 확인
4. 소량 이동
5. 결과 재조회

## 제거

Claude Code에서 제거:

```bash
claude mcp remove conai
```

Hermes Agent에서는 `~/.hermes/config.yaml`의 `mcp_servers.conai` 항목을 지우고 재시작합니다.

## 문제 해결

### 연결이 안 됨

- CoNAI 백엔드가 실행 중인지 확인합니다: `curl http://localhost:1666/health`
- MCP URL이 `http://localhost:1666/mcp`인지 확인합니다.
- 설정에서 HTTP MCP가 활성인지, 클라이언트가 Bearer API 키를 보내는지 확인합니다.
- 프론트엔드 포트 `1677`에 연결하지 않았는지 확인합니다.
- 방화벽/원격 접속이면 서버 IP와 바인딩을 확인합니다.

### `GET /mcp`가 405를 반환함

인증 헤더가 있다면 정상입니다. CoNAI MCP는 stateless Streamable HTTP 서버라 `POST /mcp` 요청만 처리합니다.

### Claude Code에서 도구가 안 보임

```bash
claude mcp list
```

그리고 Claude Code 안에서:

```text
/mcp
```

그래도 안 보이면 등록 URL, transport 타입, CoNAI 백엔드 실행 상태를 다시 확인합니다.

### ComfyUI 생성 실패

- `list_workflows`로 workflow_id 확인
- `list_comfyui_servers`로 server_id 확인
- `get_workflow_details`로 marked field 이름 확인
- ComfyUI 서버가 켜져 있는지 확인

### NovelAI 생성 실패

- `NovelAI token not configured`: 웹 UI에서 NAI 로그인 필요
- `Active subscription required`: 유효한 구독 필요
- `Invalid or expired token`: 토큰 재로그인 필요
- `Invalid NovelAI request, nothing was sent to NovelAI: ...`: 서버가 요청을 NovelAI로 보내기 전에 거절했습니다. Anlas는 소모되지 않습니다. 메시지에 적힌 필드를 고쳐 다시 요청합니다. `prompt`가 비었거나, 허용되지 않은 `model`·`sampler`(`k_euler`, `k_euler_ancestral`, `k_dpmpp_2s_ancestral`, `k_dpmpp_2m`, `k_dpmpp_2m_sde`, `k_dpmpp_sde`)·`noise_schedule`·`uc_preset`을 넣었거나, 크기(64~4096, 64 배수)·스텝(1~50)·CFG(0~30)·생성 수(1~4)가 범위를 벗어난 경우입니다. 화면·채팅·MCP·그래프·재시도 모든 경로에서 큐 등록 시와 전송 직전에 같은 검사를 합니다.

### 프롬프트 그룹 정리 실수

`list_backups`로 백업을 찾고 `restore_prompt_data`를 사용합니다. 복원은 실제 데이터를 바꾸므로 대상 백업 파일명을 먼저 확인합니다.

## 플러그인 제작 도구

관리자 1:1 채팅의 `configure` 범위에는 `plugins` 카테고리의 제작 도구가 제공됩니다. `list_plugin_drafts`로 설치된 패키지와 제작 초안을 확인하고, `create_plugin_draft`로 새 패키지 또는 설치된 패키지의 복사본을 만듭니다. `read_plugin_draft`는 파일 목록·리비전과 필요한 텍스트 구간만 읽고, `edit_plugin_draft`는 현재 리비전과 재시도용 요청 ID로 파일 작성·정확한 문구 교체·이름 변경·삭제를 수행합니다. 변경은 비실행 초안에만 저장됩니다.

`prepare_plugin_install`은 저장한 리비전을 검증하여 변경 파일과 관리 화면 링크를 반환합니다. 상태 `needs_human_review`는 설치 성공이 아닙니다. 관리자는 링크를 열어 검토한 패키지를 적용하거나 ZIP으로 내보냅니다. 설치·활성화를 자동 승인하는 도구는 없으며, 외부 HTTP 키·게시판 봇 호출·플러그인 실행 문맥에는 제작 도구를 제공하지 않습니다. 제작 전 `get_app_guide`로 `PLUGIN_DEVELOPMENT`의 필요한 절을 읽습니다. [플러그인 가이드](PLUGINS.md#앱에서-제작수정내보내기)를 참고하세요.

`check_plugin_updates({pluginId?})`는 Git 저장소에 연결된 플러그인(전체 또는 하나)의 브랜치·태그가 가리키는 최신 커밋만 확인합니다. 아무것도 내려받거나 설치·활성화하지 않습니다. 결과는 플러그인별 연결 정보(`source`: 저장소·브랜치·설치 커밋·최신 커밋·확인 오류·`updateAvailable`)와 관리 화면 링크이며, 새 커밋이 있으면 상태가 `needs_human_review`, 없으면 `up_to_date`입니다. Git 업데이트는 관리자가 플러그인 관리의 **업데이트 검토**에서 검토하고 적용합니다. `list_plugin_drafts`의 설치 목록에도 연결된 플러그인의 `source`가 포함됩니다. 같은 제작 도구 범위(관리자 1:1 채팅, `configure`)에서만 제공합니다. [Git 저장소에서 설치·업데이트](PLUGINS.md#git-저장소에서-설치업데이트)를 참고하세요.

## 채팅 프로젝트 파일 도구

1:1 채팅에 작업 공간을 명시적으로 연결하면 Codex·Claude Code·Pi·직접 API LLM에 다음 도구가 직접 제공됩니다. 일반 채팅, 게시판 봇 호출과 외부 HTTP 키에는 자동으로 노출하지 않습니다. 대상은 서버가 확인한 현재 프로젝트이며 모델이 계정이나 프로젝트 ID를 바꿔 접근 범위를 넓힐 수 없습니다.

| 도구 | 역할 |
| --- | --- |
| `workspace_list` | 상대 경로 `target`의 관리 파일·폴더 목록, 페이지당 100개 |
| `workspace_read` | 최대 32개 텍스트 파일 읽기, 기본 파일당 128KB·합계 1MB, 리비전과 이어 읽기 위치 반환 |
| `workspace_search` | 이름·본문 검색, 페이지당 100개 항목의 앞 128KB. `nextOffset`·`partialFiles` 확인 |
| `workspace_apply` | 명시적 쓰기 연결에서 폴더 만들기·문서 작성·정확한 문장 교체·파일 이동. 최대 100개·요청 합계 8MB |

파일 인자는 `path` 대신 `target`을 사용합니다. 새 문서의 `expectedRevision`은 `null`, 기존 문서 변경은 읽기 결과의 리비전을 전달합니다. `requestId`는 동일 요청 재시도에 재사용하며 다른 작업에는 새 ID를 사용합니다. 배치는 첫 실패에서 멈추고 완료 항목을 반환합니다. 셸·명령·재귀 삭제는 제공하지 않습니다. 자세한 화면 사용법은 [파일 가이드](FILES.md#프로젝트-작업-공간)를 참고하세요.

### 완료 리소스 정리

연결된 프로젝트의 완료 자료는 `workspace_publish_resources`로 그룹 정리와 완료 문서·진행 목록 저장을 함께 요청할 수 있습니다. 파일 조회·편집, 이미지 조회·편집, 각 원본 종류의 조회 권한과 프로젝트 쓰기 연결이 필요합니다. 입력에는 두 문서의 현재 리비전, 진행 목록의 작업 ID와 재시도용 요청 ID를 포함합니다. 진행 목록은 items 배열의 id·target으로 해당 작업만 제거하며 목록 전체를 요청에 넣지 않습니다. 그룹 연결 후 문서 저장이 실패하면 목록은 남으므로 결과의 적용 항목과 최신 문서를 확인하세요. 그룹의 오디오·작업 문서 참조는 `list_group_resources`로 30개씩 조회합니다. 모델이 플러그인 서버 작업으로 제안한 완료 처리는 기존 앱 검토를 거칩니다.

## 다음 문서

- [프롬프트 관리](./PROMPTS_GUIDE.md)
- [이미지 생성 개요](./GENERATION_OVERVIEW.md)
- [ComfyUI 생성](./COMFYUI_GENERATION.md)
- [문제 해결](./TROUBLESHOOTING.md)

### 통합된 도구 이름 (2026-10-14)

중복 도구 4개를 아래 경로로 통합했습니다. 외부 MCP 호출과 개별 도구 허용 목록은 새 도구로 변경해야 합니다. 기존 허용 목록을 더 넓은 도구로 자동 치환하지 않으며, 통합 대상의 조회·편집 권한 검사는 그대로 유지합니다.

| 이전 도구 | 현재 호출 |
| --- | --- |
| `get_unclassified_prompts` | `get_prompts_in_group`에 `group_id: 0` |
| `create_prompt_group` | `batch_create_groups`에 `groups: [{ group_name, ... }]` |
| `assign_prompts_to_group` | `move_prompts_between_groups`에 `prompt_ids`, `target_group_id` (결과: `moved_count`, `fail_count`, `total`) |
| `wait_sprite_job` | `get_sprite_job`에 `wait_seconds` (기존 기본 대기는 120초이므로 명시적으로 전달) |

`get_sprite_job`은 대기를 생략하면 즉시 상태를 반환합니다. 대기는 외부 MCP 최대 600초, 채팅 최대 30초입니다. 단건 그룹 생성 결과는 `results[0]`에서 확인합니다.
