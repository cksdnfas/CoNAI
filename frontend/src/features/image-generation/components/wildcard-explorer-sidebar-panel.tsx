import { Folder, FolderPlus, History, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { WildcardRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WildcardTreeEntry, WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'
import { WildcardTree } from './wildcard-browser-cards'

interface WildcardExplorerSidebarPanelProps {
  isWideLayout: boolean
  activeWorkspaceTab: WildcardWorkspaceTab
  browserEntries: WildcardTreeEntry[]
  browserTreeNodes: WildcardRecord[]
  filteredEntries: WildcardTreeEntry[]
  selectedWildcardId: number | null
  selectedWildcard: WildcardRecord | null
  searchInput: string
  canCreateInActiveTab: boolean
  canEditInActiveTab: boolean
  canDeleteInActiveTab: boolean
  canScanLora: boolean
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
  canEditInActiveTab,
  canDeleteInActiveTab,
  canScanLora,
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
  const { t } = useI18n()

  return (
    <ExplorerSidebar
      title={t({ ko: '탐색기', en: 'Explorer' })}
      badge={<Badge variant="outline">{browserEntries.length}</Badge>}
      floatingFrame
      floatingLockStorageKey="conai:wildcards:sidebar-locked"
      className={cn(isWideLayout && 'sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1')}
      headerExtra={(
        <div className="space-y-3 border-b border-white/5 pb-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeWorkspaceTab === 'lora' ? (
              <>
                {canScanLora ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="bg-surface-low"
                    onClick={onOpenLoraCollect}
                    aria-label={t('image-generation.components.wildcard.explorer.sidebar.panel.auto.collect')}
                    title={t('image-generation.components.wildcard.explorer.sidebar.panel.auto.collect')}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="bg-surface-low"
                  onClick={onRefreshLoraLog}
                  disabled={isRefreshingLog}
                  aria-label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh.logs')}
                  title={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh.logs')}
                >
                  <History className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                {canEditInActiveTab ? (
                  <>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="bg-surface-low"
                      onClick={() => onOpenCreate(selectedWildcard?.id ?? null)}
                      disabled={!canCreateInActiveTab}
                      aria-label={t('image-generation.components.wildcard.explorer.sidebar.panel.add.item')}
                      title={t('image-generation.components.wildcard.explorer.sidebar.panel.add.item')}
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
                      aria-label={t('image-generation.components.wildcard.explorer.sidebar.panel.edit')}
                      title={t('image-generation.components.wildcard.explorer.sidebar.panel.edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
                {canDeleteInActiveTab ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="border-rose-500/30 bg-surface-low text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                    onClick={onDeleteSelected}
                    disabled={!selectedWildcard || isDeleting}
                    aria-label={t('image-generation.components.wildcard.explorer.sidebar.panel.delete')}
                    title={t('image-generation.components.wildcard.explorer.sidebar.panel.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input value={searchInput} onChange={(event) => onSearchChange(event.target.value)} placeholder={t('image-generation.components.wildcard.explorer.sidebar.panel.search.name.or.path')} />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 bg-surface-low"
              onClick={onRefresh}
              aria-label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh')}
              title={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh')}
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
          <AlertTitle>{t('image-generation.components.wildcard.explorer.sidebar.panel.could.not.load.list')}</AlertTitle>
          <AlertDescription>{errorMessage ?? t('image-generation.components.wildcard.explorer.sidebar.panel.could.not.load.the.list')}</AlertDescription>
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
            <div className="text-sm text-muted-foreground">{t('image-generation.components.wildcard.explorer.sidebar.panel.no.search.results')}</div>
          )
        ) : browserTreeNodes.length > 0 ? (
          <WildcardTree entries={browserEntries} selectedId={selectedWildcardId} onSelect={onSelectWildcard} />
        ) : (
          <div className="text-sm text-muted-foreground">{t('image-generation.components.wildcard.explorer.sidebar.panel.no.items.to.display.yet')}</div>
        )
      ) : null}
    </ExplorerSidebar>
  )
}
