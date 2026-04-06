# Custom Node System Plan

## Goal

Add a local-first custom node system to CoNAI so users can drop node packages into `user/custom_nodes/<node-folder>/` and use them inside the module graph like built-in reusable modules.

This design targets a personal/local workflow environment, not a hosted multi-tenant platform. The system should therefore optimize for hackability and fast iteration while still protecting CoNAI from crashes caused by broken custom node code.

## Product Direction

### Primary principles

1. File system is the source of truth.
2. A custom node is one folder under `user/custom_nodes`.
3. CoNAI indexes custom nodes into `module_definitions` so the graph editor can reuse the existing module library and graph execution model.
4. Runtime restrictions should be minimal for local users.
5. Stability protection should come from process isolation, timeouts, and error capture rather than heavy permission systems.

### Non-goals for MVP

- Multi-user hosting security model
- Marketplace or package registry
- Python runtime support
- Frontend code editor for node source files
- Full dependency installation workflow inside the app

## Folder Layout

```text
user/
  custom_nodes/
    weather-api/
      node.json
      index.js
      README.md        # optional
      icon.png         # optional
      assets/          # optional
```

## Source of Truth

The custom node package on disk is canonical.

`module_definitions` should act as a searchable runtime index for graph usage, not as the primary authoring store. If a folder is added, edited, or removed, the registry sync should reconcile the DB state.

## MVP Runtime Model

### Engine type

Add a new graph engine type:

- `custom_js`

### Authoring source

Add a new module authoring source:

- `custom_node_fs`

### Execution model

Custom JS nodes should execute in a separate Node.js child process. This is not mainly for security. It is to prevent one broken or infinite-loop custom node from taking down the whole backend process.

### Runtime behavior

- Read manifest from `node.json`
- Load entry file from the node folder
- Pass resolved graph inputs into the custom node runtime
- Receive structured outputs back from the child process
- Store outputs through the existing graph artifact pipeline

## Manifest Format

Recommended MVP manifest:

```json
{
  "schemaVersion": 1,
  "key": "custom.weather_api",
  "name": "Weather API",
  "description": "Fetch weather JSON from an external API.",
  "version": "1.0.0",
  "runtime": "javascript",
  "entry": "index.js",
  "category": "Custom/API",
  "color": "#4fc3f7",
  "inputs": [
    {
      "key": "city",
      "label": "City",
      "data_type": "text",
      "required": true,
      "default_value": "Seoul"
    }
  ],
  "outputs": [
    {
      "key": "response_json",
      "label": "Response JSON",
      "data_type": "json"
    }
  ],
  "ui_schema": [
    {
      "key": "city",
      "label": "City",
      "data_type": "text"
    }
  ]
}
```

## Database Strategy

### Existing table reuse

Reuse `module_definitions` instead of introducing a parallel custom-node-only table for graph execution.

### Required additions

Extend `module_definitions` support with:

- `engine_type = 'custom_js'`
- `authoring_source = 'custom_node_fs'`
- `external_key` for stable file-backed node identity
- `source_path` for the node folder path
- `source_hash` for change detection

## Registry Sync Model

### Scan process

1. Enumerate folders under `user/custom_nodes`
2. Read `node.json`
3. Validate manifest shape
4. Convert manifest into one `module_definitions` row
5. Upsert by `external_key`
6. Mark missing file-backed nodes inactive if their folders are gone

### Startup behavior

- Ensure `user/custom_nodes` exists
- Run one registry sync at backend startup after the user DB is ready
- Log loaded node count and load errors

### Later behavior

Post-MVP, add a file watcher to auto-rescan changed node folders.

## Execution Contract

MVP custom node entry file should export a handler through one of these patterns:

- `module.exports = async function run(ctx) { ... }`
- `exports.run = async function run(ctx) { ... }`
- `export default async function run(ctx) { ... }` when using an ESM entry such as `.mjs`

CommonJS example for `index.js`:

```js
module.exports = async function run(ctx) {
  const city = ctx.inputs.city ?? 'Seoul'
  const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
  const data = await response.json()

  return {
    outputs: {
      response_json: data,
      summary_text: `${city} weather loaded`
    }
  }
}
```

## Output Type Rules

MVP output support:

- `text`
- `prompt`
- `number`
- `boolean`
- `json`
- `any`

Image and mask output support can be added after the basic JS runtime is stable.

## API Surface

### MVP endpoints

- `GET /api/custom-nodes`
- `POST /api/custom-nodes/rescan`

### Post-MVP endpoints

- `POST /api/custom-nodes/scaffold`
- `POST /api/custom-nodes/:key/test`
- `GET /api/custom-nodes/:key/source`

## UI Surface

### MVP

- Reuse module library by syncing custom nodes into `module_definitions`
- Show custom JS modules in the normal graph module library
- Add engine label support for `custom_js`

### Post-MVP

- Settings page for custom node status
- Open folder button
- Rescan button
- Load error details
- Scaffold wizard

## Implementation Phases

### Phase 1 — Foundations

- Add runtime path for `user/custom_nodes`
- Add schema support for `custom_js` and `custom_node_fs`
- Add `external_key`, `source_path`, `source_hash`
- Create file-system registry service
- Add rescan/list API
- Sync file-backed nodes into `module_definitions`

### Phase 2 — Graph execution

- Add `custom_js` execution branch to graph workflow executor
- Implement child-process runner
- Validate runtime outputs against output port definitions
- Persist artifacts and logs

### Phase 3 — UX improvements

- Add scaffold API
- Add file watcher auto-reload
- Add frontend custom node management UI
- Add test-run tooling

## Recommended First Success Criteria

1. Drop a valid node folder into `user/custom_nodes`
2. Start the backend or call rescan
3. See a synced `custom_js` module in module definition APIs
4. Build still passes
5. Existing module graph behavior remains unchanged for non-custom modules
