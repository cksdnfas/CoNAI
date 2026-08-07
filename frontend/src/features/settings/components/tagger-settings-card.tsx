import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { TaggerModelInfo, TaggerSettings } from '@/types/settings'
import { SettingsField, SettingsSection, SettingsToggleRow } from './settings-primitives'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

interface TaggerSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  taggerDraft: TaggerSettings | null
  taggerModels: TaggerModelInfo[]
  onPatchTagger: (patch: Partial<TaggerSettings>) => void
}

export function TaggerSettingsCard({
  heading,
  actions,
  taggerDraft,
  taggerModels,
  onPatchTagger,
}: TaggerSettingsCardProps) {
  const { t } = useI18n()

  return (
    <SettingsSection heading={heading} actions={actions}>
      <div className="grid gap-4 md:grid-cols-2">
        {taggerDraft ? (
          <>
            <SettingsToggleRow className="md:col-span-2">
              <input type="checkbox" checked={taggerDraft.enabled} onChange={(event) => onPatchTagger({ enabled: event.target.checked })} />
              {t({ ko: 'WD Tagger 활성화', en: 'Enable WD Tagger' })}
            </SettingsToggleRow>

            <SettingsToggleRow className="md:col-span-2">
              <input
                type="checkbox"
                checked={taggerDraft.autoTagOnUpload}
                onChange={(event) => onPatchTagger({ autoTagOnUpload: event.target.checked })}
              />
              {t({ ko: '업로드 시 자동 태깅', en: 'Auto tag on upload' })}
            </SettingsToggleRow>

            <SettingsField label={t({ ko: '모델', en: 'Model' })}>
              <Select variant="settings" value={taggerDraft.model} onChange={(event) => onPatchTagger({ model: event.target.value as TaggerSettings['model'] })}>
                {taggerModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.label}
                  </option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label={t({ ko: '디바이스', en: 'Device' })}>
              <Select variant="settings" value={taggerDraft.device} onChange={(event) => onPatchTagger({ device: event.target.value as TaggerSettings['device'] })}>
                <option value="auto">auto</option>
                <option value="cpu">cpu</option>
                <option value="cuda">cuda</option>
              </Select>
            </SettingsField>

            <SettingsField label={t({ ko: 'General 임계값', en: 'General threshold' })}>
              <NumberStepperInput min={0} max={1} step={0.01} variant="settings" value={taggerDraft.generalThreshold} onValueCommit={(nextValue) => onPatchTagger({ generalThreshold: Number(nextValue) || 0 })} />
            </SettingsField>

            <SettingsField label={t({ ko: 'Character 임계값', en: 'Character threshold' })}>
              <NumberStepperInput min={0} max={1} step={0.01} variant="settings" value={taggerDraft.characterThreshold} onValueCommit={(nextValue) => onPatchTagger({ characterThreshold: Number(nextValue) || 0 })} />
            </SettingsField>

            <SettingsField label={t({ ko: 'Python 경로', en: 'Python path' })} className="md:col-span-2">
              <Input variant="settings" value={taggerDraft.pythonPath} onChange={(event) => onPatchTagger({ pythonPath: event.target.value })} />
            </SettingsField>

            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={taggerDraft.keepModelLoaded}
                onChange={(event) => onPatchTagger({ keepModelLoaded: event.target.checked })}
              />
              {t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}
            </SettingsToggleRow>

            <SettingsField label={t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' })}>
              <NumberStepperInput min={1} variant="settings" value={taggerDraft.autoUnloadMinutes} onValueCommit={(nextValue) => onPatchTagger({ autoUnloadMinutes: Number(nextValue) || 1 })} />
            </SettingsField>
          </>
        ) : (
          <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
        )}
      </div>
    </SettingsSection>
  )
}
