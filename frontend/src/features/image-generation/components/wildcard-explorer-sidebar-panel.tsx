import { Folder, FolderPlus, History, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { WildcardRecord } from '@/lib/api-wildcards'
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
  const { t, formatNumber } = useI18n()
  const hasSearch = searchInput.trim().length > 0
  const resultBadgeLabel = hasSearch
    ? t({ ko: '{visible} / {total}', en: '{visible} / {total}' }, { visible: formatNumber(filteredEntries.length), total: formatNumber(browserEntries.length) })
    : formatNumber(browserEntries.length)

  return (
    <ExplorerSidebar
      title={t({ ko: '탐색기', en: 'Explorer' })}
      badge={<Badge variant="outline">{resultBadgeLabel}</Badge>}
      floatingFrame
      floatingLockStorageKey="conai:wildcards:sidebar-locked"
      className={cn(isWideLayout && 'sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1')}
      headerExtra={(
        <div className="space-y-3 pb-1">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeWorkspaceTab === 'lora' ? (
              <>
                {canScanLora ? (
                  <IconButton
                    size="icon-sm"
                    variant="secondary"
                    onClick={onOpenLoraCollect}
                    label={t('image-generation.components.wildcard.explorer.sidebar.panel.auto.collect')}
                  >
                    <Upload className="h-4 w-4" />
                  </IconButton>
                ) : null}
                <IconButton
                  size="icon-sm"
                  variant="secondary"
                  onClick={onRefreshLoraLog}
                  disabled={isRefreshingLog}
                  label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh.logs')}
                >
                  <History className="h-4 w-4" />
                </IconButton>
              </>
            ) : (
              <>
                {canEditInActiveTab ? (
                  <>
                    <IconButton
                      size="icon-sm"
                      variant="secondary"
                      onClick={() => onOpenCreate(selectedWildcard?.id ?? null)}
                      disabled={!canCreateInActiveTab}
                      label={t('image-generation.components.wildcard.explorer.sidebar.panel.add.item')}
                    >
                      <FolderPlus className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      size="icon-sm"
                      variant="secondary"
                      onClick={onOpenEdit}
                      disabled={!selectedWildcard}
                      label={t('image-generation.components.wildcard.explorer.sidebar.panel.edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                  </>
                ) : null}
                {canDeleteInActiveTab ? (
                  <IconButton
                    size="icon-sm"
                    variant="secondary"
                    className="hover:text-destructive"
                    onClick={onDeleteSelected}
                    disabled={!selectedWildcard || isDeleting}
                    label={t('image-generation.components.wildcard.explorer.sidebar.panel.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input value={searchInput} onChange={(event) => onSearchChange(event.target.value)} placeholder={t('image-generation.components.wildcard.explorer.sidebar.panel.search.name.or.path')} />
            <IconButton
              size="icon-sm"
              variant="secondary"
              className="shrink-0"
              onClick={onRefresh}
              label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh')}
            >
              <RefreshCw className="h-4 w-4" />
            </IconButton>
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
            <div className="space-y-1">
              {filteredEntries.map((entry) => {
                const wildcard = entry.wildcard
                const isSelected = wildcard.id === selectedWildcardId
                return (
                  <Button
                    key={wildcard.id}
                    type="button"
                    variant="nav"
                    data-active={isSelected || undefined}
                    onClick={() => onSelectWildcard(wildcard.id)}
                    className="h-auto flex-col items-stretch gap-1 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Folder className="shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium text-foreground">{wildcard.name}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{entry.path.join(' / ')}</span>
                  </Button>
                )
              })}
            </div>
          ) : (
            <Text variant="muted">{t('image-generation.components.wildcard.explorer.sidebar.panel.no.search.results')}</Text>
          )
        ) : browserTreeNodes.length > 0 ? (
          <WildcardTree entries={browserEntries} selectedId={selectedWildcardId} onSelect={onSelectWildcard} />
        ) : (
          <Text variant="muted">{t('image-generation.components.wildcard.explorer.sidebar.panel.no.items.to.display.yet')}</Text>
        )
      ) : null}
    </ExplorerSidebar>
  )
}
