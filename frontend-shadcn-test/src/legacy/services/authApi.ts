import apiClient from './api/apiClient';

/**
 * Authentication status response
 */
export interface AuthStatus {
  hasCredentials: boolean;
  authenticated: boolean;
  username: string | null;
}

/**
 * Login response
 */
export interface LoginResponse {
  success: boolean;
  message: string;
  username: string;
}

/**
 * Logout response
 */
export interface LogoutResponse {
  success: boolean;
  message: string;
}

/**
 * Setup response
 */
export interface SetupResponse {
  success: boolean;
  message: string;
}

/**
 * Update credentials response
 */
export interface UpdateCredentialsResponse {
  success: boolean;
  message: string;
}

/**
 * Database info response
 */
export interface DatabaseInfoResponse {
  authDbPath: string;
  exists: boolean;
  recoveryInstructions: {
    ko: string;
    en: string;
  };
}

/**
 * Authentication API service
 */
export const authApi = {
  /**
   * Check authentication status
   */
  async checkStatus(): Promise<AuthStatus> {
    const response = await apiClient.get<AuthStatus>('/api/auth/status');
    return response.data;
  },

  /**
   * Login with username and password
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await apiClient.post<LoginResponse>(
      '/api/auth/login',
      { username, password }
    );
    return response.data;
  },

  /**
   * Logout
   */
  async logout(): Promise<LogoutResponse> {
    const response = await apiClient.post<LogoutResponse>(
      '/api/auth/logout',
      {}
    );
    return response.data;
  },

  /**
   * Setup initial authentication credentials
   */
  async setup(username: string, password: string): Promise<SetupResponse> {
    const response = await apiClient.post<SetupResponse>(
      '/api/auth/setup',
      { username, password }
    );
    return response.data;
  },

  /**
   * Update authentication credentials
   */
  async updateCredentials(
    currentPassword: string,
    newUsername: string,
    newPassword: string
  ): Promise<UpdateCredentialsResponse> {
    const response = await apiClient.put<UpdateCredentialsResponse>(
      '/api/auth/credentials',
      { currentPassword, newUsername, newPassword }
    );
    return response.data;
  },

  /**
   * Get authentication database information
   * Used for account recovery
   */
  async getDatabaseInfo(): Promise<DatabaseInfoResponse> {
    const response = await apiClient.get<DatabaseInfoResponse>(
      '/api/auth/database-info'
    );
    return response.data;
  }
};
