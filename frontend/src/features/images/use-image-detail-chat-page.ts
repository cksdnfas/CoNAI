import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatPageData } from '@conai/shared'
import { useChatPage, useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import { useLocation, useNavigate } from 'react-router-dom'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { getExistingImageEditorSourceUrl, getImageVectorAvailability, getVectorSimilarImages, type VectorSimilarityBasis } from '@/lib/api-images'
import { getGroupsHierarchyAll, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import type { ImageAutoTags, ImageRecord } from '@/types/image'
import { prepareImageSourceState } from './image-source-navigation'
import { useImageViewModal, type ImageViewModalAccessOptions } from './components/detail/image-view-modal-context'
import { useImageGroupAssignMutation } from './components/detail/image-group-assign-action'
import { useImageDeletion } from './components/detail/image-delete-action'
import { useImageSpriteMenuAction } from './components/detail/image-sprite-action'
import { useChatMediaDeleteDescription } from './chat-media-delete-warning'

const SIMILAR_ITEMS = 12
type SimilarResult = { similar: Array<{ image: ImageRecord; similarity: number }> }

/**
 * The highest-scoring entries of a tag→score map as `{ name, score }` rows: tag names never become object keys, since
 * page data refuses protected-looking keys (a tag like "qr_code" would reject the whole screen).
 */
function topScores(scores: Record<string, number> | null | undefined, count: number): ChatPageData[] {
  if (!scores || typeof scores !== 'object') return []
  return Object.entries(scores)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, score]) => ({ name, score: Math.round(score * 1000) / 1000 }))
}

/** What the automatic analysis found on this image (tagger incl. PixAI's artist/meta tags, Kaloscope artists). */
function autoTagSummary(tags: ImageAutoTags | null | undefined): Record<string, ChatPageData> | null {
  if (!tags) return null
  const tagger = tags.tagger as (NonNullable<ImageAutoTags['tagger']> & { artist?: Record<string, number> | null; meta?: Record<string, number> | null }) | null | undefined
  const kaloscope = tags.kaloscope
  const summary: Record<string, ChatPageData> = {}
  if (tagger) {
    summary.tagger = {
      model: tagger.model ?? '',
      general: topScores(tagger.general ?? tags.general, 20),
      character: topScores(tagger.character ?? tags.character, 10),
      rating: topScores(tagger.rating ?? tags.rating, 4),
      ...(tagger.artist ? { artist: topScores(tagger.artist, 10) } : {}),
      ...(tagger.meta ? { meta: topScores(tagger.meta, 10) } : {}),
    }
  }
  if (kaloscope) summary.kaloscope = { model: kaloscope.model ?? '', artists: topScores(kaloscope.artists ?? kaloscope.artist, 10) }
  return Object.keys(summary).length ? summary : null
}

/**
 * The 내용 유사 / 화풍 유사 results already on screen (the section loads them on a click), read from the query cache
 * without starting a request; a newer result replaces an older one for the same basis.
 */
function useLoadedVectorSimilar(compositeHash: string | undefined) {
  const queryClient = useQueryClient()
  const read = () => {
    const result: Partial<Record<VectorSimilarityBasis, Array<{ hash: string; similarity: number }>>> = {}
    if (!compositeHash) return result
    for (const basis of ['content', 'style'] as const) {
      const entries = queryClient.getQueriesData<SimilarResult>({ queryKey: ['image-similar-vector', compositeHash, basis] })
      const data = entries.map(([, value]) => value).filter((value): value is SimilarResult => Boolean(value?.similar)).at(-1)
      if (data) result[basis] = data.similar.slice(0, SIMILAR_ITEMS).flatMap((item) => item.image.composite_hash ? [{ hash: item.image.composite_hash, similarity: item.similarity }] : [])
    }
    return result
  }
  const [loaded, setLoaded] = useState(read)
  useEffect(() => {
    setLoaded(read())
    return queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey
      if (key[0] === 'image-similar-vector' && key[1] === compositeHash && event.type === 'updated') setLoaded(read())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read() only depends on compositeHash and the client
  }, [compositeHash, queryClient])
  return loaded
}

