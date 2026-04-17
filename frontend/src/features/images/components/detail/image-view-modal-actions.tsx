import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { type ImageDetailViewHeaderControls } from '@/features/images/image-detail-view'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import type { ImageViewModalAccessOptions } from './image-view-modal-context'

export type ImageViewModalMode = 'full' | 'medium' | 'minimal'

interface ImageViewModeSwitcherProps {
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  tone?: 'surface' | 'overlay'
}

/** Render the modal mode switcher with surface or overlay styling. */
export function ImageViewModeSwitcher({
  viewMode,
  onChangeViewMode,
  tone = 'surface',
}: ImageViewModeSwitcherProps) {
  return (
    <SegmentedControl
      value={viewMode}
      items={[
        { value: 'full', label: 'L' },
        { value: 'medium', label: 'M' },
        { value: 'minimal', label: 'S' },
      ]}
      onChange={(nextMode) => onChangeViewMode(nextMode as ImageViewModalMode)}
      size="xs"
      className={tone === 'overlay' ? 'border-white/12 bg-black/36 text-white backdrop-blur-sm' : undefined}
    />
  )
}

interface ImageViewModalActionsProps {
  compositeHash: string
  activeIndex: number
  totalCount: number
  viewMode: ImageViewModalMode
  onChangeViewMode: (mode: ImageViewModalMode) => void
  canViewPrevious: boolean
  canViewNext: boolean
  controls: ImageDetailViewHeaderControls
  mobileActionsRef: RefObject<HTMLDivElement | null>
  accessOptions?: ImageViewModalAccessOptions
  onClose: () => void
  onViewPrevious: () => void
  onViewNext: () => void
}

/** Render the header action area shared by the full and medium modal surfaces. */
export function ImageViewModalActions({
  compositeHash,
  activeIndex,
  totalCount,
  viewMode,
  onChangeViewMode,
  canViewPrevious,
  canViewNext,
  controls,
  mobileActionsRef,
  accessOptions,
  onClose,
  onViewPrevious,
  onViewNext,
}: ImageViewModalActionsProps) {
  const navigate = useNavigate()
  const showCounter = totalCount > 1 && activeIndex >= 0

  const allowDetailNavigation = accessOptions?.allowDetailNavigation !== false
  const allowEditAction = accessOptions?.allowEditAction !== false
  const allowGroupAssignAction = accessOptions?.allowGroupAssignAction !== false

  const openDetailPage = () => {
    navigate(`/images/${compositeHash}`)
    onClose()
  }

  const navigationButtons = (
    <>
      <Button size="icon-sm" variant="secondary" onClick={onClose} aria-label="닫기" title="닫기">
        <X className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={onViewPrevious} disabled={!canViewPrevious} aria-label="이전 이미지" title="이전 이미지">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={onViewNext} disabled={!canViewNext} aria-label="다음 이미지" title="다음 이미지">
        <ChevronRight className="h-4 w-4" />
      </Button>
      {showCounter ? <div className="px-2 text-xs text-muted-foreground">{activeIndex + 1} / {totalCount}</div> : null}
      {allowDetailNavigation ? (
        <Button size="icon-sm" variant="outline" onClick={openDetailPage} aria-label="상세 페이지 열기" title="상세 페이지">
          <ExternalLink className="h-4 w-4" />
        </Button>
      ) : null}
      <Button size="icon-sm" variant="outline" onClick={controls.refresh} disabled={controls.isRefreshing} aria-label="새로고침" title="새로고침">
        <RefreshCcw className={controls.isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </Button>
    </>
  )

  const groupAssignButton = allowGroupAssignAction ? <ImageGroupAssignAction image={controls.image} /> : null
  const editButton = allowEditAction ? <ImageEditAction image={controls.image} /> : null
  const modeSwitcher = <ImageViewModeSwitcher viewMode={viewMode} onChangeViewMode={onChangeViewMode} />

  const downloadButton = controls.downloadUrl ? <ImageDownloadTriggerButton image={controls.image} /> : null

  return (
    <>
      <div className="hidden xl:flex xl:flex-wrap xl:items-center xl:justify-between xl:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {navigationButtons}
          {modeSwitcher}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editButton}
          {groupAssignButton}
          {downloadButton}
        </div>
      </div>

      <div
        ref={mobileActionsRef}
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[92] md:inset-x-6 xl:hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rounded-sm border border-border/85 bg-background/94 p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {navigationButtons}
              {editButton}
              {groupAssignButton}
              {downloadButton}
            </div>
            {modeSwitcher}
          </div>
        </div>
      </div>
    </>
  )
}
