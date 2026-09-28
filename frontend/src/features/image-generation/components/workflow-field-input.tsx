import type { ReactNode } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { TYPED_FIELD_RANDOM_OPTION_VALUE, TypedFieldInput } from '@/features/shared-fields/typed-field-input'
import { FormField, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { PowerLoraLoaderInput } from './power-lora-loader-input'
import { MiniMaxH3DirectorDasiwaInput } from './minimax-h3-director-dasiwa-input'
import { PathOptionTreeSelect } from './path-option-tree-select'
import { useI18n } from '@/i18n'

function shouldUsePathTreeSelect(options: string[]) {
  const pathLikeOptions = options.filter((option) => option !== TYPED_FIELD_RANDOM_OPTION_VALUE && /[\\/]/.test(option))
  return pathLikeOptions.length >= 2
}

type WorkflowFieldInputProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  hideLabel?: boolean
  loraOptions?: string[]
  isRefreshingOptions?: boolean
  onRefreshOptions?: () => Promise<void> | void
  /** Mark the editable control invalid after a failed generate validation. */
  invalid?: boolean
  /** Id of the inline validation message rendered next to the field. */
  errorMessageId?: string
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
export function WorkflowFieldInput({ field, value, hideLabel = false, loraOptions, isRefreshingOptions = false, onRefreshOptions, invalid = false, errorMessageId, onChange, onImageChange }: WorkflowFieldInputProps) {
  const { t } = useI18n()
  const fieldLabel = field.required ? `${field.label} *` : field.label
  const labelAccessory = field.description ? (
    <span
      className="inline-flex cursor-help text-muted-foreground"
      title={field.description}
      aria-label={t({ ko: '{label} 설명', en: '{label} description' }, { label: field.label })}
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

  const stringValue = typeof value === 'string' ? value : ''
  const commit = (nextValue: unknown) => onChange(nextValue as WorkflowFieldDraftValue)

  if (field.type === 'node' && (field.node_editor === 'power_lora_loader_rgthree' || field.node_editor === 'minimax_h3_director_dasiwa')) {
    const nodeValue: Record<string, unknown> = isWorkflowNodeDraftValue(value) ? value : {}

    return wrapField(field.node_editor === 'power_lora_loader_rgthree' ? (
      <PowerLoraLoaderInput
        field={field}
        value={nodeValue}
        loraOptions={loraOptions}
        isRefreshingLoraOptions={isRefreshingOptions}
        onRefreshLoraOptions={onRefreshOptions}
        useValueFallback={false}
        onChange={onChange}
      />
    ) : (
      <MiniMaxH3DirectorDasiwaInput
        value={nodeValue}
        visibleFields={field.node_visible_fields}
        hiddenControls={field.node_hidden_controls}
        numericBounds={field.node_numeric_bounds}
        onChange={onChange}
      />
    ))
  }

  if (field.type === 'select' && shouldUsePathTreeSelect(field.options ?? [])) {
    return wrapField(
      <PathOptionTreeSelect
        value={stringValue}
        options={field.options ?? []}
        modelPreviewFolder={field.model_preview_folder}
        refreshLabel={t({ ko: 'ComfyUI 자동수집 새로고침', en: 'Refresh ComfyUI options' })}
        isRefreshing={isRefreshingOptions}
        onRefresh={onRefreshOptions}
        onChange={onChange}
      />,
    )
  }

  const kind = field.type === 'textarea' || field.type === 'text'
    ? 'prompt'
    : field.type === 'select' || field.type === 'image' || field.type === 'number' ? field.type : 'text'

  return wrapField(
    <TypedFieldInput
      kind={kind}
      value={kind === 'image' ? (isSelectedImageDraftValue(value) ? value : null) : field.type === 'textarea' ? (isWorkflowTextSegmentValue(value) ? value : '') : stringValue}
      onChange={commit}
      placeholder={field.placeholder || ''}
      invalid={invalid}
      errorMessageId={errorMessageId}
      promptTool="comfyui"
      promptLayout={field.type === 'textarea' ? 'segments' : 'single'}
      options={field.options ?? []}
      emptyOption="placeholder"
      min={field.min}
      max={field.max}
      step={field.step ?? 1}
      allowEmpty={!field.required}
      numberFormat="string"
      imageModalTitle={field.label}
      imageUploadOnly={field.simple_upload_only === true}
      imageRemovable
      onImageChange={onImageChange}
    />,
  )
}
