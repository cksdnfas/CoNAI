import { Folder, FolderPlus, History, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { WildcardRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WildcardTreeEntry, WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'
import { WildcardTree } from './wildcard-browser-cards'

export interface WildcardExplorerSidebarPanelProps {
  isWideLayout: boolean
  activeWorkspaceTab: WildcardWorkspaceTab
  browserEntries: WildcardTreeEntry[]
  browserTreeNodes: WildcardRecord[]
  filteredEntries: WildcardTreeEntry[]
  selectedWildcardId: number | null
  selectedWildcard: WildcardRecord | null
  searchInput: string
  canCreateInActiveTab: boolean
  isLoading: boolean
  isError: boolean
  isDeleting: boolean
  isRefreshingLog: boolean
  errorMessage?: string | null
  onSearchChange: (value: string) => void
  onRefresh: () => void
  onOpenLoraCollect: () => void
  onRefreshLoraLog: () => void
  onOpenCreate: (defaultParentId: number | null) => void
  onOpenEdit: () => void
  onDeleteSelected: () => void
  onSelectWildcard: (wildcardId: number) => void
}

/** Render the wildcard explorer sidebar with header actions, search, and tree/list results. */
export function WildcardExplorerSidebarPanel({
  isWideLayout,
  activeWorkspaceTab,
  browserEntries,
  browserTreeNodes,
  filteredEntries,
  selectedWildcardId,
  selectedWildcard,
  searchInput,
  canCreateInActiveTab,
  isLoading,
  isError,
  isDeleting,
  isRefreshingLog,
  errorMessage,
  onSearchChange,
  onRefresh,
  onOpenLoraCollect,
  onRefreshLoraLog,
  onOpenCreate,
  onOpenEdit,
  onDeleteSelected,
  onSelectWildcard,
}: WildcardExplorerSidebarPanelProps) {
  return (
    <ExplorerSidebar
      title="Explorer"
      badge={<Badge variant="outline">{browserEntries.length}</Badge>}
      floatingFrame
      className={cn(isWideLayout && 'sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1')}
      headerExtra={(
        <div className="space-y-3 border-b border-white/5 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {activeWorkspaceTab === 'lora' ? (
              <>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="bg-surface-low"
                  onClick={onOpenLoraCollect}
                  aria-label="자동 수집"
                  title="자동 수집"
                >
                  <Upload className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="bg-surface-low"
                  onClick={onRefreshLoraLog}
                  disabled={isRefreshingLog}
                  aria-label="로그 새로고침"
                  title="로그 새로고침"
                >
                  <History className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="bg-surface-low"
                  onClick={() => onOpenCreate(selectedWildcard?.id ?? null)}
                  disabled={!canCreateInActiveTab}
                  aria-label="항목 추가"
                  title="항목 추가"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="bg-surface-low"
                  onClick={onOpenEdit}
                  disabled={!selectedWildcard}
                  aria-label="편집"
                  title="편집"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="ml-2 bg-surface-low"
                  onClick={onDeleteSelected}
                  disabled={!selectedWildcard || isDeleting}
                  aria-label="삭제"
                  title="삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input value={searchInput} onChange={(event) => onSearchChange(event.target.value)} placeholder="이름 또는 경로 검색" />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 bg-surface-low"
              onClick={onRefresh}
              aria-label="새로고침"
              title="새로고침"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>목록을 불러오지 못했어</AlertTitle>
          <AlertDescription>{errorMessage ?? '목록을 불러오지 못했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !isError ? (
        searchInput.trim().length > 0 ? (
          filteredEntries.length > 0 ? (
            <div className="space-y-2">
              {filteredEntries.map((entry) => {
                const wildcard = entry.wildcard
                const isSelected = wildcard.id === selectedWildcardId
                return (
                  <button
                    key={wildcard.id}
                    type="button"
                    onClick={() => onSelectWildcard(wildcard.id)}
                    className={cn(
                      'w-full rounded-sm border px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-surface-high'
                        : 'border-border bg-surface-lowest hover:border-primary/35',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium text-foreground">{wildcard.name}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{entry.path.join(' / ')}</div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">검색 결과가 없어.</div>
          )
        ) : browserTreeNodes.length > 0 ? (
          <WildcardTree entries={browserEntries} selectedId={selectedWildcardId} onSelect={onSelectWildcard} />
        ) : (
          <div className="text-sm text-muted-foreground">표시할 항목이 아직 없어.</div>
        )
      ) : null}
    </ExplorerSidebar>
  )
}
