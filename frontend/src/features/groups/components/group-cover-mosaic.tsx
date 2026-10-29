import { useQuery } from '@tanstack/react-query'
import { Folder } from 'lucide-react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { useInView } from '@/lib/use-in-view'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { GROUP_COVER_IMAGE_COUNT } from '../group-page-shared'

interface GroupCoverMosaicProps {
  groupId: number
  sourceKey: string
  imageCount: number
  /** The source's batched cover loader (`groupSources[key].loadCoverImages`). */
  loadCoverImages: (groupId: number) => Promise<ImageRecord[]>
  className?: string
}

/** A 2x2 mosaic of the group's preview images (one image fills the frame; empty groups show a folder). */
export function GroupCoverMosaic({ groupId, sourceKey, imageCount, loadCoverImages, className }: GroupCoverMosaicProps) {
  const [ref, view] = useInView<HTMLDivElement>('200px')
  const previewQuery = useQuery({
    queryKey: ['group-cover-images', sourceKey, groupId],
    queryFn: () => loadCoverImages(groupId),
    enabled: imageCount > 0 && view.visible,
    staleTime: 60_000,
  })
  const images = (previewQuery.data ?? []).slice(0, GROUP_COVER_IMAGE_COUNT)

  return (
    <div ref={ref} className={cn('relative overflow-hidden bg-fill', className)}>
      {images.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
          <Folder className="size-1/3 max-h-10 max-w-10" aria-hidden="true" />
        </div>
      ) : images.length === 1 ? (
        <ImagePreviewMedia image={images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        // 2 images split the frame; 3 put the first one tall on the left; 4 fill the 2x2 grid.
        <div className={cn('grid h-full w-full grid-cols-2 gap-px', images.length === 2 ? 'grid-rows-1' : 'grid-rows-2')}>
          {images.map((image, index) => (
            <ImagePreviewMedia
              key={String(image.composite_hash ?? image.id)}
              image={image}
              alt=""
              className={cn('h-full w-full min-h-0 object-cover', images.length === 3 && index === 0 && 'row-span-2')}
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  )
}
