import { useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Tip } from '@/components/ui/tooltip'
import type { ModulePortDefinition } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { buildHandleId, getModulePortCompatibility, getPortTypeColor } from '../module-graph-shared'
import { useModuleGraphCanvasContext } from './module-graph-canvas-context'

/** Distance the pointer travels on a connected input before its link lifts off (a plain click never disconnects). */
const PICK_UP_DISTANCE = 5

export type ModuleGraphHandleDropState = 'idle' | 'ok' | 'target' | 'no'

/** How one port reacts to the link being dragged right now. */
export function useModuleGraphHandleDropState(nodeId: string, side: 'input' | 'output', port: ModulePortDefinition | undefined): ModuleGraphHandleDropState {
  const { drag, dropTarget } = useModuleGraphCanvasContext()
  if (!drag || !port) return 'idle'
  const handleId = buildHandleId(side === 'input' ? 'in' : 'out', port.key)
  if (drag.nodeId === nodeId) {
    return drag.handleId === handleId ? 'idle' : 'no'
  }
  const wantsInput = drag.handleType === 'source'
  if (wantsInput !== (side === 'input')) return 'no'
  const compatibility = wantsInput
    ? getModulePortCompatibility(drag.dataType, port.data_type)
    : getModulePortCompatibility(port.data_type, drag.dataType)
  if (compatibility === 'incompatible') return 'no'
  return dropTarget?.nodeId === nodeId && dropTarget.handleId === handleId ? 'target' : 'ok'
}

/**
 * One port's connection point. It sits on the node's edge (half outside), takes the port type's color, rings when
 * the dragged link fits and fades when it does not. Dragging a connected single input lifts its link instead of
 * starting a new one.
 */
export function ModuleGraphPortHandle({
  nodeId,
  port,
  side,
  connected = false,
  reveal = false,
  color,
  tooltip,
  className,
}: {
  nodeId: string
  port: ModulePortDefinition
  side: 'input' | 'output'
  connected?: boolean
  /** A widget's point: hidden until its row is hovered, a fitting link is dragged, or it is linked. */
  reveal?: boolean
  /** Overrides the type color (e.g. a muted inactive branch). */
  color?: string
  tooltip?: string
  className?: string
}) {
  const { canPickUp, pickUpInput } = useModuleGraphCanvasContext()
  const dropState = useModuleGraphHandleDropState(nodeId, side, port)
  const handleId = buildHandleId(side === 'input' ? 'in' : 'out', port.key)
  const pickUpEnabled = side === 'input' && connected && !port.multiple && canPickUp
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  const handleColor = color ?? getPortTypeColor(port.data_type)

  const startPickUpWatch = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!pickUpEnabled || event.button !== 0) return
    pressRef.current = { x: event.clientX, y: event.clientY }
    const onMove = (moveEvent: MouseEvent) => {
      const start = pressRef.current
      if (!start) return
      if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < PICK_UP_DISTANCE) return
      cleanup()
      pickUpInput(nodeId, handleId, { x: moveEvent.clientX, y: moveEvent.clientY })
    }
    const cleanup = () => {
      pressRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', cleanup)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', cleanup)
  }

  const style: CSSProperties = {
    '--port-color': handleColor,
    background: handleColor,
  } as CSSProperties

  const handle = (
    <Handle
      id={handleId}
      type={side === 'input' ? 'target' : 'source'}
      position={side === 'input' ? Position.Left : Position.Right}
      isConnectableStart={!pickUpEnabled}
      onMouseDown={startPickUpWatch}
      data-drop={dropState}
      data-connected={connected ? 'true' : undefined}
      className={cn('module-graph-port-handle', side === 'input' ? 'is-input' : 'is-output', reveal && 'is-reveal', className)}
      style={style}
    />
  )

  return tooltip ? (
    <Tip content={tooltip} className="whitespace-pre-line text-left" side={side === 'input' ? 'left' : 'right'}>
      {handle}
    </Tip>
  ) : handle
}
