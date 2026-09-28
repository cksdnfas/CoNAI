import { RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { DEFAULT_PROMPT_TEXTAREA_ROWS } from '@/features/image-generation/components/text-segment-spreadsheet-input'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { TypedFieldInput } from '@/features/shared-fields/typed-field-input'
import { useI18n } from '@/i18n'
import type { GraphWorkflowExposedInput } from '@/lib/api-module-graph'
import { normalizeModulePortDescription } from '../module-graph-shared'
import { hasMeaningfulValue } from './module-graph-field-shared'
import { formatModuleGraphDefaultOptionLabel } from './module-graph-simple-value-input'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'

// Same tone role as <Inset />: surface-low on the page, recessed inside the runner Section.
const WORKFLOW_INPUT_FIELD_SURFACE_CLASS = 'ui-tone-plinth space-y-2 rounded-sm p-4'
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
        <IconButton
          size="icon-sm"
          variant="ghost"
          onClick={() => restoreDefaultValue(inputDefinition)}
          disabled={!defaultAvailable || usingDefault}
          label={t({ ko: '기본값 가져오기', en: 'Restore default value' })}
        >
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <IconButton
          size="icon-sm"
          variant="ghost"
          onClick={() => onInputValueClear(inputDefinition.id)}
          disabled={!explicitValue}
          label={t({ ko: '값 지우기', en: 'Clear value' })}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    )
  }

  const renderInputControl = (inputDefinition: GraphWorkflowExposedInput, rawValue: unknown, isSelect: boolean) => {
    const onChange = (value: unknown) => onInputValueChange(inputDefinition.id, value)

    if (isNaiCharacterPromptPort(inputDefinition.port_key, inputDefinition.data_type)) {
      return <NaiCharacterPromptsInput value={rawValue} onChange={onChange} />
    }

    if (isNaiVibePort(inputDefinition.port_key, inputDefinition.data_type)) {
      return <NaiReusableAssetInput kind="vibes" value={rawValue} onChange={onChange} />
    }

    if (isNaiCharacterReferencePort(inputDefinition.port_key, inputDefinition.data_type)) {
      return <NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={onChange} />
    }

    const dataType = inputDefinition.data_type
    const kind = isSelect
      ? 'select'
      : dataType === 'prompt' || dataType === 'json' || dataType === 'number' || dataType === 'boolean'
        ? dataType
        : dataType === 'image' || dataType === 'mask' ? 'image' : 'text'

    return (
      <TypedFieldInput
        kind={kind}
        value={rawValue}
        onChange={onChange}
        placeholder={inputDefinition.placeholder || inputDefinition.label}
        rows={dataType === 'json' ? 6 : DEFAULT_PROMPT_TEXTAREA_ROWS}
        options={inputDefinition.options}
        emptyOption="placeholder"
        emptyLabel={hasDefaultValue(inputDefinition.default_value) ? formatModuleGraphDefaultOptionLabel(t, inputDefinition.default_value) : undefined}
        allowEmpty={!inputDefinition.required}
        imageModalTitle={inputDefinition.label}
        onImageChange={(image) => onInputImageChange(inputDefinition.id, image)}
      />
    )
  }

  const renderInputField = (inputDefinition: GraphWorkflowExposedInput) => {
    const rawValue = inputValues[inputDefinition.id]
    const explicitValue = hasMeaningfulValue(rawValue)
    const normalizedDescription = normalizeModulePortDescription(inputDefinition.description)
    const isSelect = inputDefinition.ui_data_type === 'select' && Array.isArray(inputDefinition.options) && inputDefinition.options.length > 0
      && !isNaiCharacterPromptPort(inputDefinition.port_key, inputDefinition.data_type)
      && !isNaiVibePort(inputDefinition.port_key, inputDefinition.data_type)
      && !isNaiCharacterReferencePort(inputDefinition.port_key, inputDefinition.data_type)

    return (
      <div key={inputDefinition.id} className={WORKFLOW_INPUT_FIELD_SURFACE_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tip content={normalizedDescription}>
              <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
            </Tip>
            {inputDefinition.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
          </div>
          {renderInputActions(inputDefinition, rawValue, explicitValue)}
        </div>
        {renderInputControl(inputDefinition, rawValue, isSelect)}
      </div>
    )
  }

  if (inputDefinitions.length === 0) {
    return null
  }

  return <div className="space-y-2.5">{inputDefinitions.map((inputDefinition) => renderInputField(inputDefinition))}</div>
}
