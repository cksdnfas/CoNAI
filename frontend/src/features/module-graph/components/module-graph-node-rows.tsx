import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord, ModulePortDataType, ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import type { TypedFieldOption } from '@/features/shared-fields/typed-field-input'
import { getImageValueSrc } from '@/lib/library-image-ref'
import { cn } from '@/lib/utils'
import { formatModuleGraphDefaultOptionLabel } from './module-graph-simple-value-input'
import { getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import { buildInputSourceKey, useModuleGraphCanvasContext, useModuleGraphNodeActions } from './module-graph-canvas-context'
import { ModuleGraphPortHandle } from './module-graph-port-handle'
import { NodeNumberControl, NodeSelectControl, NodeSwitchControl, NodeTextControl, NodeWidgetContext, stopNodeEvent } from './module-graph-node-controls'
import { NodeOptionSourceSelect } from './module-graph-node-option-source'
import { getModuleOperationKey, normalizeModulePortDescription, type ModuleGraphConditionalOutputState, type ModuleGraphNode } from '../module-graph-shared'

type Translate = ReturnType<typeof useI18n>['t']

/** Keeps a block widget's connection point level with its name line instead of the block's middle. */
export const NODE_BLOCK_HANDLE_CLASS = 'top-[14px]!'

/** A block widget: the same fill as a pill, rounded to match, holding a name line and up to three lines of text. */
const NODE_BLOCK_CLASS = 'nodrag block h-auto w-full rounded-[13px] bg-surface-high px-3 pt-1 pb-1.5 text-left text-xs leading-normal font-normal tracking-normal whitespace-normal text-foreground transition-none hover:bg-surface-highest hover:text-foreground'

export function NodeRowDivider() {
  return <div className="my-1 h-px bg-line" aria-hidden />
}

/** Inputs that only ever arrive by link (media, anything): their point always shows, as in ComfyUI. */
const LINK_FIRST_TYPES = new Set<ModulePortDataType>(['image', 'mask', 'video', 'audio', 'any'])

export function isLinkFirstPortType(dataType: ModulePortDataType) {
  return LINK_FIRST_TYPES.has(dataType)
}

/**
 * ComfyUI marked fields are named "<node title>-<input>" so they stay apart in the workflow editor; inside the node
 * the title is noise, so the row shows just the input name (the tooltip keeps the full name).
 */
export function getNodePortDisplayLabel(module: ModuleDefinitionRecord, port: Pick<ModulePortDefinition, 'key' | 'label'>) {
  const markedFields = Array.isArray(module.template_defaults?.marked_fields) ? module.template_defaults.marked_fields as Array<Record<string, unknown>> : []
  const field = markedFields.find((candidate) => candidate?.id === port.key)
  // Older fields carry no source title: read it from the wrapped workflow node their path points at.
  const nodeId = typeof field?.source_node_id === 'string'
    ? field.source_node_id
    : typeof field?.jsonPath === 'string' ? /^([^.[\]]+)\.inputs(?:\.|$)/.exec(field.jsonPath)?.[1] : undefined
  const workflowJson = module.template_defaults?.workflow_json as Record<string, { _meta?: { title?: unknown } } | undefined> | undefined
  const title = field?.source_node_title ?? (nodeId ? workflowJson?.[nodeId]?._meta?.title : undefined)
  if (typeof title === 'string' && title && port.label.startsWith(`${title}-`) && port.label.length > title.length + 1) {
    return port.label.slice(title.length + 1)
  }
  return port.label
}

/** Port tooltip: name, type, whether it is required or takes several links, and its description. */
export function buildPortTooltip(t: Translate, port: ModulePortDefinition) {
  return [
    port.label,
    getModuleGraphPortTypeLabel(t, port.data_type),
    port.required ? t({ ko: '필수', en: 'Required' }) : null,
    port.multiple ? t({ ko: '여러 개 연결 가능', en: 'Takes several links' }) : null,
    normalizeModulePortDescription(port.description) || null,
  ].filter(Boolean).join('\n')
}

/** One output: name on the right, connection point on the right edge. */
export function NodeOutputRow({
  nodeId,
  port,
  outputState,
}: {
  nodeId: string
  port: ModulePortDefinition
  outputState?: ModuleGraphConditionalOutputState | null
}) {
  const { t } = useI18n()
  return (
    <div className={cn('relative flex min-h-7 items-center justify-end gap-2 pr-3 pl-6 text-xs', outputState === 'inactive' && 'opacity-55')}>
      {outputState ? (
        <span className={cn('rounded-sm px-1 text-2xs font-medium', outputState === 'active' ? 'bg-success-soft text-success-soft-foreground' : 'bg-surface-high text-muted-foreground')}>
          {outputState === 'active' ? t({ ko: '활성', en: 'Active' }) : t({ ko: '꺼짐', en: 'Off' })}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-medium text-foreground">{port.label}</span>
      <ModuleGraphPortHandle nodeId={nodeId} port={port} side="output" color={outputState === 'inactive' ? 'var(--muted-foreground)' : undefined} tooltip={buildPortTooltip(t, port)} />
    </div>
  )
}

function RowLabel({ label, labelTitle, required, missing, className }: { label: ReactNode; labelTitle?: string; required?: boolean; missing?: boolean; className?: string }) {
  return (
    <span title={labelTitle} className={cn('min-w-0 truncate', missing && 'text-warning', className)}>
      {label}
      {required ? <span className={cn('ml-0.5', missing ? 'text-warning' : 'text-muted-foreground/70')}>*</span> : null}
    </span>
  )
}

/**
 * One node row, ComfyUI style. A widget is a pill (name on the left, its control on the right) whose connection
 * point shows only on hover, while a fitting link is dragged, or once linked; a linked widget turns into an outline
 * that names its source. A link row is for inputs that only arrive by link: name and an always-visible point.
 */
export function NodeRow({
  label,
  labelTitle,
  required,
  missing,
  handle,
  children,
  below,
  className,
  variant = 'widget',
  linked = false,
}: {
  label: ReactNode
  labelTitle?: string
  required?: boolean
  missing?: boolean
  handle?: ReactNode
  children?: ReactNode
  below?: ReactNode
  className?: string
  variant?: 'widget' | 'link'
  /** A widget fed by a link: drawn as an outline, its control replaced by the source. */
  linked?: boolean
}) {
  if (variant === 'link') {
    return (
      <div className={cn('relative pr-4 pl-3', className)}>
        {handle}
        <div className="flex min-h-7 items-center gap-2 text-xs">
          <RowLabel label={label} labelTitle={labelTitle} required={required} missing={missing} className={cn('shrink', !missing && 'text-foreground')} />
          {children ? <span className="ml-auto flex min-w-0 max-w-[62%] flex-1 justify-end">{children}</span> : null}
        </div>
        {below}
      </div>
    )
  }

  return (
    <div className={cn('module-graph-widget-row relative px-2.5 py-0.5', className)}>
      {handle}
      <div className={cn('flex h-[26px] items-center gap-1.5 rounded-full pr-1.5 pl-3 text-xs', linked ? 'ring-1 ring-line ring-inset' : 'bg-surface-high')}>
        <RowLabel
          label={label}
          labelTitle={labelTitle}
          required={required}
          missing={missing}
          className={cn('flex-1', !missing && (linked ? 'text-muted-foreground/60' : 'text-muted-foreground'))}
        />
        {children ? (
          <span className="flex min-w-0 max-w-[64%] shrink-0 items-center justify-end">
            <NodeWidgetContext.Provider value>{children}</NodeWidgetContext.Provider>
          </span>
        ) : null}
      </div>
      {below}
    </div>
  )
}

/** "← source" in place of a linked input's control. */
export function NodeLinkedSource({ source }: { source?: string }) {
  const { t } = useI18n()
  return <span className="truncate pr-1 text-xs text-muted-foreground">← {source ?? t({ ko: '연결됨', en: 'Linked' })}</span>
}

/** A long value as a block widget: name on top, three lines of it below; clicking opens the panel editor. */
export function NodeWidgetBlock({
  nodeId,
  fieldKey,
  label,
  labelTitle,
  required,
  missing,
  handle,
  text,
  placeholder,
  className,
}: {
  nodeId: string
  fieldKey: string
  label: ReactNode
  labelTitle?: string
  required?: boolean
  missing?: boolean
  handle?: ReactNode
  text: string
  placeholder: string
  className?: string
}) {
  const actions = useModuleGraphNodeActions()
  const { t } = useI18n()
  return (
    <div className={cn('module-graph-widget-row relative px-2.5 py-0.5', className)}>
      {handle}
      <Button
        type="button"
        variant="subtle"
        title={t({ ko: '패널에서 고치기', en: 'Edit in the panel' })}
        onMouseDown={stopNodeEvent}
        onClick={(event) => {
          event.stopPropagation()
          actions.editInPanel(nodeId, fieldKey)
        }}
        className={NODE_BLOCK_CLASS}
      >
        <RowLabel label={label} labelTitle={labelTitle} required={required} missing={missing} className={cn('block text-2xs', !missing && 'text-muted-foreground')} />
        <span className={cn('line-clamp-3 break-words whitespace-pre-wrap', !text && 'text-muted-foreground/70')}>{text || placeholder}</span>
      </Button>
    </div>
  )
}

/** A long value shown as three lines inside the node; clicking opens the panel editor. */
export function NodeValuePreview({ nodeId, fieldKey, text, placeholder }: { nodeId: string; fieldKey: string; text: string; placeholder: string }) {
  const actions = useModuleGraphNodeActions()
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="subtle"
      title={t({ ko: '패널에서 고치기', en: 'Edit in the panel' })}
      onMouseDown={stopNodeEvent}
      onClick={(event) => {
        event.stopPropagation()
        actions.editInPanel(nodeId, fieldKey)
      }}
      className={cn(NODE_BLOCK_CLASS, 'mb-1.5 py-1.5')}
    >
      <span className={cn('line-clamp-3 break-words whitespace-pre-wrap', !text && 'text-muted-foreground/70')}>{text || placeholder}</span>
    </Button>
  )
}

/** An image value shown small inside the node; clicking opens the panel editor. */
export function NodeImagePreview({ nodeId, fieldKey, src, alt }: { nodeId: string; fieldKey: string; src: string; alt: string }) {
  const actions = useModuleGraphNodeActions()
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="subtle"
      title={t({ ko: '패널에서 고치기', en: 'Edit in the panel' })}
      onMouseDown={stopNodeEvent}
      onClick={(event) => {
        event.stopPropagation()
        actions.editInPanel(nodeId, fieldKey)
      }}
      className="nodrag mb-1.5 block h-auto w-full rounded-[5px] p-1 transition-none"
    >
      <img src={src} alt={alt} draggable={false} className="mx-auto max-h-24 w-auto rounded-[3px] object-contain" />
    </Button>
  )
}

/** A narrow node row has no room for a placeholder's trailing "(explanation)"; keep the example part. */
function getShortPlaceholder(placeholder: string | undefined) {
  return placeholder?.replace(/\s*\([^)]*\)\s*$/, '') || undefined
}

