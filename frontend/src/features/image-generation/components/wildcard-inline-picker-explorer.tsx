import { ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import { useMemo, type MouseEventHandler } from 'react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { WildcardRecord } from '@/lib/api-wildcards'
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
  const expandedWildcardIdSet = useMemo(() => new Set(expandedWildcardIds), [expandedWildcardIds])

  const renderExplorerTree = (nodes: WildcardRecord[], depth = 0) => {
    if (nodes.length === 0) {
      return null
    }

    return (
      <div className="space-y-1">
        {nodes.map((node) => {
          const hasChildren = (node.children?.length ?? 0) > 0
          const isExpanded = expandedWildcardIdSet.has(node.id)
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
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onMouseDown={handleToggleExpanded}
                    label={isExpanded ? t('image-generation.components.wildcard.inline.picker.explorer.collapse') : t('image-generation.components.wildcard.inline.picker.explorer.expand')}
                    tooltip={false}
                  >
                    <ChevronRight className={cn('transition-transform', isExpanded && 'rotate-90')} />
                  </IconButton>
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                )}

                <Button
                  type="button"
                  variant="nav"
                  size="sm"
                  data-active={isSelected || undefined}
                  onMouseDown={handleSelect}
                  className="min-w-0 flex-1 px-2 text-foreground"
                  title={node.name}
                >
                  {hasChildren || isSelected ? <FolderOpen /> : <Folder />}
                  <span className="truncate">{node.name}</span>
                </Button>

                <div className="hidden shrink-0 items-center gap-1 md:flex">
                  <Badge variant={preferredBadgeTool === 'general' ? 'secondary' : 'outline'}>General {generalItemCount}</Badge>
                  <Badge variant={preferredBadgeTool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
                  <Badge variant={preferredBadgeTool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
                </div>

                <IconButton
                  size="icon-sm"
                  variant="secondary"
                  onMouseDown={handleInsert}
                  label={t({ ko: '{label} {syntax} 추가', en: 'Add {label} {syntax}' }, { label: insertLabel, syntax: insertSyntax })}
                  tooltipSide="left"
                >
                  <Plus />
                </IconButton>
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
      <div className="px-3 py-2">
        <SegmentedTabBar
          value={activeTab}
          items={tabs}
          onChange={(value) => onChangeActiveTab(value as WildcardWorkspaceTab)}
          fullWidth
          size="xs"
        />
      </div>

      <div className="max-h-80 overflow-y-auto p-2">
        {treeNodes.length > 0 ? (
          <div className="space-y-1">
            {renderExplorerTree(treeNodes)}
          </div>
        ) : (
          <Text variant="muted" className="px-3 py-3">{t('image-generation.components.wildcard.inline.picker.explorer.no.items.in.this.category.yet')}</Text>
        )}
      </div>
    </>
  )
}
