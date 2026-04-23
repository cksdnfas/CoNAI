# Codex Image-Generation Provider Integration

_Date: 2026-04-23_

## Goal

Add Codex as a first-class image-generation provider without creating a separate storage or UI path.

The integration should reuse CoNAI's existing generation architecture:
- Codex authentication is reused from the server's existing Codex CLI login state
- requests enter `generation_queue_jobs`
- results land in `api_generation_history`
- final files are saved through the normal generated-media pipeline under `uploads/API/...`
- the main image DB remains the source of truth for thumbnails, metadata extraction, search, and detail views

This should feel like "one more provider in the same system", not a parallel subsystem.

## Current Architectural Baseline

As of this document:
- Codex runs through the locally installed Codex CLI and inherits the server's existing login state
- queue orchestration is centralized in `backend/src/routes/generation-queue.routes.ts` and `backend/src/services/generationQueueService.ts`
- queue rows already support upstream trace IDs through `provider_job_id`
- generated outputs are persisted through `backend/src/services/GenerationHistoryService.ts`, `backend/src/services/APIImageProcessor.ts`, and `backend/src/utils/fileSaver.ts`
- result indexing is hash-first: `api_generation_history` links to the main image DB by `composite_hash`
- current first-class generation services are `comfyui` and `novelai`

Codex should plug into those same seams.

## Recommended Architecture

### 1. Authentication model
Codex should reuse the machine's existing Codex CLI authentication.

Implementation rule:
- do not ask CoNAI users to paste a second API key just for this provider
- do not hardcode credentials in route or worker code
- treat `codex exec --ephemeral` as the execution boundary for each job

If CoNAI later adds explicit Codex account management, that can be layered on top, but the current integration intentionally reuses the running server's login state.

### 2. Queue integration
Codex should submit work through the generation queue instead of a direct route-to-provider shortcut.

Recommended shape:
1. UI or API builds one normalized Codex request payload.
2. Backend creates one `generation_queue_jobs` row.
3. `GenerationQueueService` dispatches the job.
4. A Codex executor creates an isolated temp work directory and runs `codex exec --ephemeral` there.
5. The worker captures job-local logs and any available execution identifiers for debugging.
6. Final outputs are saved through the existing generated-media path.
7. Queue and history surfaces read the result the same way they already do for other providers.

This keeps retries, auditing, queue visibility, and future multi-provider scheduling in one place.

### 3. Result persistence
Codex output should not invent a new media store.

Use the existing pattern:
- create/update a generation-history row in `api_generation_history`
- write the actual file through `FileSaver.saveGeneratedImage(...)` or `saveGeneratedFile(...)`
- let the saved file receive a `composite_hash`
- use that hash to connect into the main searchable image system

That preserves existing thumbnailing, metadata extraction, grouping, and image-detail behavior.

## Temp-Directory Rule

### Required rule
Codex temporary files must be staged in CoNAI's **user runtime area**, not in a repository-root temp folder.

In this project that means a path under the runtime user base, for example:
- canonical app path: `runtimePaths.tempDir` + `/codex-*`
- deployed Windows example: `D:\\Share\\0_DEV\\Management\\Deploy\\CoNAI\\user\\temp\\codex-jobs`

The important rule is not "user home" by itself. The rule is: **inside CoNAI's user-scoped runtime data folder, outside tracked project content.**

### Why this rule matters
Do **not** stage Codex downloads or request artifacts under a repository-root `temp/` folder.

Reasons:
- provider temp files are operational, not project content
- repository-root temp folders are easier to accidentally commit, scan, or wipe during repo maintenance
- Codex payloads may contain transient originals, masks, or provider responses that should stay in CoNAI's runtime data area
- `runtimePaths.tempDir` already follows CoNAI's cross-environment user-data convention, so it is the right anchor here

### Cleanup expectation
The Codex temp root should have explicit cleanup rules:
- delete one-off staged files immediately after persistence
- keep short-lived debug artifacts only when debugging is enabled
- add periodic cleanup for orphaned files

