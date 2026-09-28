import { Folder, History, Plus, Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { WildcardRecord } from '@/lib/api-wildcards'
import type { WildcardTreeEntry, WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'
import { WildcardTree } from './wildcard-browser-cards'

interface WildcardExplorerSidebarPanelProps {
  activeWorkspaceTab: WildcardWorkspaceTab
  tabLabel: string
  browserEntries: WildcardTreeEntry[]
  browserTreeNodes: WildcardRecord[]
  filteredEntries: WildcardTreeEntry[]
  selectedWildcardId: number | null
  selectedWildcard: WildcardRecord | null
  searchInput: string
  canCreateInActiveTab: boolean
  canEditInActiveTab: boolean
  canScanLora: boolean
  isLoading: boolean
  isError: boolean
  isRefreshingLog: boolean
  errorMessage?: string | null
  onOpenLoraCollect: () => void
  onRefreshLoraLog: () => void
  onOpenCreate: (defaultParentId: number | null) => void
  onSelectWildcard: (wildcardId: number) => void
}

/** Sidebar of /wildcards: the active tab's tree (or the search matches) with add / LoRA collect keys on the label. */
export function WildcardExplorerSidebarPanel({
  activeWorkspaceTab,
  tabLabel,
  browserEntries,
  browserTreeNodes,
  filteredEntries,
  selectedWildcardId,
  selectedWildcard,
  searchInput,
  canCreateInActiveTab,
  canEditInActiveTab,
  canScanLora,
  isLoading,
  isError,
  isRefreshingLog,
  errorMessage,
  onOpenLoraCollect,
  onRefreshLoraLog,
  onOpenCreate,
  onSelectWildcard,
}: WildcardExplorerSidebarPanelProps) {
  const { t, formatNumber } = useI18n()
  const hasSearch = searchInput.trim().length > 0
  const countLabel = hasSearch
    ? `${formatNumber(filteredEntries.length)} / ${formatNumber(browserEntries.length)}`
    : formatNumber(browserEntries.length)

  const labelActions = activeWorkspaceTab === 'lora' ? (
    <>
      {canScanLora ? (
        <IconButton size="icon-xs" variant="ghost" onClick={onOpenLoraCollect} label={t('image-generation.components.wildcard.explorer.sidebar.panel.auto.collect')}>
          <Upload />
        </IconButton>
      ) : null}
      <IconButton size="icon-xs" variant="ghost" onClick={onRefreshLoraLog} disabled={isRefreshingLog} label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh.logs')}>
        <History />
      </IconButton>
    </>
  ) : canEditInActiveTab ? (
    <IconButton
      size="icon-xs"
      variant="ghost"
      onClick={() => onOpenCreate(selectedWildcard?.id ?? null)}
      disabled={!canCreateInActiveTab}
      label={t('image-generation.components.wildcard.explorer.sidebar.panel.add.item')}
    >
      <Plus />
    </IconButton>
  ) : null

  return (
    <SidebarNav>
      <SidebarGroupLabel actions={labelActions}>
        {tabLabel} <span className="ml-1 tabular-nums">{countLabel}</span>
      </SidebarGroupLabel>

      {isLoading ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="my-0.5 h-8 w-full rounded-sm" />) : null}

      {isError ? (
        <Alert variant="destructive" className="mt-2">
          <AlertTitle>{t('image-generation.components.wildcard.explorer.sidebar.panel.could.not.load.list')}</AlertTitle>
          <AlertDescription>{errorMessage ?? t('image-generation.components.wildcard.explorer.sidebar.panel.could.not.load.the.list')}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !isError ? (
        hasSearch ? (
          filteredEntries.length > 0 ? (
            filteredEntries.map((entry) => (
              <SidebarItem
                key={entry.wildcard.id}
                icon={Folder}
                label={entry.wildcard.name}
                title={entry.path.join(' / ')}
                active={entry.wildcard.id === selectedWildcardId}
                onClick={() => onSelectWildcard(entry.wildcard.id)}
              />
            ))
          ) : (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('image-generation.components.wildcard.explorer.sidebar.panel.no.search.results')}</p>
          )
        ) : browserTreeNodes.length > 0 ? (
          <WildcardTree entries={browserEntries} selectedId={selectedWildcardId} onSelect={onSelectWildcard} />
        ) : (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('image-generation.components.wildcard.explorer.sidebar.panel.no.items.to.display.yet')}</p>
        )
      ) : null}
    </SidebarNav>
  )
}
