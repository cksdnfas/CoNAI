# Auth and Access Control Expansion Plan

## Goal

Upgrade CoNAI from its current single-admin local login flow into a multi-account, group-based access control system.

This work must support:

- guest account creation from the login page
- multiple local accounts
- administrator review and promotion of guest accounts
- group-based permission presets
- hierarchical permission inheritance
- configurable anonymous access
- page-level and action-level authorization

## Current State

The current authentication flow is intentionally simple, but it is too limited for the new requirements.

### What exists now

- one local credential record in `auth.db`
- session login state with a username only
- route-level gating through `optionalAuth`
- app-shell level redirect to `/login` when credentials exist
- settings UI for creating or changing the single local account

### Current limitations

- only one account can exist
- there is no user list
- there are no roles or permission groups
- all authenticated users would be treated the same
- anonymous access cannot be configured per page or feature
- action-level authorization does not exist

## Product Direction

The new system should separate identity from authorization.

### Identity

Identity answers:

- who is this account
- can this account log in
- is this account a guest or an admin-oriented account

### Authorization

Authorization answers:

- what pages can this subject open
- what actions can this subject perform
- which permission group memberships grant those abilities

## Core Access Model

## 1. Subjects

CoNAI should recognize three initial subject tiers:

- anonymous
- guest
- admin

`anonymous` is not a stored account, but it must still be represented in permission configuration as a first-class access group.

## 2. Permission groups

Permissions should be assigned to groups, not directly to accounts.

Initial system groups:

- `anonymous`
- `guest`
- `admin`

Future custom groups should be allowed.

Examples:

- `viewer`
- `editor`
- `operator`
- `moderator`

## 3. Hierarchical inheritance

Permission groups should inherit from lower tiers.

Initial inheritance chain:

- `anonymous` -> base public access
- `guest` -> inherits all `anonymous` permissions
- `admin` -> inherits all `guest` permissions

This gives the expected behavior:

- if anonymous can access a page, guests and admins can too
- if guests can do something, admins can too
- guest-specific rights do not automatically flow down to anonymous

## 4. Permission granularity

Permissions should be resource-action based.

Examples:

- `page.home.view`
- `page.settings.view`
- `page.generation.view`
- `groups.create`
- `groups.delete`
- `images.copy`
- `images.delete`
- `images.metadata.edit`
- `upload.create`
- `generation.execute`
- `settings.security.manage`
- `auth.accounts.view`
- `auth.accounts.promote`
- `auth.guest.create`

This is detailed enough to be useful without exploding into button-level policy.

## Initial Rules

## Anonymous

Anonymous access must be configurable.

Initial default:

- no permissions granted by default

Later the admin can explicitly allow selected public pages or public-safe actions.

## Guest

Guests should exist as real local accounts.

Initial default:

- can log in
- inherit anonymous permissions
- no guest-specific permissions granted by default

This means guest accounts start in a safe waiting state until the admin expands their rights.

## Admin

Admins must be able to:

- inspect accounts
- inspect guest accounts
- promote accounts by changing group membership
- manage permission groups
- manage permission assignments

## Rollout Strategy

This should be implemented in phases so the app can keep working during the migration.

### Phase 1, Data model foundation

Build the new auth database structures without breaking the current single-account login flow.

Deliverables:

- account table
- permission group table
- permission catalog table
- group-permission mapping table
- account-group membership table
- seeded system groups: anonymous, guest, admin
- seeded initial permission catalog
- legacy single-admin credential mirrored into the new account model for migration safety

### Phase 2, Backend authorization layer

Add reusable backend authorization helpers.

Deliverables:

- current session resolves to an account identity
- permission resolution with inherited groups
- route guards for page and API permissions
- admin-only guards for account and security management routes
- a safe fallback path while mixed old/new auth logic still coexists

### Phase 3, Account management APIs

Add new API endpoints for account lifecycle and permissions.

Deliverables:

- guest signup endpoint
- account list endpoint
- account detail endpoint
- group membership update endpoint
- permission group list endpoint
- group permission update endpoint
- anonymous access policy endpoint

### Phase 4, Frontend login and settings UI

Replace the current single-account assumptions in the UI.

Deliverables:

- login page guest account creation
- admin account review list in settings
- group-based promotion UI
- permission matrix or grouped permission editor
- anonymous access editor
- clear session state and permission-aware navigation

### Phase 5, Page and action enforcement

Apply real permissions to routes and actions.

Deliverables:

- page visibility and route access checks
- API authorization for create, delete, copy, edit, execute, and security actions
- frontend action disabling or hiding where appropriate
- backend remains the source of truth for enforcement

## Non-Goals for the First Pass

Do not add these yet unless requirements expand:

- OAuth or external identity providers
- password reset email flows
- self-service account recovery by email or token
- row-level ownership rules
- highly dynamic policy scripting
- audit trail UI for every permission change

## Risks and Design Notes

### 1. Backward compatibility

The current single-admin flow is already wired into the app.

The migration path must avoid breaking:

- existing logins
- existing sessions
- auth DB recovery through deleting `auth.db`

### 2. Public route handling

The current app shell treats the app as globally locked once credentials exist.

That must be replaced with route-aware access checks, otherwise anonymous permissions cannot work.

### 3. Guest UX

A guest account with zero permissions is secure but potentially confusing.

The UI should eventually show a clear waiting-state message when a guest can log in but cannot access most areas yet.

### 4. Permission sprawl

The system should start with a curated permission catalog.

Do not attempt to create a unique permission for every tiny UI affordance in the first pass.

## Success Criteria

This work is successful when:

- multiple local accounts can exist
- a guest can create an account from the login page
- an admin can see guest accounts and promote them through group membership
- anonymous access can be configured separately
- guest permissions inherit anonymous permissions
- admins can manage permissions without hand-editing the database
- page access and sensitive actions are enforced by backend permission checks

## TODO Checklist

## Foundation

- [ ] Document the access model and rollout plan
- [ ] Add new auth DB tables for accounts, groups, permissions, and memberships
- [ ] Seed `anonymous`, `guest`, and `admin` system groups
- [ ] Seed the first permission catalog
- [ ] Mirror the legacy single-admin credential into the new account model

## Backend

- [ ] Add account model helpers for list, create, update, and lookup
- [ ] Add permission group model helpers
- [ ] Add permission resolution with inheritance
- [ ] Extend session typing to store account identity
- [ ] Replace simple authenticated-only checks with permission-aware guards
- [ ] Add admin APIs for account review and promotion
- [ ] Add guest signup API

## Frontend

- [ ] Update login page to support guest account creation
- [ ] Replace single-account security tab assumptions
- [ ] Add admin account list UI
- [ ] Add group assignment and promotion UI
- [ ] Add anonymous permission settings UI
- [ ] Add permission-aware route handling
- [ ] Add permission-aware action visibility and disabled states

## Verification

- [ ] Verify backend build after each schema or auth-layer change
- [ ] Verify frontend build after route and settings changes
- [ ] Test anonymous access with zero permissions
- [ ] Test guest signup and waiting-state behavior
- [ ] Test admin promotion flow
- [ ] Test inherited permissions
- [ ] Test logout/login session transitions
- [ ] Test legacy single-admin upgrade path

## Immediate Next Step

Start with Phase 1 only:

1. add the new auth DB structures
2. seed the system groups and permission catalog
3. keep the current login flow working
4. only then move on to backend permission resolution
