import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { TaggerModelInfo, TaggerSettings } from '@/types/settings'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

interface TaggerSettingsCardProps {
  taggerDraft: TaggerSettings | null
  taggerModels: TaggerModelInfo[]
  onPatchTagger: (patch: Partial<TaggerSettings>) => void
  onSaveTagger: () => void
  isSavingTagger: boolean
  isCheckingTaggerDependencies: boolean
}

export function TaggerSettingsCard({
  taggerDraft,
  taggerModels,
  onPatchTagger,
  onSaveTagger,
  isSavingTagger,
  isCheckingTaggerDependencies,
}: TaggerSettingsCardProps) {
  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>WD Tagger</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onSaveTagger} disabled={!taggerDraft || isSavingTagger || isCheckingTaggerDependencies}>
              {isCheckingTaggerDependencies ? '의존성 확인 중…' : '저장'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
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
              <select
                value={taggerDraft.model}
                onChange={(event) => onPatchTagger({ model: event.target.value as TaggerSettings['model'] })}
                className={settingsControlClassName}
              >
                {taggerModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.label}
                  </option>
                ))}
              </select>
            </SettingsField>

            <SettingsField label="디바이스">
              <select
                value={taggerDraft.device}
                onChange={(event) => onPatchTagger({ device: event.target.value as TaggerSettings['device'] })}
                className={settingsControlClassName}
              >
                <option value="auto">auto</option>
                <option value="cpu">cpu</option>
                <option value="cuda">cuda</option>
              </select>
            </SettingsField>

            <SettingsField label="General threshold">
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={taggerDraft.generalThreshold}
                onChange={(event) => onPatchTagger({ generalThreshold: Number(event.target.value) || 0 })}
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="Character threshold">
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={taggerDraft.characterThreshold}
                onChange={(event) => onPatchTagger({ characterThreshold: Number(event.target.value) || 0 })}
                className={settingsControlClassName}
              />
            </SettingsField>

            <SettingsField label="Python path" className="md:col-span-2">
              <input value={taggerDraft.pythonPath} onChange={(event) => onPatchTagger({ pythonPath: event.target.value })} className={settingsControlClassName} />
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
              <input
                type="number"
                min={1}
                value={taggerDraft.autoUnloadMinutes}
                onChange={(event) => onPatchTagger({ autoUnloadMinutes: Number(event.target.value) || 1 })}
                className={settingsControlClassName}
              />
            </SettingsField>
          </>
        ) : (
          <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
        )}
      </CardContent>
    </Card>
  )
}
