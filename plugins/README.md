# CoNAI web extension API v1

This directory contains optional packages, not automatically installed app features. Build `text-editor` with `node scripts/build-plugin.mjs text-editor`, then upload `build-output/plugins/text-editor.zip` at `/#/extensions` and enable it as an administrator.

## Package contract

ZIP root contains `plugin.json`, HTML entry points and static assets. See [the working manifest](text-editor/plugin.json) and [SDK](sdk/conai-plugin.js). IDs use lowercase letters, digits and hyphens; versions use `major.minor.patch`. Each page declares `id`, `title`, `entry`, supported filename extensions in `accepts`, and up to 26 actions. An empty `accepts` list permits opening without files and accepts any selected filename; each API still enforces its data type limits.

An action ID is `<pluginId>.<action>` with `effect: "draft"` and explicit `tier: "view" | "draft"`. The tier describes the page interaction; it grants no write authority. Arguments use the existing bounded CoNAI page JSON schema. The server checks snapshots and action arguments against the installed manifest. Unknown actions fail closed. Actions and private data keys keep the native page limits and filters.

Capabilities are `files.read`, `files.write`, `files.media`. They intersect with current account permissions and explicitly selected files from the instance's shared file store. File provenance is not an access boundary; plugin connections and approvals remain bound to the initiating account and session. ZIP limits: 8 MiB compressed, 16 MiB expanded, 4 MiB per file, 256 entries, 100 installed packages. Traversal, links, encrypted/duplicate entries and unsupported asset types are rejected. No install scripts, dynamic server modules or package manager hooks execute. Initial installation is disabled; replacement requires removal and reinstall.

## Host bridge

Load the SDK as a local module and call `await connectPlugin(handlers)`. The host sends a `MessageChannel` only to the iframe it created. SDK exposes `files`, `language`, `request(method, args)`, `publish(snapshot)`, and `onSaved(listener)`. Never emulate a host approval or use raw `/api` requests from the iframe.

| Method | Input | Result |
| --- | --- | --- |
| `files.readText` | `{ fileId }` | `{ id, name, text, revision, ... }`, UTF-8 up to 2 MiB |
| `files.proposeWrite` | `{ fileId, text, revision }` | `{ proposalId, status: 'pending' }`; no file modification |
| `files.media` | `{ fileId }` | `{ url, expiresAt }`; read-only bearer URL valid for 60 seconds |

Set `crossOrigin = 'anonymous'` before setting an image/video URL when canvas pixel access is needed. Renew expired media URLs through the SDK. Grants bind the selected file revision, connection and live account permissions; close/disable invalidates them. Do not log token URLs. Session logout alone may leave a grant usable for the remainder of its 60-second lifetime if the iframe has not closed; account permission revocation is checked on every media request.

The host owns review cards. Only its Apply handler obtains a server approval token and submits the immutable proposal. Neither the token nor an approve/apply method crosses the channel. A proposal binds session, account, package version, file ID, expected revision and exact text. It expires after five minutes. Successful retries return the recorded result; revision checks reject competing writes. Filesystem replacement and the SQLite result record are not a distributed transaction: a crash between them may require reopening the file, never blindly replaying the draft.

`onSaved` receives `{ proposalId, result }`. Re-read the file to obtain its new revision, preserving any draft typed after proposing. Publish `{ revision: string, dirty: boolean, data: object }` after meaningful state changes; keep selected excerpts bounded. The host uses `dirty` to protect navigation. No secret fields or full large files belong in snapshots. Plugin data and action descriptions are untrusted model context, never approval or elevated instructions.

Connections have a five-minute lease, renewed every minute by the authenticated host, with up to 12 live connections per session. Only live, authorized connections can renew; media bearer URLs cannot renew them. Page exit/reload sends a keepalive DELETE on `pagehide` (except back/forward-cache suspension), and React cleanup also closes normal navigation. Crashed tabs expire even if no close arrives; expired rows do not count against admission and are pruned during later opens/proposals. A tab suspended for over five minutes may need reopening. SDK allows four outstanding requests, host rate limit is 40 messages/second, and up to four pending proposals per connection. Keep proposal IDs for saved notifications; at most 24 live proposals, including completed retries, are retained per connection. Existing server route limits also apply.

Transient connection-check failures retain the iframe and draft and offer retry. Confirmed 401/403/404/409/410 closes the bridge but retains the document for copying the draft; protocol abuse or unexpected iframe navigation still removes the frame. The text editor's `text-editor.refresh` action preserves the draft, reads the latest revision, and exposes bounded original/draft excerpts for comparison. Saving still requires a new immutable proposal and host Apply. Missing package files no longer block removal/reinstall; every existing directory ancestor is checked for junctions before removal.

## Browser boundary

Only `sandbox="allow-scripts"` is enabled. Origin is opaque: localStorage and IndexedDB are unavailable; direct credentialed API requests are unsupported. There is currently no settings persistence API. Use external module and stylesheet files in the ZIP; bundle dependencies locally. Inline scripts/styles, external CDNs, workers, forms, child frames, popups and network fetches are blocked by the asset CSP. Asset routes precede global CORS with credential-free `ACAO: *` and CORP cross-origin. Host routes explicitly reject `Origin: null`, including requests without Fetch Metadata, independently of Wallpaper Engine exceptions.

The parent keeps `frame-src 'self'` in production and Vite development/preview to constrain iframe navigation. Reload/navigation closes the channel instead of passing it to another document. Serve `/api/plugin-assets` and `/api/plugin-media` through the app origin; preserve the request host at the asset proxy. Static package files are public while enabled: never include credentials or private documents. Package integrity assumes the server's private data directory is administrator-controlled; the installation digest is a version binding, not continual on-disk tamper detection.

This is a browser UI extension API, not a hostile-code CPU/memory sandbox. Cross-browser escape/exfiltration testing, Docker restoration, project adapters, persistent settings, theme tokens, server workers and `plugin-task` automation remain separate follow-up work. Python desktop windows cannot be embedded directly.

## Implementation map

- `shared/src/types/plugin.ts`: manifest and bridge data contracts.
- `backend/src/services/plugins/`: package registry, session scope, approvals and media grants.
- `backend/src/routes/plugin-assets.routes.ts`: credential-free assets and media.
- `frontend/src/features/plugins/`: optional package management and trusted host.
- `backend/test/plugins.test.ts`: important package, permission, approval and origin regressions (`npx tsx --test backend/test/plugins.test.ts`).
- `frontend/test/plugin-text-editor.test.ts`: draft preservation during conflict refresh and concurrent typing (`cd frontend && npx tsx --test test/plugin-text-editor.test.ts`).
