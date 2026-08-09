import { useState } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { useGroupPreviewImage } from '@/features/groups/hooks/use-group-preview-image'
import { useI18n } from '@/i18n'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@conai/shared'

interface GroupChildCardProps {
  group: GroupWithHierarchy
  previewSourceKey?: string
  loadPreviewImage?: (groupId: number) => Promise<ImageRecord | null>
  onOpen: (groupId: number) => void
  totalImageCount?: number
  cardStyle?: GroupExplorerCardStyle
}

/** Render a group-navigation card using the selected appearance style. */
export function GroupChildCard({
  group,
  previewSourceKey = 'default',
  loadPreviewImage,
  onOpen,
  totalImageCount,
  cardStyle = 'compact-row',
}: GroupChildCardProps) {
  const { formatNumber, t } = useI18n()
  const effectiveTotalImageCount = totalImageCount ?? group.image_count
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewQuery = useGroupPreviewImage({
    groupId: group.id,
    sourceKey: previewSourceKey,
    loadPreviewImage,
    enabled: effectiveTotalImageCount > 0 && !previewFailed,
  })

  const previewImage = previewFailed ? null : (previewQuery.data ?? null)
  const imageCountLabel = t({ ko: '이미지 {count}개', en: '{count} images' }, { count: formatNumber(effectiveTotalImageCount) })
  const childCountLabel = t({ ko: '폴더 {count}개', en: '{count} folders' }, { count: formatNumber(group.child_count ?? 0) })
  const subtitle = effectiveTotalImageCount === 0 && (group.child_count ?? 0) === 0
    ? t({ ko: '비어 있음', en: 'Empty' })
    : `${imageCountLabel} · ${childCountLabel}`

  const handleOpen = () => {
    onOpen(group.id)
  }

  if (cardStyle === 'media-tile') {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="group relative isolate block aspect-[4/3] w-full overflow-hidden rounded-sm bg-surface-container text-left transition-transform duration-300 hover:-translate-y-0.5 hover:bg-surface-high"
      >
        {previewImage ? (
          <ImagePreviewMedia
            image={previewImage}
            alt={group.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-surface-lowest to-surface-high">
            <Folder className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/42 to-transparent" />

        <div className="absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 text-[11px] font-medium text-white/92 backdrop-blur-sm">
          <Folder className="h-3.5 w-3.5" />
          {t({ ko: '폴더', en: 'Folder' })}
        </div>

        <div className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1.5 text-white/88 backdrop-blur-sm">
          <ChevronRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 space-y-1 p-3">
          <p className="truncate text-sm font-semibold text-white">{group.name}</p>
          <p className="truncate text-[11px] text-white/82">{subtitle}</p>
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group flex min-h-[76px] w-full items-center gap-3 rounded-sm bg-surface-container p-3 text-left transition-colors hover:bg-surface-high"
    >
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-low">
        {previewImage ? (
          <ImagePreviewMedia
            image={previewImage}
            alt={group.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <Folder className="h-5 w-5 text-muted-foreground" />
        )}
        {previewImage ? (
          <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Folder className="h-3 w-3" />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{group.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
