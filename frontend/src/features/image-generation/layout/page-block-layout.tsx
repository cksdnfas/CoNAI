import { Fragment } from 'react'
import type { GenerationLayoutSurface } from '@conai/shared'
import { cn } from '@/lib/utils'
import { GenerationBlockLayout, type GenerationLayoutBlockNodes } from './generation-block-layout'
import { useGenerationLayoutSurface } from './generation-layout-context'
import { GenerationLayoutListEditor } from './generation-layout-list-editor'
import { stackedLayoutBlocks } from './generation-layout-ops'

/**
 * A page section arranged by a layout preset, for pages that scroll as a whole (sprite, audio, image detail, upload):
 * columns on wide screens, the preset's order stacked on narrow ones (with the list editor above while an admin edits).
 */
export function PageBlockLayout({ surface, blocks, wide, active = true, stickyClassName, stackClassName = 'flex flex-col gap-6' }: {
  surface: GenerationLayoutSurface
  blocks: GenerationLayoutBlockNodes
  wide: boolean
  /** False while mounted but not on screen (an inactive tab). */
  active?: boolean
  /** Wide: the sticky offset of the columns; null keeps them in the normal flow. */
  stickyClassName?: string | null
  stackClassName?: string
}) {
  const { preset, editing } = useGenerationLayoutSurface(surface, { active })
  if (wide) return <GenerationBlockLayout surface={surface} blocks={blocks} active={active} flow="page" stickyClassName={stickyClassName} />

  return (
    <>
      {editing ? <GenerationLayoutListEditor surface={surface} /> : null}
      <div className={cn(stackClassName, editing && 'hidden')}>
        {stackedLayoutBlocks(preset).map((block) => blocks[block] != null ? <Fragment key={block}>{blocks[block]}</Fragment> : null)}
      </div>
    </>
  )
}
