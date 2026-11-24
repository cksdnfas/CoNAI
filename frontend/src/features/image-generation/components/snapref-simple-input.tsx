import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageIcon, Plus, RefreshCw, Upload, X } from 'lucide-react'
import {
  findSnapRefSimpleValueIssues,
  SNAPREF_SIMPLE_FIDELITY,
  SNAPREF_SIMPLE_MAX_REFERENCES,
  SNAPREF_SIMPLE_MODES,
  SNAPREF_SIMPLE_STRENGTH,
  type SnapRefSimpleMode,
} from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Panel } from '@/components/ui/panel'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useDropZoneState } from '@/features/upload/use-drop-zone-state'
import { useI18n } from '@/i18n'
import { getGenerationCustomDropdownLists } from '@/lib/api-image-generation-workflows'
import { deleteWorkflowInputAsset, uploadWorkflowInputAsset, type WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import { cn } from '@/lib/utils'
import { ImageAttachmentPickerButton, selectedImageToFile } from './image-attachment-picker'
import { isWorkflowInputAssetRef } from './minimax-h3-director-dasiwa-utils'
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
  /** Pictures are picked with the in-app picker (library, save folder) instead of a plain file upload. */
  allowBrowse?: boolean
  /** The chosen ComfyUI server, for previews of pictures that are files in its input folder. */
  comfyServerId?: number
}

type SnapRefPictureTileProps = {
  index: number
  name: string
  previewUrl?: string
  strength: number
  onStrengthCommit: (value: string) => void
  onPick: () => void
  onDropFiles: (files: File[]) => void
  /** Omit for a picture that cannot be removed. */
  onRemove?: () => void
}

