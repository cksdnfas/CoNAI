import { useMemo } from 'react'
import { getImageLayoutPrompt } from '@/lib/image-extracted-prompts'
import { getLayoutRegionColor, getLayoutRegionRect } from '@/lib/layout-prompt'
import type { ImageRecord } from '@/types/image'
import { useActivePromptRegion } from './prompt-region-highlight-context'

/** Marks the layout-prompt region under the pointer on the viewed image. Sits inside the media frame, so zoom, pan and rotation apply. */
export function PromptRegionOverlay({ image }: { image: ImageRecord }) {
  const activeRegion = useActivePromptRegion()
  const layout = useMemo(() => getImageLayoutPrompt(image), [image])
  const region = activeRegion === null ? undefined : layout?.regions[activeRegion]
  const rect = layout && region ? getLayoutRegionRect(layout, region, image.width, image.height) : null

  if (!region || !rect) {
    return null
  }

  const color = getLayoutRegionColor(region.index)

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <div
        className="absolute border-2"
        style={{
          left: `${rect.left}%`,
          top: `${rect.top}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
          borderColor: color,
          backgroundColor: `${color}2e`,
        }}
      >
        <span className="absolute top-0 left-0 px-1.5 text-xs leading-5 font-bold text-black" style={{ backgroundColor: color }}>
          {region.index + 1}
        </span>
      </div>
    </div>
  )
}
