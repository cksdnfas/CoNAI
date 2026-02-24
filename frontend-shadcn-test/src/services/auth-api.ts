import { apiClient } from '@/lib/api/client'

export interface AuthStatus {
  hasCredentials: boolean
  authenticated: boolean
  username: string | null
}

export interface LoginResponse {
  success: boolean
  message: string
  username: string
}

export interface LogoutResponse {
  success: boolean
  message: string
}

export interface SetupResponse {
  success: boolean
  message: string
}

export interface UpdateCredentialsResponse {
  success: boolean
  message: string
}

export interface DatabaseInfoResponse {
  authDbPath: string
  exists: boolean
  recoveryInstructions: {
    ko: string
    en: string
  }
}

export const authApi = {
  async checkStatus(): Promise<AuthStatus> {
    const response = await apiClient.get<AuthStatus>('/api/auth/status')
    return response.data
  },

  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await apiClient.post<LoginResponse>('/api/auth/login', { username, password })
    return response.data
  },

  async logout(): Promise<LogoutResponse> {
    const response = await apiClient.post<LogoutResponse>('/api/auth/logout', {})
    return response.data
  },

  async setup(username: string, password: string): Promise<SetupResponse> {
    const response = await apiClient.post<SetupResponse>('/api/auth/setup', { username, password })
    return response.data
  },

  async updateCredentials(currentPassword: string, newUsername: string, newPassword: string): Promise<UpdateCredentialsResponse> {
    const response = await apiClient.put<UpdateCredentialsResponse>('/api/auth/credentials', {
      currentPassword,
      newUsername,
      newPassword,
    })
    return response.data
  },

  async getDatabaseInfo(): Promise<DatabaseInfoResponse> {
    const response = await apiClient.get<DatabaseInfoResponse>('/api/auth/database-info')
    return response.data
  },
}
