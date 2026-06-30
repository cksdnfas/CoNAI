# MCP 가이드

CoNAI는 MCP(Model Context Protocol) 서버를 제공합니다. Claude Code, Hermes Agent, Cursor류 MCP 클라이언트에서 CoNAI의 프롬프트, 이미지, 생성 이력, ComfyUI/NAI 생성 기능을 도구처럼 호출할 수 있습니다.

## 핵심 요약

- 기본 HTTP 엔드포인트: `http://localhost:1666/mcp`
- 전송 방식: Streamable HTTP(권장), stdio(로컬 전용)
- HTTP 서버는 stateless 방식이라 `POST /mcp`만 사용합니다.
- HTTP MCP는 기본 비활성입니다. 신뢰된 로컬/내부망 클라이언트에만 `CONAI_MCP_HTTP_ENABLED=true`로 켭니다.
- 기본 백엔드 포트는 `1666`, 프론트엔드 포트는 `1677`입니다. 헷갈리면 바로 터집니다.

## 사전 조건

CoNAI 백엔드가 실행 중이어야 합니다.

```bash
npm run dev
```

HTTP 방식으로 연결하려면 `.env`에 다음 값을 추가하고 백엔드를 다시 시작합니다.

```ini
CONAI_MCP_HTTP_ENABLED=true
```

MCP 도구는 프롬프트/이미지 조회와 생성 작업을 실행할 수 있습니다. 외부 공개 주소에는 열지 말고, 공개 데모에서는 꺼진 상태를 기본으로 유지하세요. 로컬 stdio 방식은 이 값이 필요 없습니다.

프로덕션 실행 환경에서는 앱을 실행한 뒤 백엔드 URL을 확인합니다.

확인:

```bash
curl http://localhost:1666/health
```

MCP 엔드포인트는 브라우저 GET으로 보는 페이지가 아닙니다. `GET /mcp`는 405가 정상입니다.

## 연결 방식 선택

| 방식 | 추천 상황 | 특징 |
| --- | --- | --- |
| Streamable HTTP | 대부분의 클라이언트 | 실행 중인 CoNAI 백엔드에 연결 |
| stdio | 로컬 Claude Code/개발용 | Express 서버 없이 MCP 서버를 직접 실행, DB에 직접 접근 |

대부분은 HTTP를 쓰면 됩니다. stdio는 로컬에서 CoNAI 프로젝트 루트를 알고 있는 클라이언트에만 권장합니다.

## Claude Code 연결

### HTTP 방식

```bash
claude mcp add --transport http conai http://localhost:1666/mcp
```

다른 PC에서 접근한다면 `localhost` 대신 서버 IP를 씁니다.

```bash
claude mcp add --transport http conai http://<서버IP>:1666/mcp
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
      "url": "http://localhost:1666/mcp"
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
- 프론트엔드 포트 `1677`에 연결하지 않았는지 확인합니다.
- 방화벽/원격 접속이면 서버 IP와 바인딩을 확인합니다.

### `GET /mcp`가 405를 반환함

정상입니다. CoNAI MCP는 stateless Streamable HTTP 서버라 `POST /mcp` 요청만 처리합니다.

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
