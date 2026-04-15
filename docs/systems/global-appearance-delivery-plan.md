# Global Appearance Delivery Plan

## Goal
Make the CoNAI appearance system behave as one global admin-controlled theme.

## Desired Behavior
- The appearance configuration is stored once for the whole app.
- Only admins can change the appearance.
- All viewers should receive the same appearance:
  - admin
  - guest
  - other authenticated accounts
  - anonymous surfaces that are intentionally public
- Theme colors, typography, density, and appearance-driven layout choices should stay aligned across those viewers.

## Current Problem
The appearance data is already stored globally in the shared settings file, but frontend theme and appearance consumers often load it through `/api/settings`.

That route is protected by the settings permission gate, which is effectively admin-only after auth is configured.

Result:
- admins receive the saved appearance,
- non-admin viewers can fall back to frontend defaults,
- the app behaves like the theme is global in storage but not global in delivery.

## Safe Fix Strategy
1. Add a read-only public appearance endpoint that returns only the global appearance payload.
2. Keep appearance write routes admin-only through the existing settings permission flow.
3. Move shared frontend appearance consumers to the read-only endpoint.
4. Keep sensitive settings behind `/api/settings`.
5. Prefer bootstrap support for the shared appearance payload so public pages do not flash the default theme on first render.

## Implementation Scope
### Backend
- Expose one safe read-only appearance route outside the admin-only `/api/settings` gate.
- Return only the appearance object, not the full settings document.
- Keep the route outside auth and permission gates so the same payload works for admin, guest, and anonymous sessions.
- Embed the global appearance payload into the integrated frontend bootstrap alongside auth status.

### Frontend
- Add one shared query/helper for global appearance loading.
- Update `ThemeProvider` to use the global appearance source instead of the full settings route.
- Update appearance-driven UI readers that should match the shared theme even for non-admin viewers.

## Success Criteria
1. Admin can still edit appearance only through settings.
2. Guest and other non-admin viewers receive the same global appearance as admin.
3. Public or anonymous app surfaces that render the shell/theme also use the same appearance.
4. No sensitive non-appearance settings become publicly readable.
5. Frontend and backend builds pass after the change.
