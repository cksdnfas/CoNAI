import { useMemo, useState } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { formatDateTime, getArtifactPreviewUrl } from '@/features/module-graph/module-graph-shared'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperBrowseContentQuery, useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import {
  getWallpaperArtifactPreviewImage,
  WallpaperPreviewImageSurface,
  type WallpaperWidgetPreviewImage,
} from './wallpaper-widget-preview-surface'
import {
  buildWallpaperFinalResultArtifact,
  getWallpaperAnimationEasingCss,
  getWallpaperHoverMotionAmount,
  getWallpaperImageUrl,
  getWallpaperMotionStrengthMultiplier,
  useWallpaperMotionTick,
  useWallpaperRotatingIndex,
} from './wallpaper-widget-utils'

/** Render one recent-results widget using the latest graph outputs. */
export function WallpaperRecentResultsBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'recent-results' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const refreshInterval = Math.max(5, widget.settings.refreshIntervalSec) * 1000
  const visibleCount = Math.max(1, Math.min(6, widget.settings.visibleCount))
  const displayMode = widget.settings.displayMode ?? 'grid'
  const shiftInterval = Math.max(4, widget.settings.shiftIntervalSec ?? 8) * 1000
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'zoom'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'

  const resultsQuery = useWallpaperBrowseContentQuery('recent-results', refreshInterval)

  const recentEntries = useMemo(() => {
    const browseContent = resultsQuery.data
    if (!browseContent) {
      return [] as Array<{ id: string; previewImage: ImageRecord; workflowName: string; createdLabel: string; badge: string }>
    }

    const workflowById = new Map(browseContent.workflows.map((workflow) => [workflow.id, workflow]))
    const executionById = new Map(browseContent.executions.map((execution) => [execution.id, execution]))
    const claimedArtifactIds = new Set<number>()

    const finalEntries = [...browseContent.final_results]
      .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
      .flatMap((finalResult) => {
        claimedArtifactIds.add(finalResult.source_artifact_id)
        const artifact = buildWallpaperFinalResultArtifact(finalResult)
        if (artifact.artifact_type !== 'image') {
          return []
        }

        const previewUrl = getArtifactPreviewUrl(artifact)
        if (!previewUrl) {
          return []
        }

        const execution = executionById.get(finalResult.source_execution_id ?? finalResult.execution_id)
        const workflowName = execution ? (workflowById.get(execution.graph_workflow_id)?.name ?? '워크플로') : '워크플로'
        const previewImage = getWallpaperArtifactPreviewImage(previewUrl, workflowName, finalResult.source_metadata)
        if (!previewImage) {
          return []
        }

        return [{
          id: `final-${finalResult.id}`,
          previewImage,
          workflowName,
          createdLabel: formatDateTime(finalResult.created_date),
          badge: '최종',
        }]
      })

    const artifactEntries = [...browseContent.artifacts]
      .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
      .flatMap((artifact) => {
        if (claimedArtifactIds.has(artifact.id) || artifact.artifact_type !== 'image') {
          return []
        }

        const previewUrl = getArtifactPreviewUrl(artifact)
        if (!previewUrl) {
          return []
        }

        const execution = executionById.get(artifact.execution_id)
        const workflowName = execution ? (workflowById.get(execution.graph_workflow_id)?.name ?? '워크플로') : '워크플로'
        const previewImage = getWallpaperArtifactPreviewImage(previewUrl, workflowName, artifact.metadata)
        if (!previewImage) {
          return []
        }

        return [{
          id: `artifact-${artifact.id}`,
          previewImage,
          workflowName,
          createdLabel: formatDateTime(artifact.created_date),
          badge: '실시간',
        }]
      })

    return [...finalEntries, ...artifactEntries].slice(0, visibleCount)
  }, [resultsQuery.data, visibleCount])

  const stackIndex = useWallpaperRotatingIndex(recentEntries.length, shiftInterval, displayMode === 'stack' && recentEntries.length > 1)

  if (resultsQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">최근 결과 불러오는 중…</div>
  }

  if (resultsQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">최근 결과를 불러오지 못했어.</div>
  }

  if (displayMode === 'stack') {
    const stackedEntries = recentEntries.map((entry, index) => ({
      entry,
      order: (index - stackIndex + recentEntries.length) % Math.max(recentEntries.length, 1),
    })).sort((left, right) => right.order - left.order)

    return (
      <div className="relative h-full overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent_40%),var(--surface-low)]">
        {recentEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">아직 최근 이미지 결과가 없어.</div>
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
            transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${rotate}deg) scale(${scale})`,
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
              <div className="absolute inset-x-0 bottom-0 z-[1] bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_84%,transparent))] p-2">
                <div className="truncate text-xs font-medium text-white">{entry.workflowName}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-white/78">
                  <span>{entry.badge}</span>
                  <span className="truncate">{isFront ? entry.createdLabel : `-${order}`}</span>
                </div>
              </div>
            </>
          )

          if (mode === 'runtime' && onOpenImage) {
            return (
              <button
                key={entry.id}
                type="button"
                className="absolute inset-0 block overflow-hidden rounded-xl border border-white/12 bg-surface-high shadow-[0_16px_42px_rgba(0,0,0,0.34)] transition-all duration-[1600ms] ease-out"
                style={cardStyle}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenImage({ image: entry.previewImage, alt: entry.workflowName })
                }}
              >
                {cardContent}
              </button>
            )
          }

          return (
            <div
              key={entry.id}
              className="absolute inset-0 overflow-hidden rounded-xl border border-white/12 bg-surface-high shadow-[0_16px_42px_rgba(0,0,0,0.34)] transition-all duration-[1600ms] ease-out"
              style={cardStyle}
            >
              {cardContent}
            </div>
          )
        })}

        {recentEntries.length > 1 ? (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-background/72 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/90 backdrop-blur-sm">
            스택
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('grid h-full gap-2', visibleCount >= 4 ? 'grid-cols-2' : 'grid-cols-1')}>
      {recentEntries.length === 0 ? (
        <div className="col-span-full flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
          아직 최근 이미지 결과가 없어.
        </div>
      ) : null}

      {recentEntries.map((entry, index) => (
        <WallpaperPreviewImageSurface
          key={`recent-grid-slot-${index}`}
          image={entry.previewImage}
          alt={entry.workflowName}
          onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
          transitionStyle={imageTransitionStyle}
          transitionSpeed={imageTransitionSpeed}
          transitionEasing={imageTransitionEasing}
          hoverMotion={imageHoverMotion}
          hoverEasing={hoverEasing}
          className="relative overflow-hidden rounded-xl border border-border/70 bg-surface-low"
          imageClassName="h-full w-full object-cover"
        >
          <div className="absolute inset-x-0 bottom-0 z-[1] bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_84%,transparent))] p-2">
            <div className="truncate text-xs font-medium text-white">{entry.workflowName}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-white/78">
              <span>{entry.badge}</span>
              <span className="truncate">{entry.createdLabel}</span>
            </div>
          </div>
        </WallpaperPreviewImageSurface>
      ))}
    </div>
  )
}

/** Render one group-backed preview grid using the existing groups preview API. */
export function WallpaperGroupImageViewBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(1, Math.min(9, widget.settings.visibleCount))
  const motionMode = widget.settings.motionMode ?? 'static'
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 1)
  const motionEasing = widget.settings.motionEasing ?? 'easeOutCubic'
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'
  const allowPointerMotion = motionMode === 'pointer' && mode === 'runtime'
  const ambientTick = useWallpaperMotionTick(motionMode === 'ambient')
  const [pointerOffset, setPointerOffset] = useState<{ x: number; y: number } | null>(null)

  const previewQuery = useWallpaperGroupPreviewImagesQuery('group-image-view', groupId, includeChildren, visibleCount)

  if (groupId === null) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">설정에서 그룹을 선택해.</div>
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">그룹 미리보기 불러오는 중…</div>
  }

  if (previewQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">그룹 미리보기를 불러오지 못했어.</div>
  }

  const images = previewQuery.data ?? []
  const columnCount = visibleCount >= 6 ? 3 : visibleCount >= 4 ? 2 : 1
  const rowCount = Math.max(1, Math.ceil(Math.max(images.length, 1) / columnCount))

  return (
    <div
      className="relative grid h-full gap-2"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      onPointerMove={allowPointerMotion ? (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const nextX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2
        const nextY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2
        setPointerOffset({ x: nextX, y: nextY })
      } : undefined}
      onPointerLeave={allowPointerMotion ? () => setPointerOffset(null) : undefined}
    >
      {images.length === 0 ? (
        <div className="col-span-full flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
          이 그룹에는 아직 미리보기 이미지가 없어.
        </div>
      ) : null}
      {images.map((image, index) => {
        const imageUrl = getWallpaperImageUrl(image)
        const columnIndex = index % columnCount
        const rowIndex = Math.floor(index / columnCount)
        const columnBias = columnIndex - (columnCount - 1) / 2
        const rowBias = rowIndex - (rowCount - 1) / 2
        let translateX = 0
        let translateY = 0
        let scale = 1

        if (motionMode === 'ambient') {
          const phase = ambientTick / 8 + index * 0.72
          translateX = (Math.sin(phase) * 2.8 + columnBias * 1.35) * motionStrength
          translateY = (Math.cos(phase * 0.9) * 2.4 + rowBias * 1.15) * motionStrength
          scale = 1.025
        } else if (allowPointerMotion && pointerOffset) {
          translateX = (pointerOffset.x * 7 + columnBias * 1.8) * motionStrength
          translateY = (pointerOffset.y * 7 + rowBias * 1.8) * motionStrength
          scale = 1
        }

        return imageUrl ? (
          <WallpaperPreviewImageSurface
            key={`group-grid-slot-${index}`}
            image={image}
            alt="그룹 미리보기"
            onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
            transitionStyle={imageTransitionStyle}
            transitionSpeed={imageTransitionSpeed}
            transitionEasing={imageTransitionEasing}
            hoverMotion={imageHoverMotion}
            hoverEasing={hoverEasing}
            className="overflow-hidden rounded-lg border border-border/70 bg-surface-low transition-transform duration-200 will-change-transform"
            imageClassName="h-full w-full object-cover"
            style={{
              transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
              transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
            }}
          />
        ) : (
          <div
            key={`group-grid-slot-${index}`}
            className="flex h-full min-h-16 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-surface-low text-xs text-muted-foreground transition-transform duration-200 will-change-transform"
            style={{
              transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
              transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
            }}
          >
            이미지 없음
          </div>
        )
      })}

    </div>
  )
}

/** Render one showcase-style image widget with optional motion playback. */
export function WallpaperImageShowcaseBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const playbackMode = widget.settings.playbackMode ?? 'carousel'
  const previewCount = playbackMode === 'static' ? 1 : 10
  const slideshowInterval = Math.max(4, widget.settings.slideshowIntervalSec) * 1000
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'

  const previewQuery = useWallpaperGroupPreviewImagesQuery('image-showcase', groupId, includeChildren, previewCount)

  const images = previewQuery.data ?? []
  const rotationEnabled = playbackMode !== 'static' && images.length > 1
  const kenBurnsEnabled = playbackMode === 'ken-burns'
  const currentIndex = useWallpaperRotatingIndex(images.length, slideshowInterval, rotationEnabled)
  const motionTick = useWallpaperMotionTick(kenBurnsEnabled)
  const currentImage = images[currentIndex] ?? images[0] ?? null
  const imageUrl = getWallpaperImageUrl(currentImage)

  if (groupId === null) {
    return (
      <div className="flex h-full items-end rounded-sm border border-border/70 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--secondary)_24%,transparent),transparent_55%),linear-gradient(180deg,transparent,color-mix(in_srgb,var(--primary)_10%,transparent)),var(--surface-low)] p-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-secondary">대표 이미지</div>
          <div className="text-sm font-medium text-foreground">설정에서 쇼케이스용 그룹을 골라.</div>
        </div>
      </div>
    )
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">쇼케이스 불러오는 중…</div>
  }

  if (!imageUrl) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">표시할 쇼케이스 이미지가 없어.</div>
  }

  const motionPhase = motionTick / 18 + currentIndex * 0.8
  const kenBurnsTranslateX = Math.sin(motionPhase * 0.8) * 8
  const kenBurnsTranslateY = Math.cos(motionPhase * 0.6) * 6
  const kenBurnsScale = 1.08 + ((Math.sin(motionPhase * 0.5) + 1) * 0.03)
  const showcaseTransform = kenBurnsEnabled
    ? `translate3d(${kenBurnsTranslateX}px, ${kenBurnsTranslateY}px, 0) scale(${kenBurnsScale})`
    : rotationEnabled
      ? 'scale(1.03)'
      : 'scale(1)'

  return (
    <WallpaperPreviewImageSurface
      image={currentImage}
      alt="쇼케이스"
      onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
      transitionStyle={imageTransitionStyle}
      transitionSpeed={imageTransitionSpeed}
      transitionEasing={imageTransitionEasing}
      hoverMotion={imageHoverMotion}
      hoverEasing={hoverEasing}
      className="relative h-full overflow-hidden rounded-xl border border-border/70 bg-surface-low"
      imageClassName={cn(
        'h-full w-full rounded-xl ease-out will-change-transform',
        widget.settings.fitMode === 'contain' ? 'object-contain' : 'object-cover',
        kenBurnsEnabled ? 'transition-transform duration-200' : 'transition-transform duration-[1600ms]',
      )}
      imageStyle={{
        transform: showcaseTransform,
        transitionTimingFunction: getWallpaperAnimationEasingCss(imageTransitionEasing),
      }}
    >
      {rotationEnabled ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_74%,transparent))] px-3 py-2">
          <div className="flex items-center gap-1.5">
            {images.slice(0, 6).map((image, index) => (
              <span
                key={String(image.composite_hash ?? image.id ?? index)}
                className={cn(
                  'block h-1.5 rounded-full bg-white/55 transition-all duration-300',
                  index === currentIndex ? 'w-4 bg-white' : 'w-1.5',
                )}
              />
            ))}
          </div>
          <div className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/92 backdrop-blur-sm">
            {kenBurnsEnabled ? '켄 번즈' : '자동'}
          </div>
        </div>
      ) : null}
    </WallpaperPreviewImageSurface>
  )
}
