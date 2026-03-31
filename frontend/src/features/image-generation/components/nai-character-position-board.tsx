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

/** Spread markers slightly when multiple characters share the same snapped cell. */
function buildMarkerOffsets(characters: CharacterPositionBoardItem[]) {
  const markersByCell = new Map<string, number[]>()

  characters.forEach((character, index) => {
    const cellKey = `${character.centerX}:${character.centerY}`
    const currentIndexes = markersByCell.get(cellKey) || []
    currentIndexes.push(index)
    markersByCell.set(cellKey, currentIndexes)
  })

  const markerOffsets = new Map<number, { offsetX: number; offsetY: number }>()
  const offsetPattern = [
    { offsetX: 0, offsetY: 0 },
    { offsetX: -16, offsetY: -12 },
    { offsetX: 16, offsetY: -12 },
    { offsetX: -16, offsetY: 12 },
    { offsetX: 16, offsetY: 12 },
  ]

  markersByCell.forEach((indexes) => {
    indexes.forEach((index, offsetIndex) => {
      markerOffsets.set(index, offsetPattern[offsetIndex % offsetPattern.length])
    })
  })

  return markerOffsets
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
  const markerOffsets = useMemo(() => buildMarkerOffsets(characters), [characters])

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
          const offset = markerOffsets.get(index) || { offsetX: 0, offsetY: 0 }

          return (
            <button
              key={`character-position-marker-${index}`}
              type="button"
              className={cn(
                'absolute rounded-full border px-2 py-1 text-xs font-medium shadow-sm transition-colors',
                isSelected || isDragging
                  ? 'z-20 border-accent bg-accent text-accent-foreground'
                  : 'z-10 border-border bg-background text-foreground hover:bg-surface-high',
              )}
              style={{ left, top, transform: `translate(calc(-50% + ${offset.offsetX}px), calc(-50% + ${offset.offsetY}px))` }}
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

