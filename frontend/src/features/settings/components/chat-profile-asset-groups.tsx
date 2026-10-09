import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { getGroupImages } from '@/lib/api-groups'
import { getErrorMessage } from '@/lib/error-message'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { useCharacterGroups } from './chat-profile-asset-slots'

/** Every generated asset candidate of the character ("채팅 캐릭터/<name>/후보"), in the shared masonry and viewer. */
export function ChatProfileCandidateArchive({ characterName }: { characterName: string }) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const [open, setOpen] = useState(false)
  const { candidateGroup } = useCharacterGroups(characterName)
  const candidates = useInfiniteQuery({
    queryKey: ['chat-asset-candidates', candidateGroup?.id],
    enabled: canViewImages && !!candidateGroup && open,
    initialPageParam: { page: 1, cursorOrderIndex: null as number | null, cursorAddedDate: null as string | null, cursorHash: null as string | null },
    queryFn: ({ pageParam }) => getGroupImages(candidateGroup!.id, { ...pageParam, limit: 48 }),
    getNextPageParam: (last) => (last.pagination.hasMore ?? last.pagination.page < last.pagination.totalPages) ? { page: last.pagination.page + 1, cursorOrderIndex: last.pagination.nextCursorOrderIndex ?? null, cursorAddedDate: last.pagination.nextCursorAddedDate ?? null, cursorHash: last.pagination.nextCursorHash ?? null } : undefined,
  })
  const safety = useImageFeedSafety({ items: candidates.data?.pages.flatMap((page) => page.images.filter((image) => image.mime_type?.startsWith('image/'))) ?? [], hasMore: candidates.hasNextPage, isLoadingMore: candidates.isFetchingNextPage, onLoadMore: () => candidates.fetchNextPage() })
  const count = candidateGroup?.visible_image_count ?? candidateGroup?.image_count ?? 0
  if (!candidateGroup) return null
  return (
    <CollapsibleRow title={t({ ko: '후보 보관함', en: 'Candidate archive' })} meta={count} open={open} onOpenChange={setOpen}>
      {candidates.isPending ? <Spinner /> : <ImageList items={safety.visibleItems} layout="masonry" activationMode="modal" scrollMode="container" viewportHeight="min(48vh, 480px)" minColumnWidth={130} columnGap={8} rowGap={8} resetKey={String(candidateGroup.id)} showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay} hasMore={candidates.hasNextPage} isLoadingMore={candidates.isFetchingNextPage} onLoadMore={() => void candidates.fetchNextPage()} />}
      {candidates.isError ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive">{getErrorMessage(candidates.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}<Button size="xs" variant="ghost" onClick={() => void candidates.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button></div> : null}
    </CollapsibleRow>
  )
}
