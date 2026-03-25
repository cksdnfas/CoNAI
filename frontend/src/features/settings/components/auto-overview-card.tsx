import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getThemeToneTextStyle } from '@/lib/theme-tones'
import type { KaloscopeServerStatus, TaggerDependencyCheckResult, TaggerServerStatus } from '@/types/settings'
import { SettingsValueTile } from './settings-primitives'

interface AutoOverviewCardProps {
  taggerStatus: TaggerServerStatus | undefined
  taggerDependencyResult: TaggerDependencyCheckResult | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  isCheckingTaggerDependencies: boolean
}

function renderDependencyStatus({
  ready,
  pending,
  fallback = '—',
}: {
  ready: boolean | null
  pending?: boolean
  fallback?: string
}) {
  if (pending) {
    return <span className="text-muted-foreground">확인 중…</span>
  }

  if (ready == null) {
    return <span className="text-muted-foreground">{fallback}</span>
  }

  return <span style={ready ? getThemeToneTextStyle('positive') : getThemeToneTextStyle('negative')}>{ready ? '준비 OK' : '확인 필요'}</span>
}

export function AutoOverviewCard({
  taggerStatus,
  taggerDependencyResult,
  kaloscopeStatus,
  isCheckingTaggerDependencies,
}: AutoOverviewCardProps) {
  const kaloscopeReady = kaloscopeStatus ? kaloscopeStatus.scriptExists && kaloscopeStatus.dependenciesAvailable : null

  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <CardTitle>Auto</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 min-[900px]:grid-cols-4">
        <SettingsValueTile label="loaded model" value={taggerStatus?.currentModel ?? '—'} />
        <SettingsValueTile label="current device" value={taggerStatus?.currentDevice ?? '—'} />
        <SettingsValueTile
          label="wd tagger"
          value={renderDependencyStatus({
            ready: taggerDependencyResult?.available ?? null,
            pending: isCheckingTaggerDependencies,
          })}
        />
        <SettingsValueTile label="kaloscope" value={renderDependencyStatus({ ready: kaloscopeReady })} />
      </CardContent>
    </Card>
  )
}