/** One picture of the grid: the picture (a drop target that replaces it), its number, replace/remove on hover, and its weight below. */
function SnapRefPictureTile({ index, name, previewUrl, strength, onStrengthCommit, onPick, onDropFiles, onRemove }: SnapRefPictureTileProps) {
  const { t } = useI18n()
  const drop = useDropZoneState<HTMLDivElement>({ onDropFiles })
  // A preview that does not load (the input file is gone from the server) falls back to the icon.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const shown = previewUrl && failedUrl !== previewUrl ? previewUrl : null

  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div
        className={cn('group relative aspect-square overflow-hidden rounded-sm bg-field', drop.isDragActive && 'ring-2 ring-inset ring-primary')}
        title={name || undefined}
        onDrop={drop.handleDrop}
        onDragEnter={drop.handleDragEnter}
        onDragOver={drop.handleDragOver}
        onDragLeave={drop.handleDragLeave}
      >
        {shown
          ? <img src={shown} alt={name} className="size-full bg-checker object-cover" onError={() => setFailedUrl(shown)} />
          : <div className="flex size-full items-center justify-center text-muted-foreground"><ImageIcon className="size-5" /></div>}
        <Badge variant="overlay" size="sm" className="absolute left-1.5 top-1.5">{index + 1}</Badge>
        {/* Always shown where there is no hover (touch) and on a picture that is still empty. */}
        <div className={cn('absolute right-1.5 top-1.5 z-10 transition-opacity', shown && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')}>
          <Panel treatment="floating" padding="toolbar">
            <div className="flex items-center gap-1">
              <IconButton size="icon-xs" variant="ghost" onClick={onPick} label={t({ ko: '이미지 교체', en: 'Replace image' })}><RefreshCw /></IconButton>
              {onRemove ? <IconButton size="icon-xs" variant="ghost" onClick={onRemove} label={t('image-generation.components.nai.common.remove')}><X /></IconButton> : null}
            </div>
          </Panel>
        </div>
        {drop.isDragActive ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/20 text-foreground"><Upload className="size-6" /></div> : null}
      </div>
      <Tip content={t({ ko: '강도', en: 'Strength' })}>
        <div className="min-w-0">
          <NumberStepperInput
            aria-label={t({ ko: '사진 {index} 강도', en: 'Picture {index} strength' }, { index: index + 1 })}
            min={SNAPREF_SIMPLE_STRENGTH.min}
            max={SNAPREF_SIMPLE_STRENGTH.max}
            step={SNAPREF_SIMPLE_STRENGTH.step}
            value={String(strength)}
            onValueCommit={onStrengthCommit}
          />
        </div>
      </Tip>
    </div>
  )
}

/** SnapRef (SnapRefSimple) inputs: up to eight pictures of one character (Style mode: of one art style) with a weight each, mode, fidelity and adapter. */
export function SnapRefSimpleInput({ value, onChange, loraOptions, isRefreshingLoraOptions = false, onRefreshLoraOptions, allowBrowse = false, comfyServerId }: SnapRefSimpleInputProps) {
  const { t } = useI18n()
  // Slot index the picker fills; an index past the used slots adds a picture.
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileIndexRef = useRef(0)
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
    Style: t({ ko: '스타일만', en: 'Style only' }),
  }

  const releasePicture = (picture: unknown) => {
    if (!isWorkflowInputAssetRef(picture)) return
    void deleteWorkflowInputAsset(picture.id).catch(() => {
      setStatus(t({ ko: '이전 사진 정리에 실패했어.', en: 'Failed to clean up the previous picture.' }))
    })
  }

  const writeSlots = (nextSlots: SnapRefSimpleSlot[]) => onChange(writeSnapRefSimpleSlots(value, nextSlots))

  // The write below uses this render's value, so every control stays disabled until the uploads settle.
  // Replacing takes one picture; adding takes as many as there is room for.
  const placePictures = async (index: number, files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    const picked = index < slots.length ? images.slice(0, 1) : images.slice(0, SNAPREF_SIMPLE_MAX_REFERENCES - slots.length)
    if (isUploading || picked.length === 0) return
    setIsUploading(true)
    const uploaded: WorkflowInputAssetRef[] = []
    try {
      for (const file of picked) {
        setStatus(t({ ko: '{name} 업로드 중…', en: 'Uploading {name}…' }, { name: file.name }))
        uploaded.push(await uploadWorkflowInputAsset(file))
      }
      const previous = slots[index]?.picture
      writeSlots(index < slots.length
        ? slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, picture: uploaded[0] } : slot)
        : [...slots, ...uploaded.map((asset) => ({ picture: asset, strength: SNAPREF_SIMPLE_STRENGTH.default }))])
      setStatus(null)
      releasePicture(previous)
    } catch (error) {
      for (const asset of uploaded) void deleteWorkflowInputAsset(asset.id).catch(() => undefined)
      setStatus(error instanceof Error ? error.message : t({ ko: '사진 업로드에 실패했어.', en: 'Failed to upload the picture.' }))
    } finally {
      setIsUploading(false)
    }
  }

  /** Plain upload opens the file dialog; a field that allows browsing opens the in-app picker. */
  const pickPicture = (index: number) => {
    if (allowBrowse) { setPickerIndex(index); return }
    fileIndexRef.current = index
    if (fileInputRef.current) fileInputRef.current.multiple = index >= slots.length
    fileInputRef.current?.click()
  }

  const addDrop = useDropZoneState<HTMLButtonElement>({ onDropFiles: (files) => void placePictures(slots.length, files) })

  const removePicture = (index: number) => {
    writeSlots(slots.filter((_, slotIndex) => slotIndex !== index))
    releasePicture(slots[index]?.picture)
  }

  return (
    <fieldset disabled={isUploading} aria-busy={isUploading || undefined} className="min-w-0 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ ko: '모드', en: 'Mode' })} info={t({ ko: '캐릭터 + 스타일은 사진의 캐릭터와 그림체를 가져오고, 캐릭터만은 그림체를 모델과 프롬프트에 맡겨. 스타일만은 사진의 그림체만 가져오니까 캐릭터와 장면은 프롬프트에 쓰고, 스타일 브랜치가 있는 어댑터(snapref_v2s_pre 등)를 골라.', en: 'Character & Style takes the character and art style from the pictures; Character only leaves the style to the model and prompt. Style only takes just the art style, so write the character and scene in the prompt and choose an adapter with a style branch (e.g. snapref_v2s_pre).' })}>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Text variant="label">{t({ ko: '참조 사진', en: 'Reference pictures' })}</Text>
          <Text as="span" variant="caption" mono>{slots.length}/{SNAPREF_SIMPLE_MAX_REFERENCES}</Text>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))' }}>
          {slots.map((slot, index) => {
            const picture = describeSnapRefSimplePicture(slot.picture, comfyServerId)
            return (
              <SnapRefPictureTile
                key={index}
                index={index}
                name={picture.name}
                previewUrl={picture.previewUrl}
                strength={slot.strength}
                onStrengthCommit={(nextValue) => writeSlots(slots.map((entry, slotIndex) => slotIndex === index ? { ...entry, strength: Number(nextValue) } : entry))}
                onPick={() => pickPicture(index)}
                onDropFiles={(files) => void placePictures(index, files)}
                onRemove={index === 0 ? undefined : () => removePicture(index)}
              />
            )
          })}
          {slots.length < SNAPREF_SIMPLE_MAX_REFERENCES ? (
            <Panel asChild tone="lowest" padding="none" interactive treatment="drop" data-drag-active={addDrop.isDragActive}>
              <button
                type="button"
                aria-label={t({ ko: '참조 사진 추가', en: 'Add reference picture' })}
                title={t({ ko: '참조 사진 추가', en: 'Add reference picture' })}
                className="flex aspect-square w-full items-center justify-center self-start text-muted-foreground"
                onClick={() => pickPicture(slots.length)}
                onDrop={addDrop.handleDrop}
                onDragEnter={addDrop.handleDragEnter}
                onDragOver={addDrop.handleDragOver}
                onDragLeave={addDrop.handleDragLeave}
              >
                <Plus className="size-5" />
              </button>
            </Panel>
          ) : null}
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        void placePictures(fileIndexRef.current, files)
      }} />
      {allowBrowse ? (
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
            if (image && pickerIndex !== null) void placePictures(pickerIndex, [selectedImageToFile(image)])
          }}
        />
      ) : null}

      {status ? <Text variant="caption">{status}</Text> : null}
      {issues.length > 0 ? (
        <Text variant="caption" tone="destructive">
          {t({ ko: '실행 전에 확인해줘: {issues}', en: 'Check before running: {issues}' }, { issues: issues.join('; ') })}
        </Text>
      ) : null}
    </fieldset>
  )
}
