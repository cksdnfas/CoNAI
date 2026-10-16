import { Eye, EyeOff, GripVertical, Lock } from 'lucide-react'
import { isGenerationLayoutRequiredBlock, type GenerationLayoutSurface } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useGenerationLayout } from './generation-layout-context'
import { moveLayoutBlock, setLayoutBlockHidden } from './generation-layout-ops'
import { useLayoutBlockDrag } from './use-layout-block-drag'

/**
 * Narrow-screen layout editor: the preset's columns as reorderable rows. Narrow screens stack the columns in order,
 * so the order here is the order on a phone too.
 */
export function GenerationLayoutListEditor({ surface }: { surface: GenerationLayoutSurface }) {
  const { t } = useI18n()
  const { presetOf, updatePreset, blockLabel } = useGenerationLayout()
  const preset = presetOf(surface)
  const drag = useLayoutBlockDrag(
    (block, target) => updatePreset((current) => moveLayoutBlock(surface, current, block, target)),
    blockLabel,
  )
  const hidden = new Set(preset.hidden)

  return (
    <div className="space-y-2">
      {preset.columns.map((column, columnIndex) => {
        const endIndicator = drag.indicator !== null && 'column' in drag.indicator && drag.indicator.column === columnIndex
        return (
          <section key={columnIndex} data-layout-column-drop={columnIndex} data-layout-column-size={column.blocks.length} className="pb-2">
            {preset.columns.length > 1 ? (
              <h3 className="pt-3 pb-1 text-xs font-semibold text-muted-foreground">{t({ ko: '{index}열', en: 'Column {index}' }, { index: columnIndex + 1 })}</h3>
            ) : null}
            <ul className="divide-y divide-line">
              {column.blocks.map((block, index) => {
                const label = blockLabel(block)
                const isHidden = hidden.has(block)
                const edge = drag.indicator && 'block' in drag.indicator && drag.indicator.block === block ? drag.indicator.edge : null
                return (
                  <li
                    key={block}
                    data-layout-block={block}
                    data-layout-column={columnIndex}
                    data-layout-index={index}
                    className={cn(
                      'relative flex min-h-12 items-center gap-2',
                      drag.dragging === block && 'opacity-40',
                      edge === 'top' && 'before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-primary',
                      edge === 'bottom' && 'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary',
                    )}
                  >
                    <IconButton
                      variant="ghost"
                      tooltip={false}
                      label={t({ ko: '{name} 옮기기', en: 'Move {name}' }, { name: label })}
                      className="size-10 cursor-grab text-muted-foreground active:cursor-grabbing"
                      {...drag.gripProps(block)}
                    >
                      <GripVertical />
                    </IconButton>
                    <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', isHidden && 'text-muted-foreground')}>{label}</span>
                    {isGenerationLayoutRequiredBlock(surface, block) ? (
                      <Tip content={t({ ko: '숨길 수 없는 블록', en: 'Cannot be hidden' })}>
                        <span className="grid size-10 place-items-center text-muted-foreground/70" tabIndex={0}>
                          <Lock className="size-4" />
                        </span>
                      </Tip>
                    ) : (
                      <IconButton
                        variant="ghost"
                        label={isHidden ? t({ ko: '{name} 다시 표시', en: 'Show {name}' }, { name: label }) : t({ ko: '{name} 숨기기', en: 'Hide {name}' }, { name: label })}
                        onClick={() => updatePreset((current) => setLayoutBlockHidden(current, block, !isHidden))}
                      >
                        {isHidden ? <EyeOff /> : <Eye />}
                      </IconButton>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className={cn('h-0.5 rounded-full', endIndicator ? 'bg-primary' : 'bg-transparent')} />
          </section>
        )
      })}
      {drag.ghost}
    </div>
  )
}
