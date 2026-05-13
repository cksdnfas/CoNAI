# Auth Maintainability Refactor TODO, 2026-04-13

## Rules
- Keep behavior unchanged.
- Prefer readability over aggressive decomposition.
- Stop extracting when the next split would make the feature harder to follow.
- Verify after each track.

## Track 1, Frontend security tab
- [x] Review current `security-tab.tsx` responsibilities and define the smallest clean section boundaries.
- [x] Extract auth/security query and mutation wiring into one focused nearby data module or hook.
- [x] Extract status, account form, account list, page access, and recovery UI into a small nearby component set.
- [x] Keep `SecurityTab` as the top-level composition entry.
- [x] Verify with `npm run build:frontend`.

2026-05-14 note: Rechecked the current implementation. `security-tab.tsx` now composes focused security cards/modals and uses `security-tab-data.ts` for auth/security query and mutation wiring.

## Track 2, Backend auth routes
- [x] Review `auth.routes.ts` and separate router registration from reusable auth/session payload helpers.
- [x] Extract current-session payload shaping into a helper module.
- [x] Extract handler helpers only where they reduce repetition and scrolling.
- [x] Keep route paths and API responses stable.
- [x] Verify with `npm run build:backend`.

## Track 3, Backend auth DB bootstrap
- [x] Review `authDb.ts` and identify the simplest split between schema setup, seed/default setup, and bootstrap orchestration.
- [x] Extract schema creation into a nearby helper if it meaningfully improves readability.
- [x] Extract seed/normalization logic into a nearby helper if it keeps SQL easier to scan.
- [x] Keep legacy migration and legacy-admin sync explicit and easy to trace.
- [x] Verify with `npm run verify:auth-db-bootstrap` and `npm run build:backend`.

2026-05-14 note: `authDb.ts` remains the bootstrap/orchestration entry, `authDbSchema.ts` owns table creation, and `authDbSeed.ts` owns default permission group/catalog seeding plus anonymous runtime-access normalization. Added an isolated temp-runtime verifier for core table creation, default group hierarchy, admin permission grants, legacy credential/session migration, idempotent bootstrap, and mirrored legacy-admin cleanup.

## Track 4, Small follow-up cleanup
- [x] Re-check `settings-page.tsx` after the auth-specific cleanup.
- [x] Apply only minimal follow-up extraction if there is an obvious low-risk win.
- [x] Avoid turning this into a full settings-page rewrite.

2026-05-14 note: Rechecked `settings-page.tsx`; it is now a tab composition root around focused tab hooks/components. No extra auth-specific extraction was needed in this pass.

## Final verification
- [x] Run `npm run build:frontend`.
- [x] Run `npm run build:backend`.
- [x] Run `npm run build:frontend && npm run build:backend`.
- [x] Summarize what changed, what stayed intentionally unsplit, and what should wait for a later wave.

2026-05-14 summary: Auth maintainability is now centered on focused frontend security sections, auth route/session helpers, and split auth DB schema/seed helpers. Legacy auth migration and legacy-admin sync intentionally stay in `authDb.ts` so upgrade behavior remains easy to trace. Broader settings-page decomposition, auth model redesign, permission catalog redesign, and schema/policy changes remain out of scope.
