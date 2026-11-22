import { useRef, type ReactNode } from 'react'
import { CheckCheck, CheckSquare, Copy, CopyPlus, Download, Palette, Plus, SquarePen, Star, StarOff, Trash2, Upload } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { ToolbarSearchField } from '@/components/common/search-field'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { CharacterSettingGrid } from '@/features/characters/components/character-setting-grid'
import { LoadMoreSentinel } from '@/features/posts/post-attach-shared'
import { useI18n } from '@/i18n'
import type { ArtStyleSort, ArtStyleSummary } from '@/lib/api-art-styles'
import { ArtStyleBadgeSidebar } from './components/art-style-badge-sidebar'
import { ArtStyleCard } from './components/art-style-card'
import { ArtStyleDialog } from './components/art-style-dialog'
import { useArtStyleChatPage } from './use-art-style-chat-page'
import { useArtStyleLibrary } from './use-art-style-library'

/**
 * Art styles view of the character page (/characters?view=styles): a badge sidebar with counts, search, sort, favorites,
 * several-select, ZIP export / import, and the style card grid that loads in batches as it scrolls; `style=<id>` opens a
 * style's window over the list. `viewSwitch` is the character page's view switch and leads the toolbar. Without
 * characters.edit everything only shows.
 */
export function ArtStylePage({ viewSwitch }: { viewSwitch: ReactNode }) {
  const { t } = useI18n()
  const library = useArtStyleLibrary()
  useArtStyleChatPage(library)
  const { canEdit, editor, list, loaded, total, selected, selectMode } = library
  const importInput = useRef<HTMLInputElement | null>(null)
  const filtering = Boolean(library.query) || library.favoriteOnly || library.badges.length > 0

  const styleMenu = (style: ArtStyleSummary): ActionMenuEntry[] => [
    { key: 'open', label: canEdit ? t({ ko: '편집', en: 'Edit' }) : t({ ko: '열기', en: 'Open' }), icon: SquarePen, onSelect: () => library.openStyle(style.id) },
    { key: 'copy', label: t({ ko: '긍정 프롬프트 복사', en: 'Copy positive prompt' }), icon: Copy, onSelect: () => void library.copyPositive(style) },
    canEdit ? { key: 'favorite', label: style.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' }), icon: style.favorite ? StarOff : Star, disabled: library.bulkPending, onSelect: () => library.toggleFavorite(style) } : null,
    canEdit ? { key: 'duplicate', label: t({ ko: '복제', en: 'Duplicate' }), icon: CopyPlus, onSelect: () => void library.duplicate(style) } : null,
    { key: 'export', label: t({ ko: '내보내기', en: 'Export' }), icon: Download, onSelect: () => void library.exportStyles({ ids: [style.id] }, style.title) },
    canEdit ? { key: 'select', label: selected.has(style.id) ? t({ ko: '선택 해제', en: 'Deselect' }) : t({ ko: '선택', en: 'Select' }), icon: CheckSquare, onSelect: () => { library.setSelectMode(true); library.toggleSelected(style) } } : null,
    canEdit ? '-' : null,
    canEdit ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, onSelect: () => void library.remove(style) } : null,
  ]

  const listFooter: ReactNode = list.isFetchNextPageError ? (
    <ErrorState size="compact" title={t({ ko: '다음 스타일을 불러오지 못했어', en: 'Could not load more styles' })} error={list.error} onRetry={() => void list.fetchNextPage()} isRetrying={list.isFetchingNextPage} />
  ) : <>
    <LoadMoreSentinel rootMargin="800px" enabled={list.hasNextPage && !list.isFetchingNextPage} onVisible={() => void list.fetchNextPage({ cancelRefetch: false })} />
    {list.isFetchingNextPage ? <LoadingState variant="inline" /> : null}
  </>

  const toolbar = (
    <PageToolbar
      start={viewSwitch}
      actions={(
        <>
          <Select variant="default" controlSize="compact" className="w-auto" aria-label={t({ ko: '정렬', en: 'Sort' })} value={library.sort} onChange={(event) => library.setListView({ sort: event.target.value as ArtStyleSort })}>
            <option value="name">{t({ ko: '이름순', en: 'Name' })}</option>
            <option value="updated">{t({ ko: '최근 수정순', en: 'Recently edited' })}</option>
            <option value="created">{t({ ko: '최근 추가순', en: 'Newest' })}</option>
            <option value="created_asc">{t({ ko: '오래된 순', en: 'Oldest' })}</option>
          </Select>
          <IconButton variant="ghost" size="icon-sm" active={library.favoriteOnly} label={t({ ko: '즐겨찾기', en: 'Favorites' })} onClick={() => library.setListView({ favorite: !library.favoriteOnly })}><Star className={library.favoriteOnly ? 'fill-current' : undefined} /></IconButton>
          {canEdit ? <IconButton variant="ghost" size="icon-sm" active={selectMode} label={selectMode ? t({ ko: '선택 끝내기', en: 'Stop selecting' }) : t({ ko: '여러 개 선택', en: 'Select several' })} onClick={() => { if (selectMode) library.clearSelection(); else library.setSelectMode(true) }}><CheckSquare /></IconButton> : null}
          <ActionMenuButton
            label={t({ ko: '스타일 작업', en: 'Style actions' })}
            entries={[
              { key: 'export', label: t({ ko: '스타일 전체 내보내기', en: 'Export every style' }), icon: Download, onSelect: () => void library.exportStyles({}, t({ ko: '그림 스타일', en: 'art styles' })) },
              canEdit ? { key: 'import', label: t({ ko: '스타일 묶음 ZIP 가져오기', en: 'Import a style bundle' }), icon: Upload, onSelect: () => importInput.current?.click() } : null,
            ]}
          />
          {canEdit ? <Button size="sm" onClick={library.openNewStyle}><Plus />{t({ ko: '새 스타일', en: 'New style' })}</Button> : null}
          <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void library.importFile(file) }} />
        </>
      )}
    >
      <ToolbarSearchField value={library.searchText} onChange={library.setSearchText} placeholder={t({ ko: '제목·설명·배지·검색어', en: 'Titles, descriptions, badges, keywords' })} />
    </PageToolbar>
  )

  return (
    <PageWithSidebar
      storageKey="art-styles"
      sidebarLabel={t({ ko: '배지', en: 'Badges' })}
      sidebar={(
        <ArtStyleBadgeSidebar
          badges={library.badgeList}
          selected={library.badges}
          loading={library.badgeCounts.isPending}
          error={library.badgeCounts.isError ? library.badgeCounts.error : null}
          onRetry={() => void library.badgeCounts.refetch()}
          onToggle={library.toggleBadge}
          onClear={() => library.setListView({ badges: [] })}
        />
      )}
      toolbar={toolbar}
    >
      <RowGroup heading={t({ ko: '그림 스타일', en: 'Art styles' })} count={total}>
        <CharacterSettingGrid
          errorTitle={t({ ko: '스타일을 불러오지 못했어', en: 'Could not load styles' })}
          items={loaded}
          pending={list.isPending}
          error={list.isError ? list.error : null}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
          footer={listFooter}
          renderSetting={(style) => (
            <ArtStyleCard
              key={style.id}
              style={style}
              selected={selectMode ? selected.has(style.id) : undefined}
              open={library.openStyleId === style.id}
              disabled={editor.busy}
              onOpen={() => (selectMode ? library.toggleSelected(style) : library.openStyle(style.id))}
              onToggleFavorite={canEdit && !selectMode ? () => library.toggleFavorite(style) : undefined}
              onToggleSelect={canEdit ? () => { library.setSelectMode(true); library.toggleSelected(style) } : undefined}
              menu={styleMenu(style)}
            />
          )}
          empty={<EmptyState icon={Palette} title={filtering ? t({ ko: '맞는 스타일이 없어', en: 'No matching styles' }) : t({ ko: '아직 스타일이 없어', en: 'No styles yet' })} />}
        />
      </RowGroup>
      {editor.open ? <ArtStyleDialog library={library} /> : null}

      {canEdit ? (
        <SelectionActionBar
          selectedCount={selected.size}
          onClear={library.clearSelection}
          responsiveActions
          actions={<>
            <SelectionBarAction icon={CheckCheck} label={t({ ko: '불러온 항목 전부 선택', en: 'Select all loaded' })} variant="ghost" disabled={!loaded?.length} onClick={library.selectAllLoaded} />
            <SelectionBarAction icon={Star} label={t({ ko: '즐겨찾기', en: 'Favorite' })} disabled={library.bulkPending} onClick={() => void library.bulk({ action: 'favorite', ids: [...selected.keys()], favorite: true }).catch(() => undefined)} />
            <SelectionBarAction icon={StarOff} label={t({ ko: '즐겨찾기 해제', en: 'Unfavorite' })} disabled={library.bulkPending} onClick={() => void library.bulk({ action: 'favorite', ids: [...selected.keys()], favorite: false }).catch(() => undefined)} />
            <SelectionBarAction icon={Download} label={t({ ko: '내보내기', en: 'Export' })} onClick={() => void library.exportStyles({ ids: [...selected.keys()] }, t({ ko: '선택한 스타일', en: 'selected styles' }))} />
            <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} disabled={library.bulkPending} onClick={() => void library.removeSelected()} />
          </>}
        />
      ) : null}
    </PageWithSidebar>
  )
}
