import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

import { ProtectedRoute } from '@/features/auth/protected-route'
import { useAuth } from '@/contexts/auth-context'

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

function renderWithRouter() {
  render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route
          path="/private"
          element={(
            <ProtectedRoute>
              <div>Protected Content</div>
            </ProtectedRoute>
          )}
        />
        <Route path="/login" element={<h1>Login Page</h1>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute contracts', () => {
  it('redirects unauthenticated users to /login when credentials exist', () => {
    mockedUseAuth.mockReturnValue({
      hasCredentials: true,
      isAuthenticated: false,
      isLoading: false,
      username: null,
      login: vi.fn(),
      logout: vi.fn(),
      checkAuth: vi.fn(),
    })

    renderWithRouter()

    expect(screen.getByRole('heading', { name: 'Login Page' })).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('allows protected children when hasCredentials=false edge contract applies', () => {
    mockedUseAuth.mockReturnValue({
      hasCredentials: false,
      isAuthenticated: false,
      isLoading: false,
      username: null,
      login: vi.fn(),
      logout: vi.fn(),
      checkAuth: vi.fn(),
    })

    renderWithRouter()

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Login Page' })).not.toBeInTheDocument()
  })
})
