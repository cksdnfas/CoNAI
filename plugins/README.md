# CoNAI web extension API v1

For the authoring workflow and the maintained inventory of shared host extensions, read the [plugin development guide](../docs/GUIDE/PLUGIN_DEVELOPMENT.md). A plugin task that adds or changes shared host connections must update that guide and the relevant contracts here in the same change, including when the initiating package is private.

This directory contains the shared SDK and four installable development examples, not automatically installed app features:

| Example | Demonstrates |
| --- | --- |
| `text-editor` | File reading, draft editing, page assistant actions and host-reviewed saving. The app already has a built-in document editor. |
| `app-workbench` | Native app tools, project access and headless server actions. |
| `chat-instructions` | A trusted server module, persistent rules, chat hooks and an MCP tool. |
| `generation-helper` | A generation layout block that reads and fills the screen's form, a button next to Generate and the generation queue hooks. |

Build an example with `node scripts/build-plugin.mjs text-editor`, then upload `build-output/plugins/text-editor.zip` at `/#/settings?section=plugins` and enable it as an administrator.

Personal packages belong in `local-plugins/<plugin-name>/`, excluded from Git and Docker build contexts. Build them explicitly with `node scripts/build-plugin.mjs --local <plugin-name>`; ZIPs go to `build-output/local-plugins/`. Keep package-specific documentation and tests under `local-plugins/` too. These local sources need a separate personal backup; a repository clone does not include them. Public examples and host tests must not depend on personal packages.

## Package contract

### In-app authoring and distribution

Administrators can create inactive source drafts in Settings → Plugins, copy an installed package for editing, edit text/add/rename/delete files, upload binary assets, review and apply a package, and export a distributable ZIP. Installed exports contain package assets only; server databases, plugin data directories and account settings are never included. The host SDK is included in new drafts and shipped with backend builds (`backend/dist/plugin-sdk`, copied beside portable/SEA applications). Existing drafts keep their SDK until explicitly edited or replaced.

All authoring HTTP calls live under `/api/plugins/authoring`, behind the existing authenticated host header/origin check and a live administrator check:

| Route | Contract |
| --- | --- |
| `GET/POST /drafts` | List up to 32 drafts / create with `{requestId, pluginId, name?, fromInstalled?}` |
| `GET/DELETE /drafts/:draftId` | Read metadata and file names / delete with `{revision}` |
| `POST /read` | `{draftId, target?, revision?, offset?, limit?}`; bounded UTF-8 text, UTF-16 character offsets and continuation |
| `POST /changes` | `{draftId, revision, requestId, operations}`; atomic `write/edit/move/delete`, up to 32 operations and 8MiB input |
| `POST /upload` | Multipart `file`, `draftId`, `revision`, `requestId`, `target`, `replace`; maximum 4MiB |
| `POST /review` | `{draftId, revision}`; validated manifest, changed-file summary, installed base digest and built-package digest |
| `POST /install` | `{draftId, revision, digest, enabled}` from the reviewed package; existing installer and administrator approval boundary, including changed activation state |
| `POST /export` | `{draftId, revision}`; validated package ZIP |
| `GET /installed/:pluginId/export` | Current installed package ZIP, including disabled packages |

Draft source is stored separately from installed code with a whole-draft revision. A stale edit or reviewed revision is rejected. Stable request IDs make create retries and the most recent edit retry idempotent; older edit retries conflict instead of replaying. Assets retain their binary bytes. Drafts share a 128MiB total storage limit and explicit deletion; package limits below still apply. Builds have deterministic timestamps/digests. Apply checks the installed base digest to prevent one draft from overwriting another installation. Repeating the same applied package is safe; applying an older package after a different update conflicts. No code is executed during draft editing, package validation or export. A new installation stays disabled; updating an enabled package retains data and restarts the existing runtime.

Administrator direct chats with `configure` scope use `list_plugin_drafts`, `create_plugin_draft`, `read_plugin_draft`, `edit_plugin_draft` and `prepare_plugin_install`. They reuse this service and expose no installation/activation or approval tool. `prepare_plugin_install` returns `needs_human_review` and a management link. External unbound MCP keys, board calls and plugin execution contexts cannot access these authoring tools. The connected editor's `plugin_author.*` page actions use view/draft operations and reviewed create/save/install commits. The SDK's native HTTP bridge continues to exclude host administration.

`plugin.draft.changed` uses the existing SSE stream's `plugins` topic, administrator-only delivery and only a draft ID. It invalidates the relevant draft/list queries; unsaved editor text is preserved. Functional execution, external dependencies, npm installation and source bundling are outside package validation. Host upgrades are required for these routes, tools and editor; no plugin manifest API version change is required. Boundary coverage is in `backend/test/plugin-authoring.test.ts` (revision/digest conflicts, retries, binary export/reinstall, private-data/link exclusion, HTTP/MCP permissions and revocation), alongside the existing plugin runtime tests.

### Git repository installs

Administrators can install and update a plugin from a public HTTPS repository on GitHub (github.com), GitLab (gitlab.com or self-hosted) or Gitea/Forgejo (codeberg.org or self-hosted). The host resolves the branch/tag/commit through the host's HTTPS API, downloads the archive of that exact commit (32MiB cap, public addresses only, no `git` binary, no tokens) and builds the package like `scripts/build-plugin.mjs`: only the plugin folder (`path`, empty = repository root, must contain `plugin.json`) is used; dot-files/folders, Markdown and file types a package can't hold are skipped and listed; links, encrypted entries, traversal and oversized files are refused; the host SDK (`conai-plugin.js`/`.css`) replaces any repository copy. The normal package limits and manifest validation below apply. Commit the built, runnable files; no build step runs.

| Route (administrator) | Contract |
| --- | --- |
| `POST /api/plugins/sources/review` | `PluginSourceInput` → `PluginSourceReview`; installs nothing; the review lives 10 minutes in memory (at most 8) |
| `POST /api/plugins/sources/install` | `{reviewId, digest}` → `PluginInstallResult` (201 new / 200 update); the reviewed bytes, refused when the installed package or its enabled state changed since review; a retry after success only ensures the link |
| `POST /api/plugins/sources/check` | `{pluginId?}` → `PluginSourceCheck[]`; resolves each linked ref to its latest commit, never downloads or installs |
| `DELETE /api/plugins/:pluginId/source` | Unlink only; the plugin stays |

Administrator plugin lists and install responses carry `InstalledPlugin.source`. A ZIP or editor install over a linked plugin keeps the link and reports `modified: true`; removing the plugin drops it. Updates are never applied automatically; the `check_plugin_updates` MCP tool only checks. Host upgrade required; no SDK or manifest change.

### Package files

ZIP root contains `plugin.json`, HTML entry points and static assets. See [the working manifest](text-editor/plugin.json) and [SDK](sdk/conai-plugin.js). IDs use lowercase letters, digits and hyphens; versions use `major.minor.patch`. Each page declares `id`, `title`, `entry`, supported filename extensions in `accepts`, and up to 26 actions. An empty `accepts` list permits opening without files and accepts any selected filename; each API still enforces its data type limits. `"menu": false` keeps a page out of the header menu and the plugin launcher (a page that only lives as a layout block). `"icon"` picks the page's header menu and launcher icon by name from the host's set (`PLUGIN_PAGE_ICONS` in [the shared types](../shared/src/types/plugin.ts), e.g. `"file-text"`, `"wrench"`); without it the page shows the puzzle icon. Hosts released before this field reject manifests that carry it.

An action ID is `<pluginId>.<action>` with `effect: "draft"` and explicit `tier: "view" | "draft"`. The tier describes the page interaction; it grants no write authority. Arguments use the existing bounded CoNAI page JSON schema. The server checks snapshots and action arguments against the installed manifest. Unknown actions fail closed. Actions and private data keys keep the native page limits and filters.

Installed and enabled plugins are app features. `capabilities` and `appTools` are optional legacy metadata, not grants or allowlists. All plugins use the current account's native feature permissions; neither opening a page nor using `api.llm` requires file access or a server module. Selected files are opening context, not a separate access boundary. Connections and reviews remain account/session-bound. ZIP limits: 8 MiB compressed, 16 MiB expanded, 4 MiB per file, 256 entries, 100 installed packages. Traversal, links, encrypted/duplicate entries and unsupported assets are rejected. Initial installation is disabled; only administrators install and enable packages.

Assets may be `.html .js .mjs .css .json .png .jpg .jpeg .webp .gif .ico .svg .woff .woff2 .ttf .otf .wasm .md .txt .csv .mp3 .wav .ogg`. No install scripts or package manager hooks execute; only a declared server module runs.

Uploading an installed package ID updates it in place, keeps plugin data and its enabled state, closes old windows and cancels pending requests. Legacy capability/tool declaration changes do not require reactivation. The same package is refused. An unreadable prior installation is recovered disabled. Removing a plugin deletes its data folder too.

## Host bridge

Load the SDK as a local module and call `await connectPlugin(handlers)`. The host sends a `MessageChannel` only to the iframe it created. SDK exposes `files`, `language`, `request(method, args)`, `publish(snapshot)`, and `onSaved(listener)`. Never emulate a host approval or use raw `/api` requests from the iframe.

### Look like the app

`scripts/build-plugin.mjs` adds `conai-plugin.css` beside `conai-plugin.js`. Link it before your own stylesheet (`<link rel="stylesheet" href="conai-plugin.css"><link rel="stylesheet" href="style.css">`) and keep your file to layout. It styles text, labels, inputs, buttons (`.primary` for the one main action, `.ghost`, `.destructive`), `.toolbar`, `.stack`, hairline `.row` / `.list`, tables, `pre`, `details` and `.badge` (`.ok`, `.warn`, `.destructive`) in the app's flat style. Colours and fonts are `--conai-*` variables: the connect message carries `theme: { scheme: 'dark' | 'light', vars }` with the app's current `background`, `foreground`, `muted-foreground`, `primary`, `primary-foreground`, `line`, `field`, `fill`, `surface-high`, `destructive`, `success`, `warning`, `font-sans` and `font-mono`, and the SDK sets them on `<html>` (plus `color-scheme` and `data-theme`) when it connects. Without them the sheet keeps the app's dark defaults. Use the variables in your own rules instead of fixed colours or `light-dark()`, which follows the OS rather than the app. Write Korean UI copy in the app's casual register (반말).

| Method | Input | Result |
| --- | --- | --- |
| `files.readText` | `{ fileId }` | `{ id, name, text, revision, ... }`, UTF-8 up to 2 MiB |
| `files.proposeWrite` | `{ fileId, text, revision }` | `{ proposalId, status: 'pending' }`; no file modification |
| `files.media` | `{ fileId }` | `{ url, expiresAt }`; read-only bearer URL valid for 60 seconds |

