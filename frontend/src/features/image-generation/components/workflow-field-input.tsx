import type { ReactNode } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { FormField, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { TextSegmentSpreadsheetInput } from './text-segment-spreadsheet-input'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { PowerLoraLoaderInput } from './power-lora-loader-input'
import { PathOptionTreeSelect } from './path-option-tree-select'

const DROPDOWN_RANDOM_OPTION_VALUE = '__random__'

function getSelectOptionLabel(option: string) {
  return option === DROPDOWN_RANDOM_OPTION_VALUE ? '랜덤 선택' : option
}

function shouldUsePathTreeSelect(options: string[]) {
  const pathLikeOptions = options.filter((option) => option !== DROPDOWN_RANDOM_OPTION_VALUE && /[\\/]/.test(option))
  return pathLikeOptions.length >= 2
}

type WorkflowFieldInputProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  hideLabel?: boolean
  loraOptions?: string[]
  isRefreshingOptions?: boolean
  onRefreshOptions?: () => Promise<void> | void
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
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

/** Render a single marked-field editor for a ComfyUI workflow. */
export function WorkflowFieldInput({ field, value, hideLabel = false, loraOptions, isRefreshingOptions = false, onRefreshOptions, onChange, onImageChange }: WorkflowFieldInputProps) {
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
    const options = field.options ?? []
    const stringValue = typeof value === 'string' ? value : ''

    if (shouldUsePathTreeSelect(options)) {
      return wrapField(
        <PathOptionTreeSelect
          value={stringValue}
          options={options}
          modelPreviewFolder={field.model_preview_folder}
          refreshLabel="ComfyUI 자동수집 새로고침"
          isRefreshing={isRefreshingOptions}
          onRefresh={onRefreshOptions}
          onChange={onChange}
        />,
      )
    }

    return wrapField(
      <Select value={stringValue} onChange={(event) => onChange(event.target.value)}>
        <option value="">선택</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {getSelectOptionLabel(option)}
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

    return wrapField(
      <PowerLoraLoaderInput
        field={field}
        value={nodeValue}
        loraOptions={loraOptions}
        isRefreshingLoraOptions={isRefreshingOptions}
        onRefreshLoraOptions={onRefreshOptions}
        useValueFallback={false}
        onChange={onChange}
      />,
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
