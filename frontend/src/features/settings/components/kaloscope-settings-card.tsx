import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE, type KaloscopeServerStatus, type KaloscopeSettings } from '@/types/settings'
import { SettingsField, SettingsSection, SettingsToggleRow } from './settings-primitives'
import { useI18n, type TranslationInput } from '@/i18n'

interface KaloscopeSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  kaloscopeDraft: KaloscopeSettings | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
}

function formatKaloscopeDependencyLabel(status: KaloscopeServerStatus | undefined, t: (input: TranslationInput) => string) {
  if (!status) return t({ ko: '확인 중…', en: 'Checking…' })
  return status.scriptExists && status.dependenciesAvailable ? t({ ko: '준비 OK', en: 'Ready' }) : t({ ko: '확인 필요', en: 'Needs attention' })
}

export function KaloscopeSettingsCard({
  heading,
  actions,
  kaloscopeDraft,
  kaloscopeStatus,
  onPatchKaloscope,
}: KaloscopeSettingsCardProps) {
  const { t } = useI18n()

  return (
    <SettingsSection heading={heading} actions={actions}>
      <div className="grid gap-4 md:grid-cols-2">
        {kaloscopeDraft ? (
          <>
            <SettingsToggleRow className="md:col-span-2">
              <input type="checkbox" checked={kaloscopeDraft.enabled} onChange={(event) => onPatchKaloscope({ enabled: event.target.checked })} />
              {t({ ko: 'Kaloscope 활성화', en: 'Enable Kaloscope' })}
            </SettingsToggleRow>

            <SettingsToggleRow className="md:col-span-2">
              <input
                type="checkbox"
                checked={kaloscopeDraft.autoTagOnUpload}
                onChange={(event) => onPatchKaloscope({ autoTagOnUpload: event.target.checked })}
              />
              {t({ ko: '업로드/스케줄러 자동 처리', en: 'Auto process uploads / scheduler' })}
            </SettingsToggleRow>

            <SettingsField label={t({ ko: '디바이스', en: 'Device' })}>
              <Select variant="settings" value={kaloscopeDraft.device} onChange={(event) => onPatchKaloscope({ device: event.target.value as KaloscopeSettings['device'] })}>
                <option value="auto">auto</option>
                <option value="cpu">cpu</option>
                <option value="cuda">cuda</option>
              </Select>
            </SettingsField>

            <SettingsField label="Top K">
              <Input type="number" min={1} max={200} variant="settings" value={kaloscopeDraft.topK} onChange={(event) => onPatchKaloscope({ topK: Number(event.target.value) || 1 })} />
            </SettingsField>

            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={kaloscopeDraft.keepModelLoaded}
                onChange={(event) => onPatchKaloscope({ keepModelLoaded: event.target.checked })}
              />
              {t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}
            </SettingsToggleRow>

            <SettingsField label={t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' })}>
              <Input
                type="number"
                min={1}
                variant="settings"
                value={kaloscopeDraft.autoUnloadMinutes}
                onChange={(event) => onPatchKaloscope({ autoUnloadMinutes: Number(event.target.value) || 1 })}
              />
            </SettingsField>

            <SettingsField label="Artist 링크 URL" className="md:col-span-2">
              <div className="space-y-2">
                <Input
                  variant="settings"
                  value={kaloscopeDraft.artistLinkUrlTemplate}
                  onChange={(event) => onPatchKaloscope({ artistLinkUrlTemplate: event.target.value })}
                  placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{t({ ko: '{key} 자리에 아티스트 배지 텍스트가 들어가.', en: 'Artist badge text is inserted at {key}.' })}</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => onPatchKaloscope({ artistLinkUrlTemplate: DEFAULT_ARTIST_LINK_URL_TEMPLATE })}>
                    <RotateCcw className="h-4 w-4" />
                    {t({ ko: '기본값', en: 'Default' })}
                  </Button>
                </div>
              </div>
            </SettingsField>
          </>
        ) : (
          <Skeleton className="h-56 w-full rounded-sm md:col-span-2" />
        )}

        <div className="flex flex-wrap gap-2 text-xs md:col-span-2">
          <span className="rounded-full border border-border/70 bg-surface-low/45 px-3 py-1.5 text-foreground">{t({ ko: '의존성', en: 'Dependencies' })} {formatKaloscopeDependencyLabel(kaloscopeStatus, t)}</span>
          <span className="rounded-full border border-border/70 bg-surface-low/45 px-3 py-1.5 text-muted-foreground">daemon {kaloscopeStatus?.isRunning ? t({ ko: '실행 중', en: 'running' }) : t({ ko: '중지', en: 'stopped' })}</span>
          <span className="rounded-full border border-border/70 bg-surface-low/45 px-3 py-1.5 text-muted-foreground">loaded {kaloscopeStatus?.modelLoaded ? t({ ko: '예', en: 'yes' }) : t({ ko: '아니오', en: 'no' })}</span>
          <span className="rounded-full border border-border/70 bg-surface-low/45 px-3 py-1.5 text-muted-foreground">{t({ ko: '캐시', en: 'Cache' })} {kaloscopeStatus?.modelCached ? t({ ko: '준비됨', en: 'ready' }) : t({ ko: '없음', en: 'none' })}</span>
          <span className="rounded-full border border-border/70 bg-surface-low/45 px-3 py-1.5 text-muted-foreground">model {kaloscopeStatus?.currentModel ?? '—'}</span>
          <span className="rounded-full border border-border/70 bg-surface-low/45 px-3 py-1.5 text-muted-foreground">device {kaloscopeStatus?.currentDevice ?? '—'}</span>
        </div>
      </div>
    </SettingsSection>
  )
}
