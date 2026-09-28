import { RefreshCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { AuthDatabaseInfoRecord } from '@/lib/api-auth'
import { StatTile } from '@/components/ui/stat-tile'
import { Section } from '@/components/ui/section'

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
    <Section variant="settings" heading={t({ ko: '복구', en: 'Recovery' })}>
      {isError && !databaseInfo ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '복구 정보를 불러오지 못했어', en: 'Could not load recovery info' })}</AlertTitle>
          <AlertDescription>
            <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={onRetry} disabled={isRetrying}>
              <RefreshCcw className={isRetrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              {t({ ko: '다시 시도', en: 'Try again' })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <StatTile
            label={t({ ko: '인증 DB', en: 'Auth DB' })}
            value={databaseInfo?.authDbPath ?? t({ ko: '불러오는 중…', en: 'Loading…' })}
            valueClassName="break-all text-xs font-medium"
          />
          <StatTile
            label={t({ ko: '방법', en: 'Method' })}
            value={recoveryInstruction ?? t({ ko: '불러오는 중…', en: 'Loading…' })}
            valueClassName="text-xs font-medium leading-6"
          />
        </div>
      )}
    </Section>
  )
}
