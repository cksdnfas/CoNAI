# CoNAI Frontend Architecture

갱신: 2026-10-13 · React + Vite + Tailwind + TanStack Query + React Router (hash router).
정책은 [AI_Guidelines.md](../AI_Guidelines.md), 서버·AI 연결은 [DEVELOPMENT.md](../DEVELOPMENT.md)를 따른다.

## Runtime
- Dev server: port `1677` (or `FRONTEND_URL`). Vite proxies `/api`, `/uploads`, `/temp`, `/save` to the backend on `1666`.
- Shared API types come from `@conai/shared` (`../shared`).
- Entry: `main.tsx` → `App.tsx` → `AppProviders` + `RouterProvider(appRouter)`.

## Providers (`src/app/providers.tsx`, outer → inner)
`QueryClientProvider` → `RuntimeEventStreamProvider` (SSE bridge into the query cache) → `I18nProvider` →
`ThemeProvider` (applies the saved appearance settings as CSS variables) → `TooltipProvider` → `SnackbarProvider` →
`ConfirmProvider` (`useConfirm()`).

The app shell also mounts `ChatPageProvider` → `CodexChatProvider`: page registration and the chat dock share the
current screen state. See `components/layout/app-shell.tsx`; these providers are not global route-independent providers.

## Routes (`src/app/router.tsx`, pages lazy-loaded in `src/app/lazy-routes.tsx`)
| Path | Feature folder | Permission |
|---|---|---|
| `/login` | `features/auth` | public |
| `/` | `features/home` (image feed) | shell |
| `/access` | `features/auth` | shell |
| `/groups`, `/groups/:groupId` | `features/groups` | `page.groups.view` |
| `/prompts` | `features/prompts` | `page.prompts.view` |
| `/characters` (`?view=profiles`, `?folder=`, `?q=`, `?page=`, `?setting=`, `?new=`) | `features/characters` (appearance library + existing chat profile editors) | `page.characters.view`; profiles admin-only |
| `/generation` (NAI, ComfyUI, workflows, queue) | `features/image-generation`, `features/module-graph` | `page.generation.view` |
| `/wildcards` | `features/image-generation` | `page.wildcards.view` |
| `/public/workflows/:slug` | `features/image-generation` | public workflow page |
| `/images/:compositeHash`, `/images/:compositeHash/metadata` | `features/images`, `features/metadata` | `page.image-detail.view`, `page.metadata-editor.view` |
| `/upload` | `features/upload` | `page.upload.view` |
| `/chat` | `features/codex-chat` | `page.chat.view` |
| `/chat/resources?tab=presets|blocks|lorebooks|routines` | `features/codex-chat` reuses settings resource editors | administrator, unchanged |
| `/files` | `features/files` | `page.files.view` |
| `/posts` | `features/posts` (board and knowledge) | `page.posts.view` |
| `/audio` | `features/audio` | `page.audio.view` |
| `/sprite` | `features/sprite` | `page.sprite.view` |
| `/settings` | `features/settings` | `page.settings.view`; `section=mine` uses `page.chat.view` |
| `/wallpaper` | `features/wallpaper` | `page.wallpaper.view` |
| `/wallpaper/runtime` | `features/wallpaper` | separate runtime access flow; outside app shell |
| `/graph` | redirect to `/generation?tab=workflows` | |
| `/dev/ui` | `features/dev-ui-catalog` | dev builds only |

Everything except `/login`, `/dev/ui` and `/wallpaper/runtime` renders inside `ProtectedAppShell` → `components/layout/app-shell.tsx`.
The public workflow route has its own access flow; being inside the shell does not make it a private workflow.

## App shell navigation

