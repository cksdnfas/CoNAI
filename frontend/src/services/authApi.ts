import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1666';

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
    const response = await axios.get<AuthStatus>(`${API_BASE_URL}/api/auth/status`, {
      withCredentials: true
    });
    return response.data;
  },

  /**
   * Login with username and password
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await axios.post<LoginResponse>(
      `${API_BASE_URL}/api/auth/login`,
      { username, password },
      { withCredentials: true }
    );
    return response.data;
  },

  /**
   * Logout
   */
  async logout(): Promise<LogoutResponse> {
    const response = await axios.post<LogoutResponse>(
      `${API_BASE_URL}/api/auth/logout`,
      {},
      { withCredentials: true }
    );
    return response.data;
  },

  /**
   * Setup initial authentication credentials
   */
  async setup(username: string, password: string): Promise<SetupResponse> {
    const response = await axios.post<SetupResponse>(
      `${API_BASE_URL}/api/auth/setup`,
      { username, password },
      { withCredentials: true }
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
    const response = await axios.put<UpdateCredentialsResponse>(
      `${API_BASE_URL}/api/auth/credentials`,
      { currentPassword, newUsername, newPassword },
      { withCredentials: true }
    );
    return response.data;
  },

  /**
   * Get authentication database information
   * Used for account recovery
   */
  async getDatabaseInfo(): Promise<DatabaseInfoResponse> {
    const response = await axios.get<DatabaseInfoResponse>(
      `${API_BASE_URL}/api/auth/database-info`
    );
    return response.data;
  }
};
