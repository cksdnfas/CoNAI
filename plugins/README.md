# CoNAI web extension API v1

This directory contains the shared SDK and three installable development examples, not automatically installed app features:

| Example | Demonstrates |
| --- | --- |
| `text-editor` | File reading, draft editing, page assistant actions and host-reviewed saving. The app already has a built-in document editor. |
| `app-workbench` | Native app tools, project access and headless server actions. |
| `chat-instructions` | A trusted server module, persistent rules, chat hooks and an MCP tool. |

Build an example with `node scripts/build-plugin.mjs text-editor`, then upload `build-output/plugins/text-editor.zip` at `/#/settings?section=plugins` and enable it as an administrator.

Personal packages belong in `local-plugins/<plugin-name>/`, excluded from Git and Docker build contexts. Build them explicitly with `node scripts/build-plugin.mjs --local <plugin-name>`; ZIPs go to `build-output/local-plugins/`. Keep package-specific documentation and tests under `local-plugins/` too. These local sources need a separate personal backup; a repository clone does not include them. Public examples and host tests must not depend on personal packages.

## Package contract

ZIP root contains `plugin.json`, HTML entry points and static assets. See [the working manifest](text-editor/plugin.json) and [SDK](sdk/conai-plugin.js). IDs use lowercase letters, digits and hyphens; versions use `major.minor.patch`. Each page declares `id`, `title`, `entry`, supported filename extensions in `accepts`, and up to 26 actions. An empty `accepts` list permits opening without files and accepts any selected filename; each API still enforces its data type limits.

An action ID is `<pluginId>.<action>` with `effect: "draft"` and explicit `tier: "view" | "draft"`. The tier describes the page interaction; it grants no write authority. Arguments use the existing bounded CoNAI page JSON schema. The server checks snapshots and action arguments against the installed manifest. Unknown actions fail closed. Actions and private data keys keep the native page limits and filters.

