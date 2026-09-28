import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { TaggerModelInfo, TaggerSettings } from '@conai/shared'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from './settings-switch-row'

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

  return (
    <Section
      variant="settings"
      heading={heading}
      description={t({ ko: '이미지 내용을 보고 Danbooru 스타일 태그와 캐릭터를 자동으로 붙여.', en: 'Automatically adds Danbooru-style tags and characters based on image content.' })}
      actions={actions}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {taggerDraft ? (
          <>
            <SettingsSwitchRow
              checked={taggerDraft.enabled}
              onCheckedChange={(checked) => onPatchTagger({ enabled: checked })}
              label={t({ ko: 'WD Tagger 활성화', en: 'Enable WD Tagger' })}
              className="md:col-span-2"
            />

            <SettingsSwitchRow
              checked={taggerDraft.autoTagOnUpload}
              disabled={!isEnabled}
              onCheckedChange={(checked) => onPatchTagger({ autoTagOnUpload: checked })}
              label={t({ ko: '업로드 시 자동 태깅', en: 'Auto tag on upload' })}
              className="md:col-span-2"
            />

            <Field label={t({ ko: '모델', en: 'Model' })}>
              <Select variant="settings" value={taggerDraft.model} disabled={!isEnabled} onChange={(event) => onPatchTagger({ model: event.target.value as TaggerSettings['model'] })}>
                {taggerModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t({ ko: '실행 장치', en: 'Device' })}>
              <Select variant="settings" value={taggerDraft.device} disabled={!isEnabled} onChange={(event) => onPatchTagger({ device: event.target.value as TaggerSettings['device'] })}>
                <option value="auto">{t({ ko: '자동 (GPU 우선)', en: 'Auto (GPU if available)' })}</option>
                <option value="cpu">{t({ ko: 'CPU (느림, GPU 불필요)', en: 'CPU (slower, no GPU needed)' })}</option>
                <option value="cuda">{t({ ko: 'GPU (NVIDIA CUDA)', en: 'GPU (NVIDIA CUDA)' })}</option>
              </Select>
            </Field>

            <Field label={t({ ko: '일반 태그 기준값', en: 'General tag threshold' })} hint={t({ ko: '높을수록 확실한 태그만', en: 'Higher = fewer, surer tags' })}>
              <NumberStepperInput min={0} max={1} step={0.01} variant="settings" disabled={!isEnabled} value={taggerDraft.generalThreshold} onValueCommit={(nextValue) => onPatchTagger({ generalThreshold: Number(nextValue) || 0 })} />
            </Field>

            <Field label={t({ ko: '캐릭터 기준값', en: 'Character threshold' })} hint={t({ ko: '높을수록 확실한 캐릭터만', en: 'Higher = fewer, surer matches' })}>
              <NumberStepperInput min={0} max={1} step={0.01} variant="settings" disabled={!isEnabled} value={taggerDraft.characterThreshold} onValueCommit={(nextValue) => onPatchTagger({ characterThreshold: Number(nextValue) || 0 })} />
            </Field>

            <Field label={t({ ko: 'Python 실행 파일', en: 'Python executable' })} hint={t({ ko: '보통 python 그대로 두면 돼', en: 'Usually leave as python' })} className="md:col-span-2">
              <Input variant="settings" value={taggerDraft.pythonPath} disabled={!isEnabled} onChange={(event) => onPatchTagger({ pythonPath: event.target.value })} placeholder="python" />
            </Field>

            <SettingsSwitchRow
              checked={taggerDraft.keepModelLoaded}
              disabled={!isEnabled}
              onCheckedChange={(checked) => onPatchTagger({ keepModelLoaded: checked })}
              label={t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}
            />

            <Field label={t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' })}>
              <NumberStepperInput min={1} variant="settings" disabled={!isEnabled} value={taggerDraft.autoUnloadMinutes} onValueCommit={(nextValue) => onPatchTagger({ autoUnloadMinutes: Number(nextValue) || 1 })} />
            </Field>
          </>
        ) : (
          <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
        )}
      </div>
    </Section>
  )
}
