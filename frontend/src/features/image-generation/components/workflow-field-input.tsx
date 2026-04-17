import type { ReactNode } from 'react'
import { CircleQuestionMark, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WorkflowMarkedField } from '@/lib/api'
import { FormField, type SelectedImageDraft, type WorkflowFieldDraftValue, type WorkflowTextDraftSegments } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'

type WorkflowFieldInputProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  hideLabel?: boolean
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
}

/** Normalize one textarea draft value into editable prompt segments. */
function getTextareaSegments(value: WorkflowFieldDraftValue): WorkflowTextDraftSegments {
  if (Array.isArray(value)) {
    return value.length > 0 ? value : ['']
  }

  if (typeof value === 'string') {
    return [value]
  }

  return ['']
}

/** Render one flatter spreadsheet-style textarea list and keep its draft as string segments. */
function WorkflowTextareaSegmentsInput({
  value,
  placeholder,
  onChange,
}: {
  value: WorkflowFieldDraftValue
  placeholder: string
  onChange: (value: WorkflowTextDraftSegments) => void
}) {
  const segments = getTextareaSegments(value)

  const handleSegmentChange = (index: number, nextValue: string) => {
    onChange(segments.map((segment, segmentIndex) => (segmentIndex === index ? nextValue : segment)))
  }

  const handleAddSegment = () => {
    onChange([...segments, ''])
  }

  const handleRemoveSegment = (index: number) => {
    if (segments.length === 1) {
      onChange([''])
      return
    }

    onChange(segments.filter((_, segmentIndex) => segmentIndex !== index))
  }

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden bg-surface-lowest/90">
        <div className="divide-y divide-border/70">
          {segments.map((segment, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-stretch bg-transparent">
              <div className="min-w-0">
                <WildcardInlinePickerField
                  tool="comfyui"
                  multiline
                  rows={4}
                  value={segment}
                  placeholder={placeholder}
                  className="!rounded-none !border-0 !bg-transparent px-3 py-2.5 focus:!border-0"
                  onChange={(nextValue) => handleSegmentChange(index, nextValue)}
                />
              </div>

              <div className="flex items-start justify-center border-l border-border/70 py-2.5">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => handleRemoveSegment(index)}
                  aria-label={`프롬프트 행 ${index + 1} 삭제`}
                  title="삭제"
                  className="mt-0.5"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end px-0 pb-0">
        <Button type="button" size="icon-sm" variant="outline" onClick={handleAddSegment} aria-label="프롬프트 행 추가" title="입력 행 추가">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
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
      <WorkflowTextareaSegmentsInput
        value={value}
        placeholder={field.placeholder || ''}
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
    const imageValue = typeof value === 'string' || Array.isArray(value) ? null : value

    return wrapField(
      <div className="space-y-3">
        <ImageAttachmentPickerButton label={imageValue ? '이미지 변경' : '이미지 선택'} modalTitle={field.label} allowSaveDialog={false} uploadOnly={field.simple_upload_only === true} onSelect={(image) => void onImageChange(image)} />
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