Capabilities are `files.read`, `files.write`, `files.media`, `workspace.read`, `workspace.write`, `workspace.media`, `media.process` and `server` (see [Server modules](#server-modules)). They intersect with current account permissions and explicitly selected files or a connected project. File provenance is not an access boundary; plugin connections and approvals remain bound to the initiating account and session. ZIP limits: 8 MiB compressed, 16 MiB expanded, 4 MiB per file, 256 entries, 100 installed packages. Traversal, links, encrypted/duplicate entries and unsupported asset types are rejected. Assets may be `.html .js .mjs .css .json .png .jpg .jpeg .webp .gif .ico .svg .woff .woff2 .ttf .otf .wasm .md .txt .csv .mp3 .wav .ogg`. No install scripts or package manager hooks execute; only a declared server module runs (trusted packages). Initial installation is disabled.

Uploading a package whose id is already installed updates it in place: files are swapped, the plugin's data folder (`plugins/data/<id>/`) is kept, open windows close and pending app requests are cancelled. The same package again is refused. A version that asks for more than the installed one (new capabilities or app tools) is turned off and has to be enabled again. Removing a plugin deletes its data folder too.

## Host bridge

Load the SDK as a local module and call `await connectPlugin(handlers)`. The host sends a `MessageChannel` only to the iframe it created. SDK exposes `files`, `language`, `request(method, args)`, `publish(snapshot)`, and `onSaved(listener)`. Never emulate a host approval or use raw `/api` requests from the iframe.

### Look like the app

`scripts/build-plugin.mjs` adds `conai-plugin.css` beside `conai-plugin.js`. Link it before your own stylesheet (`<link rel="stylesheet" href="conai-plugin.css"><link rel="stylesheet" href="style.css">`) and keep your file to layout. It styles text, labels, inputs, buttons (`.primary` for the one main action, `.ghost`, `.destructive`), `.toolbar`, `.stack`, hairline `.row` / `.list`, tables, `pre`, `details` and `.badge` (`.ok`, `.warn`, `.destructive`) in the app's flat style. Colours and fonts are `--conai-*` variables: the connect message carries `theme: { scheme: 'dark' | 'light', vars }` with the app's current `background`, `foreground`, `muted-foreground`, `primary`, `primary-foreground`, `line`, `field`, `fill`, `surface-high`, `destructive`, `success`, `warning`, `font-sans` and `font-mono`, and the SDK sets them on `<html>` (plus `color-scheme` and `data-theme`) when it connects. Without them the sheet keeps the app's dark defaults. Use the variables in your own rules instead of fixed colours or `light-dark()`, which follows the OS rather than the app. Write Korean UI copy in the app's casual register (반말).

| Method | Input | Result |
| --- | --- | --- |
| `files.readText` | `{ fileId }` | `{ id, name, text, revision, ... }`, UTF-8 up to 2 MiB |
| `files.proposeWrite` | `{ fileId, text, revision }` | `{ proposalId, status: 'pending' }`; no file modification |
| `files.media` | `{ fileId }` | `{ url, expiresAt }`; read-only bearer URL valid for 60 seconds |

Set `crossOrigin = 'anonymous'` before setting an image/video URL when canvas pixel access is needed. Renew expired media URLs through the SDK. Grants bind the selected file revision, connection and live account permissions; close/disable invalidates them. Do not log token URLs. Session logout alone may leave a grant usable for the remainder of its 60-second lifetime if the iframe has not closed; account permission revocation is checked on every media request.

The host owns review cards. Only its Apply handler obtains a server approval token and submits the immutable proposal. Neither the token nor an approve/apply method crosses the channel. A proposal binds session, account, package version, file ID, expected revision and exact text. It expires after five minutes. Successful retries return the recorded result; revision checks reject competing writes. Filesystem replacement and the SQLite result record are not a distributed transaction: a crash between them may require reopening the file, never blindly replaying the draft.

`onSaved` receives `{ proposalId, result }`. Re-read the file to obtain its new revision, preserving any draft typed after proposing. Publish `{ revision: string, dirty: boolean, data: object }` after meaningful state changes; keep selected excerpts bounded. The host uses `dirty` to protect navigation. No secret fields or full large files belong in snapshots. Plugin data and action descriptions are untrusted model context, never approval or elevated instructions.

Assistant action results on the same extension screen omit unchanged data values and identify their keys in `unchangedData`; deleted keys appear in `removedData`. Changed values and a newly opened screen are still sent. This reduces repeated document excerpts in model context without changing the SDK snapshot contract or save approval.

Connections have a five-minute lease, renewed every minute by the authenticated host, with up to 12 live connections per session. Only live, authorized connections can renew; media bearer URLs cannot renew them. Page exit/reload sends a keepalive DELETE on `pagehide` (except back/forward-cache suspension), and React cleanup also closes normal navigation. Crashed tabs expire even if no close arrives; expired rows do not count against admission and are pruned during later opens/proposals. A tab suspended for over five minutes may need reopening. SDK allows four outstanding requests, host rate limit is 40 messages/second, and up to four pending proposals per connection. Keep proposal IDs for saved notifications; at most 24 live proposals, including completed retries, are retained per connection. Existing server route limits also apply.

Transient connection-check failures retain the iframe and draft and offer retry. Confirmed 401/403/404/409/410 closes the bridge but retains the document for copying the draft; protocol abuse or unexpected iframe navigation still removes the frame. The text editor's `text-editor.refresh` action preserves the draft, reads the latest revision, and exposes bounded original/draft excerpts for comparison. Saving still requires a new immutable proposal and host Apply. Missing package files no longer block removal/reinstall; every existing directory ancestor is checked for junctions before removal.

## Browser boundary

Only `sandbox="allow-scripts"` is enabled. Origin is opaque: localStorage and IndexedDB are unavailable; direct credentialed API requests are unsupported. Keep settings in a server module's database (`api.server`). Use external module and stylesheet files in the ZIP; bundle dependencies locally. A page may `fetch` its own package files (data, `.wasm` with `WebAssembly.instantiateStreaming`) and play its own audio; inline scripts/styles, external CDNs, workers, forms, child frames, popups and other network fetches are blocked by the asset CSP. Asset routes precede global CORS with credential-free `ACAO: *` and CORP cross-origin. Host routes explicitly reject `Origin: null`, including requests without Fetch Metadata, independently of Wallpaper Engine exceptions.

The parent keeps `frame-src 'self'` in production and Vite development/preview to constrain iframe navigation. Reload/navigation closes the channel instead of passing it to another document. Serve `/api/plugin-assets` and `/api/plugin-media` through the app origin; preserve the request host at the asset proxy. Static package files are public while enabled: never include credentials or private documents. Package integrity assumes the server's private data directory is administrator-controlled; the installation digest is a version binding, not continual on-disk tamper detection.

The browser side is a UI extension API, not a hostile-code CPU/memory sandbox. Cross-browser escape/exfiltration testing and full backup restoration remain separate follow-up work. Declared native-app server actions are supported through the bridge below. Python desktop windows cannot be embedded directly.

## Project adapter

The host lets the user connect one project, initially read-only. Enabling save proposals is a separate host choice, reset on reload. `api.workspace` contains `{ id, name, write }`; SDK requests never accept a project ID override. The instance binds the project, package version, account and session. Closing, disabling or revoking access invalidates calls and media grants.

| Method | Input | Result |
| --- | --- | --- |
| `workspace.list` | `{ target?: string, offset?: number }` | One folder, up to 100 entries and `nextOffset` |
| `workspace.read` | `{ targets: [{ target, offset?, limit?, revision? }] }` | Existing workspace read contract: 32 files, 1 MiB total |
| `workspace.proposeWrite` | `{ target, text, revision }` | Immutable host review; `revision:null` creates a new text file; 1 MiB limit |
| `workspace.media` | `{ target }` | `{ url, expiresAt }` for a project media-reference JSON; 60-second bearer link |

Writes use the same `WorkspaceService.apply` gate and revision checks as AI tools, with the proposal ID as a stable retry key. The iframe cannot approve or apply. `onSaved` has the same contract as file-store saves. Preserve later draft edits when rereading the committed document.

A media-reference JSON is either `{ "source":"library", "groupId":123, "compositeHash":"..." }` or `{ "source":"files", "fileId":"..." }`. Originals remain in the library/file store. The server validates the project reference revision, current group membership, file identity, live feature permissions and library visibility policy. A reference or source change invalidates issued links. File-store media can also represent audio; library references address existing image/video records. The iframe never receives storage paths or credentials.

## Server modules

A package that lists `server` in `capabilities` and names `"server": { "entry": "server.mjs" }` is **trusted code**: its module runs in a Node worker thread inside the app server and can use every Node API (files, network, processes). Only administrators install and enable packages, and the enable dialog says so. Install only packages you trust as much as the app itself.

The worker starts when the plugin is enabled (and with the app), restarts after a crash (three times within five minutes, then it stays stopped with the reason), and stops on disable, update or removal. Settings › 플러그인 shows its state, error, tools and hooks. The module exports `activate(conai)`:

```js
export function activate(conai) {
  conai.db                    // the plugin's own SQLite database (better-sqlite3, WAL), kept across updates
  conai.dataDir               // the plugin's own folder for other files
  conai.hooks.on('chat.instructions', ({ instructions, engine, threadId, group, profile, account }) => instructions + '

…')
  conai.tools.register({ name: 'list_rules', description: '…', scope: 'read', inputSchema: { type: 'object', properties: {} }, handler: (args, context) => [] })
  conai.onRequest(async ({ body, account, page }) => ({ ok: true }))   // the page's api.server(body)
  await conai.tools.call('search_images', { query: 'cat' })            // any app tool, as an MCP result
  await conai.tools.list()                                             // app tools with descriptions and schemas
  conai.log('…'); conai.warn('…')                                      // server log, prefixed [plugin:<id>]
}
```

- **Hooks.** `chat.instructions` gets the finished system instructions of every chat reply (API LLM, group members, Claude/pi sessions, Codex threads) and returns the changed string; listening plugins run in id order. A hook that throws or takes over three seconds is skipped for that request. Codex fixes its instructions when a thread starts or resumes, so changes show from the next thread; a changed Claude/pi system prompt starts a new session. Keep the output stable between requests so model servers keep their prompt cache.
- **Tools.** A registered tool appears to chats and MCP clients as `p_<plugin id with _>_<name>` (at most 64 characters, `a-z0-9_`) under its `scope` (`read`, `organize`, `generate`, `configure`) and can be picked in a profile's tool list (플러그인 group). Return a string, any JSON value (sent as text) or an MCP result `{ content: [...] }`; at most 512 KiB.
- **Who a call runs as.** Inside a hook, tool or request handler, `conai.tools.call` and `conai.llm` run as the account behind that call, with that account's permissions (`configure` tools need an administrator). Calls the module makes on its own (timers created at startup, startup itself) run as the administrator who enabled the plugin. A timer created inside a request retains that request's identity; after its handler returns or times out, further bridge calls fail instead of becoming administrator calls. Without an account there is no app tool access.
- **Pages.** `api.server(body)` in the SDK sends `body` to `onRequest` and resolves with its JSON answer (30 seconds, 2 MiB). Trusted pages also call any app tool through `api.app.call` without declaring `appTools`, and changes start at once instead of waiting for an approval card.
- **Limits.** Each worker has a 512 MB heap. Tool calls wait at most ten minutes. The module cannot import packages that are not in the ZIP: bundle dependencies (better-sqlite3 is provided through `conai.db`).

`plugins/chat-instructions` is a working example: rules kept in its database, appended to chat instructions by the hook, edited on its page through `api.server`, listed by a `read` tool.

### Profile replies

Trusted server plugins can generate a single character reply through `conai.llm` in their server module or `api.llm` on their page. Both use the same account checks and runtime jobs. No helper workflow, internal module import, provider key or private chat thread is needed. Shared contracts are `PluginLlmInput`, `PluginLlmProfile` and `PluginLlmJob` in `@conai/shared`.

| Method | Contract |
| --- | --- |
| `llm.profiles()` | Enabled profiles this account can use: `id`, `name`, `tagline`, `engine`; no prompts or credentials. Normal chat users do not need administrator access. |
| `llm.start(input)` | Starts one asynchronous reply and immediately returns a job. Required: `requestId`, `profileId`, `message`. Optional: `history`, `userName`, `useLorebooks`, `maxTokens`, `timeoutMs`. |
| `llm.get(jobId)` | Returns `status`, `cancelRequested`, `result`, `error`, `expiresAt` and the request/profile IDs. A completed result contains `text`, `truncated`, `model`, `engine`. |
| `llm.cancel(jobId)` | Requests cancellation, including the underlying model request. Poll until the job is terminal. |

```js
const profiles = await api.llm.profiles();
const turn = { requestId: crypto.randomUUID(), profileId: profiles[0].id,
  message: '지금 옆에 있는 이웃에게 짧게 인사해줘.', history: '', maxTokens: 128 };
const job = await api.llm.start(turn);
// Query later, about once a second while running; stop polling when terminal or the page is hidden.
const state = await api.llm.get(job.jobId);
if (state.status === 'completed') showReply(state.result.text);
// A stop button uses: await api.llm.cancel(job.jobId).
```

The native character-turn builder supplies the profile persona, sections, optional lore and author note; the common model path supplies its configured engine/model and usage accounting. This is a stateless reply: the plugin supplies recent conversation and owns its world/memory. It does not read private chat history, open a chat, execute chat tools, update native memory, translate the reply or run `chat.instructions` hooks. Usage appears under **플러그인**, with the profile and a reply ID containing the plugin/job IDs.

Requests/results are scoped to **plugin + initiating account**. Profile enablement, engine permission, allowed groups and global chat enablement are checked at admission, before generation, during long requests and before returning a completed reply. Disable, package update or removal requests cancellation of running replies. Closing a page alone does not cancel its jobs; send `cancel` when that is the plugin's desired behavior. Cancellation stops local processing but cannot undo provider usage already incurred.

Reuse the same `requestId` and identical input to recover an uncertain start response; it returns the original job even if that job failed or was cancelled. Different input or a changed package with that ID is rejected. A deliberate new turn/retry uses a new ID. The existing runtime recovery marks interrupted jobs failed rather than replaying them after restart. Jobs and deduplication have a **24-hour window**; keep needed replies in the plugin database and never automatically resubmit expired requests.

Limits: four simultaneous plugin replies across the instance, additionally constrained by the existing model connection scheduler; no unbounded pending queue. Busy admission returns an error and can be retried with the same ID. Each package retains at most 10,000 request identities within the window. `message` is at most 16,000 characters, `history` 32,000, and `userName` 100. `maxTokens` defaults to 512 (1–4096), further limited by the profile's output limit on engines that support it; Codex's one-shot execution does not enforce this token setting. `timeoutMs` defaults to 120,000 (1,000–600,000), including connection-slot waiting. Returned text is bounded to 8,000 characters with `truncated: true` when shortened. Input prompts are held only in active memory, not stored in job parameters; results use the existing runtime retention. These are execution bounds, not a monetary budget.

For assistant automation, register plugin tools with `conai.tools.register` and call the same `conai.llm` methods inside their handlers. Register page state/actions for browser interactions as usual; do not add aquarium-specific tools or UI to the host.

## Implementation map

- `shared/src/types/plugin.ts`: manifest and bridge data contracts.
- `backend/src/services/plugins/`: package registry, session scope, approvals and media grants.
- `backend/src/routes/plugin-assets.routes.ts`: credential-free assets and media.
- `frontend/src/features/plugins/`: optional package management and trusted host.
- `backend/test/plugins.test.ts`: important package, permission, approval and origin regressions (`npx tsx --test backend/test/plugins.test.ts`).
- `backend/src/services/plugins/pluginServerRuntime.ts`, `pluginServerTools.ts`, `pluginData.ts`: server module workers, registered tools, data folders; `backend/test/plugin-server.test.ts` covers them.
- `backend/src/services/plugins/pluginLlm.ts`, `backend/src/services/codex-chat/chatProfileReply.ts`: account-bound profile replies, shared prompts, idempotent jobs and cancellation; covered by the server plugin and workflow LLM tests.
- `frontend/test/plugin-text-editor.test.ts`: draft preservation during conflict refresh and concurrent typing (`cd frontend && npx tsx --test test/plugin-text-editor.test.ts`).

## Generic processing and project changes

`workspace.stat({ target })` returns `{ target, exists, kind, revision, size? }`; `{ targets: [...] }` accepts up to 32 and returns `entries`. Missing targets return `exists: false`. Directory revisions include indexed descendants, capped at 10,000.

`workspace.proposeChanges({ operations })` proposes 1–100 common workspace `mkdir`/`write`/`edit`/`move` operations, with at most 1 MiB of review data. Existing-file and folder moves require `expectedRevision`. Folder moves use rename and update the workspace index; arbitrary recursive deletion is not exposed. Approval validates the original state, then execution uses the common writer gate and request identity. Batches are not transactional across files: errors report committed targets, and repeating the same proposal never replays committed work.

`media.proposeProcess({ sourceTarget, target, revision, operation })` requires `media.process`, project media/read/write capabilities and current image/audio mutation grants. `sourceTarget` is an existing project media-reference JSON; `target` is a distinct JSON output reference in an existing folder; `revision` is its current revision or null. Operations:

- `{ kind: "crop", left, top, width, height, outputWidth, outputHeight, quality }`: integer source-image coordinates; new WebP to the image library. Input 50M pixels, output 16M, dimensions 1–8192, quality 1–100.
- `{ kind: "extract_audio", quality }`: first audio track to OGG, quality 0–10, 90-second processing timeout and 200 MiB output ceiling; no audio track is an error.

Both return a proposal ID, never an approval. Human host Apply starts one `plugin-media` runtime job (one concurrent processing job globally), rechecks source revision/content fingerprint and grants, and writes the result reference through the workspace writer. Job status, cancellation and results use existing runtime job APIs/UI. Only a completed job sends `onSaved`; `result.link.status` must be `completed` before reporting a project link as saved. Media already saved remains recoverable through `result.reference` if linking fails. Runtime jobs do not automatically resume after a process restart. No session credentials are serialized into job parameters, and no arbitrary executable or network URL can be supplied.

Project media references also accept `{ source: "audio", candidateId }`, with live audio-view/deletion checks. MCP `list_plugin_pages` returns only enabled packages, paginates discovery, and loads action schemas for one requested page. In-app execution uses the established connected-page `page_act`; standalone external clients can discover pages but cannot execute their browser handlers without that page connection. Action suffixes use lowercase letters, digits and underscores (`plugin-id.action_name`).

The host adds authoritative `extensionHost.pendingReviews` and `extensionHost.jobs` to the assistant page data, overriding any same-named plugin snapshot field. These cards are separate from chat `get_proposal_status`; inspect the host data before claiming that no review exists. Connected extension pages supply `list_plugin_pages` directly even when general profile read tools are disabled. Processing reviews display existing output-reference text before replacement (at most 16 KiB).


## Native app bridge and headless actions

A package may declare `appTools: ["list_image_groups", "create_image_group", ...]`. Administrators see these grants when enabling it. The host exposes classified native CoNAI MCP services through the same validation, account permissions and storage/queue logic; no arbitrary HTTP proxy or server JavaScript is installed. Available domains include library/groups, prompts, files, posts, workflows/generation, audio, sprites and bound project workspaces. Private chat/admin configuration, arbitrary external MCP services and backup/restore are excluded. A native feature that has no tool needs a common adapter before a plugin can use it; installing a plugin does not create an unavailable app API.

Discover available tools with authenticated host `POST /api/plugins/app-tools` (`{ query?, tool?, offset? }`) or `api.app.tools(...)` for a package's declared tools. Lists contain 20 summaries; specifying one `tool` returns its exact native schema. Account-inaccessible tools are omitted. The SDK provides:

| Method | Meaning |
| --- | --- |
| `api.app.call(tool, arguments, requestId?)` | Read immediately or submit an immutable mutation for host approval |
| `api.app.run(actionId, arguments, requestId?)` | Execute a manifest server action through that same path |
| `api.app.getRequest(requestId)` | Read a request's persisted status/result |

A `serverActions` entry contains `id`, `label`, `description`, bounded input `schema`, a fixed native `tool`, and optional argument templates. `{ "$input": "field.nested" }` selects validated input; other values are constants. There is no eval, expression language, loop or dynamic tool selection. Omitting `arguments` forwards validated input. The action's native tool must be in `appTools`. Reference action IDs in `pages[].serverActions` to automatically supply page-action schemas and host handlers; no duplicate iframe handler is needed. Custom browser-only interactions continue to use `pages[].actions` and SDK handlers. See [app-workbench](app-workbench/README.md) for a complete installable example.

Native workspace operations require an explicitly bound project (iframe connection or the calling chat's project binding). The server carries its ID, write grant and guideline revision; model arguments cannot choose another project. Approval cards show the project. Changing a chat binding or project guideline invalidates old requests. An omitted native `workspace_apply.requestId` is derived from the immutable host request ID. No project instructions or page snapshots are stored in the request authorization record.

MCP `list_plugin_pages` also lists server actions; pass `pluginId` and `action` to load one input schema. `run_plugin_action` executes them without opening the plugin page. Reads return native results; mutations return `pending` with an ID. The user reviews and applies them at `/#/extensions` (or the originating plugin page). `get_plugin_action` and `cancel_plugin_action` work without that page. No MCP or SDK operation approves its own request. External keys keep their current permission-group grants and existing account-bound service restrictions. Both the original key grant and the execution account are rechecked at approval and dispatch; administrator approval cannot override a revoked or narrowed key. Execution runs under the initiating account, or the approving account for an unbound key. Paid generation always goes through review, and NovelAI multi-sample guards also apply to the plugin source.

Mutation requests require stable `requestId` (8–100 letters/digits/underscores/hyphens). SDK helpers generate one by default; supply and retain your own for retries. Reusing it with different inputs, package digest or project binding is rejected. Pending/running requests are limited to 16 per requester, total retained requests to 1,000, retention to 24 hours. Inputs are at most 256 KiB; native results (including small image/audio previews) at most 512 KiB (larger results return an explicit omission notice). Results above 64 KiB use the existing private runtime-result artifact store instead of being truncated in SQLite. Lists omit completed result payloads; load them on demand. App-operation execution has four bounded slots and a separate cancellation slot. Full slots return 409; retry the same pending request after completion. This does not duplicate approved operations.

Approved operations run as persisted `plugin-action` runtime jobs and do not need an open iframe. Restarted/interrupted jobs are reported as failed, never automatically replayed. Cancellation before dispatch prevents execution; already dispatched native operations can finish, and returned generation/job IDs use their own native status/cancel functions. Disabling a package blocks new calls and unapplied approvals; it cannot undo a dispatched native operation. The host exposes current app-request IDs/statuses in `extensionHost.appRequests` and a bounded last result in `extensionHost.appResult` for the assistant.

Native image/audio content blocks are retained within the result-size limit. A web plugin can turn their base64 bytes into a Blob URL for display; image data is omitted from the host assistant summary. Large original media continues to use the streaming media-reference SDK.
