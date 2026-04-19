import type { ReactNode } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import type { WorkflowMarkedField } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FormField, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { TextSegmentSpreadsheetInput } from './text-segment-spreadsheet-input'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'

type WorkflowFieldInputProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  hideLabel?: boolean
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
}

type PowerLoraLoaderEntryValue = {
  on?: boolean
  lora?: string
  strength?: number
}

function isWorkflowTextSegmentValue(value: WorkflowFieldDraftValue): value is string | string[] {
  return typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
}

function isSelectedImageDraftValue(value: WorkflowFieldDraftValue): value is SelectedImageDraft {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'dataUrl' in value && 'fileName' in value
}

function isWorkflowNodeDraftValue(value: WorkflowFieldDraftValue): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isSelectedImageDraftValue(value)
}

function isPowerLoraLoaderEntryValue(value: unknown): value is PowerLoraLoaderEntryValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.lora === 'string'
    && typeof record.on === 'boolean'
    && typeof record.strength === 'number'
}

/** Render one compact switch-style toggle for the Power Lora row. */
function PowerLoraRowToggle({ pressed, onPressedChange }: { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={pressed ? '로라 사용 끄기' : '로라 사용 켜기'}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors',
        pressed
          ? 'border-primary/60 bg-primary/25 justify-end pl-1 pr-[3px]'
          : 'border-border/80 bg-background/70 justify-start pr-1 pl-[3px]',
      )}
    >
      <span
        className={cn(
          'h-4.5 w-4.5 rounded-full transition-colors',
          pressed ? 'bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.08)]' : 'bg-muted-foreground/65',
        )}
      />
    </button>
  )
}

/** Render a single marked-field editor for a ComfyUI workflow. */
export function WorkflowFieldInput({ field, value, hideLabel = false, onChange, onImageChange }: WorkflowFieldInputProps) {
  const fieldLabel = field.required ? `${field.label} *` : field.label
  const labelAccessory = field.description ? (
    <span
      className="inline-flex cursor-help text-muted-foreground"
      title={field.description}
      aria-label={`${field.label} 설명`}
    >
      <CircleQuestionMark className="h-3.5 w-3.5" />
    </span>
  ) : null

  const wrapField = (children: ReactNode) => {
    if (hideLabel) {
      return <div>{children}</div>
    }

    return (
      <FormField label={fieldLabel} labelAccessory={labelAccessory}>
        {children}
      </FormField>
    )
  }

  if (field.type === 'textarea') {
    return wrapField(
      <TextSegmentSpreadsheetInput
        tool="comfyui"
        value={isWorkflowTextSegmentValue(value) ? value : ''}
        placeholder={field.placeholder || ''}
        className="rounded-none border-x-0 border-y border-border/80"
        onChange={onChange}
      />,
    )
  }

  if (field.type === 'select') {
    return wrapField(
      <Select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">선택</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>,
    )
  }

  if (field.type === 'image') {
    const imageValue = isSelectedImageDraftValue(value) ? value : null

    return wrapField(
      <div className="space-y-3">
        <ImageAttachmentPickerButton label={imageValue ? '이미지 변경' : '이미지 선택'} modalTitle={field.label} allowSaveDialog={false} uploadOnly={field.simple_upload_only === true} onSelect={(image) => void onImageChange(image)} />
        {imageValue ? (
          <div className="theme-input-surface space-y-2 rounded-sm border border-border/80 p-3">
            <div className="text-xs text-muted-foreground">{imageValue.fileName}</div>
            <InlineMediaPreview
              src={imageValue.dataUrl}
              mimeType={imageValue.mimeType}
              fileName={imageValue.fileName}
              alt={field.label}
              frameClassName="p-3"
            />
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => void onImageChange()}>
                이미지 제거
              </Button>
            </div>
          </div>
        ) : null}
      </div>,
    )
  }

  if (field.type === 'node' && field.node_editor === 'power_lora_loader_rgthree') {
    const nodeValue: Record<string, unknown> = isWorkflowNodeDraftValue(value) ? value : {}
    const nodeItems = (field.node_items ?? []).filter((item) => isPowerLoraLoaderEntryValue(nodeValue[item.key]))

    return wrapField(
      <div className="space-y-2.5">
        {nodeItems.length > 0 ? (
          <div className="space-y-2">
            {nodeItems.map((item) => {
              const entry = nodeValue[item.key] as PowerLoraLoaderEntryValue
              return (
                <div
                  key={item.key}
                  className={cn(
                    'grid grid-cols-[auto_minmax(0,1fr)_88px] items-center gap-3 rounded-sm border px-3 py-2.5 transition-colors',
                    entry.on === true
                      ? 'border-primary/30 bg-surface-container/45'
                      : 'border-border/70 bg-background/30',
                  )}
                >
                  <PowerLoraRowToggle
                    pressed={entry.on === true}
                    onPressedChange={(pressed) => onChange({
                      ...nodeValue,
                      [item.key]: {
                        ...entry,
                        on: pressed,
                      },
                    })}
                  />

                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
                  </div>

                  <ScrubbableNumberInput
                    step={0.05}
                    value={typeof entry.strength === 'number' ? String(entry.strength) : ''}
                    aria-label={`${item.label} 가중치`}
                    className="h-8 w-[72px] px-2 text-left"
                    onChange={(nextValue) => {
                      const parsedStrength = Number(nextValue)
                      onChange({
                        ...nodeValue,
                        [item.key]: {
                          ...entry,
                          strength: Number.isFinite(parsedStrength) ? parsedStrength : (entry.strength ?? 1),
                        },
                      })
                    }}
                  />
                </div>
              )
            })}
          </div>
        ) : <div className="rounded-sm border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">노출할 lora_* 항목이 없어.</div>}
      </div>,
    )
  }

  if (field.type === 'text') {
    return wrapField(
      <WildcardInlinePickerField
        tool="comfyui"
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder || ''}
        onChange={onChange}
      />,
    )
  }

  if (field.type === 'number') {
    return wrapField(
      <ScrubbableNumberInput
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder || ''}
        onChange={onChange}
      />,
    )
  }

  return wrapField(
    <Input
      type="text"
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder || ''}
      onChange={(event) => onChange(event.target.value)}
    />,
  )
}
