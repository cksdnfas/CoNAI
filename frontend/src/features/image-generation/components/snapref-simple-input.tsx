import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  findSnapRefSimpleValueIssues,
  SNAPREF_SIMPLE_FIDELITY,
  SNAPREF_SIMPLE_MAX_REFERENCES,
  SNAPREF_SIMPLE_MODES,
  SNAPREF_SIMPLE_STRENGTH,
  type SnapRefSimpleMode,
} from '@conai/shared'
import { Field, FieldGroup } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { getGenerationCustomDropdownLists } from '@/lib/api-image-generation-workflows'
import { deleteWorkflowInputAsset, uploadWorkflowInputAsset } from '@/lib/api-workflow-input-assets'
import { createFileFromBase64 } from '@/lib/appearance-package'
import type { SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { isWorkflowInputAssetRef } from './minimax-h3-director-dasiwa-utils'
import { NaiAssetRow } from './nai-assets/nai-asset-row'
import { PathOptionTreeSelect } from './path-option-tree-select'
import { findAutoCollectedPowerLoraOptions } from './power-lora-loader-utils'
import {
  describeSnapRefSimplePicture,
  readSnapRefSimpleSlots,
  writeSnapRefSimpleSlots,
  type SnapRefSimpleSlot,
} from './snapref-simple-utils'

type SnapRefSimpleInputProps = {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  /** Auto-collected models/loras files; read from the dropdown lists when the caller passes none. */
  loraOptions?: string[]
  isRefreshingLoraOptions?: boolean
  onRefreshLoraOptions?: () => Promise<void> | void
}

/** A picked image is a base64 data URL; the workflow input store takes it back as a file. */
function selectedImageToFile(image: SelectedImageDraft) {
  const [header, base64 = ''] = image.dataUrl.split(',', 2)
  const mimeType = image.mimeType || /^data:([^;,]+)/.exec(header)?.[1] || 'image/png'
  return createFileFromBase64(base64, image.fileName || 'snapref.png', mimeType)
}

/** SnapRef (SnapRefSimple) inputs: up to eight pictures of one character with a weight each, mode, fidelity and adapter. */
export function SnapRefSimpleInput({ value, onChange, loraOptions, isRefreshingLoraOptions = false, onRefreshLoraOptions }: SnapRefSimpleInputProps) {
  const { t } = useI18n()
  // Slot index the picker fills; an index past the used slots adds a picture.
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fallbackListsQuery = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
    enabled: loraOptions === undefined,
  })
  const slots = readSnapRefSimpleSlots(value)
  const adapter = typeof value.adapter === 'string' ? value.adapter : ''
  const adapterOptions = [...new Set([...(adapter ? [adapter] : []), ...(loraOptions ?? findAutoCollectedPowerLoraOptions(fallbackListsQuery.data ?? []))])]
  const mode = typeof value.mode === 'string' ? value.mode : SNAPREF_SIMPLE_MODES[0]
  const fidelity = typeof value.fidelity === 'number' ? value.fidelity : SNAPREF_SIMPLE_FIDELITY.default
  const issues = findSnapRefSimpleValueIssues(value)
  const modeLabels: Record<SnapRefSimpleMode, string> = {
    'Character & Style': t({ ko: '캐릭터 + 스타일', en: 'Character & Style' }),
    Character: t({ ko: '캐릭터만', en: 'Character only' }),
  }

  const releasePicture = (picture: unknown) => {
    if (!isWorkflowInputAssetRef(picture)) return
    void deleteWorkflowInputAsset(picture.id).catch(() => {
      setStatus(t({ ko: '이전 사진 정리에 실패했어.', en: 'Failed to clean up the previous picture.' }))
    })
  }

  const writeSlots = (nextSlots: SnapRefSimpleSlot[]) => onChange(writeSnapRefSimpleSlots(value, nextSlots))

  // The write below uses this render's value, so every control stays disabled until the upload settles.
  const placePicture = async (index: number, image: SelectedImageDraft) => {
    if (isUploading) return
    setIsUploading(true)
    setStatus(t({ ko: '{name} 업로드 중…', en: 'Uploading {name}…' }, { name: image.fileName }))
    try {
      const asset = await uploadWorkflowInputAsset(selectedImageToFile(image))
      const previous = slots[index]?.picture
      writeSlots(index < slots.length
        ? slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, picture: asset } : slot)
        : [...slots, { picture: asset, strength: SNAPREF_SIMPLE_STRENGTH.default }])
      setStatus(null)
      releasePicture(previous)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t({ ko: '사진 업로드에 실패했어.', en: 'Failed to upload the picture.' }))
    } finally {
      setIsUploading(false)
    }
  }

  const removePicture = (index: number) => {
    writeSlots(slots.filter((_, slotIndex) => slotIndex !== index))
    releasePicture(slots[index]?.picture)
  }

  return (
    <fieldset disabled={isUploading} aria-busy={isUploading || undefined} className="min-w-0 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ ko: '모드', en: 'Mode' })} info={t({ ko: '캐릭터 + 스타일은 사진의 캐릭터와 그림체를 가져오고, 캐릭터만은 그림체를 모델과 프롬프트에 맡겨.', en: 'Character & Style takes the character and art style from the pictures; Character only leaves the style to the model and prompt.' })}>
          <Select value={mode} onChange={(event) => onChange({ ...value, mode: event.target.value })}>
            {SNAPREF_SIMPLE_MODES.map((option) => <option key={option} value={option}>{modeLabels[option]}</option>)}
          </Select>
        </Field>
        <Field label={t({ ko: '충실도', en: 'Fidelity' })} info={t({ ko: '1이면 사진의 디테일을 그대로 살리고, 낮출수록 프롬프트를 더 자유롭게 따라가.', en: '1 keeps every detail of the pictures; lower follows the prompt more freely.' })}>
          <NumberStepperInput
            min={SNAPREF_SIMPLE_FIDELITY.min}
            max={SNAPREF_SIMPLE_FIDELITY.max}
            step={SNAPREF_SIMPLE_FIDELITY.step}
            value={String(fidelity)}
            onValueCommit={(nextValue) => onChange({ ...value, fidelity: Number(nextValue) })}
          />
        </Field>
      </div>

      <FieldGroup label={t({ ko: '어댑터', en: 'Adapter' })}>
        <PathOptionTreeSelect
          value={adapter}
          options={adapterOptions}
          modelPreviewFolder="loras"
          placeholder={t({ ko: 'SnapRef 가중치 파일 선택', en: 'Choose the SnapRef weights file' })}
          refreshLabel={t({ ko: 'LoRA 자동수집 새로고침', en: 'Refresh LoRA auto collect' })}
          isRefreshing={isRefreshingLoraOptions}
          onRefresh={onRefreshLoraOptions}
          onChange={(nextAdapter) => {
            if (nextAdapter) onChange({ ...value, adapter: nextAdapter })
          }}
        />
      </FieldGroup>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Text variant="label">{t({ ko: '참조 사진', en: 'Reference pictures' })}</Text>
          <div className="flex items-center gap-1">
            <Text as="span" variant="caption" mono>{slots.length}/{SNAPREF_SIMPLE_MAX_REFERENCES}</Text>
            <IconButton
              size="icon-sm"
              variant="ghost"
              disabled={isUploading || slots.length >= SNAPREF_SIMPLE_MAX_REFERENCES}
              onClick={() => setPickerIndex(slots.length)}
              label={t({ ko: '참조 사진 추가', en: 'Add reference picture' })}
            >
              <Plus />
            </IconButton>
          </div>
        </div>
        <div className="divide-y divide-line">
          {slots.map((slot, index) => {
            const picture = describeSnapRefSimplePicture(slot.picture)
            return (
              <NaiAssetRow
                key={index}
                image={picture.previewUrl ? { fileName: picture.name, dataUrl: picture.previewUrl } : undefined}
                title={picture.name || t({ ko: '사진을 골라줘', en: 'Choose a picture' })}
                meta={picture.name && !picture.previewUrl
                  ? t({ ko: '사진 {index} · ComfyUI 입력 파일', en: 'Picture {index} · ComfyUI input file' }, { index: index + 1 })
                  : t({ ko: '사진 {index}', en: 'Picture {index}' }, { index: index + 1 })}
                strength={String(slot.strength)}
                strengthMin={SNAPREF_SIMPLE_STRENGTH.min}
                strengthMax={SNAPREF_SIMPLE_STRENGTH.max}
                strengthStep={SNAPREF_SIMPLE_STRENGTH.step}
                onStrengthCommit={(nextValue) => writeSlots(slots.map((entry, slotIndex) => slotIndex === index ? { ...entry, strength: Number(nextValue) } : entry))}
                onReplaceImage={() => setPickerIndex(index)}
                onRemove={index === 0 ? undefined : () => removePicture(index)}
              />
            )
          })}
        </div>
      </div>

      <ImageAttachmentPickerButton
        hideTrigger
        label={t({ ko: '참조 사진 선택', en: 'Choose reference picture' })}
        modalTitle={t({ ko: 'SnapRef 사진 {index}', en: 'SnapRef picture {index}' }, { index: (pickerIndex ?? 0) + 1 })}
        allowSaveDialog={false}
        open={pickerIndex !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPickerIndex(null)
        }}
        onSelect={(image) => {
          if (image && pickerIndex !== null) void placePicture(pickerIndex, image)
        }}
      />

      {status ? <Text variant="caption">{status}</Text> : null}
      {issues.length > 0 ? (
        <Text variant="caption" tone="destructive">
          {t({ ko: '실행 전에 확인해줘: {issues}', en: 'Check before running: {issues}' }, { issues: issues.join('; ') })}
        </Text>
      ) : null}
    </fieldset>
  )
}
