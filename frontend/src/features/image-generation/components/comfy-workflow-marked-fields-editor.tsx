import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Inset } from '@/components/ui/inset'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
import type { WorkflowMarkedField, WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { ChevronDown, GripVertical, Trash2 } from 'lucide-react'
import { groupWorkflowMarkedFieldsByNode } from '../workflow-marked-field-groups'
import {
  MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS,
  type MiniMaxH3DirectorVisibleField,
} from './minimax-h3-director-dasiwa-utils'

const MINIMAX_H3_DIRECTOR_VISIBLE_FIELD_OPTIONS: Array<{
  key: MiniMaxH3DirectorVisibleField
  ko: string
  en: string
}> = [
  { key: 'mode', ko: '실행 모드', en: 'Mode' },
  { key: 'width', ko: '너비', en: 'Width' },
  { key: 'height', ko: '높이', en: 'Height' },
  { key: 'duration', ko: '길이', en: 'Duration' },
  { key: 'frame_rate', ko: '프레임 레이트', en: 'Frame rate' },
  { key: 'ref_image_size', ko: '참조 이미지 크기', en: 'Reference image size' },
  { key: 'timeline_data', ko: '참조 미디어', en: 'Reference media' },
  { key: 'prompt', ko: '프롬프트 빌더', en: 'Prompt builder' },
]

const MINIMAX_H3_DIRECTOR_NUMERIC_BOUND_OPTIONS = [
  { key: 'resolution_mp', ko: '해상도 (MP)', en: 'Resolution (MP)', min: 0.01 },
  { key: 'width', ko: '너비 (px)', en: 'Width (px)', min: 32 },
  { key: 'height', ko: '높이 (px)', en: 'Height (px)', min: 32 },
  { key: 'duration', ko: '길이', en: 'Duration', min: 1, max: 60 },
  { key: 'frame_rate', ko: '프레임 레이트', en: 'Frame rate', min: 0.1, max: 240 },
] as const

const MINIMAX_H3_DIRECTOR_CONTROL_OPTIONS = [
  { key: 'resolution', ko: '출력 규격', en: 'Output dimensions' },
  { key: 'resolution.input_scaling', ko: '입력 스케일링', en: 'Input scaling' },
  { key: 'postprocess.simple', ko: '단순 2× 리사이즈', en: 'Simple 2× resize' },
  { key: 'postprocess.model', ko: '업스케일 모델 사용', en: 'Upscale model toggle' },
  { key: 'postprocess.model.model_name', ko: '업스케일 모델 선택', en: 'Upscale model selection' },
  { key: 'postprocess.rtx', ko: 'RTX Upscaler & Refiner', en: 'RTX Upscaler & Refiner' },
] as const

type ComfyWorkflowMarkedFieldsEditorProps = {
  markedFields: WorkflowMarkedField[]
  expandedFieldIds: string[]
  dropdownListNames: string[]
  listClassName?: string
  onFieldPatch: (fieldId: string, patch: Partial<WorkflowMarkedField>) => void
  onFieldRemove: (fieldId: string) => void
  onFieldExpandToggle: (fieldId: string) => void
  onReorderMarkedField: (sourceFieldId: string, targetFieldId: string) => void
  onReorderMarkedFieldGroup: (sourceGroupKey: string, targetGroupKey: string) => void
}

/** Convert the comma-separated manual option input into workflow field options. */
function parseMarkedFieldOptions(rawValue: string) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function parseOptionalNumberInput(rawValue: string) {
  const trimmed = rawValue.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Build one sparse node-bound map while removing cleared fields. */
function buildNodeNumericBounds(
  field: WorkflowMarkedField,
  fieldKey: string,
  boundKey: 'min' | 'max',
  value: number | undefined,
): WorkflowNodeNumericBounds | undefined {
  const nextBounds: WorkflowNodeNumericBounds = {
    ...field.node_numeric_bounds,
    [fieldKey]: {
      ...field.node_numeric_bounds?.[fieldKey],
      [boundKey]: value,
    },
  }

  if (value === undefined) {
    delete nextBounds[fieldKey][boundKey]
  }
  if (nextBounds[fieldKey].min === undefined && nextBounds[fieldKey].max === undefined) {
    delete nextBounds[fieldKey]
  }

  return Object.keys(nextBounds).length > 0 ? nextBounds : undefined
}

function formatMarkedFieldTypeLabel(field: WorkflowMarkedField) {
  if (field.type === 'node') {
    return 'Node'
  }

  return field.type
}

/** One labelled checkbox row; tonal hover instead of an outlined box. */
function CheckboxRow({ checked, onCheckedChange, children }: { checked: boolean, onCheckedChange: (checked: boolean) => void, children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-high">
      <Checkbox checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

/** Render the marked-field list and the strongly bounded field editing controls. */
export function ComfyWorkflowMarkedFieldsEditor({
  markedFields,
  expandedFieldIds,
  dropdownListNames,
  listClassName,
  onFieldPatch,
  onFieldRemove,
  onFieldExpandToggle,
  onReorderMarkedField,
  onReorderMarkedFieldGroup,
}: ComfyWorkflowMarkedFieldsEditorProps) {
  const { t } = useI18n()
  const [draggedGroupKey, setDraggedGroupKey] = useState<string | null>(null)
  const [dragOverGroupKey, setDragOverGroupKey] = useState<string | null>(null)
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null)
  const [draggedFieldGroupKey, setDraggedFieldGroupKey] = useState<string | null>(null)
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null)
  const expandedFieldIdSet = useMemo(() => new Set(expandedFieldIds), [expandedFieldIds])
  const markedFieldGroups = useMemo(() => groupWorkflowMarkedFieldsByNode(markedFields), [markedFields])
  const markedFieldIndexById = useMemo(
    () => new Map(markedFields.map((field, index) => [field.id, index])),
    [markedFields],
  )

  const handleGroupDragStart = (groupKey: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', groupKey)
    setDraggedGroupKey(groupKey)
    setDragOverGroupKey(groupKey)
  }

  const handleGroupDragOver = (groupKey: string) => (event: DragEvent<HTMLDivElement>) => {
    if (draggedGroupKey == null || draggedGroupKey === groupKey) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverGroupKey(groupKey)
  }

  const handleGroupDrop = (groupKey: string) => (event: DragEvent<HTMLDivElement>) => {
    if (draggedGroupKey == null) {
      return
    }

    event.preventDefault()
    if (draggedGroupKey !== groupKey) {
      onReorderMarkedFieldGroup(draggedGroupKey, groupKey)
    }
    setDraggedGroupKey(null)
    setDragOverGroupKey(null)
  }

  const handleFieldDragStart = (groupKey: string, fieldId: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', fieldId)
    setDraggedFieldId(fieldId)
    setDraggedFieldGroupKey(groupKey)
    setDragOverFieldId(fieldId)
  }

  const handleFieldDragOver = (groupKey: string, fieldId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (draggedFieldId == null || draggedFieldGroupKey !== groupKey || draggedFieldId === fieldId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragOverFieldId(fieldId)
  }

  const handleFieldDrop = (groupKey: string, fieldId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (draggedFieldGroupKey !== groupKey) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (draggedFieldId != null && draggedFieldId !== fieldId) {
      onReorderMarkedField(draggedFieldId, fieldId)
    }
    setDraggedFieldId(null)
    setDraggedFieldGroupKey(null)
    setDragOverFieldId(null)
  }

  const handleDragEnd = () => {
    setDraggedGroupKey(null)
    setDragOverGroupKey(null)
    setDraggedFieldId(null)
    setDraggedFieldGroupKey(null)
    setDragOverFieldId(null)
  }

  return (
    <Section variant="settings" heading="Marked Fields" actions={<Badge variant="outline">{markedFields.length}</Badge>}>
      {markedFields.length > 0 ? (
        <div className={cn('space-y-3 overflow-y-auto pr-1', listClassName ?? 'max-h-[620px]')}>
          {markedFieldGroups.map((group) => {
            const isMultiFieldGroup = group.fields.length > 1

            return (
              <Panel
                key={group.key}
                tone="lowest"
                padding="none"
                onDragOver={handleGroupDragOver(group.key)}
                onDrop={handleGroupDrop(group.key)}
                className={cn(
                  'overflow-hidden transition-colors',
                  dragOverGroupKey === group.key && draggedGroupKey !== group.key && 'bg-primary/8 ring-1 ring-inset ring-primary/45',
                )}
              >
                {isMultiFieldGroup ? (
                  <div className="flex items-start gap-3 px-3 py-3">
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      draggable
                      onDragStart={handleGroupDragStart(group.key)}
                      onDragEnd={handleDragEnd}
                      className="shrink-0 cursor-grab active:cursor-grabbing"
                      label={t('image-generation.components.comfy.workflow.marked.fields.editor.drag.group.to.reorder')}
                    >
                      <GripVertical />
                    </IconButton>
                    <div className="min-w-0 flex-1 pt-1">
                      <Text as="div" variant="title" className="truncate">{group.nodeTitle}</Text>
                      {group.nodeId ? <div className="mt-0.5 text-2xs text-muted-foreground">{t('image-generation.components.workflow.field.group.node.id', { id: group.nodeId })}</div> : null}
                    </div>
                    <Badge variant="outline">{t('image-generation.components.workflow.field.group.field.count', { count: group.fields.length })}</Badge>
                  </div>
                ) : null}

                <div className={isMultiFieldGroup ? 'divide-y divide-outline-subtle' : undefined}>
                  {group.fields.map((field) => {
                    const index = markedFieldIndexById.get(field.id) ?? 0
                    const isExpanded = expandedFieldIdSet.has(field.id)

                    return (
                      <div
                        key={field.id}
                        onDragOver={isMultiFieldGroup ? handleFieldDragOver(group.key, field.id) : undefined}
                        onDrop={isMultiFieldGroup ? handleFieldDrop(group.key, field.id) : undefined}
                        className={isMultiFieldGroup && dragOverFieldId === field.id && draggedFieldId !== field.id
                          ? 'bg-primary/8 ring-1 ring-inset ring-primary/45'
                          : undefined}
                      >
                <div className="flex items-start gap-2 px-3 py-3">
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    draggable
                    onDragStart={isMultiFieldGroup ? handleFieldDragStart(group.key, field.id) : handleGroupDragStart(group.key)}
                    onDragEnd={handleDragEnd}
                    className="shrink-0 cursor-grab active:cursor-grabbing"
                    label={t('image-generation.components.comfy.workflow.marked.fields.editor.drag.to.reorder')}
                  >
                    <GripVertical />
                  </IconButton>

                  <Button
                    type="button"
                    variant="nav"
                    className="h-auto min-w-0 flex-1 items-start gap-3 px-2 py-1.5 whitespace-normal text-foreground"
                    onClick={() => onFieldExpandToggle(field.id)}
                    aria-expanded={isExpanded}
                  >
                    <ChevronDown className={cn('mt-0.5 text-muted-foreground transition-transform', !isExpanded && '-rotate-90')} aria-hidden />
                    <span className="min-w-0 space-y-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                        <span className="truncate text-sm font-medium text-foreground">{field.label || field.id}</span>
                        <Badge variant="outline">{formatMarkedFieldTypeLabel(field)}</Badge>
                        {field.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
                        {field.default_collapsed ? <Badge variant="secondary">{t('image-generation.components.comfy.workflow.marked.fields.editor.collapsed.by.default')}</Badge> : null}
                      </span>
                      <span className="block truncate font-mono text-2xs text-muted-foreground">{field.jsonPath}</span>
                    </span>
                  </Button>

                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 hover:text-destructive"
                    onClick={() => onFieldRemove(field.id)}
                    label={t('image-generation.components.comfy.workflow.marked.fields.editor.remove.field')}
                  >
                    <Trash2 />
                  </IconButton>
                </div>

                {isExpanded ? (
                  <div className="space-y-4 px-3 pt-1 pb-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label={t('image-generation.components.comfy.workflow.marked.fields.editor.label')}>
                        <Input variant="settings" value={field.label} onChange={(event) => onFieldPatch(field.id, { label: event.target.value })} />
                      </Field>

                      <Field label={t('image-generation.components.comfy.workflow.marked.fields.editor.type')}>
                        <Select
                          variant="settings"
                          value={field.type}
                          disabled={field.type === 'node'}
                          onChange={(event) => onFieldPatch(field.id, { type: event.target.value as WorkflowMarkedField['type'] })}
                        >
                          <option value="text">text</option>
                          <option value="textarea">textarea</option>
                          <option value="number">number</option>
                          <option value="select">select</option>
                          <option value="image">image</option>
                          <option value="node">Node</option>
                        </Select>
                      </Field>

                      <Field label={t('image-generation.components.comfy.workflow.marked.fields.editor.description')} className="md:col-span-2">
                        <Input variant="settings" value={field.description ?? ''} onChange={(event) => onFieldPatch(field.id, { description: event.target.value })} />
                      </Field>

                      <Field label={field.type === 'node' ? 'Default (JSON)' : 'Default'} className="md:col-span-2">
                        {field.type === 'textarea' ? (
                          <Textarea
                            variant="settings"
                            rows={4}
                            value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                            onChange={(event) => onFieldPatch(field.id, { default_value: event.target.value })}
                          />
                        ) : field.type === 'number' ? (
                          <NumberStepperInput
                            variant="settings"
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 1}
                            allowEmpty
                            value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                            onValueCommit={(value) => onFieldPatch(field.id, { default_value: value })}
                          />
                        ) : field.type === 'node' ? (
                          <Textarea
                            variant="settings"
                            rows={8}
                            readOnly
                            value={field.default_value && typeof field.default_value === 'object'
                              ? JSON.stringify(field.default_value, null, 2)
                              : ''}
                          />
                        ) : (
                          <Input
                            variant="settings"
                            type="text"
                            value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                            onChange={(event) => onFieldPatch(field.id, { default_value: event.target.value })}
                          />
                        )}
                      </Field>
                    </div>

                    {field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa' ? (
                      <div className="space-y-4">
                        <Field label={t({ ko: '노출할 Director 필드', en: 'Visible Director fields' })}>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {MINIMAX_H3_DIRECTOR_VISIBLE_FIELD_OPTIONS.map((option) => {
                              const visibleFields = field.node_visible_fields ?? [...MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS]
                              const isVisible = visibleFields.includes(option.key)
                              return (
                                <CheckboxRow
                                  key={option.key}
                                  checked={isVisible}
                                  onCheckedChange={(checked) => {
                                      const nextVisibleFieldSet = new Set(visibleFields)
                                      if (checked) nextVisibleFieldSet.add(option.key)
                                      else nextVisibleFieldSet.delete(option.key)
                                      const nextVisibleFields = MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.filter((key) => nextVisibleFieldSet.has(key))
                                      onFieldPatch(field.id, {
                                        node_visible_fields: nextVisibleFields.length === MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.length
                                          ? undefined
                                          : [...nextVisibleFields],
                                      })
                                    }}
                                >
                                  {t({ ko: option.ko, en: option.en })}
                                </CheckboxRow>
                              )
                            })}
                          </div>
                        </Field>

                        <Field label={t({ ko: '출력·업스케일 표시', en: 'Output and upscale controls' })}>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {MINIMAX_H3_DIRECTOR_CONTROL_OPTIONS.map((option) => (
                              <CheckboxRow
                                key={option.key}
                                checked={!field.node_hidden_controls?.includes(option.key)}
                                onCheckedChange={(checked) => {
                                  const hiddenControls = new Set(field.node_hidden_controls ?? [])
                                  if (checked) hiddenControls.delete(option.key)
                                  else hiddenControls.add(option.key)
                                  onFieldPatch(field.id, { node_hidden_controls: hiddenControls.size ? [...hiddenControls] : undefined })
                                }}
                              >
                                {t({ ko: option.ko, en: option.en })}
                              </CheckboxRow>
                            ))}
                          </div>
                        </Field>

                        <Field label={t({ ko: 'Director 입력 범위', en: 'Director input ranges' })}>
                          <div className="grid gap-3 lg:grid-cols-3">
                            {MINIMAX_H3_DIRECTOR_NUMERIC_BOUND_OPTIONS.map((option) => (
                              <Inset key={option.key} className="space-y-2 px-3">
                                <Text variant="label" className="text-xs">{t({ ko: option.ko, en: option.en })}</Text>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-1 text-xs text-muted-foreground">
                                    <span>{t({ ko: '최소', en: 'Min' })}</span>
                                    <NumberStepperInput
                                      variant="settings"

                                      step="any"
                                      allowEmpty
                                      min={'min' in option ? option.min : undefined}
                                      max={'max' in option ? option.max : undefined}
                                      value={field.node_numeric_bounds?.[option.key]?.min ?? ''}
                                      placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                                      onValueCommit={(nextValue) => onFieldPatch(field.id, {
                                        node_numeric_bounds: buildNodeNumericBounds(field, option.key, 'min', parseOptionalNumberInput(nextValue)),
                                      })}
                                    />
                                  </label>
                                  <label className="space-y-1 text-xs text-muted-foreground">
                                    <span>{t({ ko: '최대', en: 'Max' })}</span>
                                    <NumberStepperInput
                                      variant="settings"

                                      step="any"
                                      allowEmpty
                                      min={'min' in option ? option.min : undefined}
                                      max={'max' in option ? option.max : undefined}
                                      value={field.node_numeric_bounds?.[option.key]?.max ?? ''}
                                      placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                                      onValueCommit={(nextValue) => onFieldPatch(field.id, {
                                        node_numeric_bounds: buildNodeNumericBounds(field, option.key, 'max', parseOptionalNumberInput(nextValue)),
                                      })}
                                    />
                                  </label>
                                </div>
                              </Inset>
                            ))}
                          </div>
                        </Field>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <CheckboxRow checked={field.required === true} onCheckedChange={(checked) => onFieldPatch(field.id, { required: checked })}>
                        required
                      </CheckboxRow>

                      <CheckboxRow checked={field.default_collapsed === true} onCheckedChange={(checked) => onFieldPatch(field.id, { default_collapsed: checked })}>
                        {t('image-generation.components.comfy.workflow.marked.fields.editor.collapsed.on.generation.screen')}
                      </CheckboxRow>

                      {field.type === 'image' ? (
                        <CheckboxRow checked={field.simple_upload_only === true} onCheckedChange={(checked) => onFieldPatch(field.id, { simple_upload_only: checked })}>
                          {t('image-generation.components.comfy.workflow.marked.fields.editor.simple.upload.mode')}
                        </CheckboxRow>
                      ) : null}
                    </div>

                    {field.type === 'number' ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Min">
                          <NumberStepperInput
                            variant="settings"
                            allowEmpty

                            value={field.min ?? ''}
                            onValueCommit={(nextValue) => onFieldPatch(field.id, { min: parseOptionalNumberInput(nextValue) })}
                            placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                          />
                        </Field>

                        <Field label="Max">
                          <NumberStepperInput
                            variant="settings"
                            allowEmpty

                            value={field.max ?? ''}
                            onValueCommit={(nextValue) => onFieldPatch(field.id, { max: parseOptionalNumberInput(nextValue) })}
                            placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                          />
                        </Field>

                        <Field label="Step">
                          <NumberStepperInput
                            variant="settings"
                            allowEmpty

                            min={0}
                            step="any"
                            value={field.step ?? ''}
                            onValueCommit={(nextValue) => onFieldPatch(field.id, { step: parseOptionalNumberInput(nextValue) })}
                            placeholder="1"
                          />
                        </Field>
                      </div>
                    ) : null}

                    {field.type === 'select' ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Dropdown List">
                          <Select
                            variant="settings"
                            value={field.dropdown_list_name ?? ''}
                            onChange={(event) => onFieldPatch(field.id, { dropdown_list_name: event.target.value || undefined })}
                          >
                            <option value="">{t('image-generation.components.comfy.workflow.marked.fields.editor.none')}</option>
                            {dropdownListNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </Select>
                        </Field>

                        <Field label={t('image-generation.components.comfy.workflow.marked.fields.editor.manual.options')}>
                          <Input
                            variant="settings"
                            value={(field.options ?? []).join(', ')}
                            onChange={(event) => onFieldPatch(field.id, { options: parseMarkedFieldOptions(event.target.value) })}
                            placeholder="option1, option2"
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                      </div>
                    )
                  })}
                </div>
              </Panel>
            )
          })}
        </div>
      ) : (
        <Text variant="muted">{t('image-generation.components.comfy.workflow.marked.fields.editor.no.marked.fields.have.been.added.yet')}</Text>
      )}
    </Section>
  )
}
