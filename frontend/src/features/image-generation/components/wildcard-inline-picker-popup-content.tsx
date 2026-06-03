import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import type { WildcardRecord } from '@/lib/api-wildcards'
import { cn } from '@/lib/utils'
import type { WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'
import { WildcardInlinePickerExplorer } from './wildcard-inline-picker-explorer'
import {
  resolvePreferredWildcardItemTool,
  writeStoredWildcardFilterMode,
  type PromptWildcardTool,
  type WildcardFilterMode,
} from './wildcard-inline-picker-helpers'
import { renderHighlightedText } from './wildcard-inline-picker-field-ui'
import type { PromptInlineSyntaxSource } from './prompt-inline-syntax-settings'
import type {
  IndexedWildcardInlinePickerSuggestion,
  WildcardInlinePickerGroupSuggestion,
} from './use-wildcard-inline-picker-suggestions'
import type { MouseEvent } from 'react'

type WildcardInlinePickerPopupContentProps = {
  activeSource: PromptInlineSyntaxSource | null
  activeIndex: number
  activeListSuggestions: IndexedWildcardInlinePickerSuggestion[]
  activeExplorerTab: WildcardWorkspaceTab
  expandedExplorerIds: number[]
  explorerEntriesCount: number
  explorerTreeNodes: WildcardRecord[]
  filterMode: WildcardFilterMode
  groupSuggestions: WildcardInlinePickerGroupSuggestion[]
  isDanbooruDatabaseAvailable: boolean
  isDanbooruSummaryLoading: boolean
  isTreeExplorerMode: boolean
  isWildcardsLoading: boolean
  normalizedActiveQuery: string
  recentSuggestions: IndexedWildcardInlinePickerSuggestion[]
  remainingSuggestions: IndexedWildcardInlinePickerSuggestion[]
  selectedExplorerId: number | null
  tool: PromptWildcardTool
  onChangeActiveExplorerTab: (tab: WildcardWorkspaceTab) => void
  onChangeFilterMode: (mode: WildcardFilterMode) => void
  onInsertDanbooruGroup: (groupName: string) => void
  onInsertPreprocess: (preprocessName: string) => void
  onInsertWildcard: (wildcardName: string, syntaxText?: string) => void
  onSelectExplorerId: (wildcardId: number) => void
  onSetExplorerPinned: (pinned: boolean) => void
  onToggleExplorerExpanded: (wildcardId: number) => void
}

export function WildcardInlinePickerPopupContent({
  activeSource,
  activeIndex,
  activeListSuggestions,
  activeExplorerTab,
  expandedExplorerIds,
  explorerEntriesCount,
  explorerTreeNodes,
  filterMode,
  groupSuggestions,
  isDanbooruDatabaseAvailable,
  isDanbooruSummaryLoading,
  isTreeExplorerMode,
  isWildcardsLoading,
  normalizedActiveQuery,
  recentSuggestions,
  remainingSuggestions,
  selectedExplorerId,
  tool,
  onChangeActiveExplorerTab,
  onChangeFilterMode,
  onInsertDanbooruGroup,
  onInsertPreprocess,
  onInsertWildcard,
  onSelectExplorerId,
  onSetExplorerPinned,
  onToggleExplorerExpanded,
}: WildcardInlinePickerPopupContentProps) {
  const { t } = useI18n()

  const handleModeChange = (mode: WildcardFilterMode, pinned: boolean) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    onChangeFilterMode(mode)
    onSetExplorerPinned(pinned)
    writeStoredWildcardFilterMode(tool, mode)
  }

  const renderSuggestionButton = ({
    record,
    toolItemCount,
    generalItemCount,
    naiItemCount,
    comfyuiItemCount,
    recentIndex,
    index,
  }: IndexedWildcardInlinePickerSuggestion) => {
    const isActive = index === activeIndex
    const preferredBadgeTool = resolvePreferredWildcardItemTool(record.items, tool)

    return (
      <button
        key={record.id}
        type="button"
        onMouseDown={(event) => {
          event.preventDefault()
          if (activeSource === 'preprocess') {
            onInsertPreprocess(record.name)
          } else {
            onInsertWildcard(record.name)
          }
        }}
        className={cn(
          'flex w-full items-start justify-between gap-3 rounded-sm px-3 py-2 text-left transition-colors',
          isActive ? 'bg-surface-high' : 'hover:bg-surface-lowest',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{renderHighlightedText(record.name, normalizedActiveQuery)}</span>
            <Badge variant={record.type === 'chain' ? 'secondary' : 'outline'}>{record.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
            {record.isAutoCollected ? <Badge variant="outline">Auto LoRA</Badge> : null}
            {Number.isFinite(recentIndex) ? <Badge variant="secondary">{t('image-generation.components.wildcard.inline.picker.field.recent')}</Badge> : null}
            {toolItemCount === 0 ? <Badge variant="outline">{t('image-generation.components.wildcard.inline.picker.field.current.tool.is.empty')}</Badge> : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{renderHighlightedText(record.path.join(' / '), normalizedActiveQuery)}</div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge variant={preferredBadgeTool === 'general' ? 'secondary' : 'outline'}>General {generalItemCount}</Badge>
          <Badge variant={preferredBadgeTool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
          <Badge variant={preferredBadgeTool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
        </div>
      </button>
    )
  }

  return (
    <>
      <div className="space-y-2 border-b border-border/70 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {activeSource === 'wildcard' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onMouseDown={handleModeChange('available-only', false)}
                className={cn(
                  'rounded-sm border px-2 py-1 text-xs transition-colors',
                  filterMode === 'available-only' ? 'border-primary bg-surface-high text-foreground' : 'border-border bg-surface-lowest hover:bg-surface-high',
                )}
              >
                {t('image-generation.components.wildcard.inline.picker.field.search')}
              </button>
              <button
                type="button"
                onMouseDown={handleModeChange('all', true)}
                className={cn(
                  'rounded-sm border px-2 py-1 text-xs transition-colors',
                  filterMode === 'all' ? 'border-primary bg-surface-high text-foreground' : 'border-border bg-surface-lowest hover:bg-surface-high',
                )}
              >
                {t('image-generation.components.wildcard.inline.picker.field.browse.all')}
              </button>
            </div>
          ) : (
            <div className="text-xs font-medium text-muted-foreground">
              {activeSource === 'danbooru-group' ? t({ ko: '태그 그룹', en: 'Tag Groups' }) : t({ ko: '전처리', en: 'Preprocess' })}
            </div>
          )}
          <Badge variant="outline">{activeSource === 'danbooru-group' ? groupSuggestions.length : isTreeExplorerMode ? explorerEntriesCount : activeListSuggestions.length}</Badge>
        </div>
      </div>

      {activeSource === 'danbooru-group' ? (
        isDanbooruSummaryLoading ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">{t({ ko: '태그 그룹을 불러오는 중', en: 'Loading tag groups' })}</div>
        ) : groupSuggestions.length > 0 ? (
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {groupSuggestions.map((group, index) => {
              const isActive = index === activeIndex
              return (
                <button
                  key={group.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onInsertDanbooruGroup(group.label)
                  }}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 rounded-sm px-3 py-2 text-left transition-colors',
                    isActive ? 'bg-surface-high' : 'hover:bg-surface-lowest',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{renderHighlightedText(group.label, normalizedActiveQuery)}</span>
                    {group.translatedLabel ? <span className="block truncate text-xs text-muted-foreground">{group.translatedLabel}</span> : null}
                  </span>
                  <Badge variant="outline">{group.count}</Badge>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            {!isDanbooruDatabaseAvailable
              ? t({ ko: 'Danbooru DB가 없어서 태그 그룹을 사용할 수 없어.', en: 'Danbooru DB is missing, so tag groups are unavailable.' })
              : t({ ko: '일치하는 태그 그룹 없음', en: 'No matching tag groups' })}
          </div>
        )
      ) : isWildcardsLoading ? (
        <div className="px-3 py-3 text-sm text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.loading.wildcards')}</div>
      ) : isTreeExplorerMode ? (
        <WildcardInlinePickerExplorer
          activeTab={activeExplorerTab}
          expandedWildcardIds={expandedExplorerIds}
          selectedWildcardId={selectedExplorerId}
          tool={tool}
          treeNodes={explorerTreeNodes}
          onChangeActiveTab={onChangeActiveExplorerTab}
          onInsertWildcard={onInsertWildcard}
          onSelectWildcard={onSelectExplorerId}
          onToggleExpanded={onToggleExplorerExpanded}
        />
      ) : activeListSuggestions.length > 0 ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
          {recentSuggestions.length > 0 ? (
            <div className="space-y-1">
              <div className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.recent')}</div>
              <div className="space-y-1">
                {recentSuggestions.map(renderSuggestionButton)}
              </div>
            </div>
          ) : null}

          {remainingSuggestions.length > 0 ? (
            <div className="space-y-1">
              {recentSuggestions.length > 0 ? <div className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.all.results')}</div> : null}
              <div className="space-y-1">
                {remainingSuggestions.map(renderSuggestionButton)}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 px-3 py-3 text-sm text-muted-foreground">
          <div>{activeSource === 'preprocess' ? t({ ko: '일치하는 전처리 없음', en: 'No matching preprocess entries' }) : t('image-generation.components.wildcard.inline.picker.field.no.matching.wildcards')}</div>
          {activeSource === 'wildcard' && filterMode === 'available-only' ? <div className="text-xs">{t('image-generation.components.wildcard.inline.picker.field.search.mode.may.hide.wildcards.dedicated.to')}</div> : null}
        </div>
      )}
    </>
  )
}
