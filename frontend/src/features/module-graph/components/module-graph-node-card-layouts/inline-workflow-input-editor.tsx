import { Eraser } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import { getImageValueSrc } from '@/lib/library-image-ref'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import { WORKFLOW_INPUT_ENABLED_KEY, isWorkflowInputEnabledForNode } from '../../module-graph-workflow-inputs'
import type { ModuleGraphNode } from '../../module-graph-shared'
import { useModuleGraphNodeActions } from '../module-graph-canvas-context'
import { NodeNumberControl, NodeSwitchControl, stopNodeEvent } from '../module-graph-node-controls'
import { NodeRow, NodeRowDivider, NodeValuePreview } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'
import { NodeOutputRows } from './default-port-rows'

/** A value node (text, number, image…): its output, the value itself, and whether a run asks for it. */
export function WorkflowInputSourceBody({ id, data, visibleOutputPorts }: ModuleGraphNodeLayoutProps) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const sourcePort = data.module.exposed_inputs[0] ?? null
  const outputPorts = data.module.output_ports.length > 0 ? data.module.output_ports : visibleOutputPorts
  if (!sourcePort) {
    return <NodeOutputRows id={id} data={data} ports={outputPorts} />
  }

  const rawValue = data.inputValues?.[sourcePort.key]
  const runInput = isWorkflowInputEnabledForNode({ id, data } as ModuleGraphNode)
  const isImage = sourcePort.data_type === 'image' || sourcePort.data_type === 'mask'
  const imageSrc = isImage ? getImageValueSrc(rawValue) : null
  const isLong = sourcePort.data_type === 'prompt' || sourcePort.data_type === 'text' || sourcePort.data_type === 'json'

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={outputPorts} />
      <NodeRowDivider />

      {isLong ? (
        <div className="px-3">
          <NodeValuePreview
            nodeId={id}
            fieldKey={sourcePort.key}
            text={typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : JSON.stringify(rawValue)}
            placeholder={runInput ? t({ ko: '실행할 때 입력', en: 'Entered at run time' }) : t({ ko: '비어 있음', en: 'Empty' })}
          />
        </div>
      ) : null}

      {sourcePort.data_type === 'number' ? (
        <NodeRow label={sourcePort.label}>
          <NodeNumberControl ariaLabel={sourcePort.label} value={rawValue} onChange={(value) => actions.changeValue(id, sourcePort.key, value)} className="max-w-24" />
        </NodeRow>
      ) : null}

      {sourcePort.data_type === 'boolean' ? (
        <NodeRow label={sourcePort.label}>
          <NodeSwitchControl ariaLabel={sourcePort.label} checked={rawValue === true || rawValue === 'true'} onChange={(checked) => actions.changeValue(id, sourcePort.key, checked)} />
        </NodeRow>
      ) : null}

      {isImage ? (
        <div className="space-y-1.5 px-3 pb-1.5" onMouseDown={stopNodeEvent}>
          {imageSrc ? (
            <InlineMediaPreview src={imageSrc} alt={sourcePort.label} frameClassName="rounded-[5px] bg-surface-high p-1" mediaClassName="max-h-32 w-full object-contain" />
          ) : null}
          <div className="nodrag flex items-center gap-1">
            <ImageAttachmentPickerButton
              label={hasMeaningfulValue(rawValue) ? t({ ko: '이미지 변경', en: 'Change image' }) : t({ ko: '이미지 선택', en: 'Select image' })}
              modalTitle={sourcePort.label}
              allowSaveDialog={false}
              onSelect={(image) => void actions.changeImage(id, sourcePort.key, image)}
            />
            {hasMeaningfulValue(rawValue) ? (
              <IconButton size="icon-xs" variant="ghost" onClick={() => actions.clearValue(id, sourcePort.key)} label={t({ ko: '지우기', en: 'Clear' })}>
                <Eraser />
              </IconButton>
            ) : null}
          </div>
        </div>
      ) : null}

      <NodeRow label={t({ ko: '실행 입력', en: 'Run input' })} labelTitle={t({ ko: '켜면 저장한 워크플로를 실행할 때 이 값을 입력받아.', en: 'When on, runs of the saved workflow ask for this value.' })}>
        <NodeSwitchControl ariaLabel={t({ ko: '실행 입력', en: 'Run input' })} checked={runInput} onChange={(checked) => actions.changeValue(id, WORKFLOW_INPUT_ENABLED_KEY, checked)} />
      </NodeRow>
    </>
  )
}
