import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi, type AuthStatus } from '@/services/auth-api'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  hasCredentials: boolean
  username: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasCredentials, setHasCredentials] = useState(false)
  const [username, setUsername] = useState<string | null>(null)

  const checkAuth = async () => {
    try {
      setIsLoading(true)
      const status: AuthStatus = await authApi.checkStatus()
      setHasCredentials(status.hasCredentials)
      setIsAuthenticated(status.authenticated)
      setUsername(status.username)
    } catch (error) {
      console.error('Failed to check auth status:', error)
      setIsAuthenticated(false)
      setUsername(null)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (usernameInput: string, password: string) => {
    try {
      await authApi.login(usernameInput, password)
      await checkAuth()
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(error.message)
      }

      throw new Error('Login failed')
    }
  }

  const logout = async () => {
    try {
      await authApi.logout()
      setIsAuthenticated(false)
      setUsername(null)
    } catch (error) {
      console.error('Logout failed:', error)
      throw error
    }
  }

  useEffect(() => {
    void checkAuth()
  }, [])

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    hasCredentials,
    username,
    login,
    logout,
    checkAuth,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
