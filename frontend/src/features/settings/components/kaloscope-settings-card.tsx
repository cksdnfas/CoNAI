import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { KaloscopeServerStatus, KaloscopeSettings } from '@conai/shared'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '@/lib/settings-defaults'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
import { useI18n, type TranslationInput } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from './settings-switch-row'

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
  const isEnabled = kaloscopeDraft?.enabled === true

  return (
    <Section
      variant="settings"
      heading={heading}
      description={t({ ko: '이미지 화풍을 보고 비슷한 작가를 추정해 작가 태그로 붙여.', en: 'Estimates similar artists from an image’s style and adds them as artist tags.' })}
      actions={actions}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {kaloscopeDraft ? (
          <>
            <SettingsSwitchRow
              checked={kaloscopeDraft.enabled}
              onCheckedChange={(checked) => onPatchKaloscope({ enabled: checked })}
              label={t({ ko: 'Kaloscope 활성화', en: 'Enable Kaloscope' })}
              className="md:col-span-2"
            />

            <SettingsSwitchRow
              checked={kaloscopeDraft.autoTagOnUpload}
              disabled={!isEnabled}
              onCheckedChange={(checked) => onPatchKaloscope({ autoTagOnUpload: checked })}
              label={t({ ko: '새 이미지 자동 처리', en: 'Process new images automatically' })}
              className="md:col-span-2"
            />

            <Field label={t({ ko: '실행 장치', en: 'Device' })}>
              <Select variant="settings" value={kaloscopeDraft.device} disabled={!isEnabled} onChange={(event) => onPatchKaloscope({ device: event.target.value as KaloscopeSettings['device'] })}>
                <option value="auto">{t({ ko: '자동 (GPU 우선)', en: 'Auto (GPU if available)' })}</option>
                <option value="cpu">{t({ ko: 'CPU (느림, GPU 불필요)', en: 'CPU (slower, no GPU needed)' })}</option>
                <option value="cuda">{t({ ko: 'GPU (NVIDIA CUDA)', en: 'GPU (NVIDIA CUDA)' })}</option>
              </Select>
            </Field>

            <Field label={t({ ko: '작가 후보 수', en: 'Artist candidates' })} hint={t({ ko: '점수 높은 순으로 저장', en: 'Top matches kept' })}>
              <NumberStepperInput min={1} max={200} variant="settings" disabled={!isEnabled} value={kaloscopeDraft.topK} onValueCommit={(nextValue) => onPatchKaloscope({ topK: Number(nextValue) || 1 })} />
            </Field>

            <SettingsSwitchRow
              checked={kaloscopeDraft.keepModelLoaded}
              disabled={!isEnabled}
              onCheckedChange={(checked) => onPatchKaloscope({ keepModelLoaded: checked })}
              label={t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}
            />

            <Field label={t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' })} hint={kaloscopeDraft.keepModelLoaded ? t({ ko: '메모리 유지가 켜져 있으면 자동으로 내리지 않아', en: 'Not used while the model is kept in memory' }) : t({ ko: '이 시간 동안 안 쓰면 모델을 메모리에서 내려', en: 'Unloads the model after this long without use' })}>
              <NumberStepperInput
                min={1}
                variant="settings"
                disabled={!isEnabled || kaloscopeDraft.keepModelLoaded}
                value={kaloscopeDraft.autoUnloadMinutes}
                onValueCommit={(nextValue) => onPatchKaloscope({ autoUnloadMinutes: Number(nextValue) || 1 })}
              />
            </Field>

            <Field label={t({ ko: 'Artist 링크 URL', en: 'Artist link URL' })} className="md:col-span-2">
              <div className="space-y-2">
                <Input
                  variant="settings"
                  value={kaloscopeDraft.artistLinkUrlTemplate}
                  onChange={(event) => onPatchKaloscope({ artistLinkUrlTemplate: event.target.value })}
                  placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{t({ ko: '{key} 자리에 아티스트 배지 텍스트가 들어가.', en: 'Artist badge text is inserted at {key}.' })}</p>
                  <Button type="button" size="sm" variant="secondary" onClick={() => onPatchKaloscope({ artistLinkUrlTemplate: DEFAULT_ARTIST_LINK_URL_TEMPLATE })}>
                    <RotateCcw className="h-4 w-4" />
                    {t({ ko: '기본값', en: 'Default' })}
                  </Button>
                </div>
              </div>
            </Field>
          </>
        ) : (
          <Skeleton className="h-56 w-full rounded-sm md:col-span-2" />
        )}

        <div className="flex flex-wrap gap-2 text-xs md:col-span-2">
          <span className="rounded-sm bg-surface-lowest px-3 py-1.5 text-foreground">{t({ ko: '의존성', en: 'Dependencies' })} {formatKaloscopeDependencyLabel(kaloscopeStatus, t)}</span>
          <span className="rounded-sm bg-surface-lowest px-3 py-1.5 text-muted-foreground">{t({ ko: '분석 프로세스', en: 'Analyzer process' })} {kaloscopeStatus?.isRunning ? t({ ko: '실행 중', en: 'running' }) : t({ ko: '꺼짐', en: 'stopped' })}</span>
          <span className="rounded-sm bg-surface-lowest px-3 py-1.5 text-muted-foreground">{t({ ko: '모델 메모리 적재', en: 'Model in memory' })} {kaloscopeStatus?.modelLoaded ? t({ ko: '예', en: 'yes' }) : t({ ko: '아니오', en: 'no' })}</span>
          <span className="rounded-sm bg-surface-lowest px-3 py-1.5 text-muted-foreground">{t({ ko: '모델 파일', en: 'Model files' })} {kaloscopeStatus?.modelCached ? t({ ko: '받아 둠', en: 'downloaded' }) : t({ ko: '없음 (첫 실행 때 받음)', en: 'not yet (downloaded on first run)' })}</span>
          <span className="rounded-sm bg-surface-lowest px-3 py-1.5 text-muted-foreground">{t({ ko: '모델', en: 'Model' })} {kaloscopeStatus?.currentModel ?? '—'}</span>
          <span className="rounded-sm bg-surface-lowest px-3 py-1.5 text-muted-foreground">{t({ ko: '디바이스', en: 'Device' })} {kaloscopeStatus?.currentDevice ?? '—'}</span>
        </div>
      </div>
    </Section>
  )
}
