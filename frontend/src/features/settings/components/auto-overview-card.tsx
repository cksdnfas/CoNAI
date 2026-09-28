import type { ReactNode } from 'react'
import type { KaloscopeServerStatus, TaggerDependencyCheckResult, TaggerServerStatus } from '@conai/shared'
import { RowGroup } from '@/components/ui/row-group'
import { useI18n } from '@/i18n'
import { SettingsStatLine, type SettingsStatItem } from './settings-rows'

interface AutoOverviewCardProps {
  heading: ReactNode
  actions?: ReactNode
  taggerStatus: TaggerServerStatus | undefined
  taggerDependencyResult: TaggerDependencyCheckResult | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  isCheckingTaggerDependencies: boolean
}

type Translate = ReturnType<typeof useI18n>['t']

function dependencyStat(label: string, ready: boolean | null, pending: boolean, t: Translate): SettingsStatItem {
  if (pending) {
    return { label, value: t({ ko: '확인 중…', en: 'Checking…' }), tone: 'muted' }
  }
  if (ready == null) {
    return { label, value: '—', tone: 'muted' }
  }
  return ready
    ? { label, value: t({ ko: '준비 OK', en: 'Ready' }), tone: 'success' }
    : { label, value: t({ ko: '확인 필요', en: 'Needs attention' }), tone: 'danger' }
}

/** Tagger / Kaloscope readiness as one inline stat line. */
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
    <RowGroup heading={heading} actions={actions}>
      <SettingsStatLine
        className="py-1"
        items={[
          { label: t({ ko: '로드된 모델', en: 'Loaded model' }), value: taggerStatus?.currentModel ?? '—' },
          { label: t({ ko: '디바이스', en: 'Device' }), value: taggerStatus?.currentDevice ?? '—' },
          dependencyStat('WD Tagger', taggerDependencyResult?.available ?? null, isCheckingTaggerDependencies, t),
          dependencyStat('Kaloscope', kaloscopeReady, false, t),
        ]}
      />
    </RowGroup>
  )
}
