import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatPageData } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import { useNavigate } from 'react-router-dom'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { getImageVectorAvailability, type VectorSimilarityBasis } from '@/lib/api-images'
import type { ImageAutoTags, ImageRecord } from '@/types/image'

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

export function useImageDetailChatPage(image: ImageRecord | undefined, presentation: 'page' | 'modal', tab: 'current' | 'similar', setTab: (value: 'current' | 'similar') => void) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const auth = useAuthStatusQuery().data
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
      { id: 'negativePrompt', label: t({ ko: '현재 이미지 부정 프롬프트', en: 'Current image negative prompt' }), type: 'text', value: (image.ai_metadata?.prompts?.negative_prompt ?? '').slice(0, 8000), editable: false },
    ],
    data: {
      selected: { hash: image.composite_hash, width: image.width ?? 0, height: image.height ?? 0, mimeType: image.mime_type ?? '', model: image.ai_metadata?.model_name ?? '', tool: image.ai_metadata?.ai_tool ?? '' },
      ...(autoTags ? { autoTags } : {}),
      vectorSimilarity: {
        contentAvailable: availabilityQuery.data?.content === true,
        styleAvailable: availabilityQuery.data?.style === true,
        ...(loadedSimilar.content ? { content: loadedSimilar.content } : {}),
        ...(loadedSimilar.style ? { style: loadedSimilar.style } : {}),
      },
    },
    actions: auth?.permissionKeys.includes('page.metadata-editor.view') ? [pageAction('page.navigate', t({ ko: '이미지 프롬프트·메타데이터 편집 열기', en: 'Open image metadata editor' }), t({ ko: '현재 이미지의 메타데이터 편집 페이지를 열어.', en: 'Open the current image metadata editor.' }), pageObject({ to: pageChoice([metadataPath]) }, ['to']))] : [],
    apply: (patch) => { if (patch.tab !== undefined) setTab(patch.tab as 'current' | 'similar') },
    applyAction: (_id, args, assertCurrent) => { assertCurrent(); void navigate(String(args.to)) },
  } : null)
}
