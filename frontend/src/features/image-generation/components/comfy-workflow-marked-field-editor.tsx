import { useState, type ReactNode } from 'react'
import { LocateFixed, Trash2, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { WorkflowMarkedField, WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import { addMarkedFieldOption } from './comfy-workflow-marked-field-utils'
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

const FIELD_TYPE_OPTIONS: Array<{ value: WorkflowMarkedField['type'], ko: string, en: string }> = [
  { value: 'text', ko: '텍스트', en: 'Text' },
  { value: 'textarea', ko: '텍스트 영역', en: 'Text area' },
  { value: 'number', ko: '숫자', en: 'Number' },
  { value: 'select', ko: '선택', en: 'Select' },
  { value: 'image', ko: '이미지', en: 'Image' },
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

/** A labelled group of several controls; a div, not a <label>, so the controls inside keep their own labels. */
function FieldGroup({ label, children }: { label: ReactNode, children: ReactNode }) {
  return (
    <div role="group" aria-label={typeof label === 'string' ? label : undefined} className="theme-settings-field flex flex-col text-sm">
      <span className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
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

/** Select options as removable chips; Enter adds the typed value as one option, commas included. */
function MarkedFieldOptionsEditor({ options, onChange }: { options: string[], onChange: (options: string[] | undefined) => void }) {
  const { t } = useI18n()
  const [draftOption, setDraftOption] = useState('')
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
      <Input
        variant="settings"
        value={draftOption}
        onChange={(event) => setDraftOption(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          commitDraftOption()
        }}
        onBlur={() => { if (draftOption.trim()) commitDraftOption() }}
        placeholder={t({ ko: '옵션 입력 후 Enter', en: 'Type an option, then Enter' })}
      />
    </div>
  )
}

type ComfyWorkflowMarkedFieldEditorProps = {
  field: WorkflowMarkedField
  dropdownListNames: string[]
  canLocate: boolean
  onPatch: (patch: Partial<WorkflowMarkedField>) => void
  onRemove: () => void
  onLocate: () => void
}

/** Edit the one marked field selected in the field panel. */
export function ComfyWorkflowMarkedFieldEditor({ field, dropdownListNames, canLocate, onPatch, onRemove, onLocate }: ComfyWorkflowMarkedFieldEditorProps) {
  const { t } = useI18n()
  const noneLabel = t({ ko: '없음', en: 'None' })
  const isDirectorNode = field.type === 'node' && field.node_editor === 'minimax_h3_director_dasiwa'

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{field.label || field.id}</div>
          <div className="truncate font-mono text-2xs text-muted-foreground">{field.jsonPath}</div>
        </div>
        <IconButton size="icon-sm" variant="ghost" disabled={!canLocate} onClick={onLocate} label={t({ ko: '그래프에서 보기', en: 'Show in graph' })}>
          <LocateFixed />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={onRemove} label={t({ ko: '필드 삭제', en: 'Remove field' })}>
          <Trash2 />
        </IconButton>
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
          <Field label={t({ ko: '기본값', en: 'Default' })}>
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
      ) : (
        <Field label={field.type === 'node' ? t({ ko: '기본값 (JSON)', en: 'Default (JSON)' }) : t({ ko: '기본값', en: 'Default' })}>
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
              className="font-mono text-xs"
              value={field.default_value && typeof field.default_value === 'object' ? JSON.stringify(field.default_value, null, 2) : ''}
            />
          ) : field.type === 'select' && (field.options?.length ?? 0) > 0 ? (
            <Select
              variant="settings"
              value={stringifyDefaultValue(field.default_value)}
              onChange={(event) => onPatch({ default_value: event.target.value || undefined })}
            >
              <option value="">{noneLabel}</option>
              {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
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
            <Select
              variant="settings"
              value={field.dropdown_list_name ?? ''}
              onChange={(event) => onPatch({ dropdown_list_name: event.target.value || undefined })}
            >
              <option value="">{noneLabel}</option>
              {dropdownListNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </Field>
          <FieldGroup label={t({ ko: '직접 입력 옵션', en: 'Manual options' })}>
            <MarkedFieldOptionsEditor options={field.options ?? []} onChange={(options) => onPatch({ options })} />
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
        <SettingRow label={t({ ko: '필수', en: 'Required' })} className="min-h-10 py-1.5">
          <Switch checked={field.required === true} onCheckedChange={(checked) => onPatch({ required: checked })} aria-label={t({ ko: '필수', en: 'Required' })} />
        </SettingRow>
        <SettingRow label={t({ ko: '기본으로 접기', en: 'Collapsed by default' })} className="min-h-10 py-1.5">
          <Switch checked={field.default_collapsed === true} onCheckedChange={(checked) => onPatch({ default_collapsed: checked })} aria-label={t({ ko: '기본으로 접기', en: 'Collapsed by default' })} />
        </SettingRow>
        {field.type === 'image' ? (
          <SettingRow label={t({ ko: '간단 업로드', en: 'Simple upload' })} className="min-h-10 py-1.5">
            <Switch checked={field.simple_upload_only === true} onCheckedChange={(checked) => onPatch({ simple_upload_only: checked })} aria-label={t({ ko: '간단 업로드', en: 'Simple upload' })} />
          </SettingRow>
        ) : null}
      </div>
    </div>
  )
}
