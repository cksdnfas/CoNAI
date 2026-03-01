import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import { AuthSettingsFeature } from '@/features/settings/modules/auth-settings-feature'

class AuthSettingsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('Auth settings bridge failed:', error, errorInfo)
  }

  override render() {
    if (this.state.hasError) {
      return (
        <UiAlert variant="destructive">
          <AlertDescription>Failed to load account settings. Please refresh and try again.</AlertDescription>
        </UiAlert>
      )
    }

    return this.props.children
  }
}

export function AuthSettings() {
  return (
    <AuthSettingsErrorBoundary>
      <AuthSettingsFeature />
    </AuthSettingsErrorBoundary>
  )
}
