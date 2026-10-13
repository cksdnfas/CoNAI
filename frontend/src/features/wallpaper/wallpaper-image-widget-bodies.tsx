import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Text } from '@/components/ui/text'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { getImageListMediaKind, getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { formatDateTime } from '@/features/module-graph/module-graph-shared'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { WallpaperImageTransitionStyle, WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperGenerationHistory, useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import { buildPreviewImageRecord } from '@/features/images/components/inline-media-preview'
import { buildApiUrl } from '@/lib/api-client'
import type { WallpaperHistoryItem } from '@/lib/api-wallpaper-runtime'
import {
  buildWallpaperImageTransitionTransform,
  type WallpaperImageTransitionFrame,
} from './wallpaper-image-transition-utils'
import {
  WallpaperPreviewImageSurface,
  type WallpaperWidgetPreviewImage,
} from './wallpaper-widget-preview-surface'
import {
  getWallpaperAnimationEasingCss,
  getWallpaperHoverMotionAmount,
  getWallpaperImageTransitionDurationMs,
  getWallpaperImageUrl,
  getWallpaperMotionStrengthMultiplier,
  useWallpaperElementSize,
  useWallpaperRotatingIndex,
} from './wallpaper-widget-utils'
import { WallpaperWidgetErrorNote, WallpaperWidgetNote } from './wallpaper-widget-note'
import { computeWallpaperPuzzleLayout } from './wallpaper-puzzle-layout'

const WALLPAPER_PUZZLE_GAP = 8

/** Workflow name over its kind and time, on a gradient at the bottom of a recent-result card. */
function WallpaperHistoryCardCaption({ title, badge, meta }: { title: ReactNode; badge: ReactNode; meta: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-[1] bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_84%,transparent))] p-2">
      <div className="truncate text-xs font-medium text-white">{title}</div>
      <Text as="div" variant="overline" className="mt-1 flex items-center justify-between gap-2 text-white/78">
        <span>{badge}</span>
        <span className="truncate">{meta}</span>
      </Text>
    </div>
  )
}

function getWallpaperBaseStackCardFrame(
  offsetX: number,
  offsetY: number,
  scale: number,
  rotate: number,
): WallpaperImageTransitionFrame {
  return {
    opacity: 1,
    translateX: offsetX,
    translateY: offsetY,
    scale,
    rotate,
    rotateX: 0,
    blur: 0,
  }
}

// Build one stack-card motion style so recent-results stack mode respects transition style choices.
function getWallpaperStackCardStyle(
  transitionStyle: WallpaperImageTransitionStyle,
  order: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  rotate: number,
): CSSProperties {
  const frame = getWallpaperBaseStackCardFrame(offsetX, offsetY, scale, rotate)

  if (transitionStyle === 'zoom') {
    frame.scale = Math.max(0.72, scale - order * 0.04)
    frame.blur = Math.max(0, order * 1.6)
  } else if (transitionStyle === 'slide') {
    frame.translateY += order * 12
    frame.blur = Math.max(0, order * 0.8)
  } else if (transitionStyle === 'blur') {
    frame.blur = Math.max(0, order * 2.6)
  } else if (transitionStyle === 'flip') {
    frame.rotateX = order * 12
    frame.blur = Math.max(0, order * 0.6)
  } else if (transitionStyle === 'shuffle') {
    const direction = order % 2 === 0 ? -1 : 1
    frame.translateX += direction * order * 10
    frame.translateY += order * 6
    frame.rotate += direction * order * 3.5
    frame.scale = Math.max(0.8, scale - order * 0.015)
    frame.blur = Math.max(0, order * 1.1)
  }

  return {
    transform: buildWallpaperImageTransitionTransform(frame),
    filter: `blur(${frame.blur}px)`,
    ...(transitionStyle === 'flip' ? { transformStyle: 'preserve-3d' as const } : {}),
  }
}

function areSameWallpaperImageRecords(left: ImageRecord | undefined, right: ImageRecord | undefined) {
  if (!left || !right) {
    return false
  }

  return left.image_url === right.image_url
    && left.thumbnail_url === right.thumbnail_url
    && left.mime_type === right.mime_type
}

