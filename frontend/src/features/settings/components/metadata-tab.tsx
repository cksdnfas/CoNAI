import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetadataExtractionSettings } from '@/types/settings'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

interface MetadataTabProps {
  metadataDraft: MetadataExtractionSettings | null
  onPatchMetadata: (patch: Partial<MetadataExtractionSettings>) => void
  onSave: () => void
  isSaving: boolean
}

export function MetadataTab({ metadataDraft, onPatchMetadata, onSave, isSaving }: MetadataTabProps) {
  return (
    <div className="space-y-8">
      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Metadata</CardTitle>
            <Button size="sm" onClick={onSave} disabled={!metadataDraft || isSaving}>
              <Sparkles className="h-4 w-4" />
              저장
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {metadataDraft ? (
            <>
              <SettingsToggleRow className="md:col-span-2">
                <input
                  type="checkbox"
                  checked={metadataDraft.enableSecondaryExtraction}
                  onChange={(event) => onPatchMetadata({ enableSecondaryExtraction: event.target.checked })}
                />
                Secondary extraction 활성화
              </SettingsToggleRow>

              <SettingsField label="Stealth scan mode">
                <select
                  value={metadataDraft.stealthScanMode}
                  onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}
                  className={settingsControlClassName}
                >
                  <option value="fast">fast</option>
                  <option value="full">full</option>
                  <option value="skip">skip</option>
                </select>
              </SettingsField>

              <SettingsField label="최대 파일 크기(MB)">
                <input
                  type="number"
                  min={1}
                  value={metadataDraft.stealthMaxFileSizeMB}
                  onChange={(event) => onPatchMetadata({ stealthMaxFileSizeMB: Number(event.target.value) || 1 })}
                  className={settingsControlClassName}
                />
              </SettingsField>

              <SettingsField label="최대 해상도(MP)">
                <input
                  type="number"
                  min={1}
                  value={metadataDraft.stealthMaxResolutionMP}
                  onChange={(event) => onPatchMetadata({ stealthMaxResolutionMP: Number(event.target.value) || 1 })}
                  className={settingsControlClassName}
                />
              </SettingsField>

              <SettingsToggleRow>
                <input
                  type="checkbox"
                  checked={metadataDraft.skipStealthForComfyUI}
                  onChange={(event) => onPatchMetadata({ skipStealthForComfyUI: event.target.checked })}
                />
                ComfyUI 스킵
              </SettingsToggleRow>

              <SettingsToggleRow>
                <input
                  type="checkbox"
                  checked={metadataDraft.skipStealthForWebUI}
                  onChange={(event) => onPatchMetadata({ skipStealthForWebUI: event.target.checked })}
                />
                WebUI 스킵
              </SettingsToggleRow>
            </>
          ) : (
            <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
