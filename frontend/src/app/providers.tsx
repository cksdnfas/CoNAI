import type { PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { SnackbarProvider } from '@/components/ui/snackbar-provider'
import { RuntimeEventStreamProvider } from '@/features/runtime-events/runtime-event-stream-provider'
import { I18nProvider } from '@/i18n'
import { appQueryClient } from '@/lib/app-query-client'
import { ThemeProvider } from './theme-provider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={appQueryClient}>
      {/* 브리지가 useQueryClient 를 쓰므로 QueryClientProvider 안쪽이어야 한다. */}
      <RuntimeEventStreamProvider>
        <I18nProvider>
          <ThemeProvider>
            <SnackbarProvider>{children}</SnackbarProvider>
          </ThemeProvider>
        </I18nProvider>
      </RuntimeEventStreamProvider>
    </QueryClientProvider>
  )
}
