import { buildApiUrl } from '@/lib/api-client'

export interface AuthStatusRecord {
  hasCredentials: boolean
  authenticated: boolean
  username: string | null
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

/** Login with the configured local username and password. */
export function loginLocalAccount(username: string, password: string) {
  return requestAuthJson<AuthMutationRecord>('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Create the first local login account for this personal system. */
export function setupLocalAccount(username: string, password: string) {
  return requestAuthJson<AuthMutationRecord>('/api/auth/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Update the existing local login account after confirming the current password. */
export function updateLocalAccount(currentPassword: string, newUsername: string, newPassword: string) {
  return requestAuthJson<AuthMutationRecord>('/api/auth/credentials', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ currentPassword, newUsername, newPassword }),
  })
}

/** End the current authenticated session. */
export function logoutLocalAccount() {
  return requestAuthJson<AuthMutationRecord>('/api/auth/logout', {
    method: 'POST',
  })
}
