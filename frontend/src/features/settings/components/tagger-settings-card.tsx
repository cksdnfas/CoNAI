import type { ReactNode } from 'react'
import { SectionHeading } from '@/components/common/section-heading'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { TaggerModelInfo, TaggerSettings } from '@/types/settings'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

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
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading variant="inside" heading={heading} actions={actions} />
        <div className="grid gap-4 md:grid-cols-2">
          {taggerDraft ? (
            <>
              <SettingsToggleRow className="md:col-span-2">
                <input type="checkbox" checked={taggerDraft.enabled} onChange={(event) => onPatchTagger({ enabled: event.target.checked })} />
                WD Tagger 활성화
              </SettingsToggleRow>

              <SettingsToggleRow className="md:col-span-2">
                <input
                  type="checkbox"
                  checked={taggerDraft.autoTagOnUpload}
                  onChange={(event) => onPatchTagger({ autoTagOnUpload: event.target.checked })}
                />
                업로드 시 자동 태깅
              </SettingsToggleRow>

              <SettingsField label="모델">
                <Select variant="settings" value={taggerDraft.model} onChange={(event) => onPatchTagger({ model: event.target.value as TaggerSettings['model'] })}>
                  {taggerModels.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.label}
                    </option>
                  ))}
                </Select>
              </SettingsField>

              <SettingsField label="디바이스">
                <Select variant="settings" value={taggerDraft.device} onChange={(event) => onPatchTagger({ device: event.target.value as TaggerSettings['device'] })}>
                  <option value="auto">auto</option>
                  <option value="cpu">cpu</option>
                  <option value="cuda">cuda</option>
                </Select>
              </SettingsField>

              <SettingsField label="General threshold">
                <Input type="number" min={0} max={1} step={0.01} variant="settings" value={taggerDraft.generalThreshold} onChange={(event) => onPatchTagger({ generalThreshold: Number(event.target.value) || 0 })} />
              </SettingsField>

              <SettingsField label="Character threshold">
                <Input type="number" min={0} max={1} step={0.01} variant="settings" value={taggerDraft.characterThreshold} onChange={(event) => onPatchTagger({ characterThreshold: Number(event.target.value) || 0 })} />
              </SettingsField>

              <SettingsField label="Python path" className="md:col-span-2">
                <Input variant="settings" value={taggerDraft.pythonPath} onChange={(event) => onPatchTagger({ pythonPath: event.target.value })} />
              </SettingsField>

              <SettingsToggleRow>
                <input
                  type="checkbox"
                  checked={taggerDraft.keepModelLoaded}
                  onChange={(event) => onPatchTagger({ keepModelLoaded: event.target.checked })}
                />
                모델 메모리 유지
              </SettingsToggleRow>

              <SettingsField label="자동 언로드(분)">
                <Input type="number" min={1} variant="settings" value={taggerDraft.autoUnloadMinutes} onChange={(event) => onPatchTagger({ autoUnloadMinutes: Number(event.target.value) || 1 })} />
              </SettingsField>
            </>
          ) : (
            <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
