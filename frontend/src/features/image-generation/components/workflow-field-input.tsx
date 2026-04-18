import type { ReactNode } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WorkflowMarkedField } from '@/lib/api'
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

function isWorkflowTextSegmentValue(value: WorkflowFieldDraftValue): value is string | string[] {
  return typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
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
    const imageValue = isWorkflowTextSegmentValue(value) ? null : value

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

  return wrapField(
    <Input
      type={field.type === 'number' ? 'number' : 'text'}
      min={field.type === 'number' ? field.min : undefined}
      max={field.type === 'number' ? field.max : undefined}
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder || ''}
      onChange={(event) => onChange(event.target.value)}
    />,
  )
}
