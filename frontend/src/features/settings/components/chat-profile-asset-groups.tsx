import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { chatAssetCandidatesQueryKey } from '@/lib/api-codex-chat'
import { getGroupImages } from '@/lib/api-groups'
import { getErrorMessage } from '@/lib/error-message'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { useCharacterGroups, type CharacterGroupSource } from './chat-profile-asset-slots'

/** Every generated asset candidate of the character (its candidates group), in the shared masonry and viewer. */
export function ChatProfileCandidateArchive({ source, generated = 0 }: {
  source: CharacterGroupSource
  /** Candidates this editor's runs have produced so far; a change re-reads a group given by id. */
  generated?: number
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { canViewImages } = useImagePermissions()
  const [open, setOpen] = useState(false)
  const { candidateGroupId, candidateCount } = useCharacterGroups(source)
  // A group given by id (library settings) reads its visible count on its own; one found by name has it from the group tree.
  const ownCount = canViewImages && candidateGroupId !== null && candidateCount === undefined
  const countQuery = useQuery({
    queryKey: [...chatAssetCandidatesQueryKey(candidateGroupId ?? 0), 'count'],
    queryFn: ({ signal }) => getGroupImages(candidateGroupId!, { limit: 1 }, { signal }),
    enabled: ownCount,
  })
  const seenGenerated = useRef(generated)
  useEffect(() => {
    if (seenGenerated.current === generated) return
    seenGenerated.current = generated
    if (ownCount) void queryClient.invalidateQueries({ queryKey: chatAssetCandidatesQueryKey(candidateGroupId!) })
  }, [generated, ownCount, candidateGroupId, queryClient])
  const candidates = useInfiniteQuery({
    queryKey: chatAssetCandidatesQueryKey(candidateGroupId ?? 0),
    enabled: canViewImages && candidateGroupId !== null && open,
    initialPageParam: { page: 1, cursorOrderIndex: null as number | null, cursorAddedDate: null as string | null, cursorHash: null as string | null },
    queryFn: ({ pageParam }) => getGroupImages(candidateGroupId!, { ...pageParam, limit: 48 }),
    getNextPageParam: (last) => (last.pagination.hasMore ?? last.pagination.page < last.pagination.totalPages) ? { page: last.pagination.page + 1, cursorOrderIndex: last.pagination.nextCursorOrderIndex ?? null, cursorAddedDate: last.pagination.nextCursorAddedDate ?? null, cursorHash: last.pagination.nextCursorHash ?? null } : undefined,
  })
  const safety = useImageFeedSafety({ items: candidates.data?.pages.flatMap((page) => page.images.filter((image) => image.mime_type?.startsWith('image/'))) ?? [], hasMore: candidates.hasNextPage, isLoadingMore: candidates.isFetchingNextPage, onLoadMore: () => candidates.fetchNextPage() })
  const count = candidateCount ?? countQuery.data?.pagination.total ?? 0
  if (candidateGroupId === null) return null
  return (
    <CollapsibleRow title={t({ ko: '후보 보관함', en: 'Candidate archive' })} meta={count} open={open} onOpenChange={setOpen}>
      {candidates.isPending ? <Spinner /> : <ImageList items={safety.visibleItems} layout="masonry" activationMode="modal" scrollMode="container" viewportHeight="min(48vh, 480px)" minColumnWidth={130} columnGap={8} rowGap={8} resetKey={String(candidateGroupId)} showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay} hasMore={candidates.hasNextPage} isLoadingMore={candidates.isFetchingNextPage} onLoadMore={() => void candidates.fetchNextPage()} />}
      {candidates.isError ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive">{getErrorMessage(candidates.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}<Button size="xs" variant="ghost" onClick={() => void candidates.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button></div> : null}
    </CollapsibleRow>
  )
}
