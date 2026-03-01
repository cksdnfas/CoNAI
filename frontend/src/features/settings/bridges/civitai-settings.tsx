import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import { CivitaiSettingsFeature } from '@/features/settings/modules/civitai-settings-feature'

class CivitaiSettingsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('Civitai settings bridge failed:', error, errorInfo)
  }

  override render() {
    if (this.state.hasError) {
      return (
        <UiAlert variant="destructive">
          <AlertDescription>Failed to load Civitai settings. Please refresh and try again.</AlertDescription>
        </UiAlert>
      )
    }

    return this.props.children
  }
}

export function CivitaiSettings() {
  return (
    <CivitaiSettingsErrorBoundary>
      <CivitaiSettingsFeature />
    </CivitaiSettingsErrorBoundary>
  )
}
