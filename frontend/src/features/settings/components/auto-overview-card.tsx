import type { ReactNode } from 'react'
import { getThemeToneTextStyle } from '@/lib/theme-tones'
import type { KaloscopeServerStatus, TaggerDependencyCheckResult, TaggerServerStatus } from '@/types/settings'
import { SettingsSection, SettingsValueTile } from './settings-primitives'
import { useI18n, type TranslationInput } from '@/i18n'

interface AutoOverviewCardProps {
  heading: ReactNode
  actions?: ReactNode
  taggerStatus: TaggerServerStatus | undefined
  taggerDependencyResult: TaggerDependencyCheckResult | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  isCheckingTaggerDependencies: boolean
}

function renderDependencyStatus({
  ready,
  pending,
  t,
  fallback = '—',
}: {
  ready: boolean | null
  pending?: boolean
  t: (input: TranslationInput) => string
  fallback?: string
}) {
  if (pending) {
    return <span className="text-muted-foreground">{t({ ko: '확인 중…', en: 'Checking…' })}</span>
  }

  if (ready == null) {
    return <span className="text-muted-foreground">{fallback}</span>
  }

  return <span style={ready ? getThemeToneTextStyle('positive') : getThemeToneTextStyle('negative')}>{ready ? t({ ko: '준비 OK', en: 'Ready' }) : t({ ko: '확인 필요', en: 'Needs attention' })}</span>
}

export function AutoOverviewCard({
  heading,
  actions,
  taggerStatus,
  taggerDependencyResult,
  kaloscopeStatus,
  isCheckingTaggerDependencies,
}: AutoOverviewCardProps) {
  const { t } = useI18n()
  const kaloscopeReady = kaloscopeStatus ? kaloscopeStatus.scriptExists && kaloscopeStatus.dependenciesAvailable : null

  return (
    <SettingsSection heading={heading} actions={actions}>
      <div className="grid gap-4 min-[900px]:grid-cols-4">
        <SettingsValueTile label={t({ ko: '로드된 모델', en: 'Loaded model' })} value={taggerStatus?.currentModel ?? '—'} />
        <SettingsValueTile label={t({ ko: '현재 디바이스', en: 'Current device' })} value={taggerStatus?.currentDevice ?? '—'} />
        <SettingsValueTile
          label={t({ ko: 'WD Tagger', en: 'WD Tagger' })}
          value={renderDependencyStatus({
            ready: taggerDependencyResult?.available ?? null,
            pending: isCheckingTaggerDependencies,
            t,
          })}
        />
        <SettingsValueTile label={t({ ko: 'Kaloscope', en: 'Kaloscope' })} value={renderDependencyStatus({ ready: kaloscopeReady, t })} />
      </div>
    </SettingsSection>
  )
}
