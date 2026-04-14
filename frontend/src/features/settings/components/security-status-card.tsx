import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { AuthStatusRecord } from '@/lib/api-auth'
import { SettingsValueTile } from './settings-primitives'

interface SecurityStatusCardProps {
  authStatus: AuthStatusRecord | null
  hasCredentials: boolean
  currentUsername: string | null
}

/** Show the current auth/session summary at the top of the security tab. */
export function SecurityStatusCard({ authStatus, hasCredentials, currentUsername }: SecurityStatusCardProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          heading="보안 상태"
          actions={hasCredentials ? <Badge variant="secondary">활성</Badge> : <Badge variant="outline">미설정</Badge>}
        />

        <div className="grid gap-3 md:grid-cols-4">
          <SettingsValueTile label="계정" value={hasCredentials ? '있음' : '없음'} />
          <SettingsValueTile label="세션" value={authStatus?.authenticated ? '인증됨' : '미인증'} />
          <SettingsValueTile label="현재 사용자" value={currentUsername ?? '없음'} valueClassName="break-all" />
          <SettingsValueTile
            label="권한 그룹"
            value={authStatus?.accountType ?? '없음'}
            className="capitalize"
            valueClassName="capitalize"
          />
        </div>
      </CardContent>
    </Card>
  )
}
