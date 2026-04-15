import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import type { WorkflowMarkedField } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

type ComfyWorkflowMarkedFieldsEditorProps = {
  markedFields: WorkflowMarkedField[]
  expandedFieldIds: string[]
  dropdownListNames: string[]
  listClassName?: string
  onFieldPatch: (fieldId: string, patch: Partial<WorkflowMarkedField>) => void
  onFieldRemove: (fieldId: string) => void
  onFieldExpandToggle: (fieldId: string) => void
}

/** Convert the comma-separated manual option input into workflow field options. */
function parseMarkedFieldOptions(rawValue: string) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
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
}: ComfyWorkflowMarkedFieldsEditorProps) {
  return (
    <section className="space-y-4 rounded-sm border border-border bg-surface-low p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-foreground">Marked Fields</div>
        <Badge variant="outline">{markedFields.length}</Badge>
      </div>

      {markedFields.length > 0 ? (
        <div className={cn('space-y-3 overflow-y-auto pr-1', listClassName ?? 'max-h-[620px]')}>
          {markedFields.map((field) => {
            const isExpanded = expandedFieldIds.includes(field.id)

            return (
              <div key={field.id} className="rounded-sm border border-border/70 bg-surface-container">
                <div className="flex items-start gap-2 px-3 py-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => onFieldExpandToggle(field.id)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
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
                  <div className="space-y-4 border-t border-border/70 bg-background/50 px-3 py-3">
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
                        ) : (
                          <Input
                            variant="settings"
                            type={field.type === 'number' ? 'number' : 'text'}
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
                    </div>

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
      ) : null}
    </section>
  )
}
