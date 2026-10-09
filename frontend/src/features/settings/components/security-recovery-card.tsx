import { RefreshCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
import { FieldInfo } from '@/components/ui/field'
import { useI18n } from '@/i18n'
import type { AuthDatabaseInfoRecord } from '@/lib/api-auth'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'

interface SecurityRecoveryCardProps {
  databaseInfo: AuthDatabaseInfoRecord | null
  isError: boolean
  isRetrying: boolean
  onRetry: () => void
}

/** Show auth DB recovery location and the current recovery guidance text. */
export function SecurityRecoveryCard({ databaseInfo, isError, isRetrying, onRetry }: SecurityRecoveryCardProps) {
  const { language, t } = useI18n()
  const recoveryInstruction = language === 'en'
    ? (databaseInfo?.recoveryInstructions.en ?? databaseInfo?.recoveryInstructions.ko)
    : (databaseInfo?.recoveryInstructions.ko ?? databaseInfo?.recoveryInstructions.en)

  return (
    <RowGroup heading={t({ ko: '복구', en: 'Recovery' })}>
      {isError && !databaseInfo ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '복구 정보를 불러오지 못했어', en: 'Could not load recovery info' })}</AlertTitle>
          <AlertDescription>
            <IconButton size="icon-sm" variant="secondary" className="mt-2" onClick={onRetry} disabled={isRetrying} label={t({ ko: '다시 시도', en: 'Try again' })}>
              <RefreshCcw className={isRetrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </IconButton>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <SettingRow label={<span className="flex items-center gap-1">{t({ ko: '인증 DB', en: 'Auth DB' })}{recoveryInstruction ? <FieldInfo>{recoveryInstruction}</FieldInfo> : null}</span>} controlClassName="min-w-0 sm:max-w-md">
            <span className="break-all font-mono text-xs text-muted-foreground">{databaseInfo?.authDbPath ?? t({ ko: '불러오는 중…', en: 'Loading…' })}</span>
          </SettingRow>
        </>
      )}
    </RowGroup>
  )
}
