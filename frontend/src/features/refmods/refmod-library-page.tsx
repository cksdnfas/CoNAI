import { useRef, type ReactNode } from 'react'
import { REFMOD_ENTRY_LIMITS } from '@conai/shared'
import { CheckCheck, CheckSquare, CopyPlus, Download, Hammer, Layers, Plus, RefreshCw, SquarePen, Star, StarOff, Trash2, Upload, Workflow } from 'lucide-react'
import { NameDialog } from '@/components/common/entry-dialogs'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { ToolbarSearchField } from '@/components/common/search-field'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { LoadMoreSentinel } from '@/features/posts/post-attach-shared'
import { useI18n } from '@/i18n'
import type { RefModEntrySort, RefModEntrySummary } from '@/lib/api-refmod-entries'
import { RefModEntryDialog } from './components/refmod-entry-dialog'
import { RefModImportDialog } from './components/refmod-import-dialog'
import { RefModRow } from './components/refmod-row'
import { RefModSidebar } from './components/refmod-sidebar'
import { refModBuildBlockReason, refModConceptLabel, refModEntryThumbs, refModMemberCounts, refModServerStatus } from './refmod-shared'
import { useRefModChatPage } from './use-refmod-chat-page'
import { useRefModLibrary, type RefModUnregisteredRow } from './use-refmod-library'

/**
 * RefMod view of the character page (/characters?view=refmods): RefMod entries as hairline rows with their member
 * squares, the default server's status (loaded on its own), unregistered rows (saved runs and server-only names) with a
 * 등록 key, filters by server and concept, search, sort, several-select, ZIP export / import and the build key on every
 * row; `entry=<id>` opens an entry's window over the list. `viewSwitch` is the character page's view switch and leads
 * the toolbar. Without characters.edit everything only shows; building also needs generation.execute.
 */
