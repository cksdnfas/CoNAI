import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

/**
 * A save refused because the record changed elsewhere (stale revision). The draft stays; the actions take the latest
 * revision (keeping the draft) or reload. Without an action here every retry would fail with the same stale token.
 */
export function SaveConflictAlert({ message, children }: { message?: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">{message ?? t({ ko: '다른 곳에서 먼저 저장했어. 고친 내용은 그대로 있어.', en: 'This was saved elsewhere first. Your edits are kept.' })}</span>
        {children}
      </AlertDescription>
    </Alert>
  )
}

/** The usual action: save the draft over the newer version (the caller reads the latest revision first). */
export function SaveConflictOverwriteButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  return <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onClick}>{t({ ko: '내 내용으로 덮어쓰기', en: 'Overwrite with mine' })}</Button>
}
