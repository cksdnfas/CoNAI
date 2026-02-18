# MCP (Model Context Protocol) Guide

ComfyUI Image Manager는 MCP 서버를 내장하고 있어, Claude Code, OpenClo 등 MCP 호환 AI 클라이언트에서 프롬프트 탐색, 이미지 생성, 생성 이력 조회 등을 직접 수행할 수 있습니다.

## 제공 Tools

### 프롬프트 탐색

| Tool | 설명 |
|------|------|
| `search_prompts` | 프롬프트 검색 (positive/negative/auto 타입 지원) |
| `get_most_used_prompts` | 가장 많이 사용된 프롬프트 조회 |
| `list_prompt_groups` | 프롬프트 그룹 목록 조회 (프롬프트 수 포함) |

### 이미지 생성

| Tool | 설명 |
|------|------|
| `list_workflows` | ComfyUI 워크플로우 목록 조회 |
| `list_comfyui_servers` | ComfyUI 서버 목록 조회 |
| `generate_comfyui` | ComfyUI를 통한 이미지 생성 |
| `generate_nai` | NovelAI를 통한 이미지 생성 |

### 이미지 조회

| Tool | 설명 |
|------|------|
| `search_images` | 이미지 고급 검색 (프롬프트, 모델, 크기, 날짜 등) |
| `get_image_metadata` | 특정 이미지의 상세 메타데이터 조회 |
| `get_generation_history` | 이미지 생성 이력 조회 |

---

## 사용 방법

### 사전 조건

ComfyUI Image Manager 백엔드 서버가 실행 중이어야 합니다.

```bash
# 개발 모드
npm run dev

# 또는 프로덕션
npm run start
```

기본 포트: `1566`

### 방법 1: Streamable HTTP (권장)

백엔드 서버가 실행 중일 때, `/mcp` 엔드포인트를 통해 MCP 클라이언트와 통신합니다.

#### Claude Code에서 설정

```bash
claude mcp add --transport http comfyui-image-manager http://localhost:1566/mcp
```

외부 네트워크에서 접근하는 경우:
```bash
claude mcp add --transport http comfyui-image-manager http://<서버IP>:1566/mcp
```

#### 설정 확인

```bash
claude mcp list
```

Claude Code 내에서:
```
/mcp
```

### 방법 2: Stdio (로컬 전용)

백엔드 서버 없이 독립적으로 MCP 서버를 stdio 모드로 실행합니다. DB에 직접 접근합니다.

#### Claude Code에서 설정

```bash
# 프로젝트 루트에서
claude mcp add --transport stdio comfyui-image-manager -- npx tsx backend/src/mcp/stdio.ts
```

빌드된 버전 사용:
```bash
claude mcp add --transport stdio comfyui-image-manager -- node backend/dist/mcp/stdio.js
```

### 방법 3: 프로젝트 설정 파일 (.mcp.json)

프로젝트 루트에 `.mcp.json` 파일을 생성하면 팀원들과 MCP 설정을 공유할 수 있습니다.

```json
{
  "mcpServers": {
    "comfyui-image-manager": {
      "type": "http",
      "url": "http://localhost:1677/mcp"
    }
  }
}
```

stdio 방식:
```json
{
  "mcpServers": {
    "comfyui-image-manager": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "backend/src/mcp/stdio.ts"]
    }
  }
}
```

---

## Tool 사용 예시

### 프롬프트 검색

```
"1girl" 키워드로 프롬프트를 검색해줘
```

MCP Tool 호출:
```json
{
  "name": "search_prompts",
  "arguments": {
    "query": "1girl",
    "type": "positive",
    "limit": 10
  }
}
```

### 가장 많이 사용된 프롬프트 확인

```
가장 많이 사용된 프롬프트 20개를 보여줘
```

### ComfyUI 이미지 생성

```
워크플로우 1번으로 ComfyUI 서버 1에서 이미지를 생성해줘.
프롬프트는 "1girl, solo, beautiful scenery"로 설정해줘.
```

MCP Tool 호출:
```json
{
  "name": "generate_comfyui",
  "arguments": {
    "workflow_id": 1,
    "server_id": 1,
    "prompt_data": {
      "positive_prompt": "1girl, solo, beautiful scenery",
      "negative_prompt": "low quality"
    }
  }
}
```

### NovelAI 이미지 생성

```
NovelAI로 "1girl, solo, long hair, sunset" 프롬프트로 이미지를 생성해줘
```

MCP Tool 호출:
```json
{
  "name": "generate_nai",
  "arguments": {
    "prompt": "1girl, solo, long hair, sunset",
    "negative_prompt": "low quality, bad anatomy",
    "model": "nai-diffusion-4-5",
    "width": 1024,
    "height": 1024,
    "steps": 28,
    "scale": 5.0
  }
}
```

> **참고:** NovelAI 생성을 사용하려면 웹 UI에서 먼저 NAI 토큰으로 로그인해야 합니다.

### 이미지 검색

```
"landscape" 프롬프트가 포함된 1024x1024 이상의 이미지를 검색해줘
```

MCP Tool 호출:
```json
{
  "name": "search_images",
  "arguments": {
    "search_text": "landscape",
    "min_width": 1024,
    "min_height": 1024,
    "limit": 20
  }
}
```

### 생성 이력 조회

```
최근 NovelAI 생성 이력을 보여줘
```

MCP Tool 호출:
```json
{
  "name": "get_generation_history",
  "arguments": {
    "service_type": "novelai",
    "limit": 10
  }
}
```

---

## MCP 서버 제거

```bash
claude mcp remove comfyui-image-manager
```

## 문제 해결

### MCP 연결이 안 될 때

1. 백엔드 서버가 실행 중인지 확인: `http://localhost:1566/health`
2. MCP 엔드포인트 확인: `curl -X POST http://localhost:1566/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'`
3. Claude Code에서 `/mcp` 명령으로 연결 상태 확인

### NovelAI 생성 오류

- "NovelAI token not configured" → 웹 UI에서 먼저 NAI 토큰으로 로그인 필요
- "Active subscription required" → 유효한 NovelAI 구독 필요
- "Invalid or expired token" → 토큰 재로그인 필요

### ComfyUI 생성 오류

- "Workflow not found" → 워크플로우 ID 확인 (`list_workflows` Tool 사용)
- "Server not found" → 서버 ID 확인 (`list_comfyui_servers` Tool 사용)
- "ComfyUI API error" → ComfyUI 서버 실행 여부 확인
