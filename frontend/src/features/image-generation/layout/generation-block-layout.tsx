import { Fragment, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { Eye, GripVertical, Lock, MoveHorizontal, PanelTop, X } from 'lucide-react'
import { isGenerationLayoutRequiredBlock, type GenerationLayoutBlock, type GenerationLayoutColumn, type GenerationLayoutPreset, type GenerationLayoutSurface } from '@conai/shared'
import { TextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { GenerateActionDock } from '../components/generate-action-bar'
import { useGenerationLayoutSurface } from './generation-layout-context'
import { GENERATION_LAYOUT_BLOCK_LABELS } from './generation-layout-labels'
import { moveLayoutBlock, removeLayoutColumn, resizeLayoutColumn, setLayoutBlockHidden, setLayoutColumnTabs } from './generation-layout-ops'
import { useLayoutBlockDrag, type LayoutDropIndicator } from './use-layout-block-drag'

/**
 * Rendered content per block. `recent` lives inside the result block, so it is never passed separately; a block left
 * out (or null) renders nothing on screen but still shows a frame in the editor.
 */
export type GenerationLayoutBlockNodes = Partial<Record<GenerationLayoutBlock, ReactNode>>

/** Blocks that size and scroll themselves; they fill the column height instead of joining the column's scroll. */
const FILL_BLOCKS: ReadonlySet<GenerationLayoutBlock> = new Set(['result', 'results', 'outputs', 'runner', 'list'])

type UpdatePreset = (update: (preset: GenerationLayoutPreset) => GenerationLayoutPreset) => void

/**
 * How the columns size: `fill` (the generation page) fills a fixed-height frame and each column scrolls itself;
 * `page` lets the page scroll, columns take their content height and the shorter ones stay in view (sticky).
 */
export type GenerationBlockLayoutFlow = 'fill' | 'page'

/** Wide generation page: the surface's current preset as columns, or the in-place editor while an admin arranges it. */
export function GenerationBlockLayout({ surface, blocks, active = true, flow = 'fill', stickyClassName = 'top-[calc(var(--theme-shell-header-height)+1rem)]' }: {
  surface: GenerationLayoutSurface
  blocks: GenerationLayoutBlockNodes
  /** False while mounted but not on screen (an inactive tab). */
  active?: boolean
  flow?: GenerationBlockLayoutFlow
  /** `page` flow: the sticky offset of the columns; null keeps them in the normal flow. */
  stickyClassName?: string | null
}) {
  const { preset, editing, updatePreset } = useGenerationLayoutSurface(surface, { active })
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [liveWeights, setLiveWeights] = useState<number[] | null>(null)
  const drag = useLayoutBlockDrag(
    (block, target) => updatePreset((current) => moveLayoutBlock(surface, current, block, target)),
    (block) => t(GENERATION_LAYOUT_BLOCK_LABELS[block]),
  )
  const weights = liveWeights ?? preset.columns.map((column) => column.weight)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const hidden = new Set(preset.hidden)
  const pageFlow = flow === 'page'

  if (!editing) {
    // A column with nothing to show right now (e.g. an editor before anything is picked) gives its width to the rest.
    const shown = preset.columns
      .map((column, index) => ({ column, weight: weights[index] }))
      .filter(({ column }) => column.blocks.some((block) => block !== 'recent' && !hidden.has(block) && blocks[block] != null))
    return (
      <div className={cn('flex gap-8', pageFlow ? 'items-start' : 'min-h-0 flex-1 items-stretch')}>
        {shown.map(({ column, weight }, index) => (
          <div
            key={index}
            className={cn('flex min-w-[240px] flex-col', pageFlow ? stickyClassName && cn('sticky', stickyClassName) : 'min-h-0')}
            style={{ flex: `${weight} 1 0%` }}
          >
            <ViewColumn column={column} hidden={hidden} blocks={blocks} pageFlow={pageFlow} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('flex items-stretch', pageFlow ? 'min-h-[60vh]' : 'min-h-0 flex-1')}>
      {preset.columns.map((column, columnIndex) => (
        <Fragment key={columnIndex}>
          {editing && columnIndex > 0 ? (
            <ColumnDivider
              left={weights[columnIndex - 1]}
              right={weights[columnIndex]}
              total={totalWeight}
              containerRef={containerRef}
              onLive={(weight) => setLiveWeights(resizeLayoutColumn(preset.columns.map((item, position) => ({ ...item, weight: weights[position] })), columnIndex - 1, weight).map((item) => item.weight))}
              onCommit={() => {
                if (liveWeights) updatePreset((current) => ({ ...current, columns: current.columns.map((item, position) => ({ ...item, weight: liveWeights[position] ?? item.weight })) }))
                setLiveWeights(null)
              }}
            />
          ) : null}
          <div className="flex min-h-0 min-w-[240px] flex-col" style={{ flex: `${weights[columnIndex]} 1 0%` }}>
            <EditColumn surface={surface} column={column} columnIndex={columnIndex} hidden={hidden} blocks={blocks} drag={drag} canRemove={preset.columns.length > 1} updatePreset={updatePreset} />
          </div>
        </Fragment>
      ))}
      {drag.ghost}
    </div>
  )
}

function ViewColumn({ column, hidden, blocks, pageFlow }: { column: GenerationLayoutColumn; hidden: Set<GenerationLayoutBlock>; blocks: GenerationLayoutBlockNodes; pageFlow: boolean }) {
  const { t } = useI18n()
  const visible = column.blocks.filter((block) => block !== 'recent' && !hidden.has(block) && blocks[block] != null)
  const body: GenerationLayoutBlock[] = visible.filter((block) => block !== 'action')
  const dock = visible.includes('action') ? <GenerateActionDock>{blocks.action}</GenerateActionDock> : null
  const [pickedTab, setPickedTab] = useState<GenerationLayoutBlock | null>(null)
  const tabbed = column.tabs === true && body.length > 1

  // Page flow: the page scrolls, so blocks simply stack (or sit behind tabs) at their own height.
  if (pageFlow) {
    const active = tabbed ? (pickedTab && body.includes(pickedTab) ? pickedTab : body[0]) : null
    return (
      <div className="flex flex-col gap-6">
        {active ? (
          <>
            <TextTabs<GenerationLayoutBlock>
              value={active}
              items={body.map((block) => ({ value: block, label: t(GENERATION_LAYOUT_BLOCK_LABELS[block]) }))}
              onChange={setPickedTab}
            />
            <div className="min-w-0">{blocks[active]}</div>
          </>
        ) : body.map((block) => <div key={block} className="min-w-0">{blocks[block]}</div>)}
        {dock}
      </div>
    )
  }

  // Self-scrolling blocks (the result) fill the column; anything sharing it keeps a bounded height and scrolls on its own.
  if (body.some((block) => FILL_BLOCKS.has(block)) && !tabbed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        {body.map((block) => FILL_BLOCKS.has(block)
          ? <div key={block} className="flex min-h-0 flex-1 flex-col overflow-hidden">{blocks[block]}</div>
          : <div key={block} className="max-h-[45%] shrink-0 overflow-y-auto pr-2">{blocks[block]}</div>)}
        {dock}
      </div>
    )
  }

  // Tab column: one block at a time under text tabs.
  if (tabbed) {
    const active = pickedTab && body.includes(pickedTab) ? pickedTab : body[0]
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <TextTabs<GenerationLayoutBlock>
          value={active}
          items={body.map((block) => ({ value: block, label: t(GENERATION_LAYOUT_BLOCK_LABELS[block]) }))}
          onChange={setPickedTab}
          className="shrink-0"
        />
        <div className={cn('min-h-0 flex-1', FILL_BLOCKS.has(active) ? 'flex flex-col' : 'overflow-y-auto pr-2 pb-1')}>{blocks[active]}</div>
        {dock}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-2 pb-1">
        {body.map((block) => <Fragment key={block}>{blocks[block]}</Fragment>)}
      </div>
      {dock}
    </div>
  )
}

type LayoutDrag = ReturnType<typeof useLayoutBlockDrag>

function EditColumn({ surface, column, columnIndex, hidden, blocks, drag, canRemove, updatePreset }: {
  surface: GenerationLayoutSurface
  column: GenerationLayoutColumn
  columnIndex: number
  hidden: Set<GenerationLayoutBlock>
  blocks: GenerationLayoutBlockNodes
  drag: LayoutDrag
  canRemove: boolean
  updatePreset: UpdatePreset
}) {
  const { t } = useI18n()
  const visible = column.blocks.filter((block) => !hidden.has(block))
  const endIndicator = drag.indicator !== null && 'column' in drag.indicator && drag.indicator.column === columnIndex

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 px-1">
        <span className="flex-1 text-xs font-semibold text-muted-foreground">{t({ ko: '{index}열', en: 'Column {index}' }, { index: columnIndex + 1 })}</span>
        {column.blocks.includes('result') ? null : (
          <IconButton
            size="icon-xs"
            variant="ghost"
            active={column.tabs === true}
            label={t({ ko: '탭으로 보기', en: 'Show as tabs' })}
            onClick={() => updatePreset((current) => setLayoutColumnTabs(current, columnIndex, column.tabs !== true))}
          >
            <PanelTop />
          </IconButton>
        )}
        {canRemove && column.blocks.length === 0 ? (
          <IconButton size="icon-xs" variant="ghost" label={t({ ko: '빈 열 삭제', en: 'Remove empty column' })} onClick={() => updatePreset((current) => removeLayoutColumn(current, columnIndex))}>
            <X />
          </IconButton>
        ) : null}
      </div>
      <div
        data-layout-column-drop={columnIndex}
        data-layout-column-size={column.blocks.length}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1"
      >
        {visible.map((block) => (
          <BlockFrame
            key={block}
            surface={surface}
            block={block}
            columnIndex={columnIndex}
            index={column.blocks.indexOf(block)}
            indicator={drag.indicator}
            dragging={drag.dragging === block}
            gripProps={drag.gripProps(block)}
            updatePreset={updatePreset}
          >
            {block === 'recent' ? null : blocks[block]}
          </BlockFrame>
        ))}
        {visible.length === 0 ? <div className="min-h-32 shrink-0 rounded-md border border-dashed border-line" /> : null}
        <div className={cn('h-0.5 shrink-0 rounded-full', endIndicator ? 'bg-primary' : 'bg-transparent')} />
        <div className="min-h-12 flex-1" />
      </div>
    </div>
  )
}

function BlockFrame({ surface, block, columnIndex, index, indicator, dragging, gripProps, updatePreset, children }: {
  surface: GenerationLayoutSurface
  block: GenerationLayoutBlock
  columnIndex: number
  index: number
  indicator: LayoutDropIndicator | null
  dragging: boolean
  gripProps: ReturnType<LayoutDrag['gripProps']>
  updatePreset: UpdatePreset
  children: ReactNode
}) {
  const { t } = useI18n()
  const label = t(GENERATION_LAYOUT_BLOCK_LABELS[block])
  const required = isGenerationLayoutRequiredBlock(surface, block)
  const edge = indicator && 'block' in indicator && indicator.block === block ? indicator.edge : null
  const fills = FILL_BLOCKS.has(block)

  return (
    <section
      aria-label={label}
      data-layout-block={block}
      data-layout-column={columnIndex}
      data-layout-index={index}
      className={cn(
        'relative shrink-0 rounded-md border border-dashed border-primary/40',
        fills && 'flex min-h-[16rem] flex-1 shrink flex-col',
        dragging && 'opacity-40',
        edge === 'top' && 'before:absolute before:inset-x-1 before:-top-1.5 before:h-0.5 before:rounded-full before:bg-primary',
        edge === 'bottom' && 'after:absolute after:inset-x-1 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-primary',
      )}
    >
      <div className="flex h-10 items-center gap-1 px-1.5">
        <IconButton
          size="icon-sm"
          variant="ghost"
          tooltip={false}
          label={t({ ko: '{name} 옮기기', en: 'Move {name}' }, { name: label })}
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          {...gripProps}
        >
          <GripVertical />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
        {required ? (
          <Tip content={t({ ko: '숨길 수 없는 블록', en: 'Cannot be hidden' })}>
            <span className="grid size-8 place-items-center text-muted-foreground/70" tabIndex={0}>
              <Lock className="size-4" />
            </span>
          </Tip>
        ) : (
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '{name} 숨기기', en: 'Hide {name}' }, { name: label })} onClick={() => updatePreset((current) => setLayoutBlockHidden(current, block, true))}>
            <Eye />
          </IconButton>
        )}
      </div>
      {children ? (
        <div inert className={cn('pointer-events-none select-none px-3 pb-3 opacity-45', fills ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'max-h-56 overflow-hidden')}>
          {children}
        </div>
      ) : null}
    </section>
  )
}