`components/layout/app-navigation.ts` is the one navigation model: each built-in page's path, pinnable header key,
menu group (라이브러리 · 만들기 · 확장, or none for `/access` and `/settings`), plus the
enabled plugin pages, filtered by the account's page permissions (names and icons from `page-access-catalog.tsx`).
The header shows the pinned pages and `AppNavGroupMenu` (`app-nav-menu.tsx`); below md `AppBottomNav`
(`app-bottom-nav.tsx`) shows the first four pins and 전체 (`/access`, which lists the same groups). Settings and
내 설정 are in the account menu. The pins are the shared `general.headerNavigation` page flags in
`headerNavigationOrder` (tool flags show queue, search and account); before `HEADER_NAVIGATION_VERSION` 2 the page flags
meant shown/hidden, so loading an older settings file keeps only the tool flags and starts from the default pins
(`settingsServiceStorage.ts`). While mounted, the bottom tabs set `data-bottom-nav` on `<html>`, and
`--shell-bottom-inset` reserves their room for the shell, full-height pages and bottom-anchored bars (DESIGN_PRESET
"Page layout").

## Layers

Settings use a **Mine / Shared administration** sidebar and scrolling sections with group links, not inner tabs.
`section`, `group` and `setting` select a section, scroll group and highlighted registry row. `settings-tabs.ts`
normalizes legacy section/view links, including moved chat resources. `shared/src/constants/pageSettings.ts`
defines names, descriptions, synonyms, storage scope, permission and advanced metadata. Page search, Ctrl K and the
right-side contextual settings sheet reuse it. `SettingsAdvanced` is local to its group; editor-dialog switches
remain independent of page disclosure state. Generation's `nai`, `comfyui`, `pacing`, `schedules` anchors are stable;
connection controllers and dialogs are imported from image-generation without duplicating their API operations.
- `src/components/ui/` — design-system primitives (Button, IconButton, Panel, Section, Modal, Input, …). No feature
  knowledge, no API calls. Visual rules live here.
- `src/components/common/` — shared composites built from `ui` (segmented controls, page-with-sidebar / sidebar
  column / two-pane layout, media card, page toolbar, selection bar, tag/prompt result blocks). May know app concepts, not a single feature.
- `src/components/layout/`, `src/components/media/` — app shell and shared media helpers.
- `src/features/<name>/` — pages, feature components and hooks. Features do import each other today (mostly
  `images`, `search`, `groups`, `auth`); when something is reused widely, move it down to `components/common` or `lib`.
- `src/lib/` — API clients (`api-*.ts`), query client, appearance/theme system, formatting utilities.
- `src/types/` — frontend-only view types.

Dirty open `Modal`s use `lib/use-unload-guard.ts` for the browser reload/tab-close warning. The unsaved-settings
provider reuses it alongside the shared navigation blocker. `lib/use-debounced-persist.ts` writes a stable owner's
draft after a delay and flushes pending edits on owner change or unmount.

## Character library

`features/characters/character-library-page.tsx` owns the folder tree, paged name search and editor URL state.
`lib/api-character-library.ts` uses `/api/character-library`; shared contracts live in
`shared/src/types/characterLibrary.ts`. Access is `characters.view`/`characters.edit`, header key `characters`;
image fields additionally require `images.view`, candidate generation administrator access plus edit permission.

- `use-character-setting-editor.ts` preserves drafts and checks revisions; on a stale revision it merges non-overlapping
  changes and retries once, otherwise asks the user to resolve the conflict.
- `components/character-setting-appearance.tsx` reuses settings' `character-appearance-editor.tsx` and
  `use-character-setting-runs.ts` for setting-owned asset batches and expression groups.
- Settings' `chat-profile-character-link.tsx` and `use-profile-character-link.ts` distinguish no link, synced look and
  detached copy. A synced profile edits the setting first, then saves the profile; unresolved conflicts stop that save.
  Background and its generation remain profile-owned.
  Detached/unlinked drafts show the source expression group read-only until saving copies it; missing/inaccessible
  groups show a note. `ensureProfile` persists pending link changes before dependent stores/profile-owned generation.
  Proposal cards refuse synced look-only changes and confirm saving only the remaining fields in mixed proposals.
- Generation's `character-setting-load-button.tsx` copies tags and optional reference into NAI/Codex/ComfyUI forms;
  later library changes do not update those forms. NAI reference placement is independent of character prompt rows.
