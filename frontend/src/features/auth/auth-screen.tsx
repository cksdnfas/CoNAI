import type { ReactNode } from 'react'
import { Panel } from '@/components/ui/panel'

/** The blank page while the auth status loads. */
export function AuthScreenPlaceholder() {
  return <div className="min-h-screen bg-background" />
}

/** The centered column of the sign-in / setup screens (outside the app shell). */
export function AuthScreen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">{children}</div>
}

/** The floating card in that column. */
export function AuthPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <Panel tone="none" treatment="floating" padding="lg" radius="md" className={className}>{children}</Panel>
}
