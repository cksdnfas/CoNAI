import { getLayoutRegionColor, getLayoutRegionRect, type LayoutPrompt } from '@/lib/layout-prompt'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { useActivePromptRegion, useSetActivePromptRegion } from './prompt-region-highlight-context'

const PROMPT_REGION_MAP_MAX_HEIGHT = '20rem'

/** Thumbnail with every layout region outlined; the pointer on a box selects that region like its prompt card does. */
export function PromptRegionMap({ image, layout }: { image: ImageRecord; layout: LayoutPrompt }) {
  const activeRegion = useActivePromptRegion()
  const setActiveRegion = useSetActivePromptRegion()
  const source = image.thumbnail_url ?? image.image_url
  const ratio = image.width && image.height ? image.width / image.height : null

  if (!source || !ratio) {
    return null
  }

  // Fill the column width, but never taller than the max height, so every aspect ratio gets the largest size that fits.
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-sm bg-surface-lowest"
      style={{ aspectRatio: ratio, width: `min(100%, calc(${PROMPT_REGION_MAP_MAX_HEIGHT} * ${ratio}))` }}
      aria-hidden
    >
      <img src={source} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" draggable={false} />
      {layout.regions.map((region) => {
        const rect = getLayoutRegionRect(layout, region, image.width, image.height)
        if (!rect) return null
        const color = getLayoutRegionColor(region.index)
        const isActive = activeRegion === region.index
        return (
          <div
            key={region.index}
            className={cn('absolute border transition-opacity', activeRegion !== null && !isActive && 'opacity-30')}
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
              borderColor: color,
              borderWidth: isActive ? 2 : 1,
              backgroundColor: isActive ? `${color}47` : `${color}1a`,
              zIndex: isActive ? 1 : 0,
            }}
            onMouseEnter={() => setActiveRegion(region.index)}
            onMouseLeave={() => setActiveRegion(null)}
          >
            <span className="absolute top-0 left-0 px-1 text-2xs leading-4 font-bold text-black" style={{ backgroundColor: color }}>
              {region.index + 1}
            </span>
          </div>
        )
      })}
    </div>
  )
}
