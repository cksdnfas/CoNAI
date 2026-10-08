# Agent MCP opt-in operation contracts

CoNAI MCP is an agent-facing local operations surface. This contract keeps it reviewable before any agent, automation runner, or external client can use it for real work.

## Activation boundary

- HTTP MCP is off by default.
- HTTP MCP is enabled from Settings and requires a valid Bearer API key on every request.
- `POST /mcp` is the only supported HTTP MCP method in stateless mode.
- `GET /mcp` and `DELETE /mcp` stay method-denied even when HTTP MCP is enabled.
- Local stdio MCP is still local-only and must be launched from the CoNAI project root.

## Agent preflight contract

Before an agent uses CoNAI MCP for anything beyond local contract review, it must collect this evidence packet:

1. `curl http://localhost:1666/health` confirms the intended backend is reachable.
2. Settings shows HTTP MCP as enabled and the client holds the current API key.
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
| Read-only (audio, sprite) | `list_audio_projects`, `list_audio_groups`, `list_audio_candidates`, `get_audio_candidate`, `list_audio_group_comments`, `list_audio_workflows`, `get_audio_order`, `wait_audio_order`, `get_audio_download`, `get_video_info`, `get_sprite_job`, `wait_sprite_job`, `download_sprite_frames` | Allowed after preflight. Download links are short-lived and owner-checked. |
| Local mutation (audio) | `create_audio_project`, `update_audio_project`, `create_audio_group`, `update_audio_group`, `move_audio_candidates`, `import_audio`, `set_audio_group_comment_status`, `edit_audio_candidate`, `export_audio_selected` | Requires operator approval for the target project/group. Edits create new candidates; sources are never changed. |
| Destructive, restorable (audio) | `delete_unselected_audio_candidates` | Soft delete to the trash, never touches selected takes; still needs explicit approval of the frozen candidate list. |
| Generation (audio, sprite) | `order_audio`, `retry_audio_order_job`, `cancel_audio_order`, `extract_sprite_sheet`, `extract_sprite_sheets_batch`, `normalize_sprite_sheets`, `create_sprite_animation` | Requires explicit approval per run scope. Audio orders use GPU time on ComfyUI servers; sprite tools write new library media. |
| Human-only (no tool) | audio review (adopt / reject / pending), review memo, writing or deleting group comments | Not exposed over MCP at all; ask the operator to do it in the web app. |

## Stop conditions

Stop and ask for approval when:

- HTTP MCP must be exposed beyond localhost or a trusted internal host.
- A requested tool creates, moves, restores, deletes, generates, uploads, or calls an external service.
- The target backend, runtime data path, or port cannot be proven.
- The requested work would require auth/security/public API/package version changes, deployment, restart, credential changes, or destructive cleanup.