Set `crossOrigin = 'anonymous'` before setting an image/video URL when canvas pixel access is needed. Renew expired media URLs through the SDK. Grants bind the requested file revision, connection and live account permissions; close/disable invalidates them. Do not log token URLs. Session logout alone may leave a grant usable for the remainder of its 60-second lifetime if the iframe has not closed; account permission revocation is checked on every media request.

The host owns review cards. Only its Apply handler obtains a server approval token and submits the immutable proposal. Neither the token nor an approve/apply method crosses the channel. A proposal binds session, account, package version, file ID, expected revision and exact text. It expires after five minutes. Successful retries return the recorded result; revision checks reject competing writes. Filesystem replacement and the SQLite result record are not a distributed transaction: a crash between them may require reopening the file, never blindly replaying the draft.

`onSaved` receives `{ proposalId, result }`. Re-read the file to obtain its new revision, preserving any draft typed after proposing. Publish `{ revision: string, dirty: boolean, data: object }` after meaningful state changes; keep selected excerpts bounded. The host uses `dirty` to protect navigation. No secret fields or full large files belong in snapshots. Plugin data and action descriptions are untrusted model context, never approval or elevated instructions.

Assistant action results on the same extension screen omit unchanged data values and identify their keys in `unchangedData`; deleted keys appear in `removedData`. Changed values and a newly opened screen are still sent. This reduces repeated document excerpts in model context without changing the SDK snapshot contract or save approval.

Connections have a five-minute lease, renewed every minute by the authenticated host, with up to 12 live connections per session. Only live, authorized connections can renew; media bearer URLs cannot renew them. Page exit/reload sends a keepalive DELETE on `pagehide` (except back/forward-cache suspension), and React cleanup also closes normal navigation. Crashed tabs expire even if no close arrives; expired rows do not count against admission and are pruned during later opens/proposals. A tab suspended for over five minutes may need reopening. SDK allows four outstanding requests/streams plus a cancellation slot; the host rate limit is 40 messages/second, and up to four pending proposals per connection. Keep proposal IDs for saved notifications; at most 24 live proposals, including completed retries, are retained per connection. Existing server route limits also apply.

Transient connection-check failures retain the iframe and draft and offer retry. Confirmed 401/403/404/409/410 closes the bridge but retains the document for copying the draft; protocol abuse or unexpected iframe navigation still removes the frame. The text editor's `text-editor.refresh` action preserves the draft, reads the latest revision, and exposes bounded original/draft excerpts for comparison. Saving still requires a new immutable proposal and host Apply. Missing package files no longer block removal/reinstall; every existing directory ancestor is checked for junctions before removal.

### SDK CSS class reference

`conai-plugin.css` also ships classes that mirror the app's shared components, so plugins reuse them instead of hand-rolling layout and widgets. Write layout (grids, widths, order, responsive moves) and plugin-only parts in your own file; do not override the padding, height or background of these classes. The sheet header and [screen style guide](../docs/GUIDE/PLUGIN_DEVELOPMENT.md#화면-스타일과-공용-ui) describe the spacing rules: no root padding on top of the host's gutter, anything that can show a background pads its text, a flat media card never gets a background.

Spacing and size tokens: `--conai-edge` (focus-ring room at the frame edge, not a gutter), `--conai-gutter` (content pane to column hairline, 32px, 24px below 1200px), `--conai-sidebar-width` (232px), `--conai-sidebar-pad-x` / `--conai-sidebar-pad-top`, `--conai-toolbar-height` (56px), `--conai-control-height`, `--conai-field-height`, `--conai-row-height`, `--conai-text-inset`, plus `--conai-radius-md`, `--conai-scrim`, `--conai-key-shadow` and `--conai-float-shadow`. The host does not send these; they keep the SDK values.