function preloadWallpaperImageRecord(image: ImageRecord | undefined) {
  const previewUrl = image ? getImageListPreviewUrl(image) : null
  if (!previewUrl) {
    return Promise.resolve()
  }

  const mediaKind = image ? getImageListMediaKind(image) : 'image'
  if (mediaKind === 'video') {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const preloader = new window.Image()
    const finish = () => {
      preloader.onload = null
      preloader.onerror = null
      resolve()
    }

    preloader.onload = finish
    preloader.onerror = finish
    preloader.src = previewUrl

    if (preloader.complete) {
      finish()
    }
  })
}

function getWallpaperPreviewOpenSettings(widget: WallpaperWidgetInstance) {
  return {
    previewOpenScalePercent: widget.settings.imagePreviewOpenScalePercent,
    previewOpenDurationMs: widget.settings.imagePreviewOpenDurationMs,
    previewOpenEasing: widget.settings.imagePreviewOpenEasing,
    previewCloseScalePercent: widget.settings.imagePreviewCloseScalePercent,
    previewCloseDurationMs: widget.settings.imagePreviewCloseDurationMs,
    previewCloseEasing: widget.settings.imagePreviewCloseEasing,
  }
}

const WALLPAPER_SERVICE_LABEL: Record<string, string> = { novelai: 'NAI', comfyui: 'ComfyUI', codex: 'Codex' }

function buildWallpaperHistoryImage(item: WallpaperHistoryItem): ImageRecord {
  const base = buildPreviewImageRecord({ src: buildApiUrl(item.imageUrl), mimeType: item.mimeType, fileName: item.workflowName ?? '', alt: item.workflowName ?? '' }) as ImageRecord
  return { ...base, id: item.compositeHash, composite_hash: item.compositeHash, thumbnail_url: buildApiUrl(item.thumbnailUrl), width: item.width ?? undefined, height: item.height ?? undefined } as ImageRecord
}

