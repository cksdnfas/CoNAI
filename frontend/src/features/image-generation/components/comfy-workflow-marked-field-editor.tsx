import { useMemo, useState, type ReactNode } from 'react'
import { Import, LocateFixed, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { CustomDropdownList, WorkflowMarkedField, WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import {
  canHideWorkflowField,
  findWorkflowFieldChoice,
  isHiddenWorkflowField,
  partitionDropdownListsByValue,
  resolveWorkflowMarkedField,
  workflowFieldChoices,
} from '../workflow-field-choices'
import { addMarkedFieldOption, addMarkedFieldOptionLines } from './comfy-workflow-marked-field-utils'
import { shouldUsePathTreeSelect, WorkflowFieldInput } from './workflow-field-input'
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
  { key: 'refmods', ko: 'RefMod', en: 'RefMod' },
] as const

const FIELD_TYPE_OPTIONS: Array<{ value: WorkflowMarkedField['type'], ko: string, en: string }> = [
  { value: 'text', ko: '텍스트', en: 'Text' },
  { value: 'textarea', ko: '텍스트 영역', en: 'Text area' },
  { value: 'number', ko: '숫자', en: 'Number' },
  { value: 'select', ko: '선택', en: 'Select' },
  { value: 'image', ko: '이미지', en: 'Image' },
  { value: 'audio', ko: '오디오', en: 'Audio' },
  { value: 'video', ko: '비디오', en: 'Video' },
  { value: 'node', ko: '노드', en: 'Node' },
]

/** Readable name of a marked field type, shared by the field list. */
export function useMarkedFieldTypeLabel() {
  const { t } = useI18n()
  return (type: WorkflowMarkedField['type']) => {
    const option = FIELD_TYPE_OPTIONS.find((item) => item.value === type)
    return option ? t({ ko: option.ko, en: option.en }) : type
  }
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

function stringifyDefaultValue(value: WorkflowMarkedField['default_value']) {
  return value === undefined || value === null ? '' : String(value)
}

/** One labelled checkbox row; tonal hover instead of an outlined box. */
function CheckboxRow({ checked, onCheckedChange, children }: { checked: boolean, onCheckedChange: (checked: boolean) => void, children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-fill">
      <Checkbox checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

/** Warning icon with its reason in a tooltip, as the field list marks an input the workflow lost. */
function WarningMarker({ label }: { label: string }) {
  return (
    <Tip content={label}>
      <span role="img" aria-label={label} className="shrink-0 text-warning">
        <TriangleAlert className="size-3.5" />
      </span>
    </Tip>
  )
}

/**
 * Select options as removable chips; Enter adds the typed value as one option, commas included, and a multi-line paste
 * adds one option per line. `importChoices`: the node's choices on the ComfyUI server, offered as a replacement.
 */
function MarkedFieldOptionsEditor({ options, importChoices, onChange }: { options: string[], importChoices?: string[], onChange: (options: string[] | undefined) => void }) {
  const { t } = useI18n()
  const [draftOption, setDraftOption] = useState('')
  const importsNothing = importChoices !== undefined && importChoices.length === options.length && importChoices.every((choice, index) => choice === options[index])
  const commitDraftOption = () => {
    const nextOptions = addMarkedFieldOption(options, draftOption)
    if (nextOptions.length !== options.length) onChange(nextOptions)
    setDraftOption('')
  }

  return (
    <div className="space-y-2">
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <span key={option} className="inline-flex max-w-full items-center gap-1 rounded-sm bg-fill py-0.5 pr-0.5 pl-2 text-xs text-foreground">
              <span className="truncate">{option}</span>
              <IconButton
                size="icon-xs"
                variant="ghost"
                label={t({ ko: '{option} 빼기', en: 'Remove {option}' }, { option })}
                onClick={() => {
                  const nextOptions = options.filter((item) => item !== option)
                  onChange(nextOptions.length > 0 ? nextOptions : undefined)
                }}
              >
                <X />
              </IconButton>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <Input
          variant="settings"
          className="min-w-0 flex-1"
          value={draftOption}
          onChange={(event) => setDraftOption(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            commitDraftOption()
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text')
            if (!/[\r\n]/.test(pasted)) return
            event.preventDefault()
            const nextOptions = addMarkedFieldOptionLines(options, pasted)
            if (nextOptions.length !== options.length) onChange(nextOptions)
          }}
          onBlur={() => { if (draftOption.trim()) commitDraftOption() }}
          placeholder={t({ ko: '옵션 입력 후 Enter', en: 'Type an option, then Enter' })}
        />
        {importChoices && importChoices.length > 0 ? (
          <IconButton
            variant="ghost"
            disabled={importsNothing}
            onClick={() => onChange([...importChoices])}
            label={t({ ko: 'ComfyUI에서 옵션 가져오기', en: 'Get options from ComfyUI' })}
          >
            <Import />
          </IconButton>
        ) : null}
      </div>
    </div>
  )
}

type ComfyWorkflowMarkedFieldEditorProps = {
  field: WorkflowMarkedField
  dropdownLists: CustomDropdownList[]
  /** The node's choices for this input on the ComfyUI server (the editor's server check); absent when unknown. */
  inputChoices?: string[]
  canLocate: boolean
  onPatch: (patch: Partial<WorkflowMarkedField>) => void
  onRemove: () => void
  onLocate: () => void
}

/** Edit the one marked field selected in the field panel. */
export function ComfyWorkflowMarkedFieldEditor({ field, dropdownLists, inputChoices, canLocate, onPatch, onRemove, onLocate }: ComfyWorkflowMarkedFieldEditorProps) {
  const { t } = useI18n()
  const noneLabel = t({ ko: '없음', en: 'None' })
  const isDirectorNode = field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa'
  const isHidden = isHiddenWorkflowField(field)
  const defaultLabel = isHidden ? t({ ko: '고정값', en: 'Fixed value' }) : t({ ko: '기본값', en: 'Default' })
  const dropdownListByName = useMemo(() => new Map(dropdownLists.map((list) => [list.name, list])), [dropdownLists])
  // The default is picked from what the generation form offers for this field (its dropdown list, else its options).
  const resolvedField = resolveWorkflowMarkedField(field, dropdownListByName)
  const defaultChoices = field.type === 'select' ? workflowFieldChoices(resolvedField) : []
  const defaultText = stringifyDefaultValue(field.default_value)
  const matchedDefault = findWorkflowFieldChoice(defaultChoices, field.default_value)
  // A stored value the choices no longer hold stays as it is and is marked; a plain select shows it as an extra entry.
  const isStaleDefault = defaultChoices.length > 0 && defaultText.length > 0 && matchedDefault === null
  const defaultControlField: WorkflowMarkedField = {
    ...resolvedField,
    options: isStaleDefault && !shouldUsePathTreeSelect(defaultChoices) ? [...defaultChoices, defaultText] : defaultChoices,
  }
  const missingListName = field.type === 'select' && field.dropdown_list_name && !dropdownListByName.has(field.dropdown_list_name) ? field.dropdown_list_name : null
  const listGroups = partitionDropdownListsByValue(dropdownLists, field.default_value)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{field.label || field.id}</div>
          <div className="truncate font-mono text-2xs text-muted-foreground">{field.jsonPath}</div>
        </div>
        <IconButton size="icon-sm" variant="ghost" disabled={!canLocate} onClick={onLocate} label={t({ ko: '그래프에서 보기', en: 'Show in graph' })}>
          <LocateFixed />
        </IconButton>
        <Button size="sm" variant="destructive-ghost" onClick={onRemove} aria-label={t({ ko: '필드 삭제', en: 'Remove field' })}>
          {t({ ko: '삭제', en: 'Delete' })}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ ko: '라벨', en: 'Label' })}>
          <Input variant="settings" value={field.label} onChange={(event) => onPatch({ label: event.target.value })} />
        </Field>
        <Field label={t({ ko: '타입', en: 'Type' })}>
          <Select
            variant="settings"
            value={field.type}
            disabled={field.type === 'node'}
            onChange={(event) => onPatch({ type: event.target.value as WorkflowMarkedField['type'] })}
          >
            {FIELD_TYPE_OPTIONS.filter((option) => option.value !== 'node' || field.type === 'node').map((option) => (
              <option key={option.value} value={option.value}>{t({ ko: option.ko, en: option.en })}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t({ ko: '설명', en: 'Description' })}>
        <Input variant="settings" value={field.description ?? ''} onChange={(event) => onPatch({ description: event.target.value })} />
      </Field>

      {field.type === 'number' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={defaultLabel}>
            <NumberStepperInput
              variant="settings"
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              allowEmpty
              value={stringifyDefaultValue(field.default_value)}
              onValueCommit={(value) => onPatch({ default_value: value })}
            />
          </Field>
          <Field label={t({ ko: '단계', en: 'Step' })}>
            <NumberStepperInput
              variant="settings"
              allowEmpty
              min={0}
              step="any"
              value={field.step ?? ''}
              onValueCommit={(nextValue) => onPatch({ step: parseOptionalNumberInput(nextValue) })}
              placeholder="1"
            />
          </Field>
          <Field label={t({ ko: '최소', en: 'Min' })}>
            <NumberStepperInput
              variant="settings"
              allowEmpty
              value={field.min ?? ''}
              onValueCommit={(nextValue) => onPatch({ min: parseOptionalNumberInput(nextValue) })}
              placeholder={noneLabel}
            />
          </Field>
          <Field label={t({ ko: '최대', en: 'Max' })}>
            <NumberStepperInput
              variant="settings"
              allowEmpty
              value={field.max ?? ''}
              onValueCommit={(nextValue) => onPatch({ max: parseOptionalNumberInput(nextValue) })}
              placeholder={noneLabel}
            />
          </Field>
        </div>
      ) : defaultChoices.length > 0 ? (
        <FieldGroup label={defaultLabel}>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <WorkflowFieldInput
                field={defaultControlField}
                value={matchedDefault ?? defaultText}
                hideLabel
                onChange={(value) => onPatch({ default_value: typeof value === 'string' && value.length > 0 ? value : undefined })}
                onImageChange={() => undefined}
              />
            </div>
            {isStaleDefault ? <WarningMarker label={t({ ko: '목록에 없는 값이야', en: 'This value is not in the list' })} /> : null}
            <IconButton
              variant="ghost"
              disabled={defaultText.length === 0}
              onClick={() => onPatch({ default_value: undefined })}
              label={isHidden ? t({ ko: '고정값 지우기', en: 'Clear fixed value' }) : t({ ko: '기본값 지우기', en: 'Clear default' })}
            >
              <X />
            </IconButton>
          </div>
        </FieldGroup>
      ) : (
        <Field label={field.type === 'node' ? t({ ko: '기본값 (JSON)', en: 'Default (JSON)' }) : defaultLabel}>
          {field.type === 'textarea' ? (
            <Textarea
              variant="settings"
              rows={4}
              value={stringifyDefaultValue(field.default_value)}
              onChange={(event) => onPatch({ default_value: event.target.value })}
            />
          ) : field.type === 'node' ? (
            <Textarea
              variant="settings"
              rows={6}
              readOnly
              mono
              textSize="xs"
              value={field.default_value && typeof field.default_value === 'object' ? JSON.stringify(field.default_value, null, 2) : ''}
            />
          ) : (
            <Input
              variant="settings"
              value={stringifyDefaultValue(field.default_value)}
              onChange={(event) => onPatch({ default_value: event.target.value })}
            />
          )}
        </Field>
      )}

      {field.type === 'select' ? (
        <>
          <Field label={t({ ko: '드롭다운 목록', en: 'Dropdown list' })}>
            <div className="flex min-w-0 items-center gap-2">
              <Select
                variant="settings"
                value={field.dropdown_list_name ?? ''}
                onChange={(event) => onPatch({ dropdown_list_name: event.target.value || undefined })}
              >
                <option value="">{noneLabel}</option>
                {missingListName ? <option value={missingListName}>{t({ ko: '{name} (없는 목록)', en: '{name} (missing list)' }, { name: missingListName })}</option> : null}
                {listGroups.holding.length > 0 ? (
                  <>
                    <optgroup label={isHidden ? t({ ko: '고정값이 든 목록', en: 'Lists with the fixed value' }) : t({ ko: '기본값이 든 목록', en: 'Lists with the default' })}>
                      {listGroups.holding.map((list) => <option key={list.id} value={list.name}>{list.name}</option>)}
                    </optgroup>
                    {listGroups.others.length > 0 ? (
                      <optgroup label={t({ ko: '다른 목록', en: 'Other lists' })}>
                        {listGroups.others.map((list) => <option key={list.id} value={list.name}>{list.name}</option>)}
                      </optgroup>
                    ) : null}
                  </>
                ) : listGroups.others.map((list) => <option key={list.id} value={list.name}>{list.name}</option>)}
              </Select>
              {missingListName ? <WarningMarker label={t({ ko: '이 드롭다운 목록이 없어', en: 'This dropdown list no longer exists' })} /> : null}
            </div>
          </Field>
          <FieldGroup label={t({ ko: '직접 입력 옵션', en: 'Manual options' })}>
            <MarkedFieldOptionsEditor options={field.options ?? []} importChoices={inputChoices} onChange={(options) => onPatch({ options })} />
          </FieldGroup>
        </>
      ) : null}

      {isDirectorNode ? (
        <div className="space-y-3">
          <FieldGroup label={t({ ko: '노출할 Director 필드', en: 'Visible Director fields' })}>
            <div className="grid grid-cols-2 gap-0.5">
              {MINIMAX_H3_DIRECTOR_VISIBLE_FIELD_OPTIONS.map((option) => {
                const visibleFields = field.node_visible_fields ?? [...MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS]
                return (
                  <CheckboxRow
                    key={option.key}
                    checked={visibleFields.includes(option.key)}
                    onCheckedChange={(checked) => {
                      const nextVisibleFieldSet = new Set(visibleFields)
                      if (checked) nextVisibleFieldSet.add(option.key)
                      else nextVisibleFieldSet.delete(option.key)
                      const nextVisibleFields = MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.filter((key) => nextVisibleFieldSet.has(key))
                      onPatch({
                        node_visible_fields: nextVisibleFields.length === MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.length ? undefined : [...nextVisibleFields],
                      })
                    }}
                  >
                    {t({ ko: option.ko, en: option.en })}
                  </CheckboxRow>
                )
              })}
            </div>
          </FieldGroup>

          <FieldGroup label={t({ ko: '출력·업스케일 표시', en: 'Output and upscale controls' })}>
            <div className="grid gap-0.5">
              {MINIMAX_H3_DIRECTOR_CONTROL_OPTIONS.map((option) => (
                <CheckboxRow
                  key={option.key}
                  checked={!field.node_hidden_controls?.includes(option.key)}
                  onCheckedChange={(checked) => {
                    const hiddenControls = new Set(field.node_hidden_controls ?? [])
                    if (checked) hiddenControls.delete(option.key)
                    else hiddenControls.add(option.key)
                    onPatch({ node_hidden_controls: hiddenControls.size ? [...hiddenControls] : undefined })
                  }}
                >
                  {t({ ko: option.ko, en: option.en })}
                </CheckboxRow>
              ))}
            </div>
          </FieldGroup>

          {MINIMAX_H3_DIRECTOR_NUMERIC_BOUND_OPTIONS.map((option) => (
            <div key={option.key} className="grid grid-cols-2 gap-3">
              <Field label={t({ ko: '{name} 최소', en: '{name} min' }, { name: t({ ko: option.ko, en: option.en }) })}>
                <NumberStepperInput
                  variant="settings"
                  step="any"
                  allowEmpty
                  min={'min' in option ? option.min : undefined}
                  max={'max' in option ? option.max : undefined}
                  value={field.node_numeric_bounds?.[option.key]?.min ?? ''}
                  placeholder={noneLabel}
                  onValueCommit={(nextValue) => onPatch({ node_numeric_bounds: buildNodeNumericBounds(field, option.key, 'min', parseOptionalNumberInput(nextValue)) })}
                />
              </Field>
              <Field label={t({ ko: '{name} 최대', en: '{name} max' }, { name: t({ ko: option.ko, en: option.en }) })}>
                <NumberStepperInput
                  variant="settings"
                  step="any"
                  allowEmpty
                  min={'min' in option ? option.min : undefined}
                  max={'max' in option ? option.max : undefined}
                  value={field.node_numeric_bounds?.[option.key]?.max ?? ''}
                  placeholder={noneLabel}
                  onValueCommit={(nextValue) => onPatch({ node_numeric_bounds: buildNodeNumericBounds(field, option.key, 'max', parseOptionalNumberInput(nextValue)) })}
                />
              </Field>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <SettingRow label={t({ ko: '필수', en: 'Required' })} className="min-h-10">
          <Switch checked={field.required === true} disabled={isHidden} onCheckedChange={(checked) => onPatch({ required: checked })} aria-label={t({ ko: '필수', en: 'Required' })} />
        </SettingRow>
        <SettingRow label={t({ ko: '기본으로 접기', en: 'Collapsed by default' })} className="min-h-10">
          <Switch checked={field.default_collapsed === true} disabled={isHidden} onCheckedChange={(checked) => onPatch({ default_collapsed: checked })} aria-label={t({ ko: '기본으로 접기', en: 'Collapsed by default' })} />
        </SettingRow>
        {canHideWorkflowField(field.type) ? (
          <SettingRow label={t({ ko: '숨김', en: 'Hidden' })} className="min-h-10">
            <Switch checked={isHidden} onCheckedChange={(checked) => onPatch({ hidden: checked ? true : undefined })} aria-label={t({ ko: '숨김', en: 'Hidden' })} />
          </SettingRow>
        ) : null}
        {field.type === 'image' ? (
          <SettingRow label={t({ ko: '간단 업로드', en: 'Simple upload' })} className="min-h-10">
            <Switch checked={field.simple_upload_only === true} onCheckedChange={(checked) => onPatch({ simple_upload_only: checked })} aria-label={t({ ko: '간단 업로드', en: 'Simple upload' })} />
          </SettingRow>
        ) : null}
      </div>
    </div>
  )
}