export function useImageDetailChatPage(image: ImageRecord | undefined, presentation: 'page' | 'modal', tab: 'current' | 'similar', setTab: (value: 'current' | 'similar') => void, navigation?: { canViewPrevious: boolean; canViewNext: boolean; onViewPrevious: () => void; onViewNext: () => void }, access?: ImageViewModalAccessOptions, openEditor?: () => void, onDeleted?: () => void) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const page = useChatPage()
  const permissions = useImagePermissions()
  const modal = useImageViewModal()
  const allowEdit = presentation === 'page' || access?.allowEditAction !== false
  const allowAssign = permissions.canAssignGroups && (presentation === 'page' || access?.allowGroupAssignAction !== false)
  const allowDelete = permissions.canDeleteImages && (presentation === 'page' || access?.allowDeleteAction === true)
  const assignMutation = useImageGroupAssignMutation(image?.composite_hash ?? null)
  const deletion = useImageDeletion(image, (hash) => { if (presentation === 'modal') modal?.removeImageFromView(hash); else onDeleted?.() })
  const spriteAction = useImageSpriteMenuAction(image)
  const deleteDescription = useChatMediaDeleteDescription(image?.composite_hash ? [image.composite_hash] : [], allowDelete && page?.enabled === true)
  const groupsQuery = useQuery({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY, queryFn: getGroupsHierarchyAll, enabled: Boolean(page?.enabled && allowAssign && image?.composite_hash), staleTime: 60_000 })
  const groups = (groupsQuery.data ?? []).slice(0, 200)
  const metadataPath = `/images/${image?.composite_hash ?? ''}/metadata`
  // Same query the 내용 유사 / 화풍 유사 sections use: which of the two this image can be compared by.
  const availabilityQuery = useQuery({
    queryKey: ['image-vector-similarity', image?.composite_hash ?? ''],
    queryFn: ({ signal }) => getImageVectorAvailability(image?.composite_hash ?? '', { signal }),
    enabled: Boolean(image?.composite_hash),
    staleTime: 60_000,
  })
  const loadedSimilar = useLoadedVectorSimilar(image?.composite_hash ?? undefined)
  const autoTags = autoTagSummary(image?.auto_tags)
  useChatPageRegistration(image?.composite_hash ? {
    kind: 'image_detail', title: t({ ko: '이미지 상세', en: 'Image details' }), resourceId: image.composite_hash, priority: presentation === 'modal' ? 100 : 0,
    fields: [
      { id: 'tab', label: t({ ko: '이미지 표시', en: 'Image view' }), type: 'select', value: tab, options: ['current', 'similar'] },
      { id: 'prompt', label: t({ ko: '현재 이미지 프롬프트', en: 'Current image prompt' }), type: 'text', value: (image.ai_metadata?.prompts?.prompt ?? '').slice(0, 8000), editable: false },
      { id: 'negativePrompt', label: t({ ko: '현재 이미지 네거티브 프롬프트', en: 'Current image negative prompt' }), type: 'text', value: (image.ai_metadata?.prompts?.negative_prompt ?? '').slice(0, 8000), editable: false },
    ],
    data: {
      selected: { hash: image.composite_hash, width: image.width ?? 0, height: image.height ?? 0, mimeType: image.mime_type ?? '', model: image.ai_metadata?.model_name ?? '', tool: image.ai_metadata?.ai_tool ?? '' },
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      ...(autoTags ? { autoTags } : {}),
      vectorSimilarity: {
        contentAvailable: availabilityQuery.data?.content === true,
        styleAvailable: availabilityQuery.data?.style === true,
        ...(loadedSimilar.content ? { content: loadedSimilar.content } : {}),
        ...(loadedSimilar.style ? { style: loadedSimilar.style } : {}),
      },
    },
    actions: [
      ...(allowEdit && permissions.canEditMetadata && permissions.canOpenMetadataEditor && image.file_type === 'image' ? [pageAction('image_detail.open_metadata', t({ ko: '메타데이터 편집 열기', en: 'Open image metadata editor' }), t({ ko: '현재 이미지의 메타데이터 편집 페이지를 열어.', en: 'Open the current image metadata editor.' }))] : []),
      ...(navigation && (navigation.canViewPrevious || navigation.canViewNext) ? [pageAction('image_detail.step', t({ ko: '이전·다음 이미지', en: 'Previous or next image' }), t({ ko: '열린 이미지 목록에서 이동해.', en: 'Move through the open image sequence.' }), pageObject({ direction: pageChoice([...(navigation.canViewPrevious ? ['previous'] : []), ...(navigation.canViewNext ? ['next'] : [])]) }, ['direction']))] : []),
      ...((availabilityQuery.data?.content || availabilityQuery.data?.style) ? [pageAction('image_detail.similar', t({ ko: '유사 이미지 찾기', en: 'Find similar images' }), t({ ko: '내용 또는 화풍 유사 이미지를 조회해.', en: 'Fetch images similar in content or style.' }), pageObject({ basis: pageChoice([...(availabilityQuery.data?.content ? ['content'] : []), ...(availabilityQuery.data?.style ? ['style'] : [])]) }, ['basis']))] : []),
      ...(allowEdit && permissions.canCreateImageCopies && image.file_type === 'image' && getExistingImageEditorSourceUrl(image) ? [pageAction('image_detail.edit', t({ ko: '이미지 편집기 열기', en: 'Open image editor' }), t({ ko: '현재 이미지의 편집기를 열어.', en: 'Open the editor for the current image.' }))] : []),
      ...(allowEdit && spriteAction ? [pageAction('image_detail.sprite', t({ ko: '스프라이트 열기', en: 'Open sprites' }), t({ ko: '현재 영상으로 스프라이트 화면을 열어.', en: 'Open the sprites page with this video.' }))] : []),
      ...(allowAssign && groups.length ? [pageAction('image_detail.assign_group', t({ ko: '그룹에 추가', en: 'Add to group' }), t({ ko: '현재 이미지를 지정한 커스텀 그룹에 추가해.', en: 'Add this image to the specified custom group.' }), pageObject({ groupId: pageChoice(groups.map((group) => group.id)) }, ['groupId']), 'save')] : []),
      ...(allowDelete && deleteDescription ? [pageAction('image_detail.delete', t({ ko: '이미지 삭제', en: 'Delete image' }), deleteDescription, undefined, 'save')] : []),
    ],
    apply: (patch) => { if (patch.tab !== undefined) setTab(patch.tab as 'current' | 'similar') },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'image_detail.open_metadata') { if (presentation === 'modal') modal?.closeImageView(); void navigate(metadataPath, { state: prepareImageSourceState(location) }); return }
      if (id === 'image_detail.step' && navigation) { if (args.direction === 'previous') navigation.onViewPrevious(); else navigation.onViewNext(); return }
      if (id === 'image_detail.edit') { openEditor?.(); return }
      if (id === 'image_detail.sprite' && spriteAction) { if (presentation === 'modal') modal?.closeImageView(); spriteAction.onSelect(); return }
      if (id === 'image_detail.assign_group') {
        const result = await assignMutation.mutateAsync(Number(args.groupId))
        if (result.errors?.length) throw new Error(result.errors.join(', '))
        return
      }
      if (id === 'image_detail.delete') { await deletion.deleteImage(); return }
      if (id === 'image_detail.similar') {
        const basis = args.basis as VectorSimilarityBasis
        await queryClient.fetchQuery({ queryKey: ['image-similar-vector', image.composite_hash, basis, SIMILAR_ITEMS], queryFn: ({ signal }) => getVectorSimilarImages(image.composite_hash!, basis, SIMILAR_ITEMS, { signal }), staleTime: 5 * 60_000 })
        return
      }
      throw new Error('등록되지 않은 이미지 작업이야.')
    },
  } : null)
}
