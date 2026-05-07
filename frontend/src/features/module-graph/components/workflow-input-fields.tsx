import { RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { DEFAULT_PROMPT_TEXTAREA_ROWS } from '@/features/image-generation/components/text-segment-spreadsheet-input'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import type { GraphWorkflowExposedInput } from '@/lib/api-module-graph'
import { normalizeModulePortDescription } from '../module-graph-shared'
import { hasMeaningfulValue } from './module-graph-field-shared'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'

const WORKFLOW_INPUT_FIELD_SURFACE_CLASS = 'space-y-2 rounded-sm border border-border/70 bg-background/35 p-4'
const DROPDOWN_RANDOM_OPTION_VALUE = '__random__'

function getWorkflowSelectOptionLabel(option: string, randomSelectionLabel: string) {
  return option === DROPDOWN_RANDOM_OPTION_VALUE ? randomSelectionLabel : option
}

function hasDefaultValue(value: unknown) {
  return value !== undefined
}

function areFieldValuesEqual(left: unknown, right: unknown) {
  if (left === right) {
    return true
  }

  if (left == null || right == null) {
    return false
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/** Render shared workflow-exposed input fields for runner and schedule configuration panels. */
export function WorkflowInputFields({
  inputDefinitions,
  inputValues,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
}: {
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, image?: SelectedImageDraft) => Promise<void> | void
}) {
  const { t } = useI18n()

  const restoreDefaultValue = (inputDefinition: GraphWorkflowExposedInput) => {
    if (!hasDefaultValue(inputDefinition.default_value)) {
      onInputValueClear(inputDefinition.id)
      return
    }

    onInputValueChange(inputDefinition.id, inputDefinition.default_value)
  }

  const renderInputActions = (inputDefinition: GraphWorkflowExposedInput, rawValue: unknown, explicitValue: boolean) => {
    const defaultAvailable = hasDefaultValue(inputDefinition.default_value)
    const usingDefault = defaultAvailable && areFieldValuesEqual(rawValue, inputDefinition.default_value)

    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => restoreDefaultValue(inputDefinition)}
          disabled={!defaultAvailable || usingDefault}
          aria-label={t({ ko: '기본값 가져오기', en: 'Restore default value' })}
          title={t({ ko: '기본값 가져오기', en: 'Restore default value' })}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => onInputValueClear(inputDefinition.id)}
          disabled={!explicitValue}
          aria-label={t({ ko: '값 지우기', en: 'Clear value' })}
          title={t({ ko: '값 지우기', en: 'Clear value' })}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  const renderInputField = (inputDefinition: GraphWorkflowExposedInput) => {
    const rawValue = inputValues[inputDefinition.id]
    const explicitValue = hasMeaningfulValue(rawValue)
    const normalizedDescription = normalizeModulePortDescription(inputDefinition.description)

    if (isNaiCharacterPromptPort(inputDefinition.port_key, inputDefinition.data_type)) {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <NaiCharacterPromptsInput value={rawValue} onChange={(value) => onInputValueChange(inputDefinition.id, value)} />
        </div>
      )
    }

    if (isNaiVibePort(inputDefinition.port_key, inputDefinition.data_type)) {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <NaiReusableAssetInput kind="vibes" value={rawValue} onChange={(value) => onInputValueChange(inputDefinition.id, value)} />
        </div>
      )
    }

    if (isNaiCharacterReferencePort(inputDefinition.port_key, inputDefinition.data_type)) {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={(value) => onInputValueChange(inputDefinition.id, value)} />
        </div>
      )
    }

    if (inputDefinition.ui_data_type === 'select' && Array.isArray(inputDefinition.options) && inputDefinition.options.length > 0) {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · select</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <Select
            value={typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue)}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value)}
          >
            <option value="">{t({ ko: '기본값 사용', en: 'Use default value' })}</option>
            {inputDefinition.options.map((option) => (
              <option key={option} value={option}>{getWorkflowSelectOptionLabel(option, t({ ko: '랜덤 선택', en: 'Random selection' }))}</option>
            ))}
          </Select>
        </div>
      )
    }

    if (inputDefinition.data_type === 'prompt' || inputDefinition.data_type === 'json') {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <Textarea
            rows={inputDefinition.data_type === 'json' ? 6 : DEFAULT_PROMPT_TEXTAREA_ROWS}
            value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value)}
            placeholder={inputDefinition.placeholder || inputDefinition.label}
          />
        </div>
      )
    }

    if (inputDefinition.data_type === 'number') {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · number</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <Input
            type="number"
            value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value === '' ? '' : Number(event.target.value))}
            placeholder={inputDefinition.placeholder || inputDefinition.label}
          />
        </div>
      )
    }

    if (inputDefinition.data_type === 'boolean') {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · boolean</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <Select
            value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value === '' ? '' : event.target.value === 'true')}
          >
            <option value="">{t({ ko: '기본값 사용', en: 'Use default value' })}</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        </div>
      )
    }

    if (inputDefinition.data_type === 'image' || inputDefinition.data_type === 'mask') {
      return (
        <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            {renderInputActions(inputDefinition, rawValue, explicitValue)}
          </div>
          {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          <ImageAttachmentPickerButton label={explicitValue ? t({ ko: '이미지 변경', en: 'Change image' }) : t({ ko: '이미지 선택', en: 'Select image' })} modalTitle={inputDefinition.label} allowSaveDialog={false} onSelect={(image) => void onInputImageChange(inputDefinition.id, image)} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:') ? (
            <InlineMediaPreview src={rawValue} alt={inputDefinition.label} frameClassName="p-3" />
          ) : null}
        </div>
      )
    }

    return (
      <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
              {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
          </div>
          {renderInputActions(inputDefinition, rawValue, explicitValue)}
        </div>
        {normalizedDescription ? <div className="text-xs text-muted-foreground">{normalizedDescription}</div> : null}
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value)}
          placeholder={inputDefinition.placeholder || inputDefinition.label}
        />
      </div>
    )
  }

  if (inputDefinitions.length === 0) {
    return null
  }

  return <div className="space-y-2.5">{inputDefinitions.map((inputDefinition) => renderInputField(inputDefinition))}</div>
}