Compatibility: each package bundles its own copy of `conai-plugin.css`, so installed plugins change only when rebuilt. When you rebuild an older plugin, check four changes: there is no generic `button.active` / `button.ghost.active` look any more (use `.conai-nav-item` for the current row, `aria-pressed="true"` on a ghost or icon toggle, or the component's own state class); `.list` resets list bullets, margin and padding; `<dialog>` gets the SDK modal defaults (width cap, padding, edge, shadow); `.badge` is 20px tall.

| Class | Purpose | App equivalent |
| --- | --- | --- |
| `.conai-page` (`.compact`) | Document page root: room above and below only; `.compact` for small embedded panels | Page content inside the shell gutter |
| `.conai-app` | Full-height app root (usually `<body>`): header row over a split | Page root |
| `.conai-header`, `.conai-title`, `.conai-spacer` | One 56px row, no surface; hairline under it inside `.conai-app` | `PageToolbar` |
| `.conai-split` > `.conai-sidebar` (`.end`) + `.conai-pane` | 232px column with own scroll and hairline, content pane with the gutter only beside a hairline; stacks into one scrolling column below 900px | `PageWithSidebar` |
| `.conai-nav` > `.conai-nav-item` (`.conai-nav-count`) | Navigation rows; current row (`.active` or `aria-current`) = fill + 2px primary bar | `SidebarNav` / `SidebarItem` |
| `.conai-overline`, `.conai-group-head` | Overline label; group heading with rule and an actions slot | `Text variant="overline"`, `RowGroup` heading |
| `.conai-tabs` > `button` | Underlined text tabs; current = `.active` or `aria-selected="true"` | `TextTabs` |
| `.conai-segmented` (`.full`) > `button` | Fill tray with a raised selected key (`.active`, `aria-pressed` or `aria-selected`) | `SegmentedControl` |
| `.conai-chips` > `button.conai-chip` | Filter chips; pressed (`.active` or `aria-pressed`) = primary tint | `ToggleChip` |
| `label.conai-search` > `input[type=search]` | Filled search field; the icon is drawn by the class | `SearchField` |
| `button.conai-icon-button` (`.sm`, `.overlay`, `.primary`) | Square ghost icon key; `.overlay` sits on images; `aria-pressed` = primary tint | `IconButton` ghost / overlay |
| `.conai-overlay-badge` (`.tl` `.tr` `.bl` `.br`, `.xs`, `.ok` `.warn` `.destructive`), `.conai-overlay-caption` | Count / kind tag and a name on a photo, on a dark scrim | `Badge variant="overlay"` |
| `.conai-media-card` (`.boxed`) > `.conai-media` + `.conai-media-body` (`.conai-media-title`, `.conai-media-meta`) | Media card. Flat: no background in any state, hover dims the media, selected (`.active`, `.selected`, `aria-pressed`, `aria-selected`, `aria-current`) rings the media, caption aligned to the media edge. `.boxed`: surface with a padded body, selected rings the card | Media tile, `Panel asChild interactive` |
| `.conai-list` > `.conai-list-row` (`.sm`, `.interactive`, `.selected`) | Hairline rows; a `<button>`/`<a>`/`.interactive` row pads its text and washes on hover; content `.conai-row-main` > `.conai-row-title` + `.conai-row-meta` | `ListRow` / `ResourceRow` |
| `dl.conai-kv` | Key-value grid | Detail key-value rows |
| `.conai-empty` | Quiet empty line, no box | `EmptyState` |
| `.conai-drawer` (`.end`) + `.conai-backdrop` | Floating side sheet over a backdrop | `BottomDrawerSheet` / floating sheet |
| `dialog` | Page tone over a scrim, hairline edge, floating shadow | `Modal` |
| `.badge.dot`, `button.badge` | Status dot; clickable badge | `Badge` |

There is no generic `button.active` look: state classes only style the component classes above. A toggle button outside them uses `aria-pressed="true"`.

## Browser boundary

Only `sandbox="allow-scripts"` is enabled. Origin is opaque: localStorage and IndexedDB are unavailable; direct credentialed API requests are unsupported. Keep small settings in `api.storage`; server modules may use their database through `api.server`. Use external module and stylesheet files in the ZIP; bundle dependencies locally. A page may `fetch` its own package files (data, `.wasm` with `WebAssembly.instantiateStreaming`) and play its own audio; inline scripts/styles, external CDNs, workers, forms, popups, other network fetches and child frames other than [`api.preview`](#live-html-preview) documents are blocked by the asset CSP. Asset routes precede global CORS with credential-free `ACAO: *` and CORP cross-origin. Host routes explicitly reject `Origin: null`, including requests without Fetch Metadata, independently of Wallpaper Engine exceptions.

The parent keeps `frame-src 'self'` in production and Vite development/preview to constrain iframe navigation. Reload/navigation closes the channel instead of passing it to another document. Serve `/api/plugin-assets` and `/api/plugin-media` through the app origin; preserve the request host at the asset proxy. Static package files are public while enabled: never include credentials or private documents. Package integrity assumes the server's private data directory is administrator-controlled; the installation digest is a version binding, not continual on-disk tamper detection.

The browser side is a UI extension API, not a hostile-code CPU/memory sandbox. Cross-browser escape/exfiltration testing and full backup restoration remain separate follow-up work. Declared native-app server actions are supported through the bridge below. Python desktop windows cannot be embedded directly.

The SDK's host bridge now exposes native feature HTTP APIs through `api.app.fetch`. The iframe still cannot make credentialed requests itself; the host validates feature paths and forwards requests through the app's existing authentication, permissions, revision checks and upload parsers. Authentication, credential management, plugin installation/approval endpoints and arbitrary external URLs are not bridged. Supported roots are available in `api.host.nativeApiRoots` and [the shared route policy](../shared/src/utils/pluginNativeApi.ts).

### Native feature APIs, uploads and streaming

Use `api.app.fetch(path, { method?, headers?, body?, signal?, timeoutMs? })` like browser `fetch`. It returns a real `Response`, including non-2xx status and the native JSON error body. It accepts strings, Blob, ArrayBuffer and FormData bodies; responses transfer a readable stream with backpressure instead of copying whole files into JSON. `Content-Type`, `Accept`, `If-Match`, `If-None-Match` and `Range` headers are supported. No custom authentication headers or redirects are accepted. Mutations triggered by a connected assistant receive a host confirmation; direct page interactions use normal app permissions.

```js
if (!api.supports('app.fetch')) throw new Error('Update CoNAI and rebuild with its SDK');
const response = await api.app.fetch('/api/files?limit=20');
const page = await response.json();
if (!response.ok) throw new Error(page.error || `HTTP ${response.status}`);

const upload = new FormData();
upload.append('files', new Blob([bytes], { type: 'audio/wav' }), 'recording.wav');
const uploaded = await api.app.fetch('/api/files/upload', { method: 'POST', body: upload });
const result = await uploaded.json(); // native file entries/IDs; usable by import_audio(file_id)

// Read a native SSE/chunked response incrementally; cancel its reader or pass an AbortSignal.
const controller = new AbortController();
const streamResponse = await api.app.fetch(nativeStreamPath, { signal: controller.signal });
const reader = streamResponse.body.getReader();
// Consume with reader.read(); controller.abort() or reader.cancel() stops upstream reading.
```

The MCP app-call JSON cap remains 256 KiB. Binary uploads use multipart native routes instead; their existing per-route file/count/size limits apply (the host also caps one file at 500 MiB, 20 files and 1 GiB total). Large native responses are streamed, without the MCP result cap. Read a response to completion or cancel its body to release its request slot.

| Native feature | Existing endpoint examples |
| --- | --- |
| Images | `POST /api/images/upload`, `POST /api/images/upload-multiple`, `PATCH /api/images/:hash/metadata`, `DELETE /api/images/:hash` |
| Files | `POST /api/files/upload`, `PUT /api/files/:id/text`, `GET /api/files/:id/download` |
| Audio | `/api/audio/projects`, `/api/audio/candidates/:id/review`, `/api/audio/groups/:id/comments` |
| Prompts and wildcards | `/api/prompt-presets`, `/api/prompt-groups`, `/api/wildcards` |
| Workflows | `/api/workflows`, `/api/graph-workflows`, `/api/workflow-input-assets` |
| Profiles and display blocks | `/api/codex-chat/admin/profiles`, `/api/codex-chat/admin/blocks`; existing admin checks apply |
| Chats, tools and streamed replies | `/api/codex-chat/threads`; existing thread ownership and native chat execution apply |
| Appearance and wallpaper layouts | `/api/runtime-appearance`, `/api/settings/appearance`, `/api/page-settings/:scope` |
| Native job progress/cancellation | `/api/jobs/:jobId`; use the ID returned by the native operation |

Prompt groups: use `GET /api/prompt-groups/summaries?type=positive` (also `negative`/`auto`) for IDs, names, parents, visibility, ordering and direct `prompt_count`; ID 0 represents unclassified prompts. Load bodies lazily with `GET /api/prompt-groups/:id/prompts?page=1&limit=40&type=positive`, maximum 100 rows. `q`, `sortBy=usage_count|created_at|prompt`, and `sortOrder=ASC|DESC` run server-side. `include_total=false` omits `total`/`totalPages`; follow `pagination.has_more` and `pagination.next_page` with the same filters. Exact counts remain the default. These read-only routes use the existing native prompt-view permission, require no approval/revision, and can be retried or cancelled through the native bridge.

For compatibility, `/:id/prompts` clamps positive integer `limit` values above 100 instead of rejecting them; `pagination.limit` reports the effective limit, which also determines page offsets. Unrecognised `type` values retain the previous positive-collection fallback.

**Legacy for one compatibility release only:** `/api/prompt-groups/grouped-prompts` retains its old unbounded `{groups, unclassified_prompts}` response for existing native-bridge plugins and sends deprecation/successor headers. Do not use it in new plugins; migrate to summaries plus bounded pages before the following host release. No SDK version change is required; the new routes require an updated host.

These are the existing HTTP contracts, not new MCP tool names. Their input schemas, revisions, response envelopes and permission rules remain native. Native calls never retry automatically: after an interrupted mutation, query the affected resource/job before issuing another write. For durable idempotent tool execution use `api.app.call/run` with a retained request ID. `api.app.wait(result.id, { signal, timeoutMs })` waits for a plugin app request; `api.app.cancel(result.id)` requests cancellation. A `pending` review is returned immediately by wait. A native job UUID uses `/api/jobs`, and an LLM job uses `api.llm.get/wait/cancel`.

#### Audio directory pagination

`GET /api/audio/projects`, `GET /api/audio/projects/:projectId/groups` and `GET /api/audio/groups` have two native response forms:

- **Legacy:** omitting all of `limit`, `cursor` and `offset` keeps `{ success: true, data: [...] }`, with the complete ordered array, including more than 200 entries. This compatibility path is unbounded as a response; new callers should use pagination. Group `search`/`filter` alone do not opt into paging.
- **Paged:** passing any paging parameter returns `{ success: true, data: { items, limit, offset, has_more, next_cursor } }`. `limit` defaults to 200 and accepts integers 1–200. Start with `?limit=200`; pass the returned `next_cursor` as `cursor`, keeping the same project, search, filter and limit. `offset` is an alternative nonnegative integer; `cursor` takes precedence. Invalid paging inputs return the native error, never a legacy fallback.

Projects keep creation-time/ID order. Groups keep inbox-first, creation-time/ID order and Unicode case-insensitive `search` over name, label and description; the existing `filter` values remain unchanged. These are offset cursors, not a snapshot: restart at the first page after directory changes. All forms require the current account's native `audio.view` permission. Listing is read-only and does not introduce approval, edit revisions, writes or automatic mutation retries. MCP `list_audio_projects`/`list_audio_groups` always return pages.

Use the existing `api.app.fetch` bridge; no SDK change or additional capability is required. The paged response form requires a host implementing this contract. Older hosts can return the legacy array even when paging parameters are supplied; do not assume `apiVersion: 1` or `app.fetch` support alone guarantees pagination. Require an updated host before using `data.items`/`next_cursor`. Existing plugins that omit paging parameters remain compatible.

### Media, settings, events and navigation

### Live HTML preview

`api.preview.open({ html, files })` serves an HTML document the page builds (a composition, a template, a report) at `{ url, expiresAt }` for a child `<iframe sandbox="allow-scripts">` in the page. `files` maps relative paths the document uses to either a media reference (`{source:'library', compositeHash}`, `{source:'files', fileId}`, `{source:'audio', candidateId}`; image/video/audio only) or one of the package's own files (`{source:'package', path}`). `api.preview.update(url, { html, files })` replaces the contents at the same address, so a page can redraw while editing and reuse cached package scripts; load a new frame to show it. Check `api.supports('preview')`.

The document runs with `sandbox allow-scripts`, may use inline scripts and styles, and loads, fetches and plays only its own mapped paths (`data:`/`blob:` media and fonts are allowed); no app API, cookies, external URLs, forms, workers or nested frames. Every media request rechecks the account's live permission and the source fingerprint (byte ranges supported). Limits: 256KB HTML, 64 files, the newest 4 previews per page window; a preview lives while its window does and expires 10 minutes after its last use. The frame talks to its page only through `postMessage`.

`api.media.open(artifact.artifact_id)` converts a native tool's signed artifact identity into `{ url, expiresAt, mimeType, name }`. Assign `url` to an image/audio/video element. These links support byte ranges and recheck the plugin connection, account permissions, ownership and source fingerprint on access; they do not buffer the original or require cookies in the iframe. Library media, generation history, audio candidates/exports and sprite exports are supported. Files and project references keep `files.media` and `workspace.media`. For native download URLs, `api.app.download(path, filename?)` starts the download in the host; `api.app.fetch(path)` returns a stream when bytes are needed for processing.

```js
const settings = await api.storage.get('preferences'); // { key, value, revision }, nulls when absent
await api.storage.set('preferences', { zoom: 2 }, settings.revision);
// api.storage.delete(key, revision); stale revisions return HTTP 409.
const unsubscribe = api.events.on('files.changed', event => refreshVisibleFiles(event.payload));
// 'job.status', 'audio.changed', 'posts.changed', queue/history/workflow events, 'resync', 'connection', or '*'.
await api.navigation.open('/files'); // native navigation and unsaved-draft guard
```

Storage is scoped to plugin + account, retained across package updates, removed on uninstall, and limited to 256 keys / 1 MiB per account with 64 KiB per value. It needs no server module. Use file/project APIs for documents and large assets. Events share the app's single SSE connection and its account/topic filtering; private chat and page-command events are not forwarded. Re-query relevant visible data after `resync` rather than treating events as full records.

SDK calls accept `{ signal, timeoutMs }` (`request`'s third argument, `server`'s second, app call/run's fourth). Requests and server handlers are bounded to ten minutes, with four active page requests/streams and one reserved cancellation slot. Closing a page, aborting a request or reaching its timeout sends cancellation to request-owned HTTP/MCP work; server handlers receive `{ signal }` in their second argument. Handler-owned I/O must use that signal. Durable app/LLM jobs use explicit job cancellation and are never silently replayed. Already committed effects cannot be undone by aborting a response. Errors preserve `message`, `status`, `code` and `name`; invalid inputs include the failing field paths. `api.host.features` / `api.supports(name)` identify capabilities of the running host, independently of package metadata.


## Project adapter

The host lets the user connect one project. Its edit mode follows the current account's `files.edit` permission, without a separate plugin write toggle. `api.workspace` contains `{ id, name, write }`; project IDs cannot be overridden by SDK arguments. Explicit read-only API connections remain read-only. Instance, revision and account checks also apply to server-module calls from that page.

| Method | Input | Result |
| --- | --- | --- |
| `workspace.list` | `{ target?: string, offset?: number }` | One folder, up to 100 entries and `nextOffset` |
| `workspace.read` | `{ targets: [{ target, offset?, limit?, revision? }] }` | Existing workspace read contract: 32 files, 1 MiB total |
| `workspace.proposeWrite` | `{ target, text, revision }` | Immutable host review; `revision:null` creates a new text file; 1 MiB limit |
| `workspace.media` | `{ target }` | `{ url, expiresAt }` for a project media-reference JSON; 60-second bearer link |

Writes use the same `WorkspaceService.apply` gate and revision checks as AI tools, with the proposal ID as a stable retry key. The iframe cannot approve or apply. `onSaved` has the same contract as file-store saves. Preserve later draft edits when rereading the committed document.

A media-reference JSON is either `{ "source":"library", "compositeHash":"..." }` or `{ "source":"files", "fileId":"..." }`. Library references may also specify `groupId`; when present, the server additionally requires membership in that group. Omitting it keeps identity independent of group organization. Originals remain in their stores. The server validates the project reference revision, file identity, live feature permissions and library visibility policy. A reference or source change invalidates issued links. File-store media can also represent audio; library references address existing image/video records. The iframe never receives storage paths or credentials.

## Server modules

A package may declare `"server": { "entry": "server.mjs" }` to run a Node worker with filesystem, network and process access. This is an execution mode, not an app API permission tier. Install only packages trusted as app code. No matching capability declaration is required.

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
  await conai.background.account()                                    // { id, type } that timer calls run as, or null
}
```

- **Hooks.** `generation.action`, `generation.queued` and `generation.finished` are described under [Generation layouts](#generation-layouts). `chat.instructions` gets the finished system instructions of every chat reply (API LLM, group members, Claude/pi sessions, Codex threads) and returns the changed string; listening plugins run in id order. A hook that throws or takes over three seconds is skipped for that request. Codex fixes its instructions when a thread starts or resumes, so changes show from the next thread; a changed Claude/pi system prompt starts a new session. Keep the output stable between requests so model servers keep their prompt cache.
- **Tools.** A registered tool appears to chats and MCP clients as `p_<plugin id with _>_<name>` (at most 64 characters, `a-z0-9_`) under its `scope` (`read`, `organize`, `generate`, `configure`) and can be picked in a profile's tool list (플러그인 group). Return a string, any JSON value (sent as text) or an MCP result `{ content: [...] }`; at most 512 KiB.
- **Who a call runs as.** Inside a hook, tool or request handler, `conai.tools.call` and `conai.llm` run as the account behind that call, with that account's permissions (`configure` tools need an administrator). Calls the module makes on its own (timers created at startup, startup itself) run as the administrator who enabled the plugin. `conai.background.account()` returns that account (`{ id, type }`, `id` null for the bootstrap administrator) or `null` when none is active, so a module that keeps per-account data runs background work only for that account. A timer created inside a request retains that request's identity; after its handler returns or times out, further bridge calls fail instead of becoming administrator calls. Without an account there is no app tool access.
- **Call errors.** A failed `conai.*` call rejects with an `Error` whose `message` is the host's message. The error may carry a numeric `status`. Admission rejections, where no model work was spent, are 400 (invalid input), 403, 404, 409 (version change), 413 (context) and 429 (busy). A 408 is a timeout of an admitted call, and model work may already have been spent. A model or engine failure inside an admitted call has either no status or the provider's status.
- **Pages.** `api.server(body, { signal })` calls the module's handler (up to ten minutes, 2 MiB). Its `conai.tools.call/list` receives the page's bound project and current account. Every enabled plugin, including pages without server modules, may use `api.app.call`; direct mutations start as native jobs without an extra approval card.
- **Limits.** Each worker has a 512 MB heap. Tool calls wait at most ten minutes. The module cannot import packages that are not in the ZIP: bundle dependencies (better-sqlite3 is provided through `conai.db`).

`plugins/chat-instructions` is a working example: rules kept in its database, appended to chat instructions by the hook, edited on its page through `api.server`, listed by a `read` tool.

### Server processing jobs and internal media

Trusted server modules can register `conai.onJob(async (data, { signal, jobId, account, report }) => result)` and start it with `conai.jobs.start({ requestId, data })`. The start returns immediately with `jobId`; `conai.jobs.get(jobId)` and `conai.jobs.cancel(jobId)` return the native job status, progress, result and error. `await report({ percent, phase?, message? })` updates bounded native progress. These calls require a current account with `generation.execute`; identities and results are bound to the package and initiating account. Browser mutations should continue through `api.app.call` so assistant-triggered changes keep the host review card.

Jobs use `RuntimeJobRunner` (`plugin-task`), with two processing slots per instance and one active job per package, a ten-minute handler limit, 256 KiB inputs, 60 KiB results, and at most 1,000 request identities per package within native job retention. Inputs stay in active memory. Identical request IDs recover the original job; changed input/package versions conflict. Interrupted jobs fail instead of replaying. Disabling/updating a package cancels jobs; the worker gets up to three seconds to clean up after cancellation before termination. Processing children must have their own time/resource limits as a crash can bypass JavaScript cleanup.

`conai.media.resolve(reference)` uses the same internal-media resolver as project previews. Accepted references are `{source:'library', compositeHash}`, `{source:'files', fileId}` and `{source:'audio', candidateId}`. It returns `{path, name, mimeType, size, fingerprint}` to **the trusted server only**. Search through existing native tools first; never send native paths to a page or model. Recheck the reference fingerprint and live permissions before copying/using a source and before publishing output. Preserve references in project documents; expiring preview URLs are not persistent asset identities.

`conai.media.save({path, groupPath?})` imports an existing output from a **relative path under that plugin's private data folder** through the native media pipeline, returning `{source:'library', compositeHash, groupId}`. It requires `images.view`, `images.upload` and `images.edit`, refuses links/path escapes and changed source files, and accepts PNG/JPG/WebP/MP4/WebM up to 512 MiB. It copies the file without buffering the whole video. Run it inside an idempotent processing job. Cancellation cannot undo a file already ingested; such output remains in its native library group.

## Generation layouts

Screens with block layouts (the generation tabs, the public workflow page, sprite, audio, image detail and upload inspection; surfaces are `GENERATION_LAYOUT_SURFACES` in `@conai/shared`) take two kinds of plugin additions, declared under `generation`:

```json
"pages": [{ "id": "snippets", "title": "프롬프트 조각", "entry": "index.html", "accepts": [], "actions": [], "menu": false }],
"generation": {
  "blocks": [{ "id": "snippets", "page": "snippets", "surfaces": ["nai", "codex", "comfy"], "height": 240 }],
  "actions": [{ "id": "tidy", "label": "태그 정리", "surfaces": ["nai", "comfy"] }]
}
```

- **Blocks** (up to 8) show one of the package's pages inline at a fixed `height` (120–1200 px, default 320). A new block joins the end of each preset's last column (above the Generate button there); administrators move or hide it in the layout editor like any other block, and the saved presets keep its place (`plugin:<plugin id>:<block id>`, at most 8 per preset). Blocks of a disabled or removed plugin drop out of the screen. The editor shows only the block's name; the frame opens on the live screen and only while that screen is on view, using the normal page connection (it counts toward the 12 connections per session) without registering a page of its own for chat. Inside a block, `api.context` is `{ kind: 'generation-block', surface }` (null on the page itself), `await api.page.form()` returns the screen's form (`{ title, fields: [{ id, label, type, value, options?… }] }`, or null without inputs; the same fields a connected chat sees) and `await api.page.fill({ fieldId: value })` sets some of them. Every value is checked against its field (type, options, range, read-only) before the form changes; nothing is generated. These two methods fail on a plugin's own page.
- **Actions** (up to 8) are icon buttons (plugin icon, `label` as tooltip) in the Generate bar of the listed surfaces. A click sends the screen's form fields to the server module's `generation.action` hook, so actions need `server.entry`. The hook returns `{ message?, fill? }` within 30 seconds: `message` (≤ 500 characters) appears as a notice and `fill` goes through the same field checks as `api.page.fill`. It runs as the account that clicked; the button is disabled while Generate is busy.

Two more hooks report every generation queue job (any service, any caller, including chat and graph runs) without holding it up: `generation.queued` gets `{ jobId, service, status, workflowId, account }` when a job is queued, and `generation.finished` gets the same plus `failureCode` and `history: [{ id, compositeHash }]` when it completes, fails or is cancelled (images may still be post-processing then; `compositeHash` can be null). They run as the job's requester, ten seconds at most, and failures are only logged.

`plugins/generation-helper` is a working example: snippets inserted into the prompt from a block, a tag-tidying button and a per-account tally kept by the queue hooks.

### Profile replies

Enabled plugins can generate a single character reply or ask a profile's judge through `api.llm`; server modules use `conai.llm`. Both share account/profile checks. Replies use runtime jobs; judge calls are awaited directly. A server module and file permissions are not required for page LLM calls. Shared contracts live in `@conai/shared`.

| Method | Contract |
| --- | --- |
| `llm.measure(input)` | Synchronous host preflight, awaited over either SDK bridge; no job or model call. Text-mode fields without `requestId`, `mode`, `research`, `timeoutMs`; returns `PluginLlmMeasurement` below. Requires updated SDK/host feature `llm.measure`. |
| `llm.profiles()` | Enabled profiles this account can use: `id`, `name`, `tagline`, `engine`, `appearance` (image-prompt tags of the character's look), `translation`, `assetVersion`, `avatarCrop`, `assets`, `judge` settings and `statusBlocks` below, plus `details` — every saved profile setting as the profile editor holds it (persona `systemPrompt` and `promptSections`, greetings and opening history, lore/summary/context/judge settings, `style` with its blocks, model rows) — and the app-wide `loreSelectionLimit` (Settings › 채팅 › 자원 › 기억: keyword lore entries one selection keeps, best matches first; always-on entries are not counted). Only image bytes are left out (read them with `llm.asset`); profiles hold no credentials. Normal chat users do not need administrator access. |
| `llm.profile({ profileId })` | `PluginLlmProfileDetail`: the same profile entry plus `lorebooks` (the profile's shared account books, then global ones, each `{id,name,kind,entries}` with every entry) and `judgePreset` (the whole judge preset, or null). Same account/profile access as `profiles()`. |
| `llm.decide(input)` | Await `PluginLlmDecision` for plugin-supplied typed questions on the profile's judge model; no preset or thread required. |
| `llm.judgeTurn(input)` | Await `PluginJudgeTurn` from the profile's own preset items for a supplied conversation; no native chat thread. |
| `llm.asset({profileId, kind?, maxSize?})` | Reads a native profile image with the caller's profile and `images.view` permissions. `kind`: `avatar` (default), `background`, `reference`. `maxSize`: 64–512, default 256. Returns `PluginProfileAsset` with `state` (`ready`, `missing`, `hidden`), `version`, `crop`, and, when ready, base64 `data`, `mimeType: image/webp`, `width`, `height`. |
| `llm.start(input)` | Starts one asynchronous reply and immediately returns a job. Required: `requestId`, `profileId`, `message`. Optional: `history`, `userName`, `useLorebooks`, `maxTokens`, `timeoutMs`, `mode`, `model`, `structuredOutput`. |
| Profile-only run options | Ordinary `mode:'profile'` also accepts `pluginTools?: string[]` and `roomKey?: string`; neither is allowed in text mode, measurement, or isolated research. |
| `llm.room({profileId, roomKey?, roomTitle?})` | Resolve/create the account's plugin/profile room without generating or waiting for a model run. Only creation has a short guard. Returns `{threadId}`. |
| `llm.forgetRooms({roomKey})` | Clean up this plugin/account's exact-key ordinary profile rooms. Returns `{rooms:[{threadId,status:'deleted'|'unlinked'}]}`. A room containing any non-plugin user message is unlinked and kept as ordinary chat. Repeated cleanup returns `{rooms:[]}`. |
| `llm.get(jobId)` | Returns `status`, `cancelRequested`, `result`, `error`, `expiresAt` and the request/profile IDs. A completed result contains `text`, `truncated`, `model`, `engine`. |
| `llm.cancel(jobId)` | Requests cancellation, including the underlying model request. Poll until the job is terminal. |
| `llm.discard({jobId})` | Delete a rejected ordinary profile run's recorded wake and assistant messages. Returns `{jobId, deleted}`; repeated calls return `deleted:0`. Same plugin/account only; requires terminal status and a non-research `profileRun` plus its durable input receipt. Active room runs/locks return 409. Requires updated host/SDK feature `llm.discard`. |

Both `api.llm.discard({jobId}, options?)` and `conai.llm.discard({jobId})` accept only a job identity, never caller-supplied room/message IDs. The host uses `profileRun.messageIds` and the existing `job.delivery.messageId` receipt (whose thread must match), not neighboring messages. Only a still-linked, canonical automation room for that plugin/account/profile is eligible; other, recreated, unlinked and research rooms cannot be targeted. Text jobs, missing results/receipts and nonterminal jobs return 409; foreign jobs/room links return 404, expired jobs retain 410. Failed/cancelled jobs qualify only if they retain a `profileRun` result and receipt. Cancellation alone does not make a missing result eligible.

Discard preserves the room and all other messages, including later turns and human messages. It uses native exact-message cleanup for cards, attachments, generation/reply metadata and affected summaries; native session memory is reset so removed speech is not replayed. It does **not** undo saved lore, generated media, files or other already-applied tool effects. The deleted wake message also takes whatever context it delivered: a plugin that advances its own delivery checkpoint from `job.delivery` must roll that checkpoint back or resend the context in its next run. Older results without a durable input receipt are refused rather than guessed. Pages check `api.supports('llm.discard')`; server modules check `typeof conai.llm.discard === 'function'`. Reusing the original request ID still returns the original terminal job; use a new request ID for a replacement turn.

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

### Stateless profile judging

Both SDK surfaces expose `decide` and `judgeTurn`. Pages check the host feature `llm.decide`; server modules have no feature API and check `typeof conai.llm.decide === 'function'`. An `after` turn returns the empty result without a model call when the preset's follow-ups are off (`followUp.maxConsecutive` 0), as do stages without askable items. Older hosts/SDK copies do not provide these methods. `model:'judge'` on `llm.start` remains a persona/free-text reply, **not** preset judging.

- `PluginLlmDecideInput`: `{profileId, state, questions, timeoutMs?}`. Strict JSON objects throughout; `state` is a JSON object. `questions` has 1–8 unique `{id, kind:'choice'|'yesno', instructions, options?, criteria?}` items. IDs (including option IDs) match `/^[a-zA-Z][\w-]{0,39}$/`; instructions are nonempty strings. Choice requires 2 or more unique `{id, description, yes?}` options (no fixed upper count; the whole-body limit applies) (`yes` defaults true); yes/no forbids options. Optional criteria is `{yes, no}` with string values. State, instructions, criteria and descriptions have no separate byte/character caps: the whole-body transport limit applies. Option IDs are judge labels.
- `PluginLlmDecision`: `{engine:'typesafe'|'llm', model, answers, error}`; each `answers[questionId]` is `{probability, confidence:number|null, choice:string|null, distribution:Record<string,number>|null}`. Unanswered questions are absent. Partial/provider failures return a sanitized non-null `error`, preserving available answers.
- `PluginJudgeTurnInput`: `{profileId, stage:'before'|'after', user, conversation, actions?, timeoutMs?}`. `user` and entry `name` are nonempty strings. `conversation` has 1–40 strict `{from:'user'|'character', name, text}` entries with nonempty text. There is no plugin text-length rejection; native `cutForJudge` still selects its 1500-character excerpt plus ellipsis exactly as in chat. `actions` has at most 40 nonempty strings, without a character cap. Before-stage tool patterns are asked only if an action matches (trailing `*` matches a prefix); non-tool items are still asked. Preset windows and native thresholds/escalation remain.
- `PluginJudgeTurn`: `{presetId, engine, model, directive, offered, withheld, followUp, items, error}`. `directive` joins yes-item directives with newlines; `offered`/`withheld` contain **tool patterns**, not expanded action names. `items` contains `{itemId,name,verdict,probability,action}`; failed items can have null probability. `followUp` only reports an after-stage follow-up decision; the host executes no actions and schedules no follow-up. No preset or usable judge model returns exactly `{presetId:null,engine:null,model:null,directive:'',offered:[],withheld:[],followUp:false,items:[],error:null}` without a model call. Runs use the existing judge log with `threadId:null` and the profile ID; logging is best effort.

Both resolve `profile.judgeSlotId ?? preset?.modelSlotId ?? ModelSlotStore.routeId('judge')`, supporting TypeSafe and LLM connections. `decide` without a usable model throws 409 with prefix `판단 모델이 없어`. Chat/account/profile permission checks and four in-flight awaited judge calls per plugin remain; overflow is 429. An explicit `timeoutMs` (1000–1800000) owns the complete judge deadline through nested TypeSafe/LLM/preset calls. Omitted: follow connection/engine settings; **TypeSafe retains its native 20-second default when the connection has no timeout**. Plugin LLM judging adds no question-count output cap or plugin 60-second deadline. Change/disable/revocation abort requests. These calls have no extra approval, saved revision, runtime-job/request ID, durable recovery or automatic retry. Page cancellation is not a judge-job cancellation API.

`PluginLlmProfile.judge` is `{presetId,presetName,available,followUp,fields,room}`. Without a preset its settings are null; availability independently means a judge connection resolves. Follow-up exposes `{maxConsecutive,delaySeconds,directive}`, fields `{enabled,threshold,window}`, room `{window,route:{enabled,minProbability,instructions},next:{enabled,continueThreshold,instructions}}`. Empty room instructions use native defaults; exposed settings strings are returned whole, without plugin cuts. `statusBlocks` is the summary of enabled usable `{key,name,fields:[{name,label,min,max,step,values,readonly}]}` definitions; the whole blocks, with templates, CSS and block instructions, are in `details.style.blocks`.

Text replies with `structuredOutput` omit display-block fence guidance only; persona, lore and opted-in translation remain unchanged. Ordinary text and native chat threads keep their display blocks.

#### Stateless prompt budgets and safe failures

`api.llm.measure(input)` / `conai.llm.measure(input)` accept exactly
`{ profileId, message, history?, userName?, useLorebooks?, maxTokens?, structuredOutput?, translation?, model?: 'chat'|'judge' }`.
Types, defaults, strict validation and account/profile access checks are the same as text-mode `start`.
They return `{ inputTokens: number, outputReserve: number, contextTokens: number|null, available: number|null, engine: 'api'|'claude-code'|'codex', estimator: 'tokenizer'|'heuristic' }`.
The current native estimator is **heuristic**, including its chat-profile calibration; judge/translation targets use the uncalibrated native estimator, not a different model's calibration.
`available = contextTokens - outputReserve - inputTokens`; unknown context returns `null` for both context and available.
Measurement includes persona, examples, selected lore, author notes, JSON instructions and JSON display-block omission. Codex includes the actual flattened one-shot prompt wrapper.
For `translation.only`, it measures the largest planned translation chunk and that translator's reserve, not an unused character prompt.
No model call, job, approval, new concurrency pool or automatic retry is introduced. Pages can check `api.supports('llm.measure')`; servers check `typeof conai.llm.measure === 'function'`.

`profiles()` adds `context: { contextTokens: number|null, maxOutputTokens: number|null }` for each profile's **chat** target.
Direct API context is the smaller of its visible declared profile context and an unexpired learned/discovered server context, or whichever is known. Pi-configured profiles use direct API completion here, **not Pi sessions**, and only cached server context: their hidden manual context field is ignored.
Claude/Codex context is `null`; hidden values retained after an engine switch are not used. No model-name guesses or network discovery is performed by measure.
Judge and translation model rows have no declared context/output-cap fields: they use cached target context and the host fallback reserve.
API/Claude output follows the profile's settings, lowered only by an explicit positive safe-integer plugin `maxTokens` (no 4096 ceiling). With no configured/requested cap, **no output cap is sent**: the provider/model owns its default. `profiles.context.maxOutputTokens` is the configured cap or `null`. The native 2048-token fallback is used **only for estimation**, never sent to a provider.
Codex has no enforced CLI output-token option: `maxOutputTokens` is `null`, plugin/profile `maxTokens` are unenforced, and measurement reserves **2048** for planning only.
All text-mode requests are stateless and have **no host engine compaction**. Plugins must budget/reduce their own history. Native `mode:'profile'` behavior is unchanged.

For a new text request, including `model:'judge'`, admission books only the native minimum reply allowance: `min(effectiveMaxTokens, 256)` when a profile cap is configured, otherwise zero. It does not book a large configured output ceiling as if it must all be generated. A negative `available` caused by the full measured reserve is **not** by itself a rejection. Input exceeding known context minus that small allowance fails before creating a job/provider call with status **413**:
`문맥이 모델 한도를 넘었어 (입력 약 N + 출력 M > 한도 L 토큰). 입력을 줄여줘.`
`M` is the configured admission reserve, or zero when no enforceable profile cap is known. Unknown context proceeds; an estimate is not a tokenizer guarantee. Existing idempotency lookup takes precedence for an already admitted request.
Codex one-shot calls send the prompt through **stdin** (`codex exec … -- -`), not argv; `--` prevents an attached-image option from consuming the stdin marker. Explicit plugin deadlines are forwarded to the CLI transport, while omission leaves the engine's own timeout. Cancellation and scratch cleanup remain in place; early stdin write errors defer to the CLI close/exit/stderr diagnosis.

Structured translation chunks selected leaves into **at most 128 per request**, using the translation target's cached context and an estimate-only output reserve to choose chunk sizes. The reserve is never sent as an output cap.
For known context the planner uses twice the native estimate of numbered source JSON for expansion room. When context/output cap are unknown, up to 128 strings stay in one request; an advisory reserve cannot reject a single long leaf. The existing runaway-response guard rejects a translated value longer than `max(4000, source.length * 4)`; it never cuts text.
Chunks run sequentially with the caller's explicit remaining deadline or the translation connection's settings; plugin calls add no 90-second translation deadline. Native callers retain their per-call translation deadline rather than sharing one timer across all chunks. Numbered keys restart per chunk and merge only into a private copy. An input that cannot fit, malformed/missing output, runaway translation, or any failed chunk returns `translation.status:'failed'` with the original answer intact (translation-only jobs fail instead).
Unselected fields/IDs/keys are never changed. There is no longer a global 128-leaf/20,000-character translation rejection or wildcard truncation; existing input/result byte limits still apply.

Failed jobs and judge errors use bounded, stable category prefixes:
`문맥이 모델 한도를 넘었어` (context, with known budget numbers),
`출력 토큰 한도에서 답변이 잘렸어` (truncated JSON),
`요청 제한 시간을 넘었어` (plugin reply/judge, provider request, idle response or CLI deadline),
`모델 요청 한도에 걸렸어` (402/429),
`모델 인증·권한이 거부됐어` (401/403),
`모델·연결을 사용할 수 없어` (missing model/disabled connection),
`모델 제공자 요청이 실패했어` (other provider HTTP status),
`모델 실행기가 실패했어` (CLI failure, exit code when the engine exposes it),
`모델 서버에 연결하지 못했어`, `요청이 취소됐어`, or `모델 응답을 처리하지 못했어` (unclassified/invalid response).
Incomplete judge answers use `판단 답변이 불완전해`; returned answers are retained. Native access/revocation errors remain intact.
Classification reuses native connection failures and preserves HTTP status without publishing provider bodies, URLs, keys, last model output or arbitrary stderr.
Only recognized diagnostic phrases (up to 200 characters total), or standard HTTP reason text, are exposed; a Codex stderr detail comes only from its first line. Claude's existing transport does not expose exit code/stderr, so those cannot be reported.
No new automatic retries are added by the plugin bridge.

### Execute a profile with its tools

Profile create/update and draft requests reject newly supplied over-length text instead of silently truncating it.
Use `CHAT_PROFILE_TEXT_LIMITS` from `@conai/shared`: name 60, tagline 200, system prompt/greeting/appearance/section content 20,000,
author note/summary prompt/translation instructions 4,000, section title 80, extra-params JSON 20,000 characters. Untouched stored text is preserved on partial updates.
Newly supplied values are also type-checked (400): numbers must be numbers within `CHAT_PROFILE_LIMITS` (a boolean is rejected, and
required numbers such as `contextTurns` or the lore fields cannot be `null`), and on/off flags must be booleans.
Card import caps imported fields before creating the editable draft. Existing admin authorization and proposal approval rules are unchanged.

Both browser `api.llm.start` and server `conai.llm.start` accept `mode: 'profile'`. This runs the native chat engine with the profile's tool catalog, tool allowlist, generation presets, hooks, lore, memory and review cards. No extra plugin or profile grant is needed. The initiating account and current profile permissions are checked by the native tool handlers on every call. API LLM, Pi, Claude and Codex follow their normal chat execution paths.

An ordinary profile run may request `pluginTools: ['local_name']`: unique local names (not `p_<plugin>_*` names), validated against the initiating plugin's current registry at admission and execution. **Default: no added tools.** Only those tools are added for this run; native profile grants, including `call_agent`, remain intact. Added scopes do not enable unrelated native/external/other-plugin tools or the task/choice tools of an otherwise tool-disabled profile. Account feature permissions, administrator-only configure scope, reviews and dispatch-time revocation checks remain mandatory. Research runs reject this option. Requires updated shared types/host; the SDK forwards the input unchanged.

Explicitly granted `pluginTools` are offered with their complete input schemas from the first model request, without an `open_tools` lookup. All other tools retain normal lazy catalog behavior; this does not persist a grant or change profile settings. Profile-run rooms retain native history: in direct rooms `chat_reply_to` only quotes an older message (required `message_id`), and is absent when only the already-quoted incoming message exists.

During an ordinary plugin-initiated profile run, handlers of that same plugin receive host-supplied `context.run: {requestId, profileId, threadId}` alongside `{account, tool}`. It is absent on ordinary MCP/chat/tool calls. Bind effects to this identity plus the live account, domain revision and stored idempotency receipt; do not use model arguments or prompt secrets as authorization.

Optional `roomKey` is 1–100 ASCII letters/digits/`_ . : -` (no spaces). The host combines it with plugin ID and profile ID; automation rooms are account-owned. Optional `roomTitle` (trimmed, 1–60 characters, requires `roomKey`) supplies a human-readable suffix on creation, within the native title bound. Existing/user-renamed titles are preserved; raw keys are not used as labels. Both `room` and ordinary profile `start` accept it.

Before rotating an instance generation, cancel its jobs and await terminal status using bounded `get`/`wait`, then call `forgetRooms`. The host refuses held/waiting run locks, in-progress creation and running native replies with 409. Jobs merely admitted to the runtime queue may not yet hold a room lock; `expectedThreadId` makes those jobs fail without creating a room when their link is gone. Cleanup accepts no arbitrary thread IDs and cannot target other plugins/accounts/research/unlinked user rooms. Both SDK surfaces advertise `llm.room`/`llm.forgetRooms`.

Deletion is allowed only when **every user message** has `routing.routine.source === 'plugin'` (an empty room also qualifies). Otherwise only the automation link is removed: human chat, its lorebook and appearance stay intact. Pure automation rooms use the shared native delete service, including chat-book deletion and appearance cleanup. The route's optional backup/keep/merge behavior remains available to normal chat deletion; plugin cleanup uses the default delete-book/no-merge policy and does not request an automatic backup. Results report `deleted` or `unlinked` per room.

Call `room` before preparing context and pass its ID as optional `expectedThreadId` to `start` (ordinary profile mode only). A run with this precondition only looks up its room; it never creates a replacement. If the link or room disappeared, generation fails: resolve again deliberately and rebuild first-room context. A changed actual `threadId`, not just a changed key, requires resending folded summary/lore.

Same-account/plugin/profile/roomKey runs acquire a FIFO cancellable lock **before** the global four-execution slot. A completed, non-aborted primary releases that slot before the follow-up delay/drain; failed or aborted primaries do not enter this stage. Follow-up model work uses normal chat connection limits. On cancellation, the room lock waits for the preparation/reply/order promises captured at cancellation—not later unrelated turns. New queued runs independently await room availability cancellably.

Native after-reply judging and its delayed follow-up chain are awaited where the normal engine supports them. A failed primary reply fails the run; a completed primary is retained if a later follow-up fails. Only completed reply text is joined with blank lines in `result.text`; `profileRun.messageIds/tools` includes all replies, and `incompleteMessageIds` identifies unsuccessful ones. An explicit plugin deadline during follow-up returns completed speech with `followUpFailed:true, followUpTimedOut:true`; a primary-stage timeout still fails. Explicit `llm.cancel` remains cancellation, including after primary completion. Codex retains its normal follow-up limitations; non-plugin chat cancellation/rewrite/continue behavior is unchanged.

`job.delivery: {threadId,messageId}` is a durable receipt that the native room stored the input, available even after failure/cancellation. Advance and monotonically merge plugin checkpoints on delivery, including cancel paths; store the delivered thread ID. Never replay committed tool mutations merely because speech failed. Repeat the small fixed instructions and tool-use context every turn: native history windows/summary may drop old instructions. Revision-based lore and new outside-event deltas can avoid replaying history, but a new thread needs initial folded memory/lore again. `history` is extra context, not a replacement for native history.

Some native headless writers store no failed message: `profileRun.followUpFailed:true` reports that case even when `incompleteMessageIds` is empty. Plugin drains never repeatedly judge the same primary reply after such a failure; normal-chat scheduling is unchanged.

Omit `maxTokens` to follow the profile's settings, including full tool-call arguments. Without a configured cap, text mode sends no cap and uses the provider default. Explicit `maxTokens` is any positive safe integer and only lowers an existing profile cap. Each turn resets the room override, so an earlier explicit limit does not constrain later omitted limits. This behavior requires an updated host, not a new SDK.

**Host settings come first.** Tool rounds, output caps and context follow the host's settings, not numbers a plugin picks: every profile run and research uses the app-wide tool round limit (Settings › 채팅 › 자원 › 도구 사용, default 50, 1–200), and the profile's own context, lore and output settings. Do not ship per-plugin tool/turn budgets or fixed small `maxTokens`; pass `maxTokens` only when a short answer is the point of the call. Omit `timeoutMs` as well to let text, research and profile runs follow their engine/connection settings until completion or `llm.cancel`; only an explicitly supplied plugin deadline applies. One `api.llm.wait` call returns or throws `TimeoutError` within ten minutes, so wait again for longer runs. Account checks, tool reviews, cancellation and request-ID replay rules are unchanged.

```js
const job = await api.llm.start({ requestId: crypto.randomUUID(), profileId,
  mode: 'profile', message: '내 도구로 요청한 작업을 처리하고 실제 결과를 알려줘.' });
const done = await api.llm.wait(job.jobId);
if (done.status === 'completed') {
  showReply(done.result.text);
  showTools(done.result.profileRun.tools);
  // On a user click, open full output, review cards and asynchronously completed media:
  await api.navigation.openChat(done.result.profileRun.threadId);
}
```

The host creates one dedicated native room per plugin + account + profile; rooms appear in Chat's Automation tab and retain history. Other private chats are not selected or imported. Concurrent turns for the same room fail as busy. These rooms remain ordinary account chats after uninstall and can be deleted there. Profile execution uses native chat usage accounting and history retention. `history` is additional reference context; `userName` describes the current partner. The profile's lore settings apply, so `useLorebooks:false` and `structuredOutput` are rejected in this mode.

`result.profileRun` includes `threadId`, `messageIds`, up to 32 bounded tool records and `toolsTruncated`. Records include actual tool status, summary/output excerpts, image history/hash and audio candidate references, pending jobs, failed jobs, deferred generation state and proposal IDs. `llm.get` refreshes linked generation/review outcomes after the reply completes. A completed tool that queued generation does not mean the media finished. Full outputs and review cards remain in the native room. Display text is capped at 4,000 characters and tool excerpts at 24 KiB. `api.supports('llm.profile')` detects host support; rebuild packages with the updated SDK for `navigation.openChat`.

### Isolated read-only post research

An updated host accepts `research` only with `mode:'profile'` through the existing browser/server `llm.start/get/wait/cancel` methods. The SDK needs no changes. Older hosts reject the unknown field: **never retry without `research`**, which would remove the boundary.

```js
const job = await api.llm.start({
  requestId: crypto.randomUUID(), profileId, mode: 'profile',
  message: 'Compare the supplied sources. Distinguish claims from evidence.',
  research: {
    slotId: 'save-1', activityId: 'activity-1',
    allowedPostIds: [12, 34]
  }
});
const done = await api.llm.wait(job.jobId);
if (done.status === 'completed') {
  const { text, profileRun } = done.result;
  // A completed answer is not an independent verification.
  showResearch(text, profileRun.research);
}
```

`PluginResearchInput`:

| Field | Contract |
| --- | --- |
| `slotId`, `activityId` | Required nonblank strings, 1–100 characters each; both are part of the isolated execution identity. |
| `allowedPostIds` | Required 1–100 positive integer IDs. Only currently published, accessible posts in this set may be searched/read. No category expansion. |
| `purpose` | `research` (default) or `summary`. Summary exposes no tools on **every** engine and uses one API call / one Claude or Pi turn; Codex has no native turn cap. |
| `maxModelCalls`, `maxTurns`, `maxToolCalls` | **Deprecated, accepted and ignored** (integers, so older plugins keep working). Research follows the app-wide tool round limit *N* like any chat reply: *N* tool rounds, then one answer without tools — direct API `maxModelCalls` = *N*+1, Claude/Pi `maxTurns` = *N*+1, no per-call cap (`maxToolCalls: null`). |

Each new request uses its own account/plugin/profile/slot/activity/request automation room and **does not import room history**. `history`, if supplied, is explicit caller-provided context, not host-certified evidence. The stateless persona builder and existing native executors are reused. Automatic lore, linked files, semantic memory, judge, translation, instruction hooks and memory updates are omitted; `useLorebooks` does not enable them. Omitted `timeoutMs` follows engine/connection settings; an explicit 1,000–1,800,000 ms deadline includes waiting. Direct API uses the profile's output cap, lowered by an explicit `maxTokens`. Native output settings follow their existing transport, not an invented provider-level guarantee; Codex exposes no enforceable output-token cap. Native usage accounting is retained. Research errors use the same safe provider classifier, with source revocation reported as `조사 자료 접근 권한이 바뀌었어`. These are execution limits, not a currency guarantee.

**Direct API, Claude Code, Codex and Pi profiles are supported without engine substitution.** API/Claude/Pi use the existing headless LLM dispatcher. Claude retains its restricted CLI, isolated temporary home and strict MCP inventory; Pi uses a fresh private session with only CoNAI custom tools (no extensions/context discovery, retries or compaction during research). Codex uses the existing verified read-only app-server, a fresh private runtime/thread, and an account/research-bound loopback MCP token revoked at completion/cancellation. No shell, direct filesystem, external MCP or mutation tool is enabled. The host exposes only `posts_search` and `posts_read` (neither for summary), intersected with current account permissions and profile grants; every dispatch rechecks them. Search applies explicit IDs before totals, ranking and pagination without an embedding request. Read returns bounded original Markdown and its revision. Drafts/hidden/deleted posts, comment reads, attachments, indirect/catalog/plugin tools and web access remain unavailable. A visible matching comment snippet in scoped search is not read evidence. Post text cannot change these limits. Ordinary profile execution and reviewed publishing outside research are unchanged.

Direct API checks every supplied source before **every provider request** and reserves its final admitted request for prose without tools. All engines check the sources before starting, before returning a result, and on native tool dispatch; in-flight native runs additionally recheck every second and abort on revocation. **Native engines own their internal provider requests:** an atomic check before every internal request cannot be guaranteed, and already-sent content cannot be retracted. Pi removes tools for the final native turn; Claude uses its native `--max-turns` cap and may return partial text/evidence when that cap is reached rather than promising an extra summary. Codex has no enforceable model-call, turn or tool-call cap: only the timeout is guaranteed. Use `purpose:'summary'`, not `mode:'text'` or a guessed engine flag, to summarize shared excerpts without tools on any engine. Native search/read audit receipts and execution records may still be written; source content is never changed.

For live source checks before displaying cached quotes or results, reuse the native tool instead of an LLM call:

```js
const result = await conai.tools.call('posts_search', {
  post_ids: sourceIds, status: 'published', limit: 50, offset: 0
});
```

`post_ids` accepts 1–100 positive integer IDs; supplying it permits only published posts (`status:'draft'/'all'` is rejected). Search `limit` is now 1–50 (default 10); check batches of at most 50 IDs or paginate larger sets. The existing `{total, posts, snapshot?, score_version?}` result adds `revision`, `content_version` (`number|null`) and `content_hash` to each published post. The hash is the native knowledge content hash when present, otherwise SHA-256 of the exact original body. These fields are `null` where unavailable on ordinary unscoped non-published search results. Missing/hidden/draft/deleted IDs are omitted, even for an administrator/owner. Research intersects `post_ids` with the host's scope; an empty intersection returns no results. This uses existing account/profile tool permissions and batched SQL, not one source read per polling tick. Permission errors or missing IDs must hide cached quotes and derived results before the plugin returns status; changed revision/hash/version must mark the source stale. Do not serve cached sensitive output while an access check is pending or fails. This filter and version output require an updated host; older hosts must not be treated as enforcing it.

Completed jobs add `profileRun.research: PluginResearchResult`:

```ts
{
  slotId: string; activityId: string;
  modelCalls: number | null; turns: number | null; toolCalls: number;
  stopReason: 'completed' | 'model_limit' | 'turn_limit';
  limits: {
    runtime: 'direct' | 'claude' | 'pi' | 'codex';
    maxModelCalls: number | null; maxTurns: number | null; maxToolCalls: number | null;
  };
  evidenceTruncated?: boolean;
  evidence: Array<{
    postId: number; revision: number; contentVersion: number | null;
    offset: number; end: number; excerpt: string;
  }>;
}
```

`modelCalls` is an actual direct-API request count; it is `null` for all native engines, not zero or a fabricated count of outer launches. `turns` uses Claude's reported native turn count or Pi's native turn events; it is `null` for API/Codex (and if Claude omits a valid nonnegative integer count). Claude Code 2.1.302's embedded source reports the attempted continuation in `error_max_turns`, so its receipt can be `maxTurns + 1`; retain the native receipt and `turn_limit` rather than clamping or rejecting the result. This is not a count of paid provider requests. `limits` contains the **effective** enforced limits; `null` means unavailable/not applicable, not unlimited permission. `maxToolCalls` is `0` for a summary and `null` otherwise: tool calls are counted, not capped, and the rounds bound the run. Pi's normal text-only ending is not a turn-limit outcome merely because it lands at the boundary. Callers must display these distinctions and must not sum unknown model counts as zero.

Evidence is captured from successfully returned original body slices, never from model text, search summaries, rejected reads or caller history. The native `excerpt` remains the first at most 400 UTF-16 units of the returned slice; `offset`/`end` describe its exact half-open interval. `contentVersion` is the native knowledge version or `null` for ordinary posts. All receipts are retained; there is no separate 12 KiB evidence budget. Large results use private runtime result files under the shared 8 MiB resource ceiling. `evidenceTruncated` remains a legacy compatibility field, not a new truncation policy. These are historical snapshots, not current-source validation. Empty evidence stays empty even when the model claims success.

Budget termination can complete the job with partial/empty text and `model_limit`/`turn_limit`; do not label that a completed investigation. Provider failures/timeouts/cancellation keep the existing failed/cancelled envelopes and do not promise a completed result; the native room retains the reply status. Request IDs retain their existing account/plugin-bound idempotency and input-conflict rules, with no automatic replay after interruption/restart. Existing plugin LLM concurrency and profile-busy limits apply. Poll/cancel using the job ID; account/profile checks remain, and fetching a research result also requires current `posts.view`. Rooms remain in the native Automation list and can be deleted there; runtime results use the existing job expiry.

Implementation: `shared/src/types/plugin.ts`, `backend/src/services/plugins/pluginLlm.ts`, `backend/src/services/plugins/pluginProfileRun.ts`, native `backend/src/services/codex-chat/llmChatService.ts`, `backend/src/services/codex-chat/codexChatService.ts`, `backend/src/services/codex-chat/chatResearch.ts`, and the existing MCP/post services. Host regressions use `backend/test/plugin-server.test.ts` (mocked API/native processes, real dispatch/permissions/evidence) and `backend/test/chat-pi-sessions.test.ts` (real Pi SDK against a local scripted provider); no real paid requests. This contract requires the updated host; the SDK remains a pass-through, with no API-only fallback.

### Stateless text compatibility

Omitted `mode` or `mode:'text'` uses the stateless API. `structuredOutput` accepts a valid JSON example/schema object or JSON string, without a separate size ceiling; it counts toward the whole request transport limit and context measurement. Native workflow JSON mode returns complete `result.json` and `result.text`; malformed JSON fails rather than being reported as success. This is not an independent JSON Schema validator. There is no plugin JSON-result rejection or text preview cut.

Text output follows the profile's settings. An absent cap is left absent; an explicit positive safe-integer `maxTokens` can lower the profile cap. Judge calls use their selected target's requested/default setting. Codex's estimate-only reserve is not an enforced cap.

`model: 'judge'` (text mode only) sends the same profile prompt to the profile's judge model, or to the default judge row (⚖) when the profile has none, instead of its chat model. Use it for frequent small decisions where a cheaper, faster model is enough. Only LLM connections qualify (a TypeSafe decision model is skipped), and a Claude Code/Codex profile also runs on that row. `start` refuses with 409 when no judge model is available, so the caller can fall back. `api.supports('llm.judge')` detects host support; a server module on an older host gets a validation error from `start`.

In text mode, the native character-turn builder supplies the persona, sections, optional lore and author note; the common model path supplies its configured engine/model and usage accounting. The plugin supplies recent conversation and owns its world/memory. This mode does not open a chat, execute chat tools, update native memory, translate the reply or run `chat.instructions` hooks. Usage appears under **플러그인**, with the profile and a reply ID containing the plugin/job IDs.

With `useLorebooks:true` (the default), authenticated plugin text calls resolve both global and shared file-backed books linked to the profile, freshly for each execution. The host derives the reader from the initiating account; callers cannot provide a chat or an owner to import private chat lore. Keyword/always-on selection and profile token limits use the native lore path. `useLorebooks:false` disables these profile books. Plugin-owned world lore and personal memories remain the plugin's responsibility and can be supplied as bounded reference `history`; they do not alter the shared profile or other chats.

Text mode can opt into the profile's model/display languages with `translation: { fields: ['say', 'entries.*.title', 'entries.*.keys.*', 'entries.*.content'] }`. The character turn receives its configured model-language directive. `result.json`/`text` remain the source; `result.translation` carries `status` (`completed`, `failed`, `disabled`), `language`, optional `sourceLanguage`, and the separate translated `json`. When the selected prose already reads as the display language (a persona that ignored the model-language directive), nothing is translated: `status` is `completed`, `sourceLanguage` equals `language`, and there is no translated `json`. Paths select prose leaves only (up to 20 paths, five components); leaves are chunked by count and translator token budget as described above. Object keys, unselected IDs, action enums, numbers and source references are unchanged. Translation uses the existing profile translator and usage accounting, inside the same cancellable job. A failed/oversize/deadline translation returns the original with `status: failed`; explicit cancellation or revoked access still cancels/fails the job. Persist source and translated data separately, use only source prose as model history, and invalidate a cached translation when its source changes. Defaults remain untranslated for older plugins.

For an explicit editor operation, `translation: { only: true, direction: 'model' | 'display', fields: ['title', 'keys.*', 'content'] }` translates the JSON in `message` using the selected profile, without a character turn or tool execution. `result.json` is the supplied source and `result.translation.json` is the requested language. It fails if the profile has no usable translator. The caller reviews/saves the result through its normal revision/approval path. `llm.profiles()` exposes `translation.enabled`, `modelLanguage` and `displayLanguage`, without model credentials.

Requests/results are scoped to **plugin + initiating account**. Profile enablement, engine permission, allowed groups and global chat enablement are checked at admission, before generation, during long requests and before returning a completed reply. Disable, package update or removal requests cancellation of running replies. Closing a page alone does not cancel its jobs; send `cancel` when that is the plugin's desired behavior. Cancellation stops local processing but cannot undo provider usage already incurred.

Reuse the same `requestId` and identical input to recover an uncertain start response; it returns the original job even if that job failed or was cancelled. Different input or a changed package with that ID is rejected. A deliberate new turn/retry uses a new ID. The existing runtime recovery marks interrupted jobs failed rather than replaying them after restart. Jobs and deduplication have a **24-hour window**; keep needed replies in the plugin database and never automatically resubmit expired requests.

Resource protections: an instance-wide **four-job execution pool** protects CLI processes, with at most **64 waiting jobs and 64 MiB of serialized waiting-input bytes per plugin**. Executing jobs no longer consume the waiting allowance; the existing connection scheduler also governs provider concurrency. Waiters have phase `queued` and may have runtime status `running`. A full count/byte queue returns 429 busy, not a per-request length error; an unadmitted ID can be retried when capacity is released. The input map retains only input and measurement, not built messages. Completed identities remain recoverable for 24 hours; expired terminal identities are pruned without a 10,000-record refusal.

There are **no plugin-specific message/history/schema or judge-prose length ceilings**. The whole request follows the host HTTP body policy (**5 MiB by default**, configurable with `JSON_BODY_LIMIT_MB`); server-worker LLM calls enforce the same serialized-body bound. Profile-context preflight remains the model-input boundary. Strict field/type validation, identifier formats, question/option/conversation/action counts and safe translation paths remain. Optional `timeoutMs` (1000–1800000 ms) includes queue waiting; omission follows connection/engine settings, not a plugin 120-second deadline. Codex text retains its **native 10-minute engine default** when omitted; TypeSafe retains its native default as described above. Same-room write locking remains an integrity protection.

Replies return **full text and JSON**, including profile/research replies. `truncated` means the model reported `finish_reason:'length'`, never a preview cut. Above the 64 KiB inline threshold, private runtime files retain results up to the shared **8 MiB resource ceiling**. Authorized `llm.get` transparently returns the same result shape. Missing/corrupt files return **410**, including cancel/replay reads. Generic `/api/jobs` list/get/cancel responses return plugin-LLM summaries with `result:null`, never hydrate private replies or bypass profile/research checks. Completion races/errors clean orphan files. No JSON/translation envelope is discarded at a smaller plugin cap. Generic `api.server`/tool transport limits are separate; use `api.llm.get` for full results. Job parameters retain only metadata/input byte counts, not prompts.

For assistant automation, register plugin tools with `conai.tools.register` and call the same `conai.llm` methods inside their handlers. Register page state/actions for browser interactions as usual; do not add plugin-specific tools or UI to the host.

Profile assets use the same library references, legacy embedded images and safety visibility as native chat. Avatar crop is returned separately: use `object-fit: cover`, `object-position` and `transform-origin` of `${crop.x}% ${crop.y}%`, and `transform: scale(crop.scale)` inside a clipped square. Decode the base64 image into a Blob URL in the sandbox and revoke it when replaced or unmounted; native authenticated URLs cannot be loaded directly from the opaque iframe. Fetch images only for visible/selected profiles, refresh on profile changes or explicit reload, and keep bytes out of assistant state and plugin databases. Images are bounded to 512 pixels and 192 KiB encoded WebP bytes, with at most four conversions in flight. Missing/hidden images return no bytes; lack of permission rejects the request. This bridge requires a host build containing `llm.asset` as well as the updated SDK.

## Implementation map

- `shared/src/types/plugin.ts`: manifest and bridge data contracts.
- `backend/src/services/plugins/`: package registry, session scope, approvals and media grants.
- `backend/src/routes/plugin-assets.routes.ts`: credential-free assets and media.
- `frontend/src/features/plugins/`: optional package management and trusted host.
- `backend/test/plugins.test.ts`: important package, permission, approval and origin regressions (`npx tsx --test backend/test/plugins.test.ts`).
- `backend/src/services/plugins/pluginServerRuntime.ts`, `pluginServerTools.ts`, `pluginData.ts`: server module workers, registered tools, data folders; `backend/test/plugin-server.test.ts` covers them.
- `backend/src/services/plugins/pluginLlm.ts`, `backend/src/services/codex-chat/chatProfileReply.ts`: account-bound profile replies, shared prompts, idempotent jobs and cancellation; covered by the server plugin and workflow LLM tests.
- `frontend/test/plugin-text-editor.test.ts`: draft preservation during conflict refresh and concurrent typing (`cd frontend && npx tsx --test test/plugin-text-editor.test.ts`).
- Generation layouts: `frontend/src/features/plugins/plugin-generation.ts` (contributions), `plugin-layout-block.tsx` (embedded page), `plugin-generation-actions.tsx` (Generate-bar buttons), `withPluginBlocks` in `frontend/src/features/image-generation/layout/generation-layout-ops.ts`, the form bridge (`form`/`fillForm`) in `frontend/src/features/codex-chat/chat-page-context.tsx`; covered by `frontend/test/generation-layout.test.ts`, `frontend/test/plugin-sdk.test.ts` and `backend/test/plugin-server.test.ts`.

## Generic processing and project changes

`workspace.stat({ target })` returns `{ target, exists, kind, revision, size? }`; `{ targets: [...] }` accepts up to 32 and returns `entries`. Missing targets return `exists: false`. Directory revisions include indexed descendants, capped at 10,000.

`workspace.proposeChanges({ operations })` proposes 1–100 common workspace `mkdir`/`write`/`edit`/`move` operations, with at most 1 MiB of review data. Existing-file and folder moves require `expectedRevision`. Folder moves use rename and update the workspace index; arbitrary recursive deletion is not exposed. Approval validates the original state, then execution uses the common writer gate and request identity. Batches are not transactional across files: errors report committed targets, and repeating the same proposal never replays committed work.

`media.proposeProcess({ sourceTarget, target, revision, operation })` uses the connected editable project and current image/audio permissions, without manifest capability gates. `sourceTarget` is an existing project media-reference JSON; `target` is a distinct JSON output reference in an existing folder; `revision` is its current revision or null. Operations:

- `{ kind: "crop", left, top, width, height, outputWidth, outputHeight, quality }`: integer source-image coordinates; new WebP to the image library. Input 50M pixels, output 16M, dimensions 1–8192, quality 1–100.
- `{ kind: "extract_audio", quality }`: first audio track to OGG, quality 0–10, 90-second processing timeout and 200 MiB output ceiling; no audio track is an error.

Both return a proposal ID, never an approval. Human host Apply starts one `plugin-media` runtime job (one concurrent processing job globally), rechecks source revision/content fingerprint and grants, and writes the result reference through the workspace writer. Job status, cancellation and results use existing runtime job APIs/UI. Only a completed job sends `onSaved`; `result.link.status` must be `completed` before reporting a project link as saved. Media already saved remains recoverable through `result.reference` if linking fails. Runtime jobs do not automatically resume after a process restart. No session credentials are serialized into job parameters, and no arbitrary executable or network URL can be supplied.

Project media references also accept `{ source: "audio", candidateId }`, with live audio-view/deletion checks. MCP `list_plugin_pages` returns only enabled packages, paginates discovery, and loads action schemas for one requested page. In-app execution uses the established connected-page `page_act`; standalone external clients can discover pages but cannot execute their browser handlers without that page connection. Action suffixes use lowercase letters, digits and underscores (`plugin-id.action_name`).

The host adds authoritative `extensionHost.pendingReviews` and `extensionHost.jobs` to the assistant page data, overriding any same-named plugin snapshot field. These cards are separate from chat `get_proposal_status`; inspect the host data before claiming that no review exists. Connected extension pages supply `list_plugin_pages` directly even when general profile read tools are disabled. Processing reviews display existing output-reference text before replacement (at most 16 KiB).


## Native app bridge and headless actions

Every enabled plugin can use native app tools through the same validation, account permissions and storage/queue services as the app. `appTools` is optional legacy metadata and does not restrict discovery or execution. Server modules are not required. Tools requiring an active chat/page context are excluded, rather than advertised and then rejected. A native feature with no app tool still needs a shared adapter.

Discover usable tools with authenticated host `POST /api/plugins/app-tools` (`{ query?, tool?, offset? }`) or `api.app.tools(...)`. Lists contain 20 summaries; specifying `tool` returns its native schema. Account-inaccessible tools and tools requiring a missing execution context are omitted.

| Method | Meaning |
| --- | --- |
| `api.app.call(tool, arguments, requestId?)` | Read immediately or start a native mutation job as the current account |
| `api.app.run(actionId, arguments, requestId?)` | Execute a manifest server action through that same path |
| `api.app.getRequest(requestId)` | Read a request's persisted status/result |

A `serverActions` entry contains `id`, `label`, `description`, bounded input `schema`, a fixed native `tool`, and optional argument templates. `{ "$input": "field.nested" }` selects validated input; other values are constants. There is no eval, expression language, loop or dynamic tool selection. Omitting `arguments` forwards validated input. The action's native tool must be available in a plugin execution; no duplicate `appTools` declaration is needed. Reference action IDs in `pages[].serverActions` to automatically supply page-action schemas and host handlers; no duplicate iframe handler is needed. Custom browser-only interactions continue to use `pages[].actions` and SDK handlers. See [app-workbench](app-workbench/README.md) for a complete installable example.

Native workspace operations require an explicitly bound project (iframe connection or the calling chat's project binding). The server carries its ID, write grant and guideline revision; model arguments cannot choose another project. Approval cards show the project. Changing a chat binding or project guideline invalidates old requests. An omitted native `workspace_apply.requestId` is derived from the immutable host request ID. No project instructions or page snapshots are stored in the request authorization record.

MCP `list_plugin_pages` also lists server actions; pass `pluginId` and `action` to load one input schema. `run_plugin_action` executes them without opening the plugin page. Reads return native results; mutations return `pending` with an ID. The user reviews and applies them at `/#/extensions` (or the originating plugin page). `get_plugin_action` and `cancel_plugin_action` work without that page. MCP and page-assistant mutations keep host review; direct SDK app calls start normally. Explicit `files.proposeWrite` and `workspace.propose*` calls still create reviews and cannot approve themselves. External keys keep their current permission-group grants and existing account-bound service restrictions. Both the original key grant and the execution account are rechecked at approval and dispatch; administrator approval cannot override a revoked or narrowed key. Execution runs under the initiating account, or the approving account for an unbound key. AI/MCP generation proposals go through review; direct app generation uses native account permissions. NovelAI multi-sample guards also apply to the plugin source.

Mutation requests require stable `requestId` (8–100 letters/digits/underscores/hyphens). SDK helpers generate one by default; supply and retain your own for retries. Reusing it with different inputs, package digest or project binding is rejected. Pending/running requests are limited to 16 per requester, total retained requests to 1,000, retention to 24 hours. Inputs are at most 256 KiB; native results (including small image/audio previews) at most 512 KiB (larger results return an explicit omission notice). Results above 64 KiB use the existing private runtime-result artifact store instead of being truncated in SQLite. Lists omit completed result payloads; load them on demand. App-operation execution has four bounded slots and a separate cancellation slot. Full slots return 409; retry the same pending request after completion. This does not duplicate approved operations.

Approved operations run as persisted `plugin-action` runtime jobs and do not need an open iframe. Restarted/interrupted jobs are reported as failed, never automatically replayed. Cancellation before dispatch prevents execution; already dispatched native operations can finish, and returned generation/job IDs use their own native status/cancel functions. Disabling a package blocks new calls and unapplied approvals; it cannot undo a dispatched native operation. The host exposes current app-request IDs/statuses in `extensionHost.appRequests` and a bounded last result in `extensionHost.appResult` for the assistant.

Native image/audio content blocks are retained within the result-size limit. A web plugin can turn their base64 bytes into a Blob URL for display; image data is omitted from the host assistant summary. Large original media continues to use the streaming media-reference SDK.
