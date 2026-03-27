import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import { GroupImageSection } from './group-image-section'

interface GroupImageDrawerProps {
  open: boolean
  group: GroupRecord
  groupImages: ImageRecord[]
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  onClose: () => void
}

export function GroupImageDrawer({
  open,
  group,
  groupImages,
  isLoading,
  isError,
  errorMessage,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
  renderItemOverlay,
  onClose,
}: GroupImageDrawerProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  return createPortal(
    <>
      <div
        className={open ? 'fixed inset-0 z-[84] bg-black/50 transition-opacity' : 'pointer-events-none fixed inset-0 z-[84] bg-black/0 transition-opacity'}
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="그룹 이미지 시트"
        className={open
          ? 'theme-floating-panel fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] flex-col rounded-t-[1.25rem] transition-transform duration-300'
          : 'theme-floating-panel pointer-events-none fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] translate-y-full flex-col rounded-t-[1.25rem] transition-transform duration-300'}
      >
        <div className="flex justify-center px-4 pt-3">
          <div className="h-1.5 w-14 rounded-full bg-white/15" />
        </div>

        <div className="theme-drawer-header border-b border-white/5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight text-foreground">{group.name}</div>
              <div className="text-sm text-muted-foreground">{group.image_count.toLocaleString('ko-KR')}개 이미지</div>
            </div>
          </div>
        </div>

        <div className="theme-drawer-body min-h-0 flex-1 overflow-hidden pb-20">
          <GroupImageSection
            group={group}
            groupImages={groupImages}
            isLoading={isLoading}
            isError={isError}
            errorMessage={errorMessage}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            hideHeader
            presentation="drawer"
            selectable={selectable}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectedIdsChange}
            renderItemOverlay={renderItemOverlay}
          />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <Button type="button" size="sm" className="pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px]" onClick={onClose}>
            <ChevronDown className="h-4 w-4" />
            접기
          </Button>
        </div>
      </aside>
    </>,
    document.body,
  )
}
