import { Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { calculateImageSaveOutputSize, resolveImageSaveFormat, type ImageSaveSourceInfo } from '@/lib/image-save-output'
import type { ImageSaveSettings } from '@/types/settings'

interface ImageSaveOptionsModalProps {
  open: boolean
  title?: string
  options: ImageSaveSettings
  sourceInfo: ImageSaveSourceInfo | null
  isSaving: boolean
  onClose: () => void
  onOptionsChange: (patch: Partial<ImageSaveSettings>) => void
  onConfirm: () => void
}

/** Render a compact image save-options modal shared by attachment/save flows. */
export function ImageSaveOptionsModal({
  open,
  title,
  options,
  sourceInfo,
  isSaving,
  onClose,
  onOptionsChange,
  onConfirm,
}: ImageSaveOptionsModalProps) {
  const { t } = useI18n()
  const targetSize = sourceInfo
    ? calculateImageSaveOutputSize(sourceInfo.width, sourceInfo.height, options)
    : null
  const resolvedFormat = resolveImageSaveFormat(options.defaultFormat, sourceInfo?.mimeType)

  return (
    <SettingsModal open={open} onClose={onClose} title={title ?? t('imageSaveOptionsModal.saveImage')} widthClassName="max-w-2xl">
      <SettingsModalBody className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {sourceInfo ? (
            <>
              <Badge variant="outline">{sourceInfo.width}×{sourceInfo.height}</Badge>
              <Badge variant="outline">{resolvedFormat}</Badge>
              {targetSize ? <Badge variant="secondary">{targetSize.width}×{targetSize.height}</Badge> : null}
            </>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t({ ko: '포맷', en: 'Format' })}>
            <Select
              variant="settings"
              value={options.defaultFormat}
              onChange={(event) => onOptionsChange({ defaultFormat: event.target.value as ImageSaveSettings['defaultFormat'] })}
            >
              <option value="original">{t('imageSaveOptionsModal.keepOriginal')}</option>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '품질', en: 'Quality' })}>
            <Input
              type="number"
              min={1}
              max={100}
              variant="settings"
              value={options.quality}
              onChange={(event) => onOptionsChange({ quality: Number(event.target.value) || 1 })}
            />
          </SettingsField>

          <SettingsToggleRow className="md:col-span-2">
            <input
              type="checkbox"
              checked={options.resizeEnabled}
              onChange={(event) => onOptionsChange({ resizeEnabled: event.target.checked })}
            />
            {t({ ko: '저장 전에 크기 조정', en: 'Resize before saving' })}
          </SettingsToggleRow>

          <SettingsField label={t('imageSaveOptionsModal.maxWidth')}>
            <Input
              type="number"
              min={64}
              max={16384}
              variant="settings"
              value={options.maxWidth}
              onChange={(event) => onOptionsChange({ maxWidth: Number(event.target.value) || 64 })}
              disabled={!options.resizeEnabled}
            />
          </SettingsField>

          <SettingsField label={t('imageSaveOptionsModal.maxHeight')}>
            <Input
              type="number"
              min={64}
              max={16384}
              variant="settings"
              value={options.maxHeight}
              onChange={(event) => onOptionsChange({ maxHeight: Number(event.target.value) || 64 })}
              disabled={!options.resizeEnabled}
            />
          </SettingsField>
        </div>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isSaving}>
            <Save className="h-4 w-4" />
            {isSaving ? t({ ko: '적용 중…', en: 'Applying…' }) : t({ ko: '적용', en: 'Apply' })}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
