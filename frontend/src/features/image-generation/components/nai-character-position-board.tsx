import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { snapNaiCharacterGridValue } from '../image-generation-shared'

type CharacterPositionBoardItem = {
  label: string
  centerX: string
  centerY: string
}

type NaiCharacterPositionBoardProps = {
  characters: CharacterPositionBoardItem[]
  selectedIndex?: number | null
  onSelectIndex?: (index: number) => void
  onPositionChange: (index: number, centerX: string, centerY: string) => void
  className?: string
}

const GRID_VALUES = ['0.1', '0.3', '0.5', '0.7', '0.9'] as const

/** Clamp one pointer position into the board bounds and snap it to the documented 5x5 grid. */
function snapBoardPointerPosition(clientX: number, clientY: number, rect: DOMRect) {
  const normalizedX = rect.width > 0 ? Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) : 0.5
  const normalizedY = rect.height > 0 ? Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1) : 0.5

  return {
    centerX: snapNaiCharacterGridValue(0.1 + normalizedX * 0.8),
    centerY: snapNaiCharacterGridValue(0.1 + normalizedY * 0.8),
  }
}

/** Render a shared 5x5 drag board for NAI character prompt placement. */
export function NaiCharacterPositionBoard({
  characters,
  selectedIndex,
  onSelectIndex,
  onPositionChange,
  className,
}: NaiCharacterPositionBoardProps) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const draggingIndexRef = useRef<number | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)

  const gridLines = useMemo(() => GRID_VALUES.map((value) => `${Number(value) * 100}%`), [])

  const commitPointerPosition = (characterIndex: number, clientX: number, clientY: number) => {
    const boardRect = boardRef.current?.getBoundingClientRect()
    if (!boardRect) {
      return
    }

    const nextPosition = snapBoardPointerPosition(clientX, clientY, boardRect)
    onPositionChange(characterIndex, nextPosition.centerX, nextPosition.centerY)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Character Position Board</div>
          <div className="text-xs text-muted-foreground">한 보드에서 전부 보고 드래그해서 5x5 grid 칸으로 배치해.</div>
        </div>
        <div className="text-xs text-muted-foreground">A-E / 1-5</div>
      </div>

      <div
        ref={boardRef}
        className="relative aspect-square rounded-sm border border-border bg-surface-container select-none touch-none"
        onPointerMove={(event) => {
          if (draggingIndexRef.current === null) {
            return
          }

          commitPointerPosition(draggingIndexRef.current, event.clientX, event.clientY)
        }}
        onPointerUp={(event) => {
          if (draggingIndexRef.current === null) {
            return
          }

          commitPointerPosition(draggingIndexRef.current, event.clientX, event.clientY)
          draggingIndexRef.current = null
          setDraggingIndex(null)
        }}
        onPointerLeave={() => {
          draggingIndexRef.current = null
          setDraggingIndex(null)
        }}
      >
        <div className="pointer-events-none absolute inset-0">
          {gridLines.map((position) => (
            <div key={`vertical-${position}`} className="absolute top-0 bottom-0 w-px bg-border/70" style={{ left: position }} />
          ))}
          {gridLines.map((position) => (
            <div key={`horizontal-${position}`} className="absolute left-0 right-0 h-px bg-border/70" style={{ top: position }} />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-around px-[10%] text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {['A', 'B', 'C', 'D', 'E'].map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-2 flex flex-col justify-around py-[10%] text-[10px] font-medium tracking-[0.18em] text-muted-foreground">
          {['1', '2', '3', '4', '5'].map((label) => <span key={label}>{label}</span>)}
        </div>

        {characters.map((character, index) => {
          const left = `${Number(character.centerX) * 100}%`
          const top = `${Number(character.centerY) * 100}%`
          const isSelected = selectedIndex === index
          const isDragging = draggingIndex === index

          return (
            <button
              key={`character-position-marker-${index}`}
              type="button"
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-xs font-medium shadow-sm transition-colors',
                isSelected || isDragging
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border bg-background text-foreground hover:bg-surface-high',
              )}
              style={{ left, top }}
              onClick={() => onSelectIndex?.(index)}
              onPointerDown={(event) => {
                event.preventDefault()
                draggingIndexRef.current = index
                setDraggingIndex(index)
                onSelectIndex?.(index)
                event.currentTarget.setPointerCapture(event.pointerId)
                commitPointerPosition(index, event.clientX, event.clientY)
              }}
              onPointerMove={(event) => {
                if (draggingIndexRef.current !== index) {
                  return
                }

                commitPointerPosition(index, event.clientX, event.clientY)
              }}
              onPointerUp={(event) => {
                if (draggingIndexRef.current !== index) {
                  return
                }

                commitPointerPosition(index, event.clientX, event.clientY)
                draggingIndexRef.current = null
                setDraggingIndex(null)
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
            >
              {character.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

