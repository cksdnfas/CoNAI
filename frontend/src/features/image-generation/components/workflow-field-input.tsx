import { CircleQuestionMark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WorkflowMarkedField } from '@/lib/api'
import { FormField, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'

type WorkflowFieldInputProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
}

/** Render a single marked-field editor for a ComfyUI workflow. */
export function WorkflowFieldInput({ field, value, onChange, onImageChange }: WorkflowFieldInputProps) {
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

  if (field.type === 'textarea') {
    return (
      <FormField label={fieldLabel} labelAccessory={labelAccessory}>
        <WildcardInlinePickerField
          tool="comfyui"
          multiline
          rows={4}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder || ''}
          onChange={onChange}
        />
      </FormField>
    )
  }

  if (field.type === 'select') {
    return (
      <FormField label={fieldLabel} labelAccessory={labelAccessory}>
        <Select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">선택</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </FormField>
    )
  }

  if (field.type === 'image') {
    const imageValue = typeof value === 'string' ? null : value

    return (
      <FormField label={fieldLabel} labelAccessory={labelAccessory}>
        <div className="space-y-3">
          <ImageAttachmentPickerButton label={imageValue ? '이미지 변경' : '이미지 선택'} modalTitle={field.label} allowSaveDialog={false} onSelect={(image) => void onImageChange(image)} />
          {imageValue ? (
            <div className="space-y-2 rounded-sm bg-surface-low p-3">
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
        </div>
      </FormField>
    )
  }

  if (field.type === 'text') {
    return (
      <FormField label={fieldLabel} labelAccessory={labelAccessory}>
        <WildcardInlinePickerField
          tool="comfyui"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder || ''}
          onChange={onChange}
        />
      </FormField>
    )
  }

  return (
    <FormField label={fieldLabel} labelAccessory={labelAccessory}>
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        min={field.type === 'number' ? field.min : undefined}
        max={field.type === 'number' ? field.max : undefined}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder || ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  )
}