/** One-line preview of any stored value for compact node rows. */
export function getCompactValuePreview(value: unknown, t: Translate) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length > 0 ? t({ ko: '{count}개', en: '{count} items' }, { count: value.length }) : ''
  if (value && typeof value === 'object') return t({ ko: '설정됨', en: 'Set' })
  return ''
}

export type NodeInputEditorOverrides = {
  selectOptions?: TypedFieldOption[]
  numberMin?: number
  numberMax?: number
  numberStep?: number
  numberPlaceholder?: string
}

/** Numbers the LLM node treats specially: empty sampling values fall back to the profile's or the model's own. */
function getLlmNumberOverrides(t: Translate, nodeData: ModuleGraphNode['data'], portKey: string): NodeInputEditorOverrides {
  if (getModuleOperationKey(nodeData.module) !== 'system.call_llm') return {}
  if (portKey === 'temperature') return { numberStep: 0.1, numberMin: 0, numberPlaceholder: t({ ko: '기본', en: 'Default' }) }
  if (portKey === 'max_tokens') return { numberStep: 128, numberMin: 128, numberPlaceholder: t({ ko: '기본', en: 'Default' }) }
  return {}
}

export type NodeValueEditor = {
  /** A control that sits in the row (select, number, switch, short text, compact link). */
  inline: ReactNode
  /** Something shown under the row (an image preview). */
  below: ReactNode
  /** Long text: the row becomes a block widget showing three lines of it. */
  blockText: { text: string; placeholder: string } | null
}