/** Drag handle between two columns; widths update live and commit on release. */
function ColumnDivider({ left, right, total, containerRef, onLive, onCommit }: {
  left: number
  right: number
  total: number
  containerRef: RefObject<HTMLDivElement | null>
  onLive: (leftWeight: number) => void
  onCommit: () => void
}) {
  const { t } = useI18n()
  const startRef = useRef<{ x: number; left: number; width: number } | null>(null)
  const percent = (weight: number) => Math.round((weight / total) * 100)

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    startRef.current = { x: event.clientX, left, width: containerRef.current?.clientWidth ?? 1 }
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startRef.current
    if (!start) return
    onLive(start.left + ((event.clientX - start.x) / start.width) * total)
  }
  const handlePointerEnd = () => {
    if (!startRef.current) return
    startRef.current = null
    onCommit()
  }

  return (
    <div className="relative flex w-6 shrink-0 justify-center">
      <div className="absolute inset-y-0 left-1/2 w-px bg-primary/40" />
      <Tip content={t({ ko: '열 너비 조절', en: 'Resize columns' })}>
        <Button
          type="button"
          variant="secondary"
          aria-label={t({ ko: '열 너비 조절 ({left} : {right})', en: 'Resize columns ({left} : {right})' }, { left: percent(left), right: percent(right) })}
          className="relative mt-48 h-fit w-6 cursor-col-resize flex-col gap-1 rounded-full px-0 py-2"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <MoveHorizontal className="size-3.5" />
          <span className="text-2xs font-bold tabular-nums text-muted-foreground [writing-mode:vertical-rl]">{percent(left)} : {percent(right)}</span>
        </Button>
      </Tip>
    </div>
  )
}
