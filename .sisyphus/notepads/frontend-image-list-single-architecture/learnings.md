
- Centralized preview URL base resolution with  and reused it across image list + group cards while preserving existing by-path/file/thumbnail routing semantics.
- Added shared buildPreviewMediaUrl resolver and reused it at all five required preview call sites without changing processing/video/image endpoint selection.
- Closure verification rerun passed for targeted resolver test, full unit suite, and frontend build; helper deduplication proof shows zero local getPreviewMediaUrl helpers in frontend/src.
- Bookkeeping follow-up confirmed evidence files include pass/fail summaries plus missing hash/path edge-case notes, keeping Task 3 traceability audit-friendly.
- 2026-03-01T22:14:00Z - `ImageList` can preserve legacy numeric-id selection behavior while safely supporting id-less records by enabling stable-key toggling only when `onStableSelectionChange` is provided.
- 2026-03-01T22:14:00Z - Reconstructing numeric selection arrays from stable keys at consumer edges (`generation-history-list`, `group-image-grid-modal`) avoids renderer branching while keeping selected-count UX unchanged.

#T6|- 2026-03-01T22:45:00Z - Added business-agnostic  shell with explicit title/subtitle/badges/preview/secondaryAction slots to preserve existing group card visual language while enabling reuse.

#T6A|- 2026-03-01T22:47:00Z - Added business-agnostic GroupTileBase shell with explicit title/subtitle/badges/preview/secondaryAction slots to preserve existing group card visual language while enabling reuse.

#T7|- 2026-03-01T23:05:00Z - `GroupCard` can be reduced to a thin `GroupTileBase` wrapper by passing custom-group title/badges/settings action as slots while preserving existing `useGroupPreviewImage` URL and media-type behavior.
- #T8|- 2026-03-01T23:12:00Z - `AutoFolderGroupCard` now composes `GroupTileBase` as a thin wrapper while preserving existing preview URL/case-buster behavior, folder-path subtitle, and translated image/folder count badges.
- #T9|- 2026-03-01T23:20:00Z - `ImageViewCard` and `AutoFolderImageViewCard` now share one `ImageViewCardShell` that centralizes preview loading and media rendering while wrappers keep per-surface localized title/badge nodes.
- #T9|- 2026-03-01T23:20:00Z - Added business-agnostic `ThumbnailCard` with selectable/read-only support and metadata-slot fallback behavior so satellite cards can reuse one shell without changing click semantics.
- #T10|- 2026-03-01T23:40:00Z - `ImageList` empty-state button behavior can be expressed as adapter capability (`capabilities.emptyStateAction`) so the shared renderer no longer needs context-specific props or no-op paths.
- #T10|- 2026-03-01T23:40:00Z - Removing `contextId` from the image-list adapter contract and asserting no core `contextId` branches in unit tests keeps the core context-agnostic while preserving home/history/group-modal behavior.

- #T10-CLOSURE|- 2026-03-01T14:45:12Z - Closure rerun confirms adapter-driven ImageList core remains free of contextId behavioral branches ( grep no matches) with full frontend test/build pass evidence refreshed in task-10 artifacts.

- #T10-CLOSURE|- 2026-03-01T14:45:18Z - Closure rerun confirms adapter-driven ImageList core has no contextId behavioral branch pattern and full frontend test/build evidence was refreshed in task-10 artifacts.
- #T14|- 2026-03-02T00:38:00Z - Added parity regression matrix across Home, Generation History, Group Assign modal, Similarity cards, and Folder Selection modal by combining adapter-level unit tests with Playwright route-level smoke assertions.
- #T14|- 2026-03-02T00:38:00Z - Keyboard/focus regression is now explicitly guarded in both unit (`HomePage` Escape-to-focus-return on layout FAB) and Playwright (`#/` layout panel Escape close + focus restore) tests.
- #T15|- 2026-03-02T01:00:00Z - Final cleanup kept behavior stable by extracting repeated image-view title/badge JSX into `createImageViewCardMeta`, letting both image-view wrappers reuse one render helper while preserving per-surface data flow.
- #T15|- 2026-03-02T01:00:00Z - Added an explicit guardrail script (`verify-image-render-guardrails.mjs`) so duplicate helper regressions are checked by automation (no legacy `getPreviewMediaUrl`, single `buildPreviewMediaUrl`, single `createImageViewCardMeta`).
