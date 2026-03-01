import { useEffect, useMemo, useState } from 'react'
import { Copy, Folder, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WildcardWithHierarchy } from '@/services/wildcard-api'

type DetailTab = 'children' | 'comfyui' | 'nai'

interface WildcardDetailPanelProps {
  selectedNode: WildcardWithHierarchy | null
  onCopy: (text: string) => void
  onChildClick?: (node: WildcardWithHierarchy) => void
  actionButtons?: React.ReactNode
  emptyMessage: string
  sortChildren: (a: WildcardWithHierarchy, b: WildcardWithHierarchy) => number
}

export function WildcardDetailPanel({
  selectedNode,
  onCopy,
  onChildClick,
  actionButtons,
  emptyMessage,
  sortChildren,
}: WildcardDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('children')

  const sortedChildren = useMemo(() => {
    if (!selectedNode?.children) {
      return []
    }
    return [...selectedNode.children].sort(sortChildren)
  }, [selectedNode, sortChildren])

  const comfyuiItems = useMemo(() => {
    return selectedNode?.items?.filter((item) => item.tool === 'comfyui') ?? []
  }, [selectedNode])

  const naiItems = useMemo(() => {
    return selectedNode?.items?.filter((item) => item.tool === 'nai') ?? []
  }, [selectedNode])

  const hasChildren = sortedChildren.length > 0
  const hasComfy = comfyuiItems.length > 0
  const hasNai = naiItems.length > 0

  useEffect(() => {
    if (!selectedNode) {
      return
    }

    if (hasChildren) {
      setActiveTab('children')
      return
    }

    if (hasComfy) {
      setActiveTab('comfyui')
      return
    }

    if (hasNai) {
      setActiveTab('nai')
    }
  }, [selectedNode, hasChildren, hasComfy, hasNai])

  if (!selectedNode) {
    return (
      <section className="flex h-full min-h-0 flex-col rounded-md border p-3">
        <h3 className="mb-2 text-sm font-medium">Wildcard Detail</h3>
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      </section>
    )
  }

  const wildcardToken = selectedNode.type === 'chain' ? selectedNode.name : `++${selectedNode.name}++`

  return (
    <section className="flex h-full min-h-0 flex-col rounded-md border p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <button
            type="button"
            className="font-mono text-left text-sm font-semibold hover:underline"
            onClick={() => onCopy(wildcardToken)}
          >
            {wildcardToken}
          </button>
          {selectedNode.description ? <p className="text-muted-foreground text-sm">{selectedNode.description}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onCopy(wildcardToken)} aria-label="Copy wildcard token">
            <Copy className="h-4 w-4" />
          </Button>
          {actionButtons}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(next) => setActiveTab(next as DetailTab)}>
        <TabsList>
          {hasChildren ? <TabsTrigger value="children">Children ({sortedChildren.length})</TabsTrigger> : null}
          {hasComfy ? <TabsTrigger value="comfyui">ComfyUI ({comfyuiItems.length})</TabsTrigger> : null}
          {hasNai ? <TabsTrigger value="nai">NAI ({naiItems.length})</TabsTrigger> : null}
        </TabsList>
      </Tabs>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-3">
        <div className="space-y-2">
          {activeTab === 'children' && hasChildren ? (
            sortedChildren.map((child) => {
              const childToken = child.type === 'chain' ? child.name : `++${child.name}++`
              return (
                <Card key={child.id} className="py-0">
                  <CardContent className="flex items-center gap-2 p-3">
                    {Array.isArray(child.children) && child.children.length > 0 ? (
                      <Folder className="text-muted-foreground h-4 w-4" />
                    ) : (
                      <FileText className="text-muted-foreground h-4 w-4" />
                    )}
                    <button type="button" className="font-mono flex-1 text-left text-sm hover:underline" onClick={() => onChildClick?.(child)}>
                      {childToken}
                    </button>
                    <Badge variant="outline">{child.items.length} items</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCopy(childToken)}
                      aria-label={`Copy ${child.name}`}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              )
            })
          ) : null}

          {activeTab === 'comfyui' && hasComfy
            ? comfyuiItems.map((item, index) => (
                <button
                  key={`comfy-${index}-${item.content}`}
                  type="button"
                  className="hover:bg-muted w-full rounded border p-2 text-left font-mono text-sm"
                  onClick={() => onCopy(item.content)}
                >
                  {item.content}
                </button>
              ))
            : null}

          {activeTab === 'nai' && hasNai
            ? naiItems.map((item, index) => (
                <button
                  key={`nai-${index}-${item.content}`}
                  type="button"
                  className="hover:bg-muted w-full rounded border p-2 text-left font-mono text-sm"
                  onClick={() => onCopy(item.content)}
                >
                  {item.content}
                </button>
              ))
            : null}

          {!hasChildren && !hasComfy && !hasNai ? <p className="text-muted-foreground text-sm">No items</p> : null}
        </div>
      </div>
    </section>
  )
}
