import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'

/** A link between two ports: a solid line in the source type's color, with a remove button while it is selected. */
function ModuleGraphEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
}: EdgeProps) {
  const { t } = useI18n()
  const { deleteElements } = useReactFlow()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{ ...style, strokeWidth: selected ? 3.5 : 2.25, strokeLinecap: 'round' }}
      />
      {selected ? (
        <EdgeLabelRenderer>
          <div className="nodrag nopan pointer-events-auto absolute" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            <IconButton
              size="icon-xs"
              variant="secondary"
              label={t({ ko: '연결 끊기 (Delete)', en: 'Remove link (Delete)' })}
              onClick={(event) => {
                event.stopPropagation()
                void deleteElements({ edges: [{ id }] })
              }}
              className="rounded-full shadow-elevation-2 hover:bg-destructive hover:text-destructive-foreground"
            >
              <X />
            </IconButton>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const ModuleGraphEdgeView = memo(ModuleGraphEdgeComponent)
