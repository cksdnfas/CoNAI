# Local automation context operations map

This document is the M1-CU1 baseline for the `local-automation-context-operations` roadmap. It turns the next crunch roadmap into a safe local execution map: CoNAI can improve automation handoff, workflow operations, and media review continuity without pushing, deploying, restarting services, changing package versions, changing auth/security/data policy, or creating external side effects.

## Capability horizon

`local-automation-context-operations` bundles three recommended next-roadmap items:

1. **Automation context handoff**: make local readiness, MCP/agent entry points, and approval-gated release context easier to inspect before any external operation.
2. **Workflow operations recovery**: tighten the operator view around workflow queue health, rerun/recovery decisions, runtime caveats, and rollback notes while keeping live execution approval-owned.
3. **Media review continuity**: make media review signals, staged cleanup evidence, similarity decisions, and release handoff exports easier to connect across local review sessions.

## Current surfaces

| Surface | Existing anchor | Local-only boundary |
| --- | --- | --- |
| Settings release readiness | `frontend/src/features/settings/components/release-readiness-tab.tsx` and `release-readiness-history.ts` | Records local review evidence and exports Markdown only; does not call backend action endpoints. |
| Workflow runtime observability | `frontend/src/features/module-graph/components/workflow-runner-panel.tsx` and `workflow-runtime-observability.ts` | Presents queue/retry/recovery/retention signals; does not restart services or mutate live queues outside user actions. |
| Media review intelligence | `frontend/src/features/media-review/media-review-page.tsx` and `media-review-utils.ts` | Builds review/quality/similarity/cleanup guidance; destructive cleanup remains approval-owned. |
| MCP and automation | `backend/src/mcp/*` and `docs/GUIDE/MCP_GUIDE.md` | MCP HTTP remains opt-in and must not be broadened without approval. |
| Release/runbook evidence | `docs/systems/26.6.9-*.md` and release readiness exports | Push, deploy, restart, live smoke, package version bump, tags, and public release actions remain user decisions. |

## M1 local context checklist

The first milestone should make the above surfaces easier for an operator or agent worker to reason about before touching implementation details.

- Keep capability language independent from package/app version changes.
- Reference existing local contracts before adding new UI behavior.
- Preserve current approval boundaries for push, deploy, server restart, auth/security/data/public API, destructive cleanup, credentials, and package/app version changes.
- Prefer contract scripts and documentation updates before runtime changes.
- Use canonical local verification: `npm run build`, `npm run verify:release-readiness`, and `git diff --check`.

## Implementation notes for later commit units

- Automation handoff improvements should extend existing release-readiness storage/export structures instead of adding live operation endpoints.
- Workflow operations changes should derive from already exposed runtime health records before considering new backend fields.
- Media continuity changes should keep cleanup and retention as evidence-only until separately approved.
- Any MCP or agent-facing changes must preserve opt-in boundaries and should be documented in `docs/GUIDE/MCP_GUIDE.md` before exposure changes.

## Approval boundary reminder

This roadmap is local implementation and verification only. It does not authorize push, deploy, server restart, package/app version changes, auth/security/data/public API changes, destructive cleanup, credential changes, or external service side effects.
