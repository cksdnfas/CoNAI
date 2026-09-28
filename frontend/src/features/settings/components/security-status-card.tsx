import { useI18n } from '@/i18n'
import type { AuthStatusRecord } from '@/lib/api-auth'
import { StatTile } from '@/components/ui/stat-tile'
import { Section } from '@/components/ui/section'
import { getAccountTypeLabel } from './security-ui-text'

interface SecurityStatusCardProps {
  authStatus: AuthStatusRecord | null
  hasCredentials: boolean
  /** Number of accounts, or null when this viewer cannot list them. */
  accountCount: number | null
  currentUsername: string | null
}

/** Show the current auth/session summary at the top of the security tab. */
export function SecurityStatusCard({ authStatus, hasCredentials, accountCount, currentUsername }: SecurityStatusCardProps) {
  const { language, t, formatNumber } = useI18n()
  const accountValue = !hasCredentials
    ? t({ ko: '없음', en: 'None' })
    : accountCount !== null
      ? t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(accountCount) })
      : t({ ko: '설정됨', en: 'Set up' })

  return (
    <Section
      variant="settings"
      heading={t({ ko: '보안 상태', en: 'Security status' })}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile label={t({ ko: '계정', en: 'Accounts' })} value={accountValue} />
        <StatTile label={t({ ko: '현재 사용자', en: 'Current user' })} value={currentUsername ?? t({ ko: '없음', en: 'None' })} valueClassName="break-all" />
        <StatTile
          label={t({ ko: '권한 그룹', en: 'Permission group' })}
          value={getAccountTypeLabel(language, authStatus?.accountType)}
        />
      </div>
    </Section>
  )
}
