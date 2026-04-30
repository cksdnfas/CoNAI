import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import type { AuthStatusRecord } from '@/lib/api-auth'
import { SettingsSection, SettingsValueTile } from './settings-primitives'
import { getAccountTypeLabel } from './security-ui-text'

interface SecurityStatusCardProps {
  authStatus: AuthStatusRecord | null
  hasCredentials: boolean
  currentUsername: string | null
}

/** Show the current auth/session summary at the top of the security tab. */
export function SecurityStatusCard({ authStatus, hasCredentials, currentUsername }: SecurityStatusCardProps) {
  const { language, t } = useI18n()

  return (
    <SettingsSection
      heading={t({ ko: '보안 상태', en: 'Security status' })}
      actions={hasCredentials ? <Badge variant="secondary">{t({ ko: '활성', en: 'Active' })}</Badge> : <Badge variant="outline">{t({ ko: '미설정', en: 'Not set' })}</Badge>}
    >
      <div className="grid gap-3 md:grid-cols-4">
        <SettingsValueTile label={t({ ko: '계정', en: 'Accounts' })} value={hasCredentials ? t({ ko: '있음', en: 'Present' }) : t({ ko: '없음', en: 'None' })} />
        <SettingsValueTile label={t({ ko: '세션', en: 'Session' })} value={authStatus?.authenticated ? t({ ko: '인증됨', en: 'Authenticated' }) : t({ ko: '미인증', en: 'Unauthenticated' })} />
        <SettingsValueTile label={t({ ko: '현재 사용자', en: 'Current user' })} value={currentUsername ?? t({ ko: '없음', en: 'None' })} valueClassName="break-all" />
        <SettingsValueTile
          label={t({ ko: '권한 그룹', en: 'Permission group' })}
          value={getAccountTypeLabel(language, authStatus?.accountType)}
        />
      </div>
    </SettingsSection>
  )
}
