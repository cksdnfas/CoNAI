import { useMemo, useState, type DragEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsField, SettingsSection, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import type { WorkflowMarkedField, WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from 'lucide-react'
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
  { key: 'ref_image_size', ko: '참조 이미지 크기', en: 'Reference image size' },
  { key: 'timeline_data', ko: '참조 미디어', en: 'Reference media' },
  { key: 'prompt', ko: '글로벌 프롬프트', en: 'Global prompt' },
]

const MINIMAX_H3_DIRECTOR_NUMERIC_BOUND_OPTIONS = [
  { key: 'width', ko: '너비', en: 'Width' },
  { key: 'height', ko: '높이', en: 'Height' },
  { key: 'duration', ko: '길이', en: 'Duration', min: 1, max: 60 },
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
}: ComfyWorkflowMarkedFieldsEditorProps) {
  const { t } = useI18n()
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null)
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null)
  const expandedFieldIdSet = useMemo(() => new Set(expandedFieldIds), [expandedFieldIds])

  const handleFieldDragStart = (fieldId: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', fieldId)
    setDraggedFieldId(fieldId)
    setDragOverFieldId(fieldId)
  }

  const handleFieldDragOver = (fieldId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (draggedFieldId == null || draggedFieldId === fieldId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverFieldId(fieldId)
  }

  const handleFieldDrop = (fieldId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (draggedFieldId != null && draggedFieldId !== fieldId) {
      onReorderMarkedField(draggedFieldId, fieldId)
    }
    setDraggedFieldId(null)
    setDragOverFieldId(null)
  }

  const handleFieldDragEnd = () => {
    setDraggedFieldId(null)
    setDragOverFieldId(null)
  }

  return (
    <SettingsSection heading="Marked Fields" actions={<Badge variant="outline">{markedFields.length}</Badge>}>
      {markedFields.length > 0 ? (
        <div className={cn('space-y-3 overflow-y-auto pr-1', listClassName ?? 'max-h-[620px]')}>
          {markedFields.map((field, index) => {
            const isExpanded = expandedFieldIdSet.has(field.id)

            return (
              <div
                key={field.id}
                onDragOver={handleFieldDragOver(field.id)}
                onDrop={handleFieldDrop(field.id)}
                className={dragOverFieldId === field.id && draggedFieldId !== field.id
                  ? 'rounded-sm border border-primary bg-surface-low/55 ring-1 ring-primary/35'
                  : 'rounded-sm border border-border/70 bg-surface-low/35'}
              >
                <div className="flex items-start gap-2 px-3 py-3">
                  <button
                    type="button"
                    draggable
                    onDragStart={handleFieldDragStart(field.id)}
                    onDragEnd={handleFieldDragEnd}
                    className="mt-0.5 inline-flex shrink-0 cursor-grab items-center justify-center rounded-sm border border-border/70 bg-background/60 p-1 text-muted-foreground hover:bg-surface-high hover:text-foreground"
                    aria-label={t('image-generation.components.comfy.workflow.marked.fields.editor.drag.to.reorder')}
                    title={t('image-generation.components.comfy.workflow.marked.fields.editor.drag.to.reorder')}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => onFieldExpandToggle(field.id)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                        <span className="truncate text-sm font-medium text-foreground">{field.label || field.id}</span>
                        <Badge variant="outline">{formatMarkedFieldTypeLabel(field)}</Badge>
                        {field.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
                        {field.default_collapsed ? <Badge variant="secondary">{t('image-generation.components.comfy.workflow.marked.fields.editor.collapsed.by.default')}</Badge> : null}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{field.jsonPath}</div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2">
                    <Button type="button" size="icon-sm" variant="outline" onClick={() => onFieldRemove(field.id)} aria-label={t('image-generation.components.comfy.workflow.marked.fields.editor.remove.field')} title={t('image-generation.components.comfy.workflow.marked.fields.editor.remove.field')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="space-y-4 border-t border-border/70 bg-background/35 px-3 py-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <SettingsField label={t('image-generation.components.comfy.workflow.marked.fields.editor.label')}>
                        <Input variant="settings" value={field.label} onChange={(event) => onFieldPatch(field.id, { label: event.target.value })} />
                      </SettingsField>

                      <SettingsField label={t('image-generation.components.comfy.workflow.marked.fields.editor.type')}>
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
                      </SettingsField>

                      <SettingsField label={t('image-generation.components.comfy.workflow.marked.fields.editor.description')} className="md:col-span-2">
                        <Input variant="settings" value={field.description ?? ''} onChange={(event) => onFieldPatch(field.id, { description: event.target.value })} />
                      </SettingsField>

                      <SettingsField label={field.type === 'node' ? 'Default (JSON)' : 'Default'} className="md:col-span-2">
                        {field.type === 'textarea' ? (
                          <Textarea
                            variant="settings"
                            rows={4}
                            value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                            onChange={(event) => onFieldPatch(field.id, { default_value: event.target.value })}
                          />
                        ) : field.type === 'number' ? (
                          <ScrubbableNumberInput
                            variant="settings"
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 1}
                            value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                            onChange={(value) => onFieldPatch(field.id, { default_value: value })}
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
                      </SettingsField>
                    </div>

                    {field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa' ? (
                      <div className="space-y-4">
                        <SettingsField label={t({ ko: '노출할 Director 필드', en: 'Visible Director fields' })}>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {MINIMAX_H3_DIRECTOR_VISIBLE_FIELD_OPTIONS.map((option) => {
                              const visibleFields = field.node_visible_fields ?? [...MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS]
                              const isVisible = visibleFields.includes(option.key)
                              return (
                                <SettingsToggleRow key={option.key} className="rounded-sm border border-border/70 bg-background px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={isVisible}
                                    onChange={(event) => {
                                      const nextVisibleFieldSet = new Set(visibleFields)
                                      if (event.target.checked) nextVisibleFieldSet.add(option.key)
                                      else nextVisibleFieldSet.delete(option.key)
                                      const nextVisibleFields = MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.filter((key) => nextVisibleFieldSet.has(key))
                                      onFieldPatch(field.id, {
                                        node_visible_fields: nextVisibleFields.length === MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.length
                                          ? undefined
                                          : [...nextVisibleFields],
                                      })
                                    }}
                                  />
                                  {t({ ko: option.ko, en: option.en })}
                                </SettingsToggleRow>
                              )
                            })}
                          </div>
                        </SettingsField>

                        <SettingsField label={t({ ko: 'Director 입력 범위', en: 'Director input ranges' })}>
                          <div className="grid gap-3 lg:grid-cols-3">
                            {MINIMAX_H3_DIRECTOR_NUMERIC_BOUND_OPTIONS.map((option) => (
                              <div key={option.key} className="space-y-2 rounded-sm border border-border/70 bg-background p-3">
                                <div className="text-xs font-medium text-foreground">{t({ ko: option.ko, en: option.en })}</div>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-1 text-xs text-muted-foreground">
                                    <span>{t({ ko: '최소', en: 'Min' })}</span>
                                    <Input
                                      variant="settings"
                                      type="number"
                                      step="any"
                                      min={'min' in option ? option.min : undefined}
                                      max={'max' in option ? option.max : undefined}
                                      value={field.node_numeric_bounds?.[option.key]?.min ?? ''}
                                      placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                                      onChange={(event) => onFieldPatch(field.id, {
                                        node_numeric_bounds: buildNodeNumericBounds(field, option.key, 'min', parseOptionalNumberInput(event.target.value)),
                                      })}
                                    />
                                  </label>
                                  <label className="space-y-1 text-xs text-muted-foreground">
                                    <span>{t({ ko: '최대', en: 'Max' })}</span>
                                    <Input
                                      variant="settings"
                                      type="number"
                                      step="any"
                                      min={'min' in option ? option.min : undefined}
                                      max={'max' in option ? option.max : undefined}
                                      value={field.node_numeric_bounds?.[option.key]?.max ?? ''}
                                      placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                                      onChange={(event) => onFieldPatch(field.id, {
                                        node_numeric_bounds: buildNodeNumericBounds(field, option.key, 'max', parseOptionalNumberInput(event.target.value)),
                                      })}
                                    />
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        </SettingsField>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-3">
                      <SettingsToggleRow className="rounded-sm border border-border/70 bg-background px-3 py-2">
                        <input
                          type="checkbox"
                          checked={field.required === true}
                          onChange={(event) => onFieldPatch(field.id, { required: event.target.checked })}
                        />
                        required
                      </SettingsToggleRow>

                      <SettingsToggleRow className="rounded-sm border border-border/70 bg-background px-3 py-2">
                        <input
                          type="checkbox"
                          checked={field.default_collapsed === true}
                          onChange={(event) => onFieldPatch(field.id, { default_collapsed: event.target.checked })}
                        />
                        {t('image-generation.components.comfy.workflow.marked.fields.editor.collapsed.on.generation.screen')}
                      </SettingsToggleRow>

                      {field.type === 'image' ? (
                        <SettingsToggleRow className="rounded-sm border border-border/70 bg-background px-3 py-2">
                          <input
                            type="checkbox"
                            checked={field.simple_upload_only === true}
                            onChange={(event) => onFieldPatch(field.id, { simple_upload_only: event.target.checked })}
                          />
                          {t('image-generation.components.comfy.workflow.marked.fields.editor.simple.upload.mode')}
                        </SettingsToggleRow>
                      ) : null}
                    </div>

                    {field.type === 'number' ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <SettingsField label="Min">
                          <Input
                            variant="settings"
                            type="number"
                            value={field.min ?? ''}
                            onChange={(event) => onFieldPatch(field.id, { min: parseOptionalNumberInput(event.target.value) })}
                            placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                          />
                        </SettingsField>

                        <SettingsField label="Max">
                          <Input
                            variant="settings"
                            type="number"
                            value={field.max ?? ''}
                            onChange={(event) => onFieldPatch(field.id, { max: parseOptionalNumberInput(event.target.value) })}
                            placeholder={t('image-generation.components.comfy.workflow.marked.fields.editor.none')}
                          />
                        </SettingsField>

                        <SettingsField label="Step">
                          <Input
                            variant="settings"
                            type="number"
                            min={0}
                            step="any"
                            value={field.step ?? ''}
                            onChange={(event) => onFieldPatch(field.id, { step: parseOptionalNumberInput(event.target.value) })}
                            placeholder="1"
                          />
                        </SettingsField>
                      </div>
                    ) : null}

                    {field.type === 'select' ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <SettingsField label="Dropdown List">
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
                        </SettingsField>

                        <SettingsField label={t('image-generation.components.comfy.workflow.marked.fields.editor.manual.options')}>
                          <Input
                            variant="settings"
                            value={(field.options ?? []).join(', ')}
                            onChange={(event) => onFieldPatch(field.id, { options: parseMarkedFieldOptions(event.target.value) })}
                            placeholder="option1, option2"
                          />
                        </SettingsField>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{t('image-generation.components.comfy.workflow.marked.fields.editor.no.marked.fields.have.been.added.yet')}</div>
      )}
    </SettingsSection>
  )
}
