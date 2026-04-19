import { useState, type DragEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsField, SettingsSection, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import type { WorkflowMarkedField } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from 'lucide-react'

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
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null)
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null)

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
            const isExpanded = expandedFieldIds.includes(field.id)

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
                    aria-label="드래그해서 순서 바꾸기"
                    title="드래그해서 순서 바꾸기"
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
                        <Badge variant="outline">{field.type}</Badge>
                        {field.required ? <Badge variant="outline">required</Badge> : null}
                        {field.default_collapsed ? <Badge variant="secondary">기본 접기</Badge> : null}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{field.jsonPath}</div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2">
                    <Button type="button" size="icon-sm" variant="outline" onClick={() => onFieldRemove(field.id)} aria-label="필드 제거" title="필드 제거">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="space-y-4 border-t border-border/70 bg-background/35 px-3 py-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <SettingsField label="라벨">
                        <Input variant="settings" value={field.label} onChange={(event) => onFieldPatch(field.id, { label: event.target.value })} />
                      </SettingsField>

                      <SettingsField label="타입">
                        <Select variant="settings" value={field.type} onChange={(event) => onFieldPatch(field.id, { type: event.target.value as WorkflowMarkedField['type'] })}>
                          <option value="text">text</option>
                          <option value="textarea">textarea</option>
                          <option value="number">number</option>
                          <option value="select">select</option>
                          <option value="image">image</option>
                        </Select>
                      </SettingsField>

                      <SettingsField label="설명" className="md:col-span-2">
                        <Input variant="settings" value={field.description ?? ''} onChange={(event) => onFieldPatch(field.id, { description: event.target.value })} />
                      </SettingsField>

                      <SettingsField label="Default" className="md:col-span-2">
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
                        생성 화면 기본 접기
                      </SettingsToggleRow>

                      {field.type === 'image' ? (
                        <SettingsToggleRow className="rounded-sm border border-border/70 bg-background px-3 py-2">
                          <input
                            type="checkbox"
                            checked={field.simple_upload_only === true}
                            onChange={(event) => onFieldPatch(field.id, { simple_upload_only: event.target.checked })}
                          />
                          심플 업로드 모드
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
                            placeholder="없음"
                          />
                        </SettingsField>

                        <SettingsField label="Max">
                          <Input
                            variant="settings"
                            type="number"
                            value={field.max ?? ''}
                            onChange={(event) => onFieldPatch(field.id, { max: parseOptionalNumberInput(event.target.value) })}
                            placeholder="없음"
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
                            <option value="">없음</option>
                            {dropdownListNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </Select>
                        </SettingsField>

                        <SettingsField label="직접 옵션">
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
        <div className="text-sm text-muted-foreground">아직 추가된 Marked Field가 없어.</div>
      )}
    </SettingsSection>
  )
}