export function RefModLibraryPage({ viewSwitch }: { viewSwitch: ReactNode }) {
  const { t, formatDate } = useI18n()
  const library = useRefModLibrary()
  useRefModChatPage(library)
  const { canEdit, canBuild, canViewImages, editor, list, visibleEntries, total, selected, selectMode, presence } = library
  const importInput = useRef<HTMLInputElement | null>(null)
  const filtering = Boolean(library.query) || Boolean(library.concept) || library.serverFilter !== 'all'

  const entryStatus = (entry: RefModEntrySummary) => refModServerStatus(t, library.isPending(entry), presence.data, presence.isError, library.isOnServer(entry.name))
  const entryBlock = (entry: RefModEntrySummary) => refModBuildBlockReason(t, { ...entry, pending: library.isPending(entry) }, presence.data)
  const entryMenu = (entry: RefModEntrySummary): ActionMenuEntry[] => {
    const block = entryBlock(entry)
    return [
      { key: 'open', label: canEdit ? t({ ko: '편집', en: 'Edit' }) : t({ ko: '열기', en: 'Open' }), icon: SquarePen, onSelect: () => library.openEntry(entry.id) },
      canBuild ? { key: 'build', label: block ?? t({ ko: '만들기', en: 'Build' }), icon: Hammer, disabled: Boolean(block), onSelect: () => void library.build(entry) } : null,
      canEdit ? { key: 'favorite', label: entry.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' }), icon: entry.favorite ? StarOff : Star, disabled: library.bulkPending, onSelect: () => library.toggleFavorite(entry) } : null,
      canEdit ? { key: 'duplicate', label: t({ ko: '복제', en: 'Duplicate' }), icon: CopyPlus, onSelect: () => void library.duplicate(entry) } : null,
      { key: 'export', label: t({ ko: '내보내기', en: 'Export' }), icon: Download, onSelect: () => void library.exportEntries({ ids: [entry.id] }, entry.name) },
      canEdit ? { key: 'select', label: selected.has(entry.id) ? t({ ko: '선택 해제', en: 'Deselect' }) : t({ ko: '선택', en: 'Select' }), icon: CheckSquare, onSelect: () => { library.setSelectMode(true); library.toggleSelected(entry) } } : null,
      canEdit ? '-' : null,
      canEdit ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: library.isPending(entry), onSelect: () => void library.remove(entry) } : null,
    ]
  }

  const renderEntry = (entry: RefModEntrySummary) => {
    const thumbs = refModEntryThumbs(t, entry.id, entry.members, canViewImages)
    const block = entryBlock(entry)
    return (
      <RefModRow
        key={entry.id}
        name={entry.name}
        concept={refModConceptLabel(t, entry.conceptType)}
        counts={refModMemberCounts(t, entry.members.map((member) => member.kind))}
        meta={entry.lastBuiltAt ? formatDate(entry.lastBuiltAt) : null}
        thumbs={thumbs}
        status={entryStatus(entry)}
        favorite={entry.favorite}
        selected={selectMode ? selected.has(entry.id) : undefined}
        onToggleSelected={() => library.toggleSelected(entry)}
        onOpen={() => library.openEntry(entry.id)}
        onOpenMedia={(thumb) => library.openMedia(thumbs, thumb)}
        actions={<>
          {canBuild ? (
            <IconButton variant="ghost" size="icon-sm" aria-busy={library.isPending(entry)} disabled={Boolean(block)} label={block ?? t({ ko: '‘{name}’ 만들기', en: 'Build ‘{name}’' }, { name: entry.name })} onClick={() => void library.build(entry)}>
              <Hammer />
            </IconButton>
          ) : null}
          <ActionMenuButton label={t({ ko: '‘{name}’ 작업', en: '‘{name}’ actions' }, { name: entry.name })} entries={entryMenu(entry)} />
        </>}
      />
    )
  }

  const unregisteredStatus = { label: t({ ko: '미등록', en: 'Unregistered' }), tone: 'warning' as const }
  const renderUnregistered = (row: RefModUnregisteredRow) => (
    <RefModRow
      key={row.key}
      name={row.name}
      concept={refModConceptLabel(t, row.conceptType)}
      counts={refModMemberCounts(t, row.kinds)}
      meta={row.kind === 'record' ? formatDate(row.createdAt) : t({ ko: '서버에만 있음', en: 'Server only' })}
      thumbs={row.thumbs}
      status={unregisteredStatus}
      onOpenMedia={(thumb) => library.openMedia(row.thumbs, thumb)}
      actions={canEdit ? (
        <IconButton variant="ghost" size="icon-sm" disabled={library.adoptPending} label={t({ ko: '‘{name}’ 등록', en: 'Register ‘{name}’' }, { name: row.name })} onClick={() => void library.adopt([row])}>
          <Plus />
        </IconButton>
      ) : undefined}
    />
  )

  const listFooter: ReactNode = list.isFetchNextPageError ? (
    <ErrorState size="compact" title={t({ ko: '다음 RefMod를 불러오지 못했어', en: 'Could not load more RefMods' })} error={list.error} onRetry={() => void list.fetchNextPage()} isRetrying={list.isFetchingNextPage} />
  ) : <>
    {/* The server filter narrows loaded batches here, so the sentinel keeps loading while it stays in view. */}
    <LoadMoreSentinel rootMargin="800px" enabled={list.hasNextPage && !list.isFetchingNextPage} onVisible={() => void list.fetchNextPage({ cancelRefetch: false })} />
    {list.isFetchingNextPage ? <LoadingState variant="inline" /> : null}
  </>

  const serverBadge = presence.isPending ? null
    : presence.isError ? { label: t({ ko: '서버 확인 불가', en: 'Server unknown' }), tone: 'warning' as const, title: undefined }
      : presence.data?.status === 'ok' ? { label: presence.data.serverName, tone: 'secondary' as const, title: t({ ko: '대표 ComfyUI 서버', en: 'Default ComfyUI server' }) }
        : presence.data?.status === 'no-server' ? { label: t({ ko: '대표 서버 없음', en: 'No default server' }), tone: 'warning' as const, title: presence.data.message }
          : presence.data ? { label: t({ ko: '서버 확인 불가', en: 'Server unknown' }), tone: 'warning' as const, title: presence.data.message } : null

  const toolbar = (
    <PageToolbar
      start={viewSwitch}
      actions={(
        <>
          <Select variant="default" controlSize="compact" className="w-auto" aria-label={t({ ko: '정렬', en: 'Sort' })} value={library.sort} onChange={(event) => library.setListView({ sort: event.target.value as RefModEntrySort })}>
            <option value="updated">{t({ ko: '최근 수정순', en: 'Recently edited' })}</option>
            <option value="name">{t({ ko: '이름순', en: 'Name' })}</option>
            <option value="created">{t({ ko: '최근 추가순', en: 'Newest' })}</option>
            <option value="built">{t({ ko: '최근 만든 순', en: 'Recently built' })}</option>
          </Select>
          {serverBadge ? <Tip content={serverBadge.title}><Badge variant={serverBadge.tone} size="sm" casing="sentence" className="hidden max-w-40 truncate sm:inline-flex">{serverBadge.label}</Badge></Tip> : null}
          <IconButton variant="ghost" size="icon-sm" aria-busy={presence.isFetching} disabled={presence.isFetching} label={t({ ko: '서버 상태 새로고침', en: 'Refresh server status' })} onClick={() => void library.refreshPresence()}><RefreshCw /></IconButton>
          {canEdit ? <IconButton variant="ghost" size="icon-sm" active={selectMode} label={selectMode ? t({ ko: '선택 끝내기', en: 'Stop selecting' }) : t({ ko: '여러 개 선택', en: 'Select several' })} onClick={() => { if (selectMode) library.clearSelection(); else library.setSelectMode(true) }}><CheckSquare /></IconButton> : null}
          <ActionMenuButton
            label={t({ ko: 'RefMod 작업', en: 'RefMod actions' })}
            entries={[
              { key: 'export', label: t({ ko: 'RefMod 전체 내보내기', en: 'Export every RefMod' }), icon: Download, onSelect: () => void library.exportEntries({}, 'refmods') },
              canEdit ? { key: 'import', label: t({ ko: 'RefMod 묶음 ZIP 가져오기', en: 'Import a RefMod bundle' }), icon: Upload, onSelect: () => importInput.current?.click() } : null,
              canEdit ? { key: 'adopt', label: t({ ko: '미등록 전부 등록', en: 'Register every unregistered' }), icon: Layers, disabled: !library.unregisteredCount || library.adoptPending, onSelect: () => void library.adoptAll() } : null,
              library.canAddWorkflow ? { key: 'workflow', label: t({ ko: 'RefMod 생성 워크플로 추가', en: 'Add the RefMod creation workflow' }), icon: Workflow, disabled: library.addingWorkflow, onSelect: () => void library.addCreationWorkflow() } : null,
            ]}
          />
          {canEdit ? <Button size="sm" onClick={() => library.setCreating({ name: '', error: null })}><Plus />{t({ ko: '새 RefMod', en: 'New RefMod' })}</Button> : null}
          <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) library.setImporting({ file, conflict: 'skip' }) }} />
        </>
      )}
    >
      <ToolbarSearchField value={library.searchText} onChange={library.setSearchText} placeholder={t({ ko: '이름·설명·검색어·멤버 설명', en: 'Names, descriptions, keywords, members' })} />
    </PageToolbar>
  )

  const showsEntries = library.serverFilter !== 'unregistered'
  const unregisteredRows = library.unregisteredRows
  return (
    <PageWithSidebar
      storageKey="refmods"
      sidebarLabel={t({ ko: 'RefMod 필터', en: 'RefMod filters' })}
      sidebar={(
        <RefModSidebar
          server={library.serverFilter}
          concept={library.concept}
          total={total}
          unregisteredCount={library.unregisteredCount}
          onServer={(server) => library.setListView({ server })}
          onConcept={(concept) => library.setListView({ concept })}
        />
      )}
      toolbar={toolbar}
    >
      <div className="space-y-8">
        {unregisteredRows.length ? (
          <RowGroup heading={t({ ko: '미등록', en: 'Unregistered' })} count={unregisteredRows.length}>
            {unregisteredRows.map(renderUnregistered)}
          </RowGroup>
        ) : library.serverFilter === 'unregistered' ? (
          library.unregistered.isPending ? <LoadingState variant="inline" />
            : library.unregistered.isError ? <ErrorState title={t({ ko: '미등록 RefMod를 불러오지 못했어', en: 'Could not load unregistered RefMods' })} error={library.unregistered.error} onRetry={() => void library.unregistered.refetch()} />
              : <EmptyState icon={Layers} title={t({ ko: '미등록 RefMod가 없어', en: 'No unregistered RefMods' })} />
        ) : null}
        {showsEntries ? (
          <RowGroup heading="RefMod" count={library.serverFilter === 'all' ? total : undefined}>
            {list.isPending ? <LoadingState variant="inline" />
              : list.isError && !visibleEntries ? <ErrorState title={t({ ko: 'RefMod를 불러오지 못했어', en: 'Could not load RefMods' })} error={list.error} onRetry={() => void list.refetch()} isRetrying={list.isFetching} />
                : visibleEntries?.length ? visibleEntries.map(renderEntry)
                  : !list.hasNextPage ? <EmptyState icon={Layers} title={filtering ? t({ ko: '맞는 RefMod가 없어', en: 'No matching RefMods' }) : t({ ko: '아직 RefMod가 없어', en: 'No RefMods yet' })} /> : null}
            {list.isPending ? null : listFooter}
          </RowGroup>
        ) : null}
      </div>
      {editor.open ? <RefModEntryDialog library={library} /> : null}
      <MediaLightbox
        items={library.lightbox?.items ?? []}
        index={library.lightbox?.index ?? null}
        onIndexChange={(index) => library.setLightbox((current) => current && { ...current, index })}
        onClose={() => library.setLightbox(null)}
      />

      {canEdit ? (
        <SelectionActionBar
          selectedCount={selected.size}
          onClear={library.clearSelection}
          responsiveActions
          actions={<>
            <SelectionBarAction icon={CheckCheck} label={t({ ko: '불러온 항목 전부 선택', en: 'Select all loaded' })} variant="ghost" disabled={!visibleEntries?.length} onClick={library.selectAllLoaded} />
            <SelectionBarAction icon={Star} label={t({ ko: '즐겨찾기', en: 'Favorite' })} disabled={library.bulkPending} onClick={() => void library.bulk({ action: 'favorite', ids: [...selected.keys()], favorite: true })} />
            <SelectionBarAction icon={StarOff} label={t({ ko: '즐겨찾기 해제', en: 'Unfavorite' })} disabled={library.bulkPending} onClick={() => void library.bulk({ action: 'favorite', ids: [...selected.keys()], favorite: false })} />
            <SelectionBarAction icon={Download} label={t({ ko: '내보내기', en: 'Export' })} onClick={() => void library.exportEntries({ ids: [...selected.keys()] }, t({ ko: '선택한 RefMod', en: 'selected refmods' }))} />
            <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} disabled={library.bulkPending} onClick={() => void library.removeSelected()} />
          </>}
        />
      ) : null}

      {library.creating ? (
        <NameDialog
          open
          title={t({ ko: '새 RefMod', en: 'New RefMod' })}
          label={t({ ko: 'RefMod 이름 (파일 이름)', en: 'RefMod name (file name)' })}
          submitLabel={t({ ko: '만들고 편집하기', en: 'Create and edit' })}
          maxLength={REFMOD_ENTRY_LIMITS.name}
          value={library.creating.name}
          error={library.creating.error}
          busy={library.createPending}
          onChange={(name) => library.setCreating({ name, error: null })}
          onSubmit={() => void library.create(library.creating!.name)}
          onClose={() => library.setCreating(null)}
        />
      ) : null}
      {library.importing ? (
        <RefModImportDialog
          fileName={library.importing.file.name}
          conflict={library.importing.conflict}
          busy={library.importPending}
          onConflictChange={(conflict) => library.setImporting((current) => current && { ...current, conflict })}
          onSubmit={() => { if (library.importing) void library.importFile(library.importing.file, library.importing.conflict) }}
          onClose={() => library.setImporting(null)}
        />
      ) : null}
    </PageWithSidebar>
  )
}
