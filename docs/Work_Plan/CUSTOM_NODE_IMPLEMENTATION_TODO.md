# Custom Node Implementation TODO

## Active scope

Implement the MVP foundations for local file-based custom nodes.

## Success criteria

- `user/custom_nodes` exists as a runtime directory
- backend schema accepts `custom_js` and `custom_node_fs`
- backend can scan node folders from disk
- backend can sync valid manifests into `module_definitions`
- backend exposes list/rescan endpoints for custom nodes
- backend build passes

## Phase 1 — Foundation

- [x] Add `customNodesDir` to `runtimePaths`
- [x] Ensure `user/custom_nodes` is created on startup
- [x] Include the directory in startup checks
- [x] Extend graph module engine/source types with `custom_js` / `custom_node_fs`
- [x] Extend `module_definitions` schema checks
- [x] Add `external_key`, `source_path`, `source_hash` columns or compatible migration path

## Phase 2 — Registry sync

- [x] Add manifest parser/validator for `user/custom_nodes/*/node.json`
- [x] Add registry service to scan node folders
- [x] Convert manifest inputs/outputs into module definition shapes
- [x] Upsert file-backed module rows by `external_key`
- [x] Mark missing file-backed custom nodes inactive during sync
- [x] Log manifest errors without crashing startup

## Phase 3 — API

- [x] Add `GET /api/custom-nodes`
- [x] Add `POST /api/custom-nodes/rescan`
- [x] Return valid nodes and load errors in a simple admin-friendly response

## Phase 4 — Execution

- [x] Add `custom_js` branch to graph executor
- [x] Implement child-process custom JS runner
- [x] Pass resolved node inputs into the runner
- [x] Capture structured outputs and logs
- [x] Persist outputs as runtime artifacts
- [x] Add timeout handling for runaway nodes

## Phase 5 — UX follow-up

- [x] Add frontend API bindings for custom nodes
- [x] Show `custom_js` nodes cleanly in the module library
- [x] Add scaffold endpoint and starter templates
- [x] Add test-run endpoint for ad-hoc custom node execution
- [ ] Add file watcher auto-reload
- [x] Add a basic custom node management view

## Implementation notes

- Keep file system as the source of truth
- Keep MVP JavaScript-only
- Prefer simple JSON-serializable outputs first
- Avoid building a heavy permission model for the local-only MVP
- Use process isolation for stability, not policy enforcement
- Smoke verification performed with a temporary file-backed node folder that was synced into `module_definitions`, run through the custom JS runner, and then removed/resynced to confirm deactivation behavior
