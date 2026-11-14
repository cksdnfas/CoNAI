import type { MouseEvent, PointerEvent } from 'react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getLayoutRegionColor, getLayoutRegionRect, type LayoutPrompt, type LayoutPromptRegion } from '@/lib/layout-prompt'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { useActivePromptRegion, useSetActivePromptRegion } from './prompt-region-highlight-context'

const PROMPT_REGION_MAP_MAX_HEIGHT = '20rem'

/** The region's prompt alone: no box, label or card heading. */
function getRegionPromptText(region: LayoutPromptRegion) {
  return [region.caption, region.text ? `"${region.text}"` : ''].filter(Boolean).join('\n')
}

/** Thumbnail with every layout region outlined; the pointer selects the innermost region under it, and a click copies that region's prompt. */
export function PromptRegionMap({ image, layout }: { image: ImageRecord; layout: LayoutPrompt }) {
  const activeRegion = useActivePromptRegion()
  const setActiveRegion = useSetActivePromptRegion()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const source = image.thumbnail_url ?? image.image_url
  const ratio = image.width && image.height ? image.width / image.height : null

  if (!source || !ratio) {
    return null
  }

  const boxes = layout.regions.flatMap((region) => {
    const rect = getLayoutRegionRect(layout, region, image.width, image.height)
    return rect ? [{ region, rect }] : []
  })

  // Boxes overlap, so the hit is decided here instead of by stacking order: the smallest box under the pointer wins
  // (a large background box never hides the ones inside it), and equal sizes go to the later, upper layer.
  const findRegionAt = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 100
    const y = ((event.clientY - bounds.top) / bounds.height) * 100
    let hit: LayoutPromptRegion | null = null
    let hitArea = Infinity
    for (const { region, rect } of boxes) {
      const area = rect.width * rect.height
      if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height && area <= hitArea) {
        hit = region
        hitArea = area
      }
    }
    return hit
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // Hover (and its tooltip) is for a mouse; a touch goes straight to the click.
    if (event.pointerType !== 'mouse') return
    const index = findRegionAt(event)?.index ?? null
    if (index !== activeRegion) setActiveRegion(index)
  }

  const handleClick = async (event: MouseEvent<HTMLDivElement>) => {
    const region = findRegionAt(event)
    const prompt = region ? getRegionPromptText(region) : ''
    if (!prompt) return
    try {
      await copyTextToClipboard(prompt)
      showSnackbar({ message: t({ ko: '영역 프롬프트를 복사했어.', en: 'Region prompt copied.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '복사하지 못했어.', en: 'Could not copy.' }), tone: 'error' })
    }
  }

  // Fill the column width, but never taller than the max height, so every aspect ratio gets the largest size that fits.
  return (
    <div
      className={cn('relative mx-auto overflow-hidden rounded-sm bg-surface-lowest', activeRegion !== null && 'cursor-pointer')}
      style={{ aspectRatio: ratio, width: `min(100%, calc(${PROMPT_REGION_MAP_MAX_HEIGHT} * ${ratio}))` }}
      aria-hidden
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setActiveRegion(null)}
      onClick={handleClick}
    >
      <img src={source} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" draggable={false} />
      {boxes.map(({ region, rect }) => {
        const color = getLayoutRegionColor(region.index)
        const isActive = activeRegion === region.index
        const prompt = getRegionPromptText(region)
        return (
          <Tooltip key={region.index} open={isActive && Boolean(prompt)}>
            <TooltipTrigger asChild>
              <div
                className={cn('pointer-events-none absolute border transition-opacity', activeRegion !== null && !isActive && 'opacity-30')}
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
              >
                <span className="absolute top-0 left-0 px-1 text-2xs leading-4 font-bold text-black" style={{ backgroundColor: color }}>
                  {region.index + 1}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="whitespace-pre-line">{prompt}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
