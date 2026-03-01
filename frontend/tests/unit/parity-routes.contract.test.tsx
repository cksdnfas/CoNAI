import type { ReactNode } from 'react'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import { ParityApp } from '@/app/parity-app'
import { useAuth } from '@/contexts/auth-context'

vi.mock('@/i18n', () => ({}))

vi.mock('@tanstack/react-query', () => ({
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('notistack', () => ({
  SnackbarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/contexts/theme-context', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/contexts/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: vi.fn(),
}))

vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/features/auth/login-page', () => ({
  LoginPage: () => <h1>Login Route</h1>,
}))

vi.mock('@/features/home/home-page', () => ({
  HomePage: () => <h1>Home Route</h1>,
}))

vi.mock('@/features/upload/upload-page', () => ({
  UploadPage: () => <h1>Upload Route</h1>,
}))

vi.mock('@/features/image-generation/image-generation-page', () => ({
  ImageGenerationPage: () => <h1>Image Generation Route</h1>,
}))

vi.mock('@/features/settings/settings-page', () => ({
  SettingsPage: () => <h1>Settings Route</h1>,
}))

vi.mock('@/features/image-groups/image-groups-page', () => ({
  ImageGroupsPage: () => <h1>Image Groups Route</h1>,
}))

vi.mock('@/features/image-detail/image-detail-page', () => ({
  ImageDetailPage: () => <h1>Image Detail Route</h1>,
}))

vi.mock('@/features/workflows/workflow-form-page', () => ({
  WorkflowFormPage: () => <h1>Workflow Form Route</h1>,
}))

vi.mock('@/features/workflows/workflow-generate-page', () => ({
  WorkflowGeneratePage: () => <h1>Workflow Generate Route</h1>,
}))

const mockedUseAuth = vi.mocked(useAuth)

describe('ParityApp auth/route contracts', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      hasCredentials: true,
      isAuthenticated: true,
      isLoading: false,
      username: 'tester',
      login: vi.fn(),
      logout: vi.fn(),
      checkAuth: vi.fn(),
    })
  })

  it('keeps /login route publicly accessible', () => {
    window.location.hash = '#/login'

    render(<ParityApp />)

    expect(screen.getByRole('heading', { name: 'Login Route' })).toBeInTheDocument()
  })

  it('preserves wildcard fallback by routing unknown paths to /', () => {
    window.location.hash = '#/not-a-real-route'

    render(<ParityApp />)

    expect(screen.getByRole('heading', { name: 'Home Route' })).toBeInTheDocument()
  })
})
