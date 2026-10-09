import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Inset } from '@/components/ui/inset'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { TextSegmentSpreadsheetInput } from '@/features/image-generation/components/text-segment-spreadsheet-input'
import { WildcardInlinePickerField } from '@/features/image-generation/components/wildcard-inline-picker-field'
import type { PromptWildcardTool } from '@/features/image-generation/components/wildcard-inline-picker-helpers'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import { getImageValueSrc, isLibraryImageRef } from '@/lib/library-image-ref'
import { cn } from '@/lib/utils'
import type { PromptTypeFilter } from '@/types/prompt'

export type TypedFieldKind = 'text' | 'prompt' | 'json' | 'number' | 'boolean' | 'select' | 'image'

/** `disabled`: shown but not pickable (a value already saved on it still displays). */
export type TypedFieldOption = string | { value: string; label: string; disabled?: boolean }

/**
 * How the empty `""` option of a select/boolean behaves:
 * - `selectable`: a real choice (clears the value)
 * - `placeholder`: shown only until something is picked (disabled + hidden)
 * - `auto`: placeholder when the options contain the random pick, selectable otherwise
 * - `none`: no empty option at all
 */
export type TypedFieldEmptyOption = 'auto' | 'selectable' | 'placeholder' | 'none'

export type TypedFieldInputProps = {
  kind: TypedFieldKind
  value: unknown
  onChange: (value: unknown) => void
  /** `compact` shrinks single-line controls for node cards and port rows. */
  density?: 'default' | 'compact'
  placeholder?: string
  className?: string
  /** Mark the control invalid after a failed validation (aria-invalid). */
  invalid?: boolean
  /** Id of the inline validation message describing the control. */
  errorMessageId?: string
  /** Textarea rows for json / prompt / multi-line text. `text` with rows > 1 renders a textarea. */
  rows?: number
  /** prompt: wildcard scope for autocomplete and highlighting. */
  promptTool?: PromptWildcardTool
  /** prompt: multi-line (default), single line, or spreadsheet rows (emits `string[]`). */
  promptLayout?: 'multiline' | 'single' | 'segments'
  /** prompt: `plain` drops the wildcard editor (canvas cards, where caret-anchored popups drift under zoom). */
  promptEditor?: 'wildcard' | 'plain'
  autocompletePromptType?: PromptTypeFilter
  /** select options; the `__random__` value is labelled as the random pick. */
  options?: TypedFieldOption[]
  emptyLabel?: string
  emptyOption?: TypedFieldEmptyOption
  min?: number
  max?: number
  step?: number
  /** number: allow committing an empty value (default true). */
  allowEmpty?: boolean
  /** number: emit numbers (default) or the raw committed string. */
  numberFormat?: 'number' | 'string'
  /** image: receives the picked image, or `undefined` when removed. */
  onImageChange?: (image?: SelectedImageDraft) => Promise<void> | void
  imageModalTitle?: string
  /** image: upload-only picker that shows and removes the selection itself. */
  imageUploadOnly?: boolean
  /** image: show a remove button under the preview. */
  imageRemovable?: boolean
}

export const TYPED_FIELD_RANDOM_OPTION_VALUE = '__random__'

function resolveOption(option: TypedFieldOption) {
  return typeof option === 'string' ? { value: option, label: option } : option
}

function isSelectedImageDraft(value: unknown): value is SelectedImageDraft {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'dataUrl' in value && 'fileName' in value
}