/** Latest finished generations from every service (NAI, ComfyUI, Codex, workflows). */
export function WallpaperRecentResultsBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'recent-results' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const { t } = useI18n()
  const visibleCount = Math.max(1, Math.min(12, widget.settings.visibleCount))
  const displayMode = widget.settings.displayMode ?? 'grid'
  const shiftInterval = Math.max(4, widget.settings.shiftIntervalSec ?? 8) * 1000
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'zoom'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageTransitionDurationMs = widget.settings.imageTransitionDurationMs
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'
  const stackTransitionDurationMs = getWallpaperImageTransitionDurationMs(imageTransitionSpeed, imageTransitionDurationMs)
  const stackTransitionTimingFunction = getWallpaperAnimationEasingCss(imageTransitionEasing)

  const resultsQuery = useWallpaperGenerationHistory(visibleCount, widget.settings.service ?? 'all', widget.settings.refreshIntervalSec)

  const recentEntries = useMemo(() => (resultsQuery.data ?? []).map((item) => ({
    id: `history-${item.id}`,
    previewImage: buildWallpaperHistoryImage(item),
    workflowName: item.workflowName || WALLPAPER_SERVICE_LABEL[item.serviceType] || item.serviceType,
    createdLabel: formatDateTime(item.completedAt ?? item.createdAt ?? ''),
    badge: WALLPAPER_SERVICE_LABEL[item.serviceType] ?? item.serviceType,
    aspect: item.width && item.height ? item.width / item.height : 1,
  })), [resultsQuery.data])

  const stackIndex = useWallpaperRotatingIndex(recentEntries.length, shiftInterval, displayMode === 'stack' && recentEntries.length > 1)
  const [puzzleRef, puzzleSize] = useWallpaperElementSize<HTMLDivElement>()
  const puzzleRects = useMemo(
    () => (displayMode === 'masonry' ? computeWallpaperPuzzleLayout(recentEntries.map((entry) => entry.aspect), puzzleSize.width, puzzleSize.height, WALLPAPER_PUZZLE_GAP) : []),
    [displayMode, recentEntries, puzzleSize.width, puzzleSize.height],
  )

  if (resultsQuery.isLoading) {
    return <WallpaperWidgetNote>{t({ ko: '최근 결과 불러오는 중…', en: 'Loading recent results…' })}</WallpaperWidgetNote>
  }

  if (resultsQuery.isError) {
    return <WallpaperWidgetErrorNote error={resultsQuery.error} />
  }

  if (displayMode === 'stack') {
    const stackedEntries = recentEntries.map((entry, index) => ({
      entry,
      order: (index - stackIndex + recentEntries.length) % Math.max(recentEntries.length, 1),
    })).sort((left, right) => right.order - left.order)

    return (
      <div className="relative h-full overflow-hidden">
        {recentEntries.length === 0 ? (
          <WallpaperWidgetNote>{t({ ko: '아직 최근 이미지 결과가 없어.', en: 'There are no recent image results yet.' })}</WallpaperWidgetNote>
        ) : null}

        {stackedEntries.map(({ entry, order }) => {
          const offsetX = order * 14
          const offsetY = order * 10
          const scale = Math.max(0.82, 1 - order * 0.05)
          const opacity = Math.max(0.28, 1 - order * 0.18)
          const rotate = (order % 2 === 0 ? -1 : 1) * order * 1.8
          const isFront = order === 0
          const cardStyle = {
            inset: `${offsetY}px ${offsetX}px ${Math.max(0, offsetY * 0.4)}px ${Math.max(0, offsetX * 0.35)}px`,
            ...getWallpaperStackCardStyle(imageTransitionStyle, order, offsetX, offsetY, scale, rotate),
            opacity,
            zIndex: 100 - order,
          }
          const cardContent = (
            <>
              <ImagePreviewMedia
                image={entry.previewImage}
                alt={entry.workflowName}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                draggable={false}
              />
              <WallpaperHistoryCardCaption title={entry.workflowName} badge={entry.badge} meta={isFront ? entry.createdLabel : `-${order}`} />
            </>
          )

          if (mode === 'runtime' && onOpenImage && widget.settings.imageClickAction !== 'none') {
            return (
              // eslint-disable-next-line no-restricted-syntax -- wallpaper runtime image card: the rendered art is the click target
              <button
                key={entry.id}
                type="button"
                className="absolute inset-0 block overflow-hidden rounded-xl border border-white/12 bg-surface-high shadow-[0_16px_42px_rgba(0,0,0,0.34)] transition-[opacity,transform,filter,inset]"
                style={{
                  ...cardStyle,
                  transitionDuration: `${stackTransitionDurationMs}ms`,
                  transitionTimingFunction: stackTransitionTimingFunction,
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenImage({
                    image: entry.previewImage,
                    alt: entry.workflowName,
                    ...getWallpaperPreviewOpenSettings(widget),
                  })
                }}
              >
                {cardContent}
              </button>
            )
          }

          return (
            <div
              key={entry.id}
              className="absolute inset-0 overflow-hidden rounded-xl border border-white/12 bg-surface-high shadow-[0_16px_42px_rgba(0,0,0,0.34)] transition-[opacity,transform,filter,inset]"
              style={{
                ...cardStyle,
                transitionDuration: `${stackTransitionDurationMs}ms`,
                transitionTimingFunction: stackTransitionTimingFunction,
              }}
            >
              {cardContent}
            </div>
          )
        })}
      </div>
    )
  }

  if (displayMode === 'masonry') {
    // Puzzle-fit: every entry gets a tile and the tiles cover the whole widget (CSS columns clipped the overflow).
    return (
      <div ref={puzzleRef} className="relative h-full overflow-hidden">
        {recentEntries.length === 0 ? (
          <WallpaperWidgetNote>
            {t({ ko: '아직 생성 결과가 없어.', en: 'No generations yet.' })}
          </WallpaperWidgetNote>
        ) : null}
        {recentEntries.map((entry, index) => puzzleRects[index] ? (
          // The surface forces `relative`, so the tile position lives on a wrapper.
          <div key={entry.id} className="absolute transition-[left,top,width,height] duration-500 ease-out" style={puzzleRects[index]}>
            <WallpaperPreviewImageSurface
              image={entry.previewImage}
              alt={entry.workflowName}
              onOpenImage={mode === 'runtime' && widget.settings.imageClickAction !== 'none' ? onOpenImage : undefined}
              transitionStyle={imageTransitionStyle}
              transitionSpeed={imageTransitionSpeed}
              transitionDurationMs={imageTransitionDurationMs}
              transitionEasing={imageTransitionEasing}
              hoverMotion={imageHoverMotion}
              hoverEasing={hoverEasing}
              {...getWallpaperPreviewOpenSettings(widget)}
              className="block h-full w-full overflow-hidden rounded-lg"
              imageClassName="h-full w-full object-cover"
            />
          </div>
        ) : null)}
      </div>
    )
  }

  return (
    <div className={cn('grid h-full gap-2', visibleCount >= 4 ? 'grid-cols-2' : 'grid-cols-1')}>
      {recentEntries.length === 0 ? (
        <WallpaperWidgetNote tone="placeholder" className="col-span-full">
          {t({ ko: '아직 최근 이미지 결과가 없어.', en: 'There are no recent image results yet.' })}
        </WallpaperWidgetNote>
      ) : null}

      {recentEntries.map((entry, index) => (
        <WallpaperPreviewImageSurface
          key={`recent-grid-slot-${index}`}
          image={entry.previewImage}
          alt={entry.workflowName}
          onOpenImage={mode === 'runtime' && widget.settings.imageClickAction !== 'none' ? onOpenImage : undefined}
          transitionStyle={imageTransitionStyle}
          transitionSpeed={imageTransitionSpeed}
          transitionDurationMs={imageTransitionDurationMs}
          transitionEasing={imageTransitionEasing}
          hoverMotion={imageHoverMotion}
          hoverEasing={hoverEasing}
          {...getWallpaperPreviewOpenSettings(widget)}
          className="relative overflow-hidden rounded-xl border border-border/70 bg-surface-low"
          imageClassName="h-full w-full object-cover"
        >
          <WallpaperHistoryCardCaption title={entry.workflowName} badge={entry.badge} meta={entry.createdLabel} />
        </WallpaperPreviewImageSurface>
      ))}
    </div>
  )
}

