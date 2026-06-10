# Agent MCP opt-in operation contracts

CoNAI MCP is an agent-facing local operations surface. This contract keeps it reviewable before any agent, automation runner, or external client can use it for real work.

## Activation boundary

- HTTP MCP is off by default.
- HTTP MCP may be enabled only with `CONAI_MCP_HTTP_ENABLED=true` for a trusted local or internal-network client.
- `POST /mcp` is the only supported HTTP MCP method in stateless mode.
- `GET /mcp` and `DELETE /mcp` stay method-denied even when HTTP MCP is enabled.
- Local stdio MCP is still local-only and must be launched from the CoNAI project root.

## Agent preflight contract

Before an agent uses CoNAI MCP for anything beyond local contract review, it must collect this evidence packet:

1. `curl http://localhost:1666/health` confirms the intended backend is reachable.
2. The backend process was started with `CONAI_MCP_HTTP_ENABLED=true` only when HTTP MCP is intended.
3. The MCP client target URL is `http://localhost:1666/mcp` or an approved internal host on port `1666`, not the frontend port `1677`.
4. The requested MCP tools are listed and classified as read-only, local mutation, generation, or destructive/approval-owned.
5. The operator has explicitly approved every generation, prompt-group mutation, restore, cleanup, or external-service call that would create data, files, requests, or other side effects.

## Tool side-effect classes

| Class | Examples | Agent behavior |
| --- | --- | --- |
| Read-only | `search_prompts`, `list_prompt_groups`, `search_images`, `get_image_metadata`, `get_generation_history`, `list_custom_dropdown_lists`, `search_custom_dropdown_items`, `search_wildcards` | Allowed after endpoint and target preflight. |
| Local mutation | `create_prompt_group`, `batch_create_groups`, `assign_prompts_to_group`, `move_prompts_between_groups`, `restore_prompt_data` | Requires a fresh backup and explicit operator approval. |
| Generation/external service | `generate_comfyui`, `generate_comfyui_all_servers`, `generate_nai` | Requires explicit operator approval for each run scope; confirm workflow/server/token readiness first. |
| Safety prerequisite | `backup_prompt_data`, list/detail tools used before mutation | Preferred before local mutation; still record the backup filename in evidence. |

## Dry-run evidence packet

A safe dry-run does not call mutating MCP tools and does not generate media. It records:

```json
{
  "backendHealth": "checked",
  "mcpHttpOptIn": "enabled-or-disabled-observed",
  "targetUrl": "http://localhost:1666/mcp",
  "client": "claude-code|hermes|other",
  "toolsReviewed": ["search_prompts", "search_images"],
  "mutationApproved": false,
  "generationApproved": false,
  "backupRequiredBeforeMutation": true
}
```

## Stop conditions

Stop and ask for approval when:

- HTTP MCP must be exposed beyond localhost or a trusted internal host.
- A requested tool creates, moves, restores, deletes, generates, uploads, or calls an external service.
- The target backend, runtime data path, or port cannot be proven.
- The requested work would require auth/security/public API/package version changes, deployment, restart, credential changes, or destructive cleanup.

## Verification

The local contract check is:

```bash
npm run verify:mcp-opt-in-operation-contracts
```

It verifies the HTTP opt-in guard, method boundary, package script aliases, and this operations contract without starting a server or touching runtime data.
