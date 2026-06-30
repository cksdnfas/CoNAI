# Agent MCP local evidence export

This document records the local evidence export contract for the `agent-mcp-queue-recovery-media-stewardship` roadmap `M1-CU2-local-evidence-export` commit unit.

## Scope

- Provide a local dry-run evidence packet for agent-facing MCP review.
- Keep the packet exportable before an agent calls live MCP tools.
- Avoid push, deploy, server restart, package/app version changes, auth/security/data/public API changes, destructive cleanup, credential edits, live MCP calls, generation runs, or external service side effects.

## Local exporter

Run the exporter from the repository root:

```bash
npm run export:mcp-dry-run-evidence
```

Optional local review arguments:

```bash
npm run export:mcp-dry-run-evidence -- --client=claude-code --target=http://localhost:1666/mcp --tools=search_prompts,search_images,get_generation_history
```

The exporter writes JSON to stdout only. Redirect it to a local review file when needed:

```bash
npm run export:mcp-dry-run-evidence -- --client=hermes > mcp-dry-run-evidence.json
```

Do not treat the JSON file as approval. It is evidence for review before live operation.

## Packet contract

The exported packet includes:

```json
{
  "schemaVersion": 1,
  "backendHealth": "operator-check-required",
  "mcpHttpOptIn": "operator-check-required",
  "targetUrl": "http://localhost:1666/mcp",
  "client": "hermes",
  "toolsReviewed": [
    {
      "name": "search_prompts",
      "sideEffectClass": "read-only",
      "approvalRequired": false
    }
  ],
  "mutationApproved": false,
  "generationApproved": false,
  "backupRequiredBeforeMutation": false,
  "dryRunOnly": true,
  "externalSideEffects": false,
  "approvalBoundary": []
}
```

`backendHealth` and `mcpHttpOptIn` intentionally remain `operator-check-required` because this exporter does not start a server, call `/health`, or inspect a live operator shell. The operator or agent runbook must attach those observations separately.

## Tool review classes

| Side-effect class | Examples | Evidence behavior |
| --- | --- | --- |
| `read-only` | `search_prompts`, `search_images`, `get_generation_history`, `list_prompt_groups`, `list_custom_dropdown_lists`, `search_wildcards` | Reviewable in dry-run evidence after endpoint and target checks. |
| `safety-prerequisite` | `backup_prompt_data` | May appear as a prerequisite record; still verify backup filename before mutation. |
| `local-mutation` | `restore_prompt_data`, `create_prompt_group`, `batch_create_groups`, `assign_prompts_to_group`, `move_prompts_between_groups` | Sets `approvalRequired: true`; stop until explicit operator approval and backup evidence exist. |
| `generation-external-service` | `generate_comfyui`, `generate_comfyui_all_servers`, `generate_nai` | Sets `approvalRequired: true`; stop until explicit generation scope approval exists. |
| `unknown` | Any unclassified tool name | Sets `approvalRequired: true`; inspect and classify before live use. |

## Stop conditions

Stop and route approval instead of running MCP tools when:

- backend health, runtime data path, target URL, or `CONAI_MCP_HTTP_ENABLED` cannot be proven;
- any reviewed tool has `approvalRequired: true` without explicit operator approval;
- backup evidence is required before mutation but no fresh backup file is known;
- requested work would call a generation provider, mutate local data, restore data, delete data, deploy, restart, change credentials, change package/app versions, or touch public API/auth/security behavior.

## Verification

Local contract coverage:

```bash
npm run verify:mcp-local-evidence-export
```

The verifier checks the packet schema, side-effect classification, package script aliases, and documentation anchors without starting a server or calling MCP tools.
