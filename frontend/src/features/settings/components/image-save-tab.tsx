import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { ImageSaveSettings } from '@/types/settings'
import { SettingsField, SettingsSection, SettingsToggleRow } from './settings-primitives'

const IMAGE_SAVE_SIZE_PRESETS = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
] as const

interface ImageSaveTabProps {
  imageSaveDraft: ImageSaveSettings | null
  onPatchImageSave: (patch: Partial<ImageSaveSettings>) => void
  onSave: () => void
  isSaving: boolean
}

/** Render image save defaults used by save dialogs and attachment flows. */
export function ImageSaveTab({ imageSaveDraft, onPatchImageSave, onSave, isSaving }: ImageSaveTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading="이미지 저장"
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!imageSaveDraft || isSaving}
              aria-label="이미지 저장 설정 저장"
              title="이미지 저장 설정 저장"
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {imageSaveDraft ? (
              <>
                <SettingsField label="기본 포맷">
                  <Select
                    variant="settings"
                    value={imageSaveDraft.defaultFormat}
                    onChange={(event) => onPatchImageSave({ defaultFormat: event.target.value as ImageSaveSettings['defaultFormat'] })}
                  >
                    <option value="original">원본 유지</option>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </Select>
                </SettingsField>

                <SettingsField label="품질">
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
                  저장 전에 크기 조정
                </SettingsToggleRow>

                <SettingsField label="크기 프리셋">
                  <div className="flex flex-wrap gap-2">
                    {IMAGE_SAVE_SIZE_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant={imageSaveDraft.maxWidth === preset.width && imageSaveDraft.maxHeight === preset.height ? 'secondary' : 'outline'}
                        onClick={() => onPatchImageSave({ maxWidth: preset.width, maxHeight: preset.height, resizeEnabled: true })}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </SettingsField>

                <SettingsField label="최대 가로">
                  <Input
                    type="number"
                    min={64}
                    max={16384}
                    variant="settings"
                    value={imageSaveDraft.maxWidth}
                    onChange={(event) => onPatchImageSave({ maxWidth: Number(event.target.value) || 64 })}
                  />
                </SettingsField>

                <SettingsField label="최대 세로">
                  <Input
                    type="number"
                    min={64}
                    max={16384}
                    variant="settings"
                    value={imageSaveDraft.maxHeight}
                    onChange={(event) => onPatchImageSave({ maxHeight: Number(event.target.value) || 64 })}
                  />
                </SettingsField>

                <SettingsField label="적용 방식">
                  <Select
                    variant="settings"
                    value={imageSaveDraft.alwaysShowDialog ? 'dialog' : 'auto'}
                    onChange={(event) => onPatchImageSave({ alwaysShowDialog: event.target.value === 'dialog' })}
                  >
                    <option value="auto">설정값 자동 적용</option>
                    <option value="dialog">매번 팝업으로 확인</option>
                  </Select>
                </SettingsField>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToGenerationAttachments}
                    onChange={(event) => onPatchImageSave({ applyToGenerationAttachments: event.target.checked })}
                  />
                  생성 첨부에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToEditorSave}
                    onChange={(event) => onPatchImageSave({ applyToEditorSave: event.target.checked })}
                  />
                  에디터 저장에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToCanvasSave}
                    onChange={(event) => onPatchImageSave({ applyToCanvasSave: event.target.checked })}
                  />
                  캔버스 저장에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToUpload}
                    onChange={(event) => onPatchImageSave({ applyToUpload: event.target.checked })}
                  />
                  업로드에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToWorkflowOutputs}
                    onChange={(event) => onPatchImageSave({ applyToWorkflowOutputs: event.target.checked })}
                  />
                  워크플로 출력에 적용
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-64 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>
    </div>
  )
}
