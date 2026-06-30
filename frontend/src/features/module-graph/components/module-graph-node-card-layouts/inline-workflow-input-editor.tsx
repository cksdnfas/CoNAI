import { type NodeProps } from '@xyflow/react'
import { Button } from '@/components/ui/button'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import { ModuleGraphSimpleValueInput } from '../module-graph-simple-value-input'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import {
  WORKFLOW_INPUT_ENABLED_KEY,
  isWorkflowInputEnabledForNode,
  isWorkflowInputSourceModule,
} from '../../module-graph-workflow-inputs'
import type { ModuleGraphNode } from '../../module-graph-shared'
import { MODULE_GRAPH_INLINE_CONTROL_CLASS, stopNodeActionEvent, stopNodeInteraction } from '../module-graph-port-cells'

export function InlineWorkflowInputEditor({ id, data }: Pick<NodeProps<ModuleGraphNode>, 'id' | 'data'>) {
  const { t } = useI18n()
  const sourcePort = isWorkflowInputSourceModule(data.module) ? data.module.exposed_inputs[0] ?? null : null
  if (!sourcePort) {
    return null
  }

  const rawValue = data.inputValues?.[sourcePort.key]
  const workflowInputEnabled = isWorkflowInputEnabledForNode({ id, data } as ModuleGraphNode)
  const hasExplicitValue = hasMeaningfulValue(rawValue)

  const handleValueChange = (value: unknown) => {
    data.onNodeValueChange?.(id, sourcePort.key, value)
  }

  const handleValueClear = () => {
    data.onNodeValueClear?.(id, sourcePort.key)
  }

  return (
    <div className="nodrag nowheel mt-2 space-y-1" onMouseDown={stopNodeInteraction}>
      <div className="flex min-h-[28px] items-center justify-between border-b border-border/30 px-1 pb-1 text-[11px] text-foreground">
        <span>{t({ ko: '실행 입력', en: 'Run input' })}</span>
        <input
          type="checkbox"
          checked={workflowInputEnabled}
          onChange={(event) => data.onNodeValueChange?.(id, WORKFLOW_INPUT_ENABLED_KEY, event.target.checked)}
          onMouseDown={stopNodeInteraction}
          className="h-4 w-4 shrink-0 accent-primary"
        />
      </div>

      {(sourcePort.data_type === 'prompt' || sourcePort.data_type === 'text' || sourcePort.data_type === 'json') ? (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType={sourcePort.data_type}
            value={rawValue}
            onChange={handleValueChange}
            placeholder={sourcePort.label}
            rows={sourcePort.data_type === 'json' ? 4 : 3}
            className={`text-sm ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
        </div>
      ) : null}

      {sourcePort.data_type === 'number' ? (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="number"
            value={rawValue}
            onChange={handleValueChange}
            placeholder={sourcePort.label}
            className={MODULE_GRAPH_INLINE_CONTROL_CLASS}
          />
        </div>
      ) : null}

      {sourcePort.data_type === 'boolean' ? (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="boolean"
            value={rawValue}
            onChange={handleValueChange}
            emptyLabel={t({ ko: '선택', en: 'Select' })}
            className={MODULE_GRAPH_INLINE_CONTROL_CLASS}
          />
        </div>
      ) : null}

      {(sourcePort.data_type === 'image' || sourcePort.data_type === 'mask') ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <ImageAttachmentPickerButton
              label={hasExplicitValue ? t({ ko: '이미지 변경', en: 'Change image' }) : t({ ko: '이미지 선택', en: 'Select image' })}
              modalTitle={sourcePort.label}
              allowSaveDialog={false}
              onSelect={(image) => void data.onNodeImageChange?.(id, sourcePort.key, image)}
            />
            {hasExplicitValue ? (
              <Button type="button" size="sm" variant="ghost" onMouseDown={stopNodeActionEvent} onClick={handleValueClear}>
                {t({ ko: '지우기', en: 'Clear' })}
              </Button>
            ) : null}
          </div>
          {typeof rawValue === 'string' && rawValue.startsWith('data:') ? (
            <InlineMediaPreview src={rawValue} alt={sourcePort.label} frameClassName="p-2" mediaClassName="max-h-28 w-full object-contain" />
          ) : null}
        </div>
      ) : null}

      {sourcePort.data_type !== 'image' && sourcePort.data_type !== 'mask' && hasExplicitValue ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onMouseDown={stopNodeActionEvent} onClick={handleValueClear}>
            {t({ ko: '값 지우기', en: 'Clear value' })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