function toSelectValue(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function toTextValue(value: unknown) {
  return typeof value === 'string' ? value : value ? String(value) : ''
}

function toMultilineTextValue(value: unknown) {
  return typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''
}

/** Render one value editor for a typed field; callers own the label, header and value-shape adapter. */
export function TypedFieldInput({
  kind,
  value,
  onChange,
  density = 'default',
  placeholder,
  className,
  invalid = false,
  errorMessageId,
  rows,
  promptTool = 'general',
  promptLayout = 'multiline',
  promptEditor = 'wildcard',
  autocompletePromptType,
  options,
  emptyLabel,
  emptyOption,
  min,
  max,
  step,
  allowEmpty = true,
  numberFormat = 'number',
  onImageChange,
  imageModalTitle,
  imageUploadOnly = false,
  imageRemovable = false,
}: TypedFieldInputProps) {
  const { t } = useI18n()
  const invalidProps = invalid ? { 'aria-invalid': true as const, 'aria-describedby': errorMessageId } : {}
  const controlClassName = cn(density === 'compact' && 'h-7 text-2xs', className)
  const resolvedEmptyLabel = emptyLabel ?? t({ ko: '선택', en: 'Select' })

  const renderEmptyOption = (mode: TypedFieldEmptyOption, hasRandomOption: boolean) => {
    if (mode === 'none') {
      return null
    }
    const hidden = mode === 'placeholder' || (mode === 'auto' && hasRandomOption)
    return <option value="" disabled={hidden} hidden={hidden}>{resolvedEmptyLabel}</option>
  }

  if (kind === 'select') {
    const resolvedOptions = (options ?? []).map(resolveOption)
    const hasRandomOption = resolvedOptions.some((option) => option.value === TYPED_FIELD_RANDOM_OPTION_VALUE)

    return (
      <Select value={toSelectValue(value)} onChange={(event) => onChange(event.target.value)} className={controlClassName} {...invalidProps}>
        {renderEmptyOption(emptyOption ?? 'auto', hasRandomOption)}
        {resolvedOptions.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.value === TYPED_FIELD_RANDOM_OPTION_VALUE && option.label === option.value ? t({ ko: '랜덤 선택', en: 'Random pick' }) : option.label}
          </option>
        ))}
      </Select>
    )
  }

  if (kind === 'boolean') {
    return (
      <Select
        value={typeof value === 'boolean' ? String(value) : ''}
        onChange={(event) => onChange(event.target.value === '' ? '' : event.target.value === 'true')}
        className={controlClassName}
        {...invalidProps}
      >
        {renderEmptyOption(emptyOption ?? 'selectable', false)}
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    )
  }

  if (kind === 'number') {
    return (
      <NumberStepperInput
        min={min}
        max={max}
        step={typeof step === 'number' ? step : 1}
        allowEmpty={allowEmpty}
        value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
        onValueCommit={(nextValue) => onChange(numberFormat === 'string' || nextValue === '' ? nextValue : Number(nextValue))}
        placeholder={placeholder}
        className={controlClassName}
        {...invalidProps}
      />
    )
  }

  if (kind === 'image') {
    const libraryImageSrc = isLibraryImageRef(value) ? getImageValueSrc(value) : null
    const imageDraft = isSelectedImageDraft(value)
      ? value
      : typeof value === 'string' && value.startsWith('data:')
        ? { dataUrl: value, fileName: '' }
        : libraryImageSrc ? { dataUrl: libraryImageSrc, fileName: '' } : null
    const hasImage = imageDraft !== null || (typeof value === 'string' && value.trim() !== '')

    return (
      <div className={cn('space-y-3', className)}>
        <ImageAttachmentPickerButton
          label={hasImage ? t({ ko: '이미지 변경', en: 'Change image' }) : t({ ko: '이미지 선택', en: 'Choose image' })}
          modalTitle={imageModalTitle}
          allowSaveDialog={false}
          uploadOnly={imageUploadOnly}
          selectedImage={imageUploadOnly ? imageDraft : null}
          onRemove={imageUploadOnly ? () => void onImageChange?.() : undefined}
          onSelect={(image) => void onImageChange?.(image)}
        />
        {imageDraft && !imageUploadOnly ? (
          <Inset className="space-y-2 p-3">
            {/* The file name lives in the preview's tooltip instead of a caption line. */}
            <Tip content={imageDraft.fileName || null}>
              <div>
                <InlineMediaPreview
                  src={imageDraft.dataUrl}
                  mimeType={imageDraft.mimeType}
                  fileName={imageDraft.fileName || undefined}
                  alt={imageModalTitle ?? ''}
                  frameClassName="p-3"
                />
              </div>
            </Tip>
            {imageRemovable ? (
              <div className="flex justify-end">
                <IconButton size="icon-sm" variant="ghost" onClick={() => void onImageChange?.()} label={t({ ko: '이미지 제거', en: 'Remove image' })}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            ) : null}
          </Inset>
        ) : null}
      </div>
    )
  }

  if (kind === 'prompt' && promptLayout === 'segments') {
    const segmentValue = typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')) ? value : ''
    return (
      <TextSegmentSpreadsheetInput
        tool={promptTool}
        value={segmentValue}
        placeholder={placeholder}
        autocompletePromptType={autocompletePromptType}
        invalid={invalid}
        errorMessageId={errorMessageId}
        className={className}
        onChange={onChange}
      />
    )
  }

  // Plain-text prompts get the wildcard editor; structured (non-string) values keep the raw textarea.
  if (kind === 'prompt' && promptEditor === 'wildcard' && (typeof value === 'string' || value == null)) {
    const isSingleLine = promptLayout === 'single'
    return (
      <WildcardInlinePickerField
        tool={promptTool}
        multiline={!isSingleLine}
        rows={rows}
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        autocompletePromptType={autocompletePromptType}
        invalid={invalid}
        errorMessageId={errorMessageId}
        className={isSingleLine ? controlClassName : className}
        onChange={onChange}
      />
    )
  }

  if (kind === 'prompt' || kind === 'json' || (kind === 'text' && (rows ?? 0) > 1)) {
    return (
      <Textarea
        rows={rows ?? (kind === 'json' ? 6 : 4)}
        value={toMultilineTextValue(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={className}
        {...invalidProps}
      />
    )
  }

  return (
    <Input
      value={toTextValue(value)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={controlClassName}
      {...invalidProps}
    />
  )
}