/**
 * The in-node editor for one value: a select, number, switch or short text right in the row, three lines of long
 * text in a block widget, or a preview under the row for images (those open in the panel).
 */
export function useNodeValueEditor({
  nodeId,
  data,
  valueKey,
  dataType,
  uiField,
  defaultValue,
  label,
  required = false,
  overrides,
}: {
  nodeId: string
  data: ModuleGraphNode['data']
  valueKey: string
  dataType: string
  uiField: ModuleUiFieldDefinition | null | undefined
  defaultValue: unknown
  label: string
  required?: boolean
  overrides?: NodeInputEditorOverrides
}): NodeValueEditor {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const rawValue = data.inputValues?.[valueKey]
  const change = (value: unknown) => actions.changeValue(nodeId, valueKey, value)
  const llm = getLlmNumberOverrides(t, data, valueKey)
  const inline = (node: ReactNode): NodeValueEditor => ({ inline: node, below: null, blockText: null })

  if (uiField?.options_source) {
    return inline(
      <NodeOptionSourceSelect
        ariaLabel={label}
        source={uiField.options_source}
        value={rawValue}
        onChange={change}
        numeric={dataType === 'number' || uiField.data_type === 'number'}
        required={required}
        defaultValue={defaultValue}
      />,
    )
  }
  const options = overrides?.selectOptions?.length
    ? overrides.selectOptions
    : uiField?.data_type === 'select' && Array.isArray(uiField.options) && uiField.options.length > 0 ? uiField.options : null

  if (options) {
    // A list that spells out its own empty choice (e.g. "기본") names the empty option with it.
    const explicitEmpty = options.find((option) => typeof option !== 'string' && option.value === '')
    return inline(
      <NodeSelectControl
        ariaLabel={label}
        value={rawValue}
        options={options.filter((option) => (typeof option === 'string' ? option : option.value) !== '')}
        onChange={change}
        emptyLabel={explicitEmpty && typeof explicitEmpty !== 'string'
          ? explicitEmpty.label
          : hasMeaningfulValue(defaultValue) ? formatModuleGraphDefaultOptionLabel(t, defaultValue) : t({ ko: '선택', en: 'Select' })}
      />,
    )
  }

  if (dataType === 'number' || uiField?.data_type === 'number') {
    return inline(
      <NodeNumberControl
        ariaLabel={label}
        value={rawValue}
        onChange={change}
        placeholder={overrides?.numberPlaceholder ?? llm.numberPlaceholder ?? (hasMeaningfulValue(defaultValue) ? String(defaultValue) : undefined)}
        min={overrides?.numberMin ?? llm.numberMin ?? uiField?.min}
        max={overrides?.numberMax ?? uiField?.max}
        step={overrides?.numberStep ?? llm.numberStep}
      />,
    )
  }

  if (dataType === 'boolean' || uiField?.data_type === 'boolean') {
    const effective = rawValue ?? defaultValue
    return inline(<NodeSwitchControl ariaLabel={label} checked={effective === true || effective === 'true'} onChange={change} />)
  }

  const isInlineText = (dataType === 'text' && uiField?.ui_hint === 'inline') || (uiField?.data_type === 'text' && uiField.ui_hint === 'inline')
  if (isInlineText) {
    return inline(<NodeTextControl ariaLabel={label} value={rawValue} onChange={change} placeholder={getShortPlaceholder(uiField?.placeholder) || (typeof defaultValue === 'string' ? defaultValue : undefined)} />)
  }

  if (dataType === 'text' || dataType === 'prompt') {
    const text = typeof rawValue === 'string' ? rawValue : typeof defaultValue === 'string' ? defaultValue : ''
    return { inline: null, below: null, blockText: { text, placeholder: uiField?.placeholder || t({ ko: '비어 있음', en: 'Empty' }) } }
  }

  if (dataType === 'any') {
    return { inline: null, below: null, blockText: null }
  }

  const imageSrc = dataType === 'image' || dataType === 'mask' ? getImageValueSrc(rawValue ?? defaultValue) : null
  if (imageSrc) {
    return { inline: null, below: <NodeImagePreview nodeId={nodeId} fieldKey={valueKey} src={imageSrc} alt={label} />, blockText: null }
  }

  const preview = getCompactValuePreview(rawValue ?? defaultValue, t)
  return inline(
    <Button
      type="button"
      variant="link"
      onMouseDown={stopNodeEvent}
      onClick={(event) => {
        event.stopPropagation()
        actions.editInPanel(nodeId, valueKey)
      }}
      className="nodrag h-auto min-w-0 justify-end p-0 pr-1 text-xs font-normal text-muted-foreground transition-none hover:text-foreground"
    >
      <span className="truncate">{preview || t({ ko: '패널에서 설정', en: 'Set in panel' })}</span>
    </Button>,
  )
}

