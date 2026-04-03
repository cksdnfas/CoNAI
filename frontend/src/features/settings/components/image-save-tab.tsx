import { Save } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { ImageSaveSettings } from '@/types/settings'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

interface ImageSaveTabProps {
  imageSaveDraft: ImageSaveSettings | null
  onPatchImageSave: (patch: Partial<ImageSaveSettings>) => void
  onSave: () => void
  isSaving: boolean
}

/** Render image save defaults used by save dialogs and attachment flows. */
export function ImageSaveTab({ imageSaveDraft, onPatchImageSave, onSave, isSaving }: ImageSaveTabProps) {
  return (
    <div className="space-y-8">
      <section>
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading="Image Save"
              actions={
                <Button size="sm" onClick={onSave} disabled={!imageSaveDraft || isSaving}>
                  <Save className="h-4 w-4" />
                  저장
                </Button>
              }
            />

            <div className="grid gap-4 md:grid-cols-2">
              {imageSaveDraft ? (
                <>
                  <SettingsField label="Default format">
                    <Select
                      variant="settings"
                      value={imageSaveDraft.defaultFormat}
                      onChange={(event) => onPatchImageSave({ defaultFormat: event.target.value as ImageSaveSettings['defaultFormat'] })}
                    >
                      <option value="original">original</option>
                      <option value="png">png</option>
                      <option value="jpeg">jpeg</option>
                      <option value="webp">webp</option>
                    </Select>
                  </SettingsField>

                  <SettingsField label="Quality">
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      variant="settings"
                      value={imageSaveDraft.quality}
                      onChange={(event) => onPatchImageSave({ quality: Number(event.target.value) || 1 })}
                    />
                  </SettingsField>

                  <SettingsToggleRow className="md:col-span-2">
                    <input
                      type="checkbox"
                      checked={imageSaveDraft.resizeEnabled}
                      onChange={(event) => onPatchImageSave({ resizeEnabled: event.target.checked })}
                    />
                    Resize before save
                  </SettingsToggleRow>

                  <SettingsField label="Max width">
                    <Input
                      type="number"
                      min={64}
                      max={16384}
                      variant="settings"
                      value={imageSaveDraft.maxWidth}
                      onChange={(event) => onPatchImageSave({ maxWidth: Number(event.target.value) || 64 })}
                    />
                  </SettingsField>

                  <SettingsField label="Max height">
                    <Input
                      type="number"
                      min={64}
                      max={16384}
                      variant="settings"
                      value={imageSaveDraft.maxHeight}
                      onChange={(event) => onPatchImageSave({ maxHeight: Number(event.target.value) || 64 })}
                    />
                  </SettingsField>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={imageSaveDraft.alwaysShowDialog}
                      onChange={(event) => onPatchImageSave({ alwaysShowDialog: event.target.checked })}
                    />
                    Always show save dialog
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={imageSaveDraft.applyToGenerationAttachments}
                      onChange={(event) => onPatchImageSave({ applyToGenerationAttachments: event.target.checked })}
                    />
                    Apply to generation attachments
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={imageSaveDraft.applyToEditorSave}
                      onChange={(event) => onPatchImageSave({ applyToEditorSave: event.target.checked })}
                    />
                    Apply to editor save
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={imageSaveDraft.applyToCanvasSave}
                      onChange={(event) => onPatchImageSave({ applyToCanvasSave: event.target.checked })}
                    />
                    Apply to canvas save
                  </SettingsToggleRow>
                </>
              ) : (
                <Skeleton className="h-64 w-full rounded-sm md:col-span-2" />
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
