import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import type { TaggerModelInfo, TaggerSettings } from '@conai/shared'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from './settings-switch-row'
import { SETTINGS_CONTROL_CLASS, SETTINGS_WIDE_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

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
  const isEnabled = taggerDraft?.enabled === true
  const labels = {
    model: t({ ko: '모델', en: 'Model' }),
    device: t({ ko: '실행 장치', en: 'Device' }),
    general: t({ ko: '일반 태그 기준값', en: 'General tag threshold' }),
    character: t({ ko: '캐릭터 기준값', en: 'Character threshold' }),
    python: t({ ko: 'Python 실행 파일', en: 'Python executable' }),
    unload: t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' }),
  }

  return (
    <RowGroup heading={heading} actions={actions}>
      {taggerDraft ? (
        <>
          <SettingsSwitchRow
            checked={taggerDraft.enabled}
            onCheckedChange={(checked) => onPatchTagger({ enabled: checked })}
            label={t({ ko: 'WD Tagger 활성화', en: 'Enable WD Tagger' })}
          />

          <SettingsSwitchRow
            checked={taggerDraft.autoTagOnUpload}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchTagger({ autoTagOnUpload: checked })}
            label={t({ ko: '업로드 시 자동 태깅', en: 'Auto tag on upload' })}
          />

          <SettingRow label={labels.model} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Select variant="settings" aria-label={labels.model} value={taggerDraft.model} disabled={!isEnabled} onChange={(event) => onPatchTagger({ model: event.target.value as TaggerSettings['model'] })}>
              {taggerModels.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.label}
                </option>
              ))}
            </Select>
          </SettingRow>

          <SettingRow label={labels.device} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Select variant="settings" aria-label={labels.device} value={taggerDraft.device} disabled={!isEnabled} onChange={(event) => onPatchTagger({ device: event.target.value as TaggerSettings['device'] })}>
              <option value="auto">{t({ ko: '자동 (GPU 우선)', en: 'Auto (GPU if available)' })}</option>
              <option value="cpu">{t({ ko: 'CPU (느림, GPU 불필요)', en: 'CPU (slower, no GPU needed)' })}</option>
              <option value="cuda">{t({ ko: 'GPU (NVIDIA CUDA)', en: 'GPU (NVIDIA CUDA)' })}</option>
            </Select>
          </SettingRow>

          <SettingRow label={labels.general} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={0} max={1} step={0.01} variant="settings" aria-label={labels.general} disabled={!isEnabled} value={taggerDraft.generalThreshold} onValueCommit={(nextValue) => onPatchTagger({ generalThreshold: Number(nextValue) || 0 })} />
          </SettingRow>

          <SettingRow label={labels.character} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={0} max={1} step={0.01} variant="settings" aria-label={labels.character} disabled={!isEnabled} value={taggerDraft.characterThreshold} onValueCommit={(nextValue) => onPatchTagger({ characterThreshold: Number(nextValue) || 0 })} />
          </SettingRow>

          <SettingRow label={labels.python} controlClassName={SETTINGS_WIDE_CONTROL_CLASS}>
            <Input variant="settings" aria-label={labels.python} value={taggerDraft.pythonPath} disabled={!isEnabled} onChange={(event) => onPatchTagger({ pythonPath: event.target.value })} placeholder="python" />
          </SettingRow>

          <SettingsSwitchRow
            checked={taggerDraft.keepModelLoaded}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchTagger({ keepModelLoaded: checked })}
            label={t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}
          />

          <SettingRow label={labels.unload} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={1} variant="settings" aria-label={labels.unload} disabled={!isEnabled || taggerDraft.keepModelLoaded} value={taggerDraft.autoUnloadMinutes} onValueCommit={(nextValue) => onPatchTagger({ autoUnloadMinutes: Number(nextValue) || 1 })} />
          </SettingRow>
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </RowGroup>
  )
}
