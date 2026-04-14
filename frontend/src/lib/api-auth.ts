import { buildApiUrl } from '@/lib/api-client'

export interface AuthStatusRecord {
  hasCredentials: boolean
  authenticated: boolean
  username: string | null
  accountId: number | null
  accountType: 'admin' | 'guest' | null
  isAdmin: boolean
  groupKeys: string[]
  permissionKeys: string[]
}

export interface AuthDatabaseInfoRecord {
  authDbPath: string
  exists: boolean
  recoveryInstructions: {
    ko: string
    en: string
  }
}

export interface AuthMutationRecord {
  success: boolean
  message: string
  username?: string
  accountId?: number | null
  accountType?: 'admin' | 'guest' | null
  isAdmin?: boolean
  groupKeys?: string[]
  permissionKeys?: string[]
}

export interface GuestAccountMutationRecord {
  success: boolean
  message: string
  account: {
    id: number
    username: string
    accountType: 'guest' | 'admin'
    status: 'active' | 'disabled'
  }
}

export interface AuthAccountListItem {
  id: number
  username: string
  accountType: 'admin' | 'guest'
  status: 'active' | 'disabled'
  groupKeys: string[]
  createdByAccountId: number | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  syncedLegacyAdmin: boolean
}

export interface PermissionGroupListItem {
  groupKey: 'admin' | 'guest'
  name: string
}

export interface AuthPermissionGroupSummaryItem {
  id: number
  groupKey: string
  name: string
  description: string | null
  parentGroupId: number | null
  parentGroupKey: string | null
  priority: number
  systemGroup: boolean
  directPermissionKeys: string[]
  memberCount: number
}

export interface AuthPermissionGroupMemberItem {
  id: number
  username: string
  accountType: 'admin' | 'guest'
  status: 'active' | 'disabled'
}

export interface AuthPermissionGroupDetailRecord {
  group: AuthPermissionGroupSummaryItem
  members: AuthPermissionGroupMemberItem[]
}

export interface PageAccessPermissionItem {
  permissionKey: string
  label: string
  description: string | null
}

export interface PageAccessGroupItem {
  groupKey: 'anonymous' | 'guest' | 'admin'
  name: string
  description: string | null
  permissionKeys: string[]
}

export interface PageAccessMatrixRecord {
  permissions: PageAccessPermissionItem[]
  groups: PageAccessGroupItem[]
}

/** Call one auth endpoint and surface backend error messages when available. */
async function requestAuthJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }

  if (!payload) {
    throw new Error('빈 응답을 받았어.')
  }

  return payload
}

/** Load current auth configuration and session state. */
export function getAuthStatus() {
  return requestAuthJson<AuthStatusRecord>('/api/auth/status')
}

/** Load auth database path and recovery guidance. */
export function getAuthDatabaseInfo() {
  return requestAuthJson<AuthDatabaseInfoRecord>('/api/auth/database-info')
}

/** Login with one local account. */
export function loginLocalAccount(username: string, password: string) {
  return requestAuthJson<AuthMutationRecord>('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Create the first local admin account. */
export function setupLocalAccount(username: string, password: string) {
  return requestAuthJson<AuthMutationRecord>('/api/auth/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Update the legacy admin credential pair. */
export function updateLocalAccount(currentPassword: string, newUsername: string, newPassword: string) {
  return requestAuthJson<AuthMutationRecord>('/api/auth/credentials', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ currentPassword, newUsername, newPassword }),
  })
}

/** Create a guest account from the login page. */
export function createGuestAccount(username: string, password: string) {
  return requestAuthJson<GuestAccountMutationRecord>('/api/auth/guest-accounts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Load the admin review list of local accounts. */
export async function listAuthAccounts() {
  const payload = await requestAuthJson<{ success: true; data: AuthAccountListItem[] }>('/api/auth/accounts')
  return payload.data
}

/** Load the current assignable built-in groups for the first admin UI slice. */
export async function listPermissionGroups() {
  const payload = await requestAuthJson<{ success: true; data: PermissionGroupListItem[] }>('/api/auth/permission-groups')
  return payload.data
}

/** Load all permission groups for the group-centered management UI. */
export async function listAuthPermissionGroups() {
  const payload = await requestAuthJson<{ success: true; data: AuthPermissionGroupSummaryItem[] }>('/api/auth/permission-groups?scope=all')
  return payload.data
}

/** Load one permission group with its current members. */
export async function getAuthPermissionGroupDetail(groupId: number) {
  const payload = await requestAuthJson<{ success: true; data: AuthPermissionGroupDetailRecord }>(`/api/auth/permission-groups/${groupId}`)
  return payload.data
}

/** Create one custom permission group. */
export function createAuthPermissionGroup(input: { name: string; description?: string | null; permissionKeys?: string[] }) {
  return requestAuthJson<{ success: true; message: string; data: AuthPermissionGroupSummaryItem }>('/api/auth/permission-groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

/** Update one custom permission group. */
export function updateAuthPermissionGroup(groupId: number, input: { name: string; description?: string | null; permissionKeys?: string[] }) {
  return requestAuthJson<{ success: true; message: string; data: AuthPermissionGroupSummaryItem }>(`/api/auth/permission-groups/${groupId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

/** Delete one custom permission group. */
export function deleteAuthPermissionGroup(groupId: number) {
  return requestAuthJson<{ success: true; message: string }>(`/api/auth/permission-groups/${groupId}`, {
    method: 'DELETE',
  })
}

/** Add one account membership to one custom permission group. */
export function addAuthPermissionGroupMember(groupId: number, accountId: number) {
  return requestAuthJson<{ success: true; message: string }>(`/api/auth/permission-groups/${groupId}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId }),
  })
}

/** Remove one account membership from one custom permission group. */
export function removeAuthPermissionGroupMember(groupId: number, accountId: number) {
  return requestAuthJson<{ success: true; message: string }>(`/api/auth/permission-groups/${groupId}/members/${accountId}`, {
    method: 'DELETE',
  })
}

/** Change one account's current built-in group assignment. */
export function updateAuthAccountSystemGroup(accountId: number, groupKey: 'admin' | 'guest') {
  return requestAuthJson<{ success: true; message: string; account: GuestAccountMutationRecord['account'] }>(`/api/auth/accounts/${accountId}/system-group`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ groupKey }),
  })
}

/** Change one account password from the admin security UI. */
export function updateAuthAccountPassword(accountId: number, newPassword: string) {
  return requestAuthJson<{ success: true; message: string }>(`/api/auth/accounts/${accountId}/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ newPassword }),
  })
}

/** Delete one removable local account from the admin security UI. */
export function deleteAuthAccount(accountId: number) {
  return requestAuthJson<{ success: true; message: string }>(`/api/auth/accounts/${accountId}`, {
    method: 'DELETE',
  })
}

/** Load the current built-in page access matrix. */
export async function getPageAccessMatrix() {
  const payload = await requestAuthJson<{ success: true; data: PageAccessMatrixRecord }>('/api/auth/page-access')
  return payload.data
}

/** Replace one editable built-in page access set. */
export function updateBuiltInPageAccess(groupKey: 'anonymous' | 'guest', permissionKeys: string[]) {
  return requestAuthJson<{ success: true; message: string; data: PageAccessGroupItem }>(`/api/auth/page-access/${groupKey}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ permissionKeys }),
  })
}

/** End the current authenticated session. */
export function logoutLocalAccount() {
  return requestAuthJson<AuthMutationRecord>('/api/auth/logout', {
    method: 'POST',
  })
}