## Queue and Result Flow

### Request phase
1. Client prepares a Codex generation request.
2. Backend validates required fields and normalizes the payload.
3. Backend creates a queue job with:
   - `service_type` extended to include Codex, or an equivalent provider-aware queue contract
   - `request_payload` containing only the normalized job input
   - `request_summary` for human-readable queue/history surfaces
4. Dispatcher wake is requested.

### Dispatch phase
1. `GenerationQueueService` picks the queued Codex job.
2. Worker transitions the job through `queued -> dispatching -> running`.
3. Worker creates a job-specific workspace under `runtimePaths.tempDir`.
4. Worker runs `codex exec --ephemeral --skip-git-repo-check --sandbox workspace-write` in that workspace.
5. If Codex yields stable identifiers or useful final messages, persist them in queue debug metadata and/or lightweight history metadata.

### Result phase
1. Worker receives generated image bytes, base64, or downloadable file references.
2. Any temporary material is written to the user-runtime Codex temp root only long enough to normalize/save it.
3. Worker creates a generation-history row.
4. Worker persists the final file through the existing generated-media pipeline.
5. The save step returns `composite_hash` and saved path info.
6. History row is updated to `completed` and linked by `composite_hash`.
7. Queue row transitions to `completed`.

### Failure phase
On any upstream or persistence failure:
- record a readable failure message on the queue row
- mark history as failed if a history row already exists
- clean up staged temp files best-effort
- keep enough request metadata for debugging without storing secrets

## Metadata Strategy

Codex metadata should follow CoNAI's existing rule: **the saved CoNAI file is authoritative, not the raw provider response.**

### What to keep
Store normalized, durable fields only:
- provider name: `Codex`
- model identifier
- original prompt
- revised prompt, if Codex returns one
- image size
- response/request id when available
- seed or variation id if the provider exposes one
- timestamp and basic generation mode

### Where to keep it
Use two layers:
1. **Operational traceability**
   - queue payload
   - `provider_job_id`
   - generation-history fields / lightweight metadata JSON
2. **File-embedded metadata when possible**
   - reuse `ImageMetadataWriteService`
   - embed a CoNAI-owned metadata payload instead of depending on Codex-native metadata formats

### Important constraint
Do not depend on Codex-native metadata being present inside returned images.

The safer strategy is:
- treat the upstream response as transport data
- map it into CoNAI's normalized metadata shape
- embed/persist that normalized shape during save when the output format supports it

That avoids provider-specific parsing becoming a hard dependency for search and detail views.

## Known Risks

1. **Service-type expansion risk**  
   Current queue/history typing is still centered on `comfyui` and `novelai`. Codex will require enum/schema/type updates across backend and frontend surfaces.

2. **Upstream async-contract mismatch**  
   Codex may not behave like ComfyUI queueing. If it lacks a stable job id, cancellation and progress may be weaker than existing queue semantics.

3. **Metadata fidelity risk**  
   Codex may return sparse metadata. CoNAI should not assume prompt, seed, or revised prompt are always available.

4. **Temp-file leakage risk**  
   If staging files are written outside the final save path and cleanup is missed, user-runtime temp usage can still accumulate quickly.

5. **Rate-limit and cost risk**  
   Codex requests may fail differently from local ComfyUI or NovelAI. Queue retry rules should avoid blind replays for quota-related failures.

6. **Format-conversion risk**  
   If Codex returns formats without useful embedded metadata, CoNAI must preserve its own normalized metadata during the save/rewrite step.

7. **Repository-temp drift risk**  
   This repository also contains non-runtime temp folders. Codex integration must deliberately stay anchored to `runtimePaths.tempDir` (the user runtime area), not an ad-hoc repository temp path.

## Recommended Integration Rule

If there is one decision to keep fixed, it is this:

> Codex should be a queue-backed provider that saves through the normal generated-media pipeline, while using a user-runtime scoped temp root for transient provider files.

That rule keeps the implementation aligned with the rest of CoNAI and avoids another special-case image path.
