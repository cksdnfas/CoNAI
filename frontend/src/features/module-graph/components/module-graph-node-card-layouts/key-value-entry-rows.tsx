import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { ModulePortDataType, ModulePortDefinition } from '@/lib/api-module-graph'
import type { KeyValueEntry } from '../module-graph-key-value-list-input'
import { buildInputSourceKey, useModuleGraphCanvasContext, useModuleGraphNodeActions } from '../module-graph-canvas-context'
import { cn } from '@/lib/utils'
import { NodeNumberControl, NodeSwitchControl, NodeTextControl, NodeWidgetContext, stopNodeEvent } from '../module-graph-node-controls'
import { ModuleGraphPortHandle } from '../module-graph-port-handle'
import { NodeLinkedSource, buildPortTooltip } from '../module-graph-node-rows'

/**
 * Editable "name → value" rows (API request values and headers, random choice candidates). A named row is also an
 * input port, so it can take a link instead of a typed value.
 */
export function KeyValueEntryRows({
  nodeId,
  fieldKey,
  parentPort,
  entries,
  portDataType,
  valueKind = 'text',
  keyPlaceholder,
  valuePlaceholder,
  describePort,
  createEntry,
}: {
  nodeId: string
  fieldKey: string
  parentPort: ModulePortDefinition | undefined
  entries: KeyValueEntry[]
  portDataType: ModulePortDataType
  valueKind?: 'text' | 'number' | 'boolean'
  keyPlaceholder: string
  valuePlaceholder: string
  describePort?: string
  /** The row "add item" appends (defaults to an empty name and value). */
  createEntry?: (entries: KeyValueEntry[]) => KeyValueEntry
}) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const { inputSources } = useModuleGraphCanvasContext()
  const save = (next: KeyValueEntry[]) => actions.changeValue(nodeId, fieldKey, next)
  const update = (index: number, next: KeyValueEntry) => save(entries.map((entry, entryIndex) => (entryIndex === index ? next : entry)))

  return (
    <>
      {entries.map((entry, index) => {
        const name = entry.key.trim()
        const port: ModulePortDefinition | null = parentPort && name
          ? { ...parentPort, key: `${fieldKey}.${name}`, label: name, data_type: portDataType, required: false, multiple: false, default_value: undefined, description: describePort }
          : null
        const source = port ? inputSources.get(buildInputSourceKey(nodeId, port.key)) : undefined
        const connected = source !== undefined

        return (
          <div key={`${fieldKey}-${index}`} className="module-graph-widget-row relative flex items-center gap-1 py-0.5 pr-1.5 pl-2.5">
            {port ? <ModuleGraphPortHandle nodeId={nodeId} port={port} side="input" connected={connected} reveal tooltip={buildPortTooltip(t, port)} /> : null}
            <div className={cn('flex h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded-full pr-1.5 pl-3 text-xs', connected ? 'ring-1 ring-line ring-inset' : 'bg-surface-high')}>
              <NodeWidgetContext.Provider value>
                <NodeTextControl ariaLabel={keyPlaceholder} value={entry.key} placeholder={keyPlaceholder} onChange={(key) => update(index, { ...entry, key })} className="w-[40%] flex-none text-left text-muted-foreground" />
                <span className="flex min-w-0 flex-1 items-center justify-end">
                  {connected ? (
                    <NodeLinkedSource source={source} />
                  ) : valueKind === 'number' ? (
                    <NodeNumberControl ariaLabel={valuePlaceholder} value={entry.value} placeholder={valuePlaceholder} onChange={(value) => update(index, { ...entry, value: String(value) })} />
                  ) : valueKind === 'boolean' ? (
                    <NodeSwitchControl ariaLabel={valuePlaceholder} checked={entry.value === 'true'} onChange={(value) => update(index, { ...entry, value: value ? 'true' : 'false' })} />
                  ) : (
                    <NodeTextControl ariaLabel={valuePlaceholder} value={entry.value} placeholder={valuePlaceholder} onChange={(value) => update(index, { ...entry, value })} />
                  )}
                </span>
              </NodeWidgetContext.Provider>
            </div>
            <IconButton
              size="icon-xs"
              variant="ghost"
              label={t({ ko: '항목 삭제', en: 'Remove item' })}
              onMouseDown={stopNodeEvent}
              onClick={(event) => {
                event.stopPropagation()
                save(entries.filter((_, entryIndex) => entryIndex !== index))
              }}
              className="nodrag size-5"
            >
              <X />
            </IconButton>
          </div>
        )
      })}
      <div className="px-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onMouseDown={stopNodeEvent}
          onClick={(event) => {
            event.stopPropagation()
            save([...entries, createEntry ? createEntry(entries) : { key: '', value: '' }])
          }}
          className="nodrag text-2xs font-normal"
        >
          <Plus />
          {t({ ko: '항목 추가', en: 'Add item' })}
        </Button>
      </div>
    </>
  )
}
