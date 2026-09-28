import { useI18n } from '@/i18n'
import type { AuthDatabaseInfoRecord } from '@/lib/api-auth'
import { StatTile } from '@/components/ui/stat-tile'
import { SettingsSection } from './settings-primitives'

interface SecurityRecoveryCardProps {
  databaseInfo: AuthDatabaseInfoRecord | null
}

/** Show auth DB recovery location and the current recovery guidance text. */
export function SecurityRecoveryCard({ databaseInfo }: SecurityRecoveryCardProps) {
  const { language, t } = useI18n()
  const recoveryInstruction = language === 'en'
    ? (databaseInfo?.recoveryInstructions.en ?? databaseInfo?.recoveryInstructions.ko)
    : (databaseInfo?.recoveryInstructions.ko ?? databaseInfo?.recoveryInstructions.en)

  return (
    <SettingsSection heading={t({ ko: '복구', en: 'Recovery' })}>
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
    </SettingsSection>
  )
}