/**
 * One input port. Values that can be typed are widgets whose connection point appears on hover or drag; media and
 * "anything" inputs are link rows with the point always shown. A linked input names its source instead of a control.
 */
export function NodeInputRow({
  nodeId,
  data,
  port,
  uiField,
  connected,
  overrides,
  highlighted,
}: {
  nodeId: string
  data: ModuleGraphNode['data']
  port: ModulePortDefinition
  uiField?: ModuleUiFieldDefinition | null
  connected: boolean
  overrides?: NodeInputEditorOverrides
  highlighted?: boolean
}) {
  const { t } = useI18n()
  const { inputSources, liftedLink } = useModuleGraphCanvasContext()
  const defaultValue = port.default_value ?? uiField?.default_value
  const satisfied = connected || hasMeaningfulValue(data.inputValues?.[port.key]) || hasMeaningfulValue(defaultValue)
  const editor = useNodeValueEditor({
    nodeId,
    data,
    valueKey: port.key,
    dataType: port.data_type,
    uiField,
    defaultValue,
    label: port.label,
    required: port.required,
    overrides,
  })
  const isLifted = liftedLink?.targetNodeId === nodeId && liftedLink.targetPortKey === port.key
  const source = connected ? (isLifted ? liftedLink.sourceLabel : inputSources.get(buildInputSourceKey(nodeId, port.key))) : undefined
  const linkFirst = isLinkFirstPortType(port.data_type)
  const asBlock = !linkFirst && !connected && editor.blockText !== null
  const tooltip = buildPortTooltip(t, port)
  const rowProps = {
    label: getNodePortDisplayLabel(data.module, port),
    labelTitle: tooltip,
    required: port.required,
    missing: Boolean(port.required && !satisfied),
    className: highlighted ? 'bg-info/10' : undefined,
  }
  const handle = (
    <ModuleGraphPortHandle
      nodeId={nodeId}
      port={port}
      side="input"
      connected={connected}
      reveal={!linkFirst}
      tooltip={tooltip}
      className={asBlock ? NODE_BLOCK_HANDLE_CLASS : undefined}
    />
  )

  if (asBlock && editor.blockText) {
    return <NodeWidgetBlock {...rowProps} nodeId={nodeId} fieldKey={port.key} handle={handle} text={editor.blockText.text} placeholder={editor.blockText.placeholder} />
  }

  return (
    <NodeRow {...rowProps} variant={linkFirst ? 'link' : 'widget'} linked={connected} handle={handle} below={connected ? null : editor.below}>
      {connected ? <NodeLinkedSource source={source} /> : editor.inline}
    </NodeRow>
  )
}

