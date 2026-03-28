import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetadataExtractionSettings } from '@/types/settings'
import { SettingsField, SettingsSectionHeading, SettingsToggleRow } from './settings-primitives'

interface MetadataTabProps {
  metadataDraft: MetadataExtractionSettings | null
  onPatchMetadata: (patch: Partial<MetadataExtractionSettings>) => void
  onSave: () => void
  isSaving: boolean
}

export function MetadataTab({ metadataDraft, onPatchMetadata, onSave, isSaving }: MetadataTabProps) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SettingsSectionHeading
          heading="Metadata"
          actions={
            <Button size="sm" onClick={onSave} disabled={!metadataDraft || isSaving}>
              <Save className="h-4 w-4" />
              저장
            </Button>
          }
        />
        <Card className="bg-surface-container">
          <CardContent className="grid gap-4 md:grid-cols-2">
            {metadataDraft ? (
              <>
                <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-muted-foreground md:col-span-2">
                  표준 메타(XMP / EXIF / PNG text)는 항상 먼저 읽고, 여기 옵션은 주로 stealth 계열 보조 스캔 범위를 조절해. 지금 기준으로는 PNG secondary fallback과 WebP stealth reader가 이 제한을 같이 참고해.
                </div>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={metadataDraft.enableSecondaryExtraction}
                    onChange={(event) => onPatchMetadata({ enableSecondaryExtraction: event.target.checked })}
                  />
                  PNG secondary extraction 활성화
                </SettingsToggleRow>

                <SettingsField label="Stealth scan mode">
                  <Select variant="settings" value={metadataDraft.stealthScanMode} onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
                    <option value="fast">fast</option>
                    <option value="full">full</option>
                    <option value="skip">skip</option>
                  </Select>
                  <span className="mt-2 text-xs text-muted-foreground">fast/full은 PNG stealth fallback 쪽에서 의미가 크고, WebP stealth는 skip 여부와 크기/해상도 제한을 같이 따라.</span>
                </SettingsField>

                <SettingsField label="최대 파일 크기(MB)">
                  <Input type="number" min={1} variant="settings" value={metadataDraft.stealthMaxFileSizeMB} onChange={(event) => onPatchMetadata({ stealthMaxFileSizeMB: Number(event.target.value) || 1 })} />
                </SettingsField>

                <SettingsField label="최대 해상도(MP)">
                  <Input type="number" min={1} variant="settings" value={metadataDraft.stealthMaxResolutionMP} onChange={(event) => onPatchMetadata({ stealthMaxResolutionMP: Number(event.target.value) || 1 })} />
                </SettingsField>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={metadataDraft.skipStealthForComfyUI}
                    onChange={(event) => onPatchMetadata({ skipStealthForComfyUI: event.target.checked })}
                  />
                  ComfyUI로 이미 판단되면 PNG stealth fallback 스킵
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={metadataDraft.skipStealthForWebUI}
                    onChange={(event) => onPatchMetadata({ skipStealthForWebUI: event.target.checked })}
                  />
                  WebUI로 이미 판단되면 PNG stealth fallback 스킵
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
