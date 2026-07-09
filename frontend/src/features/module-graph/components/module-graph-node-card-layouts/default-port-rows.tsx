import type { ModulePortDefinition } from '@/lib/api-module-graph'
import type { ModuleGraphNode } from '../../module-graph-shared'
import {
  InputPortCell,
  PortCell,
  getInputPortState,
  type ModuleUiFieldMap,
} from '../module-graph-port-cells'

export function DefaultModulePortRows({
  id,
  data,
  accentColor,
  connectedInputKeys,
  connectedOutputKeys,
  uiFieldByKey,
  visibleInputPorts,
  visibleOutputPorts,
}: {
  id: string
  data: ModuleGraphNode['data']
  accentColor: string
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
  uiFieldByKey: ModuleUiFieldMap
  visibleInputPorts: ModulePortDefinition[]
  visibleOutputPorts: ModulePortDefinition[]
}) {
  const portRowCount = Math.max(visibleInputPorts.length, visibleOutputPorts.length, 1)

  return (
    <div className="mt-2.5 grid gap-1">
      {Array.from({ length: portRowCount }, (_, index) => {
        const inputPort = visibleInputPorts[index]
        const outputPort = visibleOutputPorts[index]
        const inputPortState = getInputPortState(data, inputPort, connectedInputKeys)
        const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

        if (inputPort && !outputPort) {
          return (
            <div key={`port-row-${index}`} className="grid grid-cols-1">
              <InputPortCell
                nodeId={id}
                data={data}
                port={inputPort}
                uiField={uiFieldByKey.get(inputPort.key) ?? null}
                accentColor={accentColor}
                connected={inputPortState.connected}
                satisfied={inputPortState.satisfied}
                requiredMissing={inputPortState.requiredMissing}
                selectOptionsOverride={undefined}
              />
            </div>
          )
        }

        if (!inputPort && outputPort) {
          return (
            <div key={`port-row-${index}`} className="grid grid-cols-1">
              <PortCell
                nodeId={id}
                port={outputPort}
                side="output"
                accentColor={accentColor}
                connected={outputConnected}
                satisfied={outputConnected}
                requiredMissing={false}
                outputState={data.conditionalOutputStates?.[outputPort.key] ?? null}
              />
            </div>
          )
        }

        return (
          <div key={`port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
            <InputPortCell
              nodeId={id}
              data={data}
              port={inputPort}
              uiField={inputPort ? uiFieldByKey.get(inputPort.key) ?? null : null}
              accentColor={accentColor}
              connected={inputPortState.connected}
              satisfied={inputPortState.satisfied}
              requiredMissing={inputPortState.requiredMissing}
              selectOptionsOverride={undefined}
            />
            <PortCell
              nodeId={id}
              port={outputPort}
              side="output"
              accentColor={accentColor}
              connected={outputConnected}
              satisfied={outputConnected}
              requiredMissing={false}
              outputState={outputPort ? data.conditionalOutputStates?.[outputPort.key] ?? null : null}
            />
          </div>
        )
      })}
    </div>
  )
}
