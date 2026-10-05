# MCP 가이드

CoNAI는 MCP(Model Context Protocol) 서버를 제공합니다. Claude Code, Hermes Agent, Cursor류 MCP 클라이언트에서 CoNAI의 프롬프트, 이미지, 생성 이력, ComfyUI/NAI 생성 기능을 도구처럼 호출할 수 있습니다.

## 핵심 요약

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
claude mcp add --transport stdio conai -- node backend/dist/mcp/stdio.js
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
| `get_unclassified_prompts` | 미분류 프롬프트 배치 조회 |
| `get_prompts_in_group` | 특정 그룹 프롬프트 조회 (`group_id=0`은 미분류) |
| `create_prompt_group` | 그룹 생성 |
| `batch_create_groups` | 여러 그룹 생성 |
| `assign_prompts_to_group` | 프롬프트를 그룹에 배정 |
| `move_prompts_between_groups` | 프롬프트를 그룹 간 이동 |
| `backup_prompt_data` | 프롬프트/그룹/설정 JSON 백업 생성 |
| `restore_prompt_data` | 백업에서 프롬프트 데이터 복원 |
| `list_backups` | 백업 파일 목록 조회 |

그룹 정리 작업은 실제 DB를 바꿉니다. 먼저 `backup_prompt_data`를 실행하고 구조를 확인한 뒤 이동하세요.

### 이미지 생성

| Tool | 용도 |
| --- | --- |
| `list_workflows` | 등록된 ComfyUI 워크플로우 조회 |
| `list_comfyui_servers` | 등록된 ComfyUI 서버 조회 |
| `get_workflow_details` | 워크플로우 상세와 marked fields 조회 |
| `generate_comfyui` | 특정 ComfyUI 서버에서 생성 |
| `generate_comfyui_all_servers` | 활성 ComfyUI 서버 전체에서 병렬 생성 |
| `generate_nai` | NovelAI 생성 |

생성 도구는 실제 파일과 생성 이력을 만듭니다. 프롬프트, 서버, 그룹 ID를 확인하고 실행합니다.

### 이미지 조회

| Tool | 용도 |
| --- | --- |
| `search_images` | 프롬프트, 모델, 크기, 날짜, 그룹 등으로 이미지 검색 |
| `get_image_metadata` | composite hash로 이미지 메타데이터 조회 |
| `get_generation_history` | ComfyUI/NovelAI 생성 이력 조회 |
| `search_images_by_tags` | WD Tagger 태그, 캐릭터, 등급 조건으로 검색 |

### 이미지 그룹 정리

프롬프트 그룹과 별개인 **커스텀 이미지 그룹**을 관리합니다. 감시폴더나 실제 파일 경로를 이동하는 기능은 아닙니다.

| Tool | 용도 | HTTP MCP 키 권한 |
| --- | --- | --- |
| `list_image_groups` | 그룹 ID, 전체 경로, 이미지 수 조회 | `read` |
| `get_image_groups` | 이미지의 직접 소속 그룹과 수동/자동수집 구분 조회 | `read` |
| `resolve_image_group_path` | 경로로 그룹 조회·생성 (`create` 기본값 `true`) | `organize` |
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

| Tool | 용도 | HTTP MCP 키 권한 |
| --- | --- | --- |
| `list_emoticon_groups` | 이모티콘 그룹과 이미지·키워드 수 조회 | `read` |
| `list_emoticons` | 그룹의 이미지별 키워드, 파일명, 상위 태그 조회 (`explicit: false`는 파일명 키워드) | `read` |
| `view_images` | 이미지(composite hash) 또는 파일 보관함 이미지(file id)를 최대 6개까지 작은 미리보기로 받아 보기 | `read` |
| `set_emoticon_keywords` | 이미지별 키워드 지정 (`null`은 파일명으로 되돌림, `[]`은 키워드 없음). 겹치는 키워드는 건너뛰고 `conflicts`로 알림 | `organize` |
| `set_emoticon_group` | 커스텀 그룹을 이모티콘 그룹으로 켜고 끄기 | `organize` |

- 채팅에서 `view_images`는 프로필에 **이미지를 볼 수 있는 모델**이 켜져 있을 때만 API LLM에 제공됩니다. 꺼져 있으면 모델은 파일명과 태그로 판단합니다.

### 파일 보관함

계정별 개인 파일 보관함입니다. 이미지 라이브러리와 따로 저장됩니다. 계정과 연결되지 않은 HTTP 키에는 제공되지 않습니다.

| Tool | 용도 | HTTP MCP 키 권한 |
| --- | --- | --- |
| `list_files` | 폴더 내용 조회 | `read` |
| `get_file_info` | 파일·폴더 정보 조회 | `read` |
| `read_file_text` | UTF-8 텍스트 파일을 나눠 읽기 | `read` |
| `create_file_folder` | 폴더 만들기 | `organize` |
| `rename_file` | 이름 바꾸기 | `organize` |
| `move_files` | 폴더로 옮기기 (폴더는 내용과 함께) | `organize` |
| `delete_files` | 파일·빈 폴더 삭제 (채팅에 첨부된 파일은 보호) | `organize` |

- 정리 도구는 계정에 권한이 추가로 필요합니다: `create_file_folder`·`rename_file`·`move_files`는 `files.organize`, `delete_files`는 `files.delete`. 이름 변경으로 실행파일 등 제한 확장자를 붙이려면 `files.upload.any`도 있어야 합니다.
- MCP 도구는 항상 요청 계정 본인의 보관함만 다룹니다. 관리자의 다른 계정 보관함 탐색(`files.browse.all`)은 웹 UI·HTTP API(`?owner=`)에서만 됩니다.

### 리소스 조회

| Tool | 용도 |
| --- | --- |
| `list_custom_dropdown_lists` | LoRA, 체크포인트 등 커스텀 드롭다운 목록 조회 |
| `search_custom_dropdown_items` | 드롭다운 항목 검색 |
| `search_wildcards` | wildcard 이름, 계층, 루트 목록 검색 |

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
3. `get_unclassified_prompts`
4. `create_prompt_group` 또는 `batch_create_groups`
5. `assign_prompts_to_group`

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

### 프롬프트 그룹 정리 실수

`list_backups`로 백업을 찾고 `restore_prompt_data`를 사용합니다. 복원은 실제 데이터를 바꾸므로 대상 백업 파일명을 먼저 확인합니다.

## 다음 문서

- [프롬프트 관리](./PROMPTS_GUIDE.md)
- [이미지 생성 개요](./GENERATION_OVERVIEW.md)
- [ComfyUI 생성](./COMFYUI_GENERATION.md)
- [문제 해결](./TROUBLESHOOTING.md)
