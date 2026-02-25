import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { ImagesPage } from '@/features/images/images-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { ApiPlaygroundPage } from '@/features/api-playground/api-playground-page'

function NotFoundPage() {
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Page not found</h2>
      <Button asChild variant="outline">
        <NavigateToHome />
      </Button>
    </div>
  )
}

function NavigateToHome() {
  return <a href="#/">Go to Dashboard</a>
}

export function AppRoutes() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/images" element={<ImagesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/api-playground" element={<ApiPlaygroundPage />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </HashRouter>
  )
}
