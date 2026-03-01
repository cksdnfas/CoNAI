import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import { ExternalApiSettingsFeature } from '@/features/settings/modules/external-api-settings-feature'

class ExternalApiSettingsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('External API settings bridge failed:', error, errorInfo)
  }

  override render() {
    if (this.state.hasError) {
      return (
        <UiAlert variant="destructive">
          <AlertDescription>Failed to load external API settings. Please refresh and try again.</AlertDescription>
        </UiAlert>
      )
    }

    return this.props.children
  }
}

export function ExternalApiSettings() {
  return (
    <ExternalApiSettingsErrorBoundary>
      <ExternalApiSettingsFeature />
    </ExternalApiSettingsErrorBoundary>
  )
}
