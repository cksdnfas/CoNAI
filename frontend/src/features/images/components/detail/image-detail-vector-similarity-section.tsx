import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ScanSearch } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { getImageVectorAvailability, getVectorSimilarImages, type VectorSimilarityBasis } from '@/lib/api-images'
import { getErrorMessage } from '@/lib/error-message'
import type { ImageRecord } from '@/types/image'
import type { RelatedImageCardAspectRatio } from '@conai/shared'
import { getValidImageRecords } from './image-detail-utils'
import { RelatedImageGallerySection } from './related-image-gallery-section'
import { VectorScoreOverlay } from './similarity-score-overlay'

interface ImageDetailVectorSimilaritySectionProps {
  compositeHash: string
  presentation: 'page' | 'modal'
  /** The detail view settled on this image (the same gate the other similarity checks wait for). */
  ready: boolean
  /** Run both checks without a click (the scan-all trigger or the always-check setting). */
  requestAll: boolean
  /** Tell the detail view a check was asked for, so it starts settling. */
  onRequest: () => void
  resultLimit: number
  /** Already shown as duplicates above. */
  excludeHashes: ReadonlySet<string>
  mobileCardColumns?: number
  desktopCardColumns?: number
  cardAspectRatio?: RelatedImageCardAspectRatio
  hideEmptySections?: boolean
}

const BASES: VectorSimilarityBasis[] = ['content', 'style']

/**
 * "내용 유사" (image embeddings: what the picture shows) and "화풍 유사" (Kaloscope style vectors), below the hash
 * and prompt sections and shaped like them. A section is left out while this image has no vector of that kind.
 */
export function ImageDetailVectorSimilaritySection({
  compositeHash,
  presentation,
  ready,
  requestAll,
  onRequest,
  resultLimit,
  excludeHashes,
  mobileCardColumns = 1,
  desktopCardColumns = 3,
  cardAspectRatio = 'square',
  hideEmptySections = false,
}: ImageDetailVectorSimilaritySectionProps) {
  const { t } = useI18n()
  const [requested, setRequested] = useState<Record<VectorSimilarityBasis, boolean>>({ content: false, style: false })

  useEffect(() => {
    setRequested({ content: false, style: false })
  }, [compositeHash])

  const availabilityQuery = useQuery({
    queryKey: ['image-vector-similarity', compositeHash],
    queryFn: ({ signal }) => getImageVectorAvailability(compositeHash, { signal }),
    enabled: Boolean(compositeHash),
    staleTime: 60_000,
  })
  const available = availabilityQuery.data

  const isRequested = (basis: VectorSimilarityBasis) => requestAll || requested[basis]

  const contentQuery = useQuery({
    queryKey: ['image-similar-vector', compositeHash, 'content', resultLimit],
    queryFn: ({ signal }) => getVectorSimilarImages(compositeHash, 'content', resultLimit, { signal }),
    enabled: ready && isRequested('content') && available?.content === true,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  })
  const styleQuery = useQuery({
    queryKey: ['image-similar-vector', compositeHash, 'style', resultLimit],
    queryFn: ({ signal }) => getVectorSimilarImages(compositeHash, 'style', resultLimit, { signal }),
    enabled: ready && isRequested('style') && available?.style === true,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  })
  const queries = { content: contentQuery, style: styleQuery }

  const itemsByBasis = useMemo(() => {
    const build = (items: Array<{ image: ImageRecord; similarity: number }> | undefined) => {
      const kept = (items ?? []).filter((item) => typeof item.image.composite_hash === 'string' && !excludeHashes.has(item.image.composite_hash))
      return {
        images: getValidImageRecords(kept.map((item) => item.image)),
        scoreByHash: new Map(kept.map((item) => [String(item.image.composite_hash), item.similarity])),
      }
    }
    return { content: build(contentQuery.data?.similar), style: build(styleQuery.data?.similar) }
  }, [contentQuery.data?.similar, excludeHashes, styleQuery.data?.similar])

  const renderContentOverlay = useCallback((image: ImageRecord): ReactNode => {
    const score = itemsByBasis.content.scoreByHash.get(String(image.composite_hash))
    return typeof score === 'number' ? <VectorScoreOverlay score={score} basis="content" /> : null
  }, [itemsByBasis])
  const renderStyleOverlay = useCallback((image: ImageRecord): ReactNode => {
    const score = itemsByBasis.style.scoreByHash.get(String(image.composite_hash))
    return typeof score === 'number' ? <VectorScoreOverlay score={score} basis="style" /> : null
  }, [itemsByBasis])

  const copy = {
    content: {
      title: t({ ko: '내용 유사', en: 'Similar content' }),
      request: t({ ko: '내용 유사 검사: 그림에 담긴 것이 비슷한 이미지를 찾아', en: 'Check similar content: find images showing similar things' }),
      overlay: renderContentOverlay,
    },
    style: {
      title: t({ ko: '화풍 유사', en: 'Similar style' }),
      request: t({ ko: '화풍 유사 검사: 그림체가 비슷한 이미지를 찾아', en: 'Check similar style: find images drawn in a similar style' }),
      overlay: renderStyleOverlay,
    },
  }

  const sections = BASES.flatMap((basis) => {
    if (available?.[basis] !== true) {
      return []
    }

    const query = queries[basis]
    const wasRequested = isRequested(basis)
    const { images } = itemsByBasis[basis]
    const isLoading = wasRequested && (!ready || query.isLoading)
    const errorMessage = wasRequested && query.isError
      ? getErrorMessage(query.error, t('images.components.detail.image.detail.similarity.section.an.unknown.error.occurred'))
      : null
    if (wasRequested && hideEmptySections && !isLoading && !errorMessage && images.length === 0) {
      return []
    }

    return [(
      <RelatedImageGallerySection
        key={basis}
        title={copy[basis].title}
        items={wasRequested ? images : []}
        isLoading={isLoading}
        errorMessage={errorMessage}
        emptyMessage={wasRequested ? t({ ko: '비슷한 이미지가 없어', en: 'No similar images' }) : undefined}
        actions={wasRequested ? undefined : (
          <IconButton
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setRequested((current) => ({ ...current, [basis]: true }))
              onRequest()
            }}
            label={copy[basis].request}
          >
            <ScanSearch />
          </IconButton>
        )}
        activationMode={presentation === 'modal' ? 'modal' : 'modal-single'}
        mobileCardColumns={mobileCardColumns}
        desktopCardColumns={desktopCardColumns}
        cardAspectRatio={cardAspectRatio}
        renderItemPersistentOverlay={copy[basis].overlay}
      />
    )]
  })

  if (sections.length === 0) {
    return null
  }

  return <div className="space-y-6">{sections}</div>
}