/** Render one group-backed preview grid using the existing groups preview API. */
export function WallpaperGroupImageViewBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const { t } = useI18n()
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(1, Math.min(9, widget.settings.visibleCount))
  const layoutMode = widget.settings.layoutMode ?? 'grid'
  const slideshowInterval = Math.max(4, widget.settings.slideshowIntervalSec ?? 12) * 1000
  const previewPoolCount = Math.max(visibleCount + 1, visibleCount * 3, 12)
  const motionMode = widget.settings.motionMode ?? 'static'
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 1)
  const motionEasing = widget.settings.motionEasing ?? 'easeOutCubic'
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageTransitionDurationMs = widget.settings.imageTransitionDurationMs
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'
  const allowPointerMotion = motionMode === 'pointer' && mode === 'runtime'
  const [pointerOffset, setPointerOffset] = useState<{ x: number; y: number } | null>(null)
  const [isPointerInside, setIsPointerInside] = useState(false)

  const previewQuery = useWallpaperGroupPreviewImagesQuery('group-image-view', groupId, includeChildren, previewPoolCount, widget.settings.poolRefreshMinutes ?? 0)
  const images = useMemo(() => previewQuery.data ?? [], [previewQuery.data])
  const rotationEnabled = images.length > visibleCount && !(widget.settings.pauseOnHover !== false && isPointerInside)
  const rotationIndex = useWallpaperRotatingIndex(images.length, slideshowInterval, rotationEnabled)
  const targetVisibleImages = useMemo(() => {
    if (images.length <= visibleCount) {
      return images.slice(0, visibleCount)
    }

    const batchStartIndex = (rotationIndex * visibleCount) % images.length
    return Array.from({ length: visibleCount }, (_, index) => images[(batchStartIndex + index) % images.length]).filter(Boolean)
  }, [images, rotationIndex, visibleCount])
  const [visibleImages, setVisibleImages] = useState<ImageRecord[]>(targetVisibleImages)
  const visibleImageRequestRef = useRef(0)

  useEffect(() => {
    const isSameVisibleSet = visibleImages.length === targetVisibleImages.length
      && visibleImages.every((image, index) => areSameWallpaperImageRecords(image, targetVisibleImages[index]))

    if (isSameVisibleSet) {
      return
    }

    if (visibleImages.length === 0 || targetVisibleImages.length === 0) {
      setVisibleImages(targetVisibleImages)
      return
    }

    const requestId = visibleImageRequestRef.current + 1
    visibleImageRequestRef.current = requestId
    let cancelled = false

    void Promise.all(targetVisibleImages.map((image) => preloadWallpaperImageRecord(image))).then(() => {
      if (cancelled || visibleImageRequestRef.current !== requestId) {
        return
      }

      setVisibleImages(targetVisibleImages)
    })

    return () => {
      cancelled = true
    }
  }, [targetVisibleImages, visibleImages])

  const isPuzzle = layoutMode === 'masonry'
  const [puzzleRef, puzzleSize] = useWallpaperElementSize<HTMLDivElement>()
  const puzzleRects = useMemo(
    () => (isPuzzle
      ? computeWallpaperPuzzleLayout(visibleImages.map((image) => (image.width && image.height ? image.width / image.height : 1)), puzzleSize.width, puzzleSize.height, WALLPAPER_PUZZLE_GAP)
      : []),
    [isPuzzle, visibleImages, puzzleSize.width, puzzleSize.height],
  )
  const columnCount = layoutMode === 'filmstrip' ? visibleCount : visibleCount >= 6 ? 3 : visibleCount >= 4 ? 2 : 1
  const rowCount = Math.max(1, Math.ceil(Math.max(visibleImages.length, 1) / columnCount))

  if (groupId === null) {
    return <WallpaperWidgetNote tone="placeholder">{t({ ko: '설정에서 그룹을 선택해.', en: 'Select a group in settings.' })}</WallpaperWidgetNote>
  }

  if (previewQuery.isLoading) {
    return <WallpaperWidgetNote>{t({ ko: '그룹 미리보기 불러오는 중…', en: 'Loading group previews…' })}</WallpaperWidgetNote>
  }

  if (previewQuery.isError) {
    return <WallpaperWidgetNote tone="error">{t({ ko: '그룹 미리보기를 불러오지 못했어.', en: 'Failed to load group previews.' })}</WallpaperWidgetNote>
  }

  return (
    <div
      ref={isPuzzle ? puzzleRef : undefined}
      className={cn('relative h-full', isPuzzle ? 'overflow-hidden' : 'grid gap-2')}
      style={isPuzzle ? undefined : { gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      onPointerEnter={() => setIsPointerInside(true)}
      onPointerMove={allowPointerMotion ? (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const nextX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2
        const nextY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2
        setPointerOffset({ x: nextX, y: nextY })
      } : undefined}
      onPointerLeave={() => {
        setIsPointerInside(false)
        if (allowPointerMotion) {
          setPointerOffset(null)
        }
      }}
    >
      {visibleImages.length === 0 ? (
        <WallpaperWidgetNote tone="placeholder" className="col-span-full">
          {t({ ko: '이 그룹에는 아직 미리보기 이미지가 없어.', en: 'There are no preview images in this group yet.' })}
        </WallpaperWidgetNote>
      ) : null}
      {visibleImages.map((image, index) => {
        const imageUrl = getWallpaperImageUrl(image)
        const columnIndex = index % columnCount
        const rowIndex = Math.floor(index / columnCount)
        const puzzleRect = isPuzzle ? puzzleRects[index] : undefined
        if (isPuzzle && !puzzleRect) {
          return null
        }
        const columnBias = puzzleRect
          ? ((puzzleRect.left + puzzleRect.width / 2) / Math.max(1, puzzleSize.width) - 0.5) * 2
          : columnIndex - (columnCount - 1) / 2
        const rowBias = puzzleRect
          ? ((puzzleRect.top + puzzleRect.height / 2) / Math.max(1, puzzleSize.height) - 0.5) * 2
          : rowIndex - (rowCount - 1) / 2
        let translateX = 0
        let translateY = 0

        // Ambient drift runs in CSS, on a wrapper so hover scaling still reaches the tile, around a resting
        // offset that fans tiles out from the centre.
        const ambientStyle = motionMode === 'ambient'
          ? {
              ['--wp-bx' as string]: `${(columnBias * 1.35 * motionStrength).toFixed(2)}px`,
              ['--wp-by' as string]: `${(rowBias * 1.15 * motionStrength).toFixed(2)}px`,
              ['--wp-ax' as string]: `${(2.8 * motionStrength).toFixed(2)}px`,
              ['--wp-ay' as string]: `${(2.4 * motionStrength).toFixed(2)}px`,
              ['--wp-scale' as string]: '1.025',
              ['--wp-duration' as string]: `${(5 + (index % 4) * 0.9).toFixed(2)}s`,
              ['--wp-delay' as string]: `${(-index * 0.8).toFixed(2)}s`,
            }
          : null
        if (allowPointerMotion && pointerOffset) {
          translateX = (pointerOffset.x * 7 + columnBias * 1.8) * motionStrength
          translateY = (pointerOffset.y * 7 + rowBias * 1.8) * motionStrength
        }
        const fillsWrapper = isPuzzle || ambientStyle !== null

        const tile = imageUrl ? (
          <WallpaperPreviewImageSurface
            image={image}
            alt={t({ ko: '그룹 미리보기', en: 'Group preview' })}
            onOpenImage={mode === 'runtime' && widget.settings.imageClickAction !== 'none' ? onOpenImage : undefined}
            transitionStyle={imageTransitionStyle}
            transitionSpeed={imageTransitionSpeed}
            transitionDurationMs={imageTransitionDurationMs}
            transitionEasing={imageTransitionEasing}
            hoverMotion={imageHoverMotion}
            hoverEasing={hoverEasing}
            {...getWallpaperPreviewOpenSettings(widget)}
            className={cn('overflow-hidden rounded-lg border border-border/70 bg-surface-low transition-transform duration-200 will-change-transform', fillsWrapper && 'h-full w-full')}
            imageClassName="h-full w-full object-cover"
            style={{
              transform: `translate3d(${translateX}px, ${translateY}px, 0)`,
              transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
            }}
          />
        ) : (
          <div
            className="flex h-full w-full min-h-16 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-surface-low text-xs text-muted-foreground transition-transform duration-200 will-change-transform"
            style={{
              transform: `translate3d(${translateX}px, ${translateY}px, 0)`,
              transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
            }}
          >
            {t({ ko: '이미지 없음', en: 'No image' })}
          </div>
        )
        const movingTile = ambientStyle ? <div className="wallpaper-drift h-full w-full" style={ambientStyle}>{tile}</div> : tile

        // The surface forces `relative`, so a puzzle tile's position lives on a wrapper.
        return puzzleRect ? (
          <div key={`group-grid-slot-${index}`} className="absolute transition-[left,top,width,height] duration-500 ease-out" style={puzzleRect}>
            {movingTile}
          </div>
        ) : (
          <Fragment key={`group-grid-slot-${index}`}>{movingTile}</Fragment>
        )
      })}

    </div>
  )
}

/** Render one showcase-style image widget with optional motion playback. */
export function WallpaperImageShowcaseBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const { t } = useI18n()
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const playbackMode = widget.settings.playbackMode ?? 'carousel'
  const previewCount = playbackMode === 'static' ? 1 : 10
  const slideshowInterval = Math.max(4, widget.settings.slideshowIntervalSec) * 1000
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageTransitionDurationMs = widget.settings.imageTransitionDurationMs
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'
  const [isPointerInside, setIsPointerInside] = useState(false)

  const previewQuery = useWallpaperGroupPreviewImagesQuery('image-showcase', groupId, includeChildren, previewCount, widget.settings.poolRefreshMinutes ?? 0)

  const images = useMemo(() => previewQuery.data ?? [], [previewQuery.data])
  const rotationEnabled = playbackMode !== 'static' && images.length > 1 && !(widget.settings.pauseOnHover !== false && isPointerInside)
  const kenBurnsEnabled = playbackMode === 'ken-burns'
  const currentIndex = useWallpaperRotatingIndex(images.length, slideshowInterval, rotationEnabled)
  const currentImage = images[currentIndex] ?? images[0] ?? null
  const imageUrl = getWallpaperImageUrl(currentImage)

  if (groupId === null) {
    return (
      <div className="flex h-full items-end rounded-sm border border-border/70 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--secondary)_24%,transparent),transparent_55%),linear-gradient(180deg,transparent,color-mix(in_srgb,var(--primary)_10%,transparent)),var(--surface-low)] p-3">
        <div>
          <Text as="div" variant="overline" className="text-xs text-secondary-text">{t({ ko: '대표 이미지', en: 'Featured image' })}</Text>
          <div className="text-sm font-medium text-foreground">{t({ ko: '설정에서 쇼케이스용 그룹을 골라.', en: 'Choose a showcase group in settings.' })}</div>
        </div>
      </div>
    )
  }

  if (previewQuery.isLoading) {
    return <WallpaperWidgetNote>{t({ ko: '쇼케이스 불러오는 중…', en: 'Loading showcase…' })}</WallpaperWidgetNote>
  }

  if (previewQuery.isError) {
    return <WallpaperWidgetErrorNote error={previewQuery.error} />
  }

  if (!imageUrl) {
    return <WallpaperWidgetNote tone="placeholder">{t({ ko: '표시할 쇼케이스 이미지가 없어.', en: 'There is no showcase image to display.' })}</WallpaperWidgetNote>
  }

  // Ken Burns pans in CSS (`.wallpaper-ken-burns`); the other modes hold a fixed transform.
  const showcaseTransform = kenBurnsEnabled ? undefined : rotationEnabled ? 'scale(1.03)' : 'scale(1)'

  return (
    <WallpaperPreviewImageSurface
      image={currentImage}
      alt={t({ ko: '쇼케이스', en: 'Showcase' })}
      onOpenImage={mode === 'runtime' && widget.settings.imageClickAction !== 'none' ? onOpenImage : undefined}
      transitionStyle={imageTransitionStyle}
      transitionSpeed={imageTransitionSpeed}
      transitionDurationMs={imageTransitionDurationMs}
      transitionEasing={imageTransitionEasing}
      hoverMotion={imageHoverMotion}
      hoverEasing={hoverEasing}
      {...getWallpaperPreviewOpenSettings(widget)}
      className={cn(
        'relative h-full overflow-hidden rounded-xl border border-border/70',
        'bg-transparent',
      )}
      imageClassName={cn(
        'h-full w-full rounded-xl ease-out will-change-transform',
        widget.settings.fitMode === 'contain' ? 'object-contain' : widget.settings.fitMode === 'scale-down' ? 'object-scale-down' : 'object-cover',
        kenBurnsEnabled ? 'wallpaper-ken-burns' : 'transition-transform duration-[1600ms]',
      )}
      imageStyle={{
        transform: showcaseTransform,
        ...(kenBurnsEnabled ? { ['--wp-duration' as string]: `${Math.max(16, (slideshowInterval / 1000) * 2)}s` } : null),
        transitionTimingFunction: getWallpaperAnimationEasingCss(imageTransitionEasing),
      }}
      onPointerEnter={() => setIsPointerInside(true)}
      onPointerLeave={() => setIsPointerInside(false)}
    >
      {rotationEnabled ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_74%,transparent))] px-3 py-2">
          <div className="flex items-center gap-1.5">
            {images.map((image, index) => (
              <span
                key={String(image.composite_hash ?? image.id ?? index)}
                className={cn(
                  'block h-1.5 rounded-full bg-white/55 transition-all duration-300',
                  index === currentIndex ? 'w-4 bg-white' : 'w-1.5',
                )}
              />
            ))}
          </div>
          <Text as="div" variant="overline" className="rounded-full bg-background/70 px-2 py-0.5 text-foreground/92 backdrop-blur-sm">
            {kenBurnsEnabled ? t({ ko: '켄 번즈', en: 'Ken Burns' }) : t({ ko: '자동', en: 'Auto' })}
          </Text>
        </div>
      ) : null}
    </WallpaperPreviewImageSurface>
  )
}
