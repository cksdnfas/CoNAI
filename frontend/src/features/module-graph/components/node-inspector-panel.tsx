import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ModulePortDefinition } from '@/lib/api'
import type { ModuleGraphEdge, ModuleGraphNode } from '../module-graph-shared'

type NodeInspectorPanelProps = {
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, file?: File) => Promise<void>
  showHeader?: boolean
}

/** Render editable node input overrides and selected edge details. */
export function NodeInspectorPanel({
  selectedNode,
  selectedEdge,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  showHeader = true,
}: NodeInspectorPanelProps) {
  const renderPortInput = (node: ModuleGraphNode, port: ModulePortDefinition) => {
    const rawValue = node.data.inputValues?.[port.key]
    const hasExplicitValue = rawValue !== undefined && rawValue !== null && rawValue !== ''

    if (port.data_type === 'prompt' || port.data_type === 'json') {
      return (
        <div key={port.key} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">{port.label}</div>
              <div className="text-xs text-muted-foreground">{port.data_type}</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onNodeValueClear(node.id, port.key)} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Textarea
            rows={port.data_type === 'json' ? 6 : 4}
            value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
            placeholder={port.description || port.label}
          />
        </div>
      )
    }

    if (port.data_type === 'number') {
      return (
        <div key={port.key} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">{port.label}</div>
              <div className="text-xs text-muted-foreground">number</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onNodeValueClear(node.id, port.key)} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Input
            type="number"
            value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value === '' ? '' : Number(event.target.value))}
            placeholder={port.label}
          />
        </div>
      )
    }

    if (port.data_type === 'boolean') {
      return (
        <div key={port.key} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">{port.label}</div>
              <div className="text-xs text-muted-foreground">boolean</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onNodeValueClear(node.id, port.key)} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Select
            value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value === 'true')}
          >
            <option value="">기본값 사용</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        </div>
      )
    }

    if (port.data_type === 'image' || port.data_type === 'mask') {
      return (
        <div key={port.key} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">{port.label}</div>
              <div className="text-xs text-muted-foreground">{port.data_type}</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onNodeValueClear(node.id, port.key)} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Input type="file" accept="image/*" onChange={(event) => void onNodeImageChange(node.id, port.key, event.target.files?.[0])} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:image/') ? (
            <img src={rawValue} alt={port.label} className="max-h-40 rounded-sm border border-border object-contain" />
          ) : null}
        </div>
      )
    }

    return (
      <div key={port.key} className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">{port.label}</div>
            <div className="text-xs text-muted-foreground">{port.data_type}</div>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => onNodeValueClear(node.id, port.key)} disabled={!hasExplicitValue}>
            값 지우기
          </Button>
        </div>
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
          placeholder={port.description || port.label}
        />
      </div>
    )
  }

  return (
    <Card className="bg-surface-container">
      <CardContent className="space-y-4">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="Node Inspector"
            description="선택한 노드나 엣지의 입력 오버라이드를 다듬어."
          />
        ) : null}
        {!selectedNode && !selectedEdge ? (
          <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">캔버스에서 노드나 엣지를 하나 선택해봐.</div>
        ) : null}

        {!selectedNode && selectedEdge ? (
          <div className="space-y-3 rounded-sm bg-surface-low p-4">
            <div className="font-medium text-foreground">Selected Edge</div>
            <div className="text-sm text-muted-foreground">{selectedEdge.source} → {selectedEdge.target}</div>
            <div className="text-xs text-muted-foreground">{selectedEdge.sourceHandle || 'source'} → {selectedEdge.targetHandle || 'target'}</div>
          </div>
        ) : null}

        {selectedNode ? (
          <>
            <div className="rounded-sm bg-surface-low p-4">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{selectedNode.data.module.name}</span>
                <Badge variant="outline">{selectedNode.data.module.engine_type}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">node id: {selectedNode.id}</div>
            </div>

            {(selectedNode.data.module.exposed_inputs ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">이 노드는 편집 가능한 입력 포트가 없어.</div>
            ) : (
              <div className="space-y-4">{selectedNode.data.module.exposed_inputs.map((port) => renderPortInput(selectedNode, port))}</div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
