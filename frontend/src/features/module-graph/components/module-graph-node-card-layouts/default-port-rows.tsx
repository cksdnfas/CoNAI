import type { ReactNode } from 'react'
import type { ModulePortDefinition } from '@/lib/api-module-graph'
import { NodeInputRow, NodeOutputRow, NodeRowDivider } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'

/** Outputs right under the header, then node settings, then one row per input. */
export function DefaultModulePortRows({
  id,
  data,
  connectedInputKeys,
  visibleOutputPorts,
  uiFieldByKey,
  inputPorts,
  beforeInputs,
}: ModuleGraphNodeLayoutProps & {
  inputPorts: ModulePortDefinition[]
  /** Node-specific setting rows (model, server, profile) shown above the inputs. */
  beforeInputs?: ReactNode
}) {
  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      {visibleOutputPorts.length > 0 && inputPorts.length > 0 ? <NodeRowDivider /> : null}
      {beforeInputs}
      {inputPorts.map((port) => (
        <NodeInputRow
          key={port.key}
          nodeId={id}
          data={data}
          port={port}
          uiField={uiFieldByKey.get(port.key) ?? null}
          connected={connectedInputKeys.has(port.key)}
        />
      ))}
    </>
  )
}

export function NodeOutputRows({ id, data, ports }: { id: string; data: ModuleGraphNodeLayoutProps['data']; ports: ModulePortDefinition[] }) {
  return (
    <>
      {ports.map((port) => (
        <NodeOutputRow key={port.key} nodeId={id} port={port} outputState={data.conditionalOutputStates?.[port.key] ?? null} />
      ))}
    </>
  )
}
