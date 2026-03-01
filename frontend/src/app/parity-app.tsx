import { memo } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SnackbarProvider } from 'notistack'

import '@/i18n'

import { AuthProvider } from '@/contexts/auth-context'
import { ThemeProvider } from '@/contexts/theme-context'

import { AppShell } from '@/components/layout/app-shell'
import { LoginPage } from '@/features/auth/login-page'
import { ProtectedRoute } from '@/features/auth/protected-route'
import { UploadPage } from '@/features/upload/upload-page'
import { ImageGenerationPage } from '@/features/image-generation/image-generation-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { HomePage } from '@/features/home/home-page'
import { ImageGroupsPage } from '@/features/image-groups/image-groups-page'
import { ImageDetailPage } from '@/features/image-detail/image-detail-page'
import { WorkflowFormPage } from '@/features/workflows/workflow-form-page'
import { WorkflowGeneratePage } from '@/features/workflows/workflow-generate-page'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <AppShell>
        <Outlet />
      </AppShell>
    </ProtectedRoute>
  )
}

function ParityRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/image-groups" element={<ImageGroupsPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/image/:compositeHash" element={<ImageDetailPage />} />
        <Route path="/image-generation" element={<ImageGenerationPage />} />
        <Route path="/image-generation/new" element={<WorkflowFormPage />} />
        <Route path="/image-generation/:id/edit" element={<WorkflowFormPage />} />
        <Route path="/image-generation/:id/generate" element={<WorkflowGeneratePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export const ParityApp = memo(function ParityApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SnackbarProvider maxSnack={3} autoHideDuration={3000}>
          <HashRouter>
            <AuthProvider>
              <ParityRoutes />
            </AuthProvider>
          </HashRouter>
        </SnackbarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
})