- `module-graph-character-setting-input.tsx` selects `character_setting_id` on a node card/inspector, mutually exclusive
  with `profile_id`. Workflow run inputs still use a numeric field rather than this picker.
- `use-character-library-chat-page.ts` registers `character.*`; the profile adapter exposes `profile.draft` with
  `characterLink` and reviewed `profile.character_save`. Generation adapters expose `character_setting.insert` through
  `use-chat-character-setting-insertion.ts`. Shared action permissions and path checks remain authoritative.
  The profile adapter refuses switching settings over a dirty synced draft, requires `characters.edit` for synced
  appearance edits, exposes up to 50 `syncedProfiles` names and separates background from setting-owned `profile.assets`.
- Runtime topic `characters`, event `characters.changed`, refreshes affected library/profile queries through
  `features/runtime-events/use-runtime-event-query-bridge.ts`.

See the [user guide](../docs/GUIDE/CHARACTER_LIBRARY.md) and [backend/code map](../DEVELOPMENT.md#캐릭터-라이브러리와-외형-재사용).

## i18n
- `useI18n().t(...)` with inline `{ ko, en }` dictionaries, or catalog keys from `src/i18n/resources/<feature>.ts`.
- Route catalogs register lazily with the page (`loadRouteModuleWithCatalog`). Default language `ko`.
- Korean UI copy uses casual 반말.

## Design system
See [DESIGN_PRESET.md](DESIGN_PRESET.md) ("The Silent Curator", flat page, spacing and hairline rows, button variants, tokens) and the
live catalog at `/#/dev/ui`. Use `components/ui`; the `[ds/*]` lint guards in `eslint.config.js` flag bypasses.

## Assistant integration and performance

- New page features include an assistant path: register bounded fields/data/actions with the page context and reuse
  the native state setters/API. Follow the shared action schema, permission mapping and view/draft/commit tiers.
- Server-side automation uses MCP tools over the same domain services. A navigation entry alone is not full feature support.
- Chat thread queries/selection live in `features/codex-chat/use-chat-thread-data.ts`; transcript windowing, streaming
  follow and focus restoration live in `use-chat-transcript-window.ts`. Both chat layouts share them.
- The chat view delegates the composer (`chat-composer.tsx`), live turn state (`chat-live-state-provider.tsx`),
  streamed messages (`chat-streaming-surfaces.tsx`) and portraits (`use-chat-portrait.ts`), so typing and streaming
  do not re-render the whole view. Directory events share one coalesced refresh (`chat-query-refresh.ts`); tail-only
  changes refetch active threads' tails after in-flight reads settle; sends and read receipts patch room lists locally.
  The chat gallery uses the shared virtualized media list and polls only pending work. Page registration detects
  content changes without serializing payloads.
- Context settings responses patch the open row with `applyChatThreadUpdate`; an interrupted read is invalidated.
  Chat edit mutations may request `?tail=N` (1–500), returning a bounded transcript with `messagesFrom` when older
  messages remain; reply edits and variant switches also return `changedMessage` and `previousContextRevision`.
  Without `tail` the legacy full response remains. `applyChatThreadDetail` merges the loaded range safely.
- Streaming Markdown is split by `chat-markdown-stream.ts` and parsed block by block; saved messages parse as one
  document. Resolved generation thumbnails use the thread media map; unresolved history is fetched and polled.
  `/chat` shares the sidebar's paged room cache: page-assistant `data.threads` contains loaded rooms only,
  `roomsHaveMore` signals more, and `list_chat_rooms` finds others. An open chat shows loading/error states rather
  than the new-profile picker.
- Group cover requests use `lib/batch-loader.ts` and the group/auto-folder `preview-images?ids=` routes (up to 100
  distinct IDs, same image-view access as individual previews). Group rematch jobs use `useRuntimeJobAction`:
  `resumeKind` follows all-group/rebuild jobs, while `resume: {key, find}` follows the selected group's
  `GET /api/groups/:id/auto-collect`. A readable job may include `viewerCanCancel: false`.
- Post galleries and SNS slides batch image records (`usePostMediaRecords`) and share per-hash `['post-media', hash]`
  records. Group hierarchy-only refreshes skip media queries. Feed-safety caches keep only current items.
- Workflow chat builds graph signatures/snapshots only while a chat is connected. Generation panels share
  `useHistorySettingsLoad`, `useGenerationImageSaveOptions` and `usePortalTargetById`; private and public Comfy
  workflows share `useComfyWorkflowDraft` (account-scoped, debounced, flushed on switch/unmount) and field validation.
  Ticking clocks use `lib/use-now.ts`; result progress ticks inside its own component.
- The Save picker and private/public artifact explorers use server search and 60-item cursor pages over a directory
  snapshot and keep their virtualized grids.
- `requestJson` handles raw responses; `requestApiData` handles envelopes, localized fallbacks and required data while
  preserving `ApiRequestError` status/code/data. Revision-checked settings drafts share `useSettingsDraftSlot`;
  general settings keep per-section saving. Long maintenance work (scan, verify, metadata re-extraction) runs as
  runtime jobs followed with `useRuntimeJob`/`useRuntimeJobAction`.
- Posts share `use-post-comments.ts` between the page assistant and rendered threads. Root/reply cursors load bounded
  server pages; focused comments and quote context do not require downloading the entire discussion. The post editor
  guards unsaved navigation and Cancel; on 409 it keeps all draft fields while the user loads a latest revision, then
  the next save overwrites that revision.
- Preserve the shared virtualized list in `features/images/components/image-list/` (Virtuoso + ViSelect), stable media
  identity, bounded loading and video preview lifecycle. Do not build a separate engine per page.
- Container masonry pagination checks both the request state and viewport distance after each page; filtered-out pages must not permanently lock loading at the same visible item count.
- Library selection uses `components/media/media-library-browser.tsx`: the group tree, server prompt/tag search,
  media/tool filters, sorting and virtualized list share the post attachment layout. `media-library-picker.tsx` adds
  the modal and reference selection for chat, settings, wallpaper and sprites. Posts embed the browser with mixed
  attachment ordering and group insertion; generation inputs embed it in their System tab and retain their existing
  import/conversion flow. Pass media kind, selection limit and initial group as options; do not fork the browser.
  Page assistants keep using each feature's existing hash-based draft/action contracts and domain APIs.
- Keep expensive work out of input/scroll/render paths. Reuse the query cache and runtime event bridge; invalidate
  affected data instead of refetching every list. Keep page snapshots and tool responses bounded.
- React Compiler is configured in `vite.config.ts`. Preserve the default compiler path; use the existing compiler-off
  build only to investigate a demonstrated compatibility issue, not as the default optimization strategy.

## Checks

Optional extensions live in `features/plugins/`: `/settings?section=plugins` embeds package management; `/extensions` is the standalone launcher and operation view and `/ext/:pluginId/:pageId`
hosts an opaque `sandbox="allow-scripts"` iframe. Use the private MessageChannel SDK, never inject plugin code
into the app bundle. Installed plugins use native account permissions; opening a page does not require file access.
Direct app calls execute normally, while assistant changes and explicit save proposals keep host review cards.
File selection is bounded opening context. `useUnsavedSettingsGuard(..., true)` also guards query changes that replace
the selected files. Keep the parent's `frame-src 'self'` policy and the dedicated asset proxy in Vite.
See [plugin contracts](../plugins/README.md).

Unsaved-change guards register through `useUnsavedSettingsGuard` (`features/settings/use-unsaved-settings-guard.ts`).
Its provider in the app shell owns the app's only `useBlocker`, because React Router consults just the last registered
blocker; never call `useBlocker` elsewhere. Pass `true` to also guard query changes, or a stable
`(current, next) => boolean` for a narrower scope (the workflows tab). Page editors use `useEditorPageGuard` (same
file), which wraps it and lets the editor's own navigation after a save or delete through (`allowNavigation`); their
Ctrl/⌘ S goes through `usePageSaveShortcut` (`lib/keyboard-shortcut.ts`).

`npm run typecheck`, `npx eslint .`, `npm run build` (run in `frontend/`).
