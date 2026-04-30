import { ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import type { MouseEventHandler } from 'react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import type { WildcardRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  type WildcardWorkspaceTab,
} from './wildcard-generation-panel-helpers'
import { countStoredWildcardItemsForTool, resolvePreferredWildcardItemTool, type PromptWildcardTool } from './wildcard-inline-picker-helpers'

type WildcardInlinePickerExplorerProps = {
  activeTab: WildcardWorkspaceTab
  expandedWildcardIds: number[]
  selectedWildcardId: number | null
  tool: PromptWildcardTool
  treeNodes: WildcardRecord[]
  onChangeActiveTab: (tab: WildcardWorkspaceTab) => void
  onInsertWildcard: (wildcardName: string, syntaxText?: string) => void
  onSelectWildcard: (wildcardId: number) => void
  onToggleExpanded: (wildcardId: number) => void
}

function getWildcardInlineExplorerTabs(t: ReturnType<typeof useI18n>['t']): Array<{ value: WildcardWorkspaceTab; label: string }> {
  return [
    { value: 'wildcards', label: t('image-generation.components.wildcard.inline.picker.explorer.wildcard') },
    { value: 'preprocess', label: t('image-generation.components.wildcard.inline.picker.explorer.preprocess') },
    { value: 'lora', label: t('image-generation.components.wildcard.inline.picker.explorer.lora') },
  ]
}

/** Render the bounded tree explorer UI for inline wildcard browsing. */
export function WildcardInlinePickerExplorer({
  activeTab,
  expandedWildcardIds,
  selectedWildcardId,
  tool,
  treeNodes,
  onChangeActiveTab,
  onInsertWildcard,
  onSelectWildcard,
  onToggleExpanded,
}: WildcardInlinePickerExplorerProps) {
  const { t } = useI18n()
  const tabs = getWildcardInlineExplorerTabs(t)

  const renderExplorerTree = (nodes: WildcardRecord[], depth = 0) => {
    if (nodes.length === 0) {
      return null
    }

    return (
      <div className="space-y-1">
        {nodes.map((node) => {
          const hasChildren = (node.children?.length ?? 0) > 0
          const isExpanded = expandedWildcardIds.includes(node.id)
          const isSelected = selectedWildcardId === node.id
          const generalItemCount = countStoredWildcardItemsForTool(node.items ?? [], 'general')
          const naiItemCount = countStoredWildcardItemsForTool(node.items ?? [], 'nai')
          const comfyuiItemCount = countStoredWildcardItemsForTool(node.items ?? [], 'comfyui')

          const preferredBadgeTool = resolvePreferredWildcardItemTool(node.items ?? [], tool)

          const handleSelect: MouseEventHandler<HTMLButtonElement> = (event) => {
            event.preventDefault()
            onSelectWildcard(node.id)
            if (hasChildren) {
              onToggleExpanded(node.id)
            }
          }

          const handleToggleExpanded: MouseEventHandler<HTMLButtonElement> = (event) => {
            event.preventDefault()
            onToggleExpanded(node.id)
            onSelectWildcard(node.id)
          }

          const insertSyntax = getWildcardPromptSyntax(node.name, { type: node.type, tab: activeTab })
          const insertLabel = getWildcardPromptSyntaxLabel(
            { type: node.type, tab: activeTab },
            {
              preprocess: t({ ko: '전처리 키워드', en: 'Preprocess keyword' }),
              wildcard: t({ ko: '와일드카드 문법', en: 'Wildcard syntax' }),
            },
          )

          const handleInsert: MouseEventHandler<HTMLButtonElement> = (event) => {
            event.preventDefault()
            onInsertWildcard(node.name, insertSyntax)
          }

          return (
            <div key={node.id} className="space-y-1">
              <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    onMouseDown={handleToggleExpanded}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
                    aria-label={isExpanded ? t('image-generation.components.wildcard.inline.picker.explorer.collapse') : t('image-generation.components.wildcard.inline.picker.explorer.expand')}
                    title={isExpanded ? t('image-generation.components.wildcard.inline.picker.explorer.collapse') : t('image-generation.components.wildcard.inline.picker.explorer.expand')}
                  >
                    <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                )}

                <button
                  type="button"
                  onMouseDown={handleSelect}
                  className={cn(
                    'inline-flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    isSelected ? 'bg-surface-high text-foreground' : 'hover:bg-surface-lowest text-foreground',
                  )}
                  title={node.name}
                >
                  {hasChildren || isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{node.name}</span>
                </button>

                <div className="hidden shrink-0 items-center gap-1 md:flex">
                  <Badge variant={preferredBadgeTool === 'general' ? 'secondary' : 'outline'}>General {generalItemCount}</Badge>
                  <Badge variant={preferredBadgeTool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
                  <Badge variant={preferredBadgeTool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
                </div>

                <button
                  type="button"
                  onMouseDown={handleInsert}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-lowest text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground"
                  aria-label={t({ ko: '{syntax} 추가', en: 'Add {syntax}' }, { syntax: insertSyntax })}
                  title={t({ ko: '{label} {syntax} 추가', en: 'Add {label} {syntax}' }, { label: insertLabel, syntax: insertSyntax })}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {hasChildren && isExpanded ? renderExplorerTree(node.children ?? [], depth + 1) : null}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="border-b border-border/70 px-3 py-2">
        <SegmentedTabBar
          value={activeTab}
          items={tabs}
          onChange={(value) => onChangeActiveTab(value as WildcardWorkspaceTab)}
          fullWidth
          size="xs"
          className="border-b-0 pb-0"
        />
      </div>

      <div className="max-h-80 overflow-y-auto p-2">
        {treeNodes.length > 0 ? (
          <div className="space-y-1 rounded-sm border border-border/70 bg-surface-low p-2">
            {renderExplorerTree(treeNodes)}
          </div>
        ) : (
          <div className="rounded-sm border border-border/70 bg-surface-low px-3 py-3 text-sm text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.explorer.no.items.in.this.category.yet')}</div>
        )}
      </div>
    </>
  )
}