/** A setting that is not a port (mode, pattern, separator…): a widget with no connection point. */
export function NodeFieldRow({
  nodeId,
  data,
  field,
  allowEmpty = true,
}: {
  nodeId: string
  data: ModuleGraphNode['data']
  field: ModuleUiFieldDefinition
  allowEmpty?: boolean
}) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const editor = useNodeValueEditor({
    nodeId,
    data,
    valueKey: field.key,
    dataType: field.data_type === 'select' ? 'text' : field.data_type,
    uiField: field.data_type === 'text' || field.data_type === 'prompt' ? { ...field, ui_hint: field.ui_hint ?? 'inline' } : field,
    defaultValue: field.default_value,
    label: field.label,
  })
  const isRequiredSelect = !allowEmpty && field.data_type === 'select' && !field.options_source
  const labelTitle = normalizeModulePortDescription(field.description) || field.label

  if (editor.blockText && !isRequiredSelect) {
    return <NodeWidgetBlock nodeId={nodeId} fieldKey={field.key} label={field.label} labelTitle={labelTitle} text={editor.blockText.text} placeholder={editor.blockText.placeholder} />
  }

  return (
    <NodeRow label={field.label} labelTitle={labelTitle} below={editor.below}>
      {isRequiredSelect ? (
        <NodeSelectControl
          ariaLabel={field.label}
          value={data.inputValues?.[field.key] ?? field.default_value}
          options={field.options}
          onChange={(value) => actions.changeValue(nodeId, field.key, value)}
        />
      ) : editor.inline}
      {!editor.inline && !isRequiredSelect && !editor.below ? <span className="pr-1 text-xs text-muted-foreground">{t({ ko: '패널에서 설정', en: 'Set in panel' })}</span> : null}
    </NodeRow>
  )
}
