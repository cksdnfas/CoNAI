import type { AuthDatabaseInfoRecord } from '@/lib/api-auth'
import { SettingsSection, SettingsValueTile } from './settings-primitives'

interface SecurityRecoveryCardProps {
  databaseInfo: AuthDatabaseInfoRecord | null
}

/** Show auth DB recovery location and the current recovery guidance text. */
export function SecurityRecoveryCard({ databaseInfo }: SecurityRecoveryCardProps) {
  return (
    <SettingsSection heading="복구">
      <div className="grid gap-3 md:grid-cols-2">
        <SettingsValueTile
          label="인증 DB"
          value={databaseInfo?.authDbPath ?? '불러오는 중…'}
          valueClassName="break-all text-xs font-medium"
        />
        <SettingsValueTile
          label="방법"
          value={databaseInfo?.recoveryInstructions.ko ?? '불러오는 중…'}
          valueClassName="text-xs font-medium leading-6"
        />
      </div>
    </SettingsSection>
  )
}
