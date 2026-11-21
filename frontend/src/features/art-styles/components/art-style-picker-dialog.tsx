import { useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ART_STYLE_LIMITS } from '@conai/shared'
import { Palette } from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { CharacterSettingGrid } from '@/features/characters/components/character-setting-grid'
import { LoadMoreSentinel } from '@/features/posts/post-attach-shared'
import { useI18n } from '@/i18n'
import { ART_STYLES_PAGE_SIZE, artStyleBadgesQueryKey, artStylePagesQueryKey, artStyleQueryKey, getArtStyle, listArtStyleBadges, listArtStyles, type ArtStyle, type ArtStyleScope } from '@/lib/api-art-styles'
import { getErrorMessage } from '@/lib/error-message'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { ArtStyleBadgeSidebar } from './art-style-badge-sidebar'
import { ArtStyleCard } from './art-style-card'

export type ArtStylePickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The full stored style (read fresh when the pick is confirmed); the dialog closes after. */
  onPick: (style: ArtStyle) => void
  title?: string
  confirmLabel?: string
}

/**
 * Pick one art style: a search across titles, descriptions, badges and keywords, the badge list as a filter, and the
 * style cards loading in batches as the list scrolls. Needs only `characters.view`; nothing here changes a style.
 */
export function ArtStylePickerDialog(props: ArtStylePickerDialogProps) {
  // Mounted only while open, so each opening starts with no leftover search, badges or selection.
  return props.open ? <ArtStylePicker {...props} /> : null
}

function ArtStylePicker({ onOpenChange, onPick, title, confirmLabel }: ArtStylePickerDialogProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const canView = useFeaturePermissions().has('characters.view')
  const [searchText, setSearchText] = useState('')
  const query = useDebouncedValue(searchText.trim())
  const [badges, setBadges] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const scope: ArtStyleScope = { query, badges, favorite: false, sort: 'name', limit: ART_STYLES_PAGE_SIZE }
  const list = useInfiniteQuery({
    queryKey: artStylePagesQueryKey(scope),
    queryFn: ({ pageParam, signal }) => listArtStyles({ ...scope, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((sum, page) => sum + page.items.length, 0) : undefined),
    placeholderData: keepPreviousData,
    enabled: canView,
  })
  const badgeCounts = useQuery({ queryKey: artStyleBadgesQueryKey(scope), queryFn: ({ signal }) => listArtStyleBadges(scope, signal), placeholderData: keepPreviousData, enabled: canView })
  const badgeList = [...(badgeCounts.data ?? []), ...badges.filter((badge) => !badgeCounts.data?.some((entry) => entry.badge === badge)).map((badge) => ({ badge, count: 0 }))]
  const toggleBadge = (badge: string) => setBadges((current) => current.includes(badge) ? current.filter((item) => item !== badge) : [...current, badge].slice(0, ART_STYLE_LIMITS.badges))

  const confirm = useMutation({
    mutationFn: (styleId: number) => queryClient.fetchQuery({ queryKey: artStyleQueryKey(styleId), queryFn: ({ signal }) => getArtStyle(styleId, signal), staleTime: 0 }),
    onSuccess: (style) => { onPick(style); onOpenChange(false) },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '스타일을 불러오지 못했어.', en: 'Could not load the style.' })), tone: 'error' }),
  })
  const pick = (styleId: number) => { if (!confirm.isPending) confirm.mutate(styleId) }
  const footer = list.isFetchNextPageError ? (
    <ErrorState size="compact" title={t({ ko: '다음 스타일을 불러오지 못했어', en: 'Could not load more styles' })} error={list.error} onRetry={() => void list.fetchNextPage()} isRetrying={list.isFetchingNextPage} />
  ) : <>
    <LoadMoreSentinel rootMargin="400px" enabled={list.hasNextPage && !list.isFetchingNextPage} onVisible={() => void list.fetchNextPage({ cancelRefetch: false })} />
    {list.isFetchingNextPage ? <LoadingState variant="inline" /> : null}
  </>

  return (
    <Modal open title={title ?? t({ ko: '그림 스타일 고르기', en: 'Choose art style' })} onClose={() => onOpenChange(false)} size="xl" height="tall">
      {!canView ? (
        <ModalBody>
          <EmptyState icon={Palette} title={t({ ko: '그림 스타일을 볼 권한이 없어', en: 'You cannot view art styles' })} />
        </ModalBody>
      ) : (
        <ModalBody>
          <div className="grid min-h-0 gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="min-w-0 md:max-h-[60vh] md:overflow-y-auto">
              <ArtStyleBadgeSidebar
                badges={badgeList}
                selected={badges}
                loading={badgeCounts.isPending}
                error={badgeCounts.isError ? badgeCounts.error : null}
                onRetry={() => void badgeCounts.refetch()}
                onToggle={toggleBadge}
                onClear={() => setBadges([])}
              />
            </div>
            <div className="min-w-0 space-y-3">
              <SearchField value={searchText} onChange={setSearchText} placeholder={t({ ko: '제목·설명·배지·검색어', en: 'Titles, descriptions, badges, keywords' })} />
              <CharacterSettingGrid
                errorTitle={t({ ko: '스타일을 불러오지 못했어', en: 'Could not load styles' })}
                items={list.data?.pages.flatMap((page) => page.items)}
                pending={list.isPending}
                error={list.isError && !list.isFetchNextPageError ? list.error : null}
                onRetry={() => void list.refetch()}
                retrying={list.isFetching}
                footer={footer}
                renderSetting={(style) => (
                  <ArtStyleCard key={style.id} style={style} selected={selectedId === style.id} onOpen={() => setSelectedId(style.id)} onDoubleClick={() => pick(style.id)} />
                )}
                empty={<EmptyState size="compact" icon={Palette} title={query || badges.length ? t({ ko: '맞는 스타일이 없어', en: 'No matching styles' }) : t({ ko: '아직 스타일이 없어', en: 'No styles yet' })} />}
              />
            </div>
          </div>
        </ModalBody>
      )}
      <EditorFooter onSave={canView ? () => { if (selectedId !== null) pick(selectedId) } : undefined} canSave={selectedId !== null} saving={confirm.isPending} saveLabel={confirmLabel ?? t({ ko: '선택', en: 'Select' })} />
    </Modal>
  )
}
