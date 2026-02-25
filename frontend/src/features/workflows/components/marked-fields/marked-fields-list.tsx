import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { useTranslation } from 'react-i18next'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { MarkedField } from '@/services/workflow-api'
import { SortableMarkedFieldCard } from './sortable-marked-field-card'
import { useMarkedFieldValidation } from './hooks/use-marked-field-validation'

interface MarkedFieldsListProps {
  fields: MarkedField[]
  onFieldsChange: (fields: MarkedField[]) => void
  onUpdateField: (index: number, updates: Partial<MarkedField>) => void
  onDeleteField: (index: number) => void
}

export function MarkedFieldsList({ fields, onFieldsChange, onUpdateField, onDeleteField }: MarkedFieldsListProps) {
  const { t } = useTranslation()
  const validation = useMarkedFieldValidation(fields)
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

  const handleToggleExpand = (index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex((field) => field.id === active.id)
      const newIndex = fields.findIndex((field) => field.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        onFieldsChange(arrayMove(fields, oldIndex, newIndex))
      }
    }
  }

  if (fields.length === 0) {
    return (
      <Card className="py-4 text-center text-muted-foreground">
                    <p className="text-sm">{t('workflows:markedFields.noFields')}</p>
                  </Card>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
        <div>{fields.map((field, index) => (
          <SortableMarkedFieldCard
            key={field.id}
            field={field}
            index={index}
            onUpdate={onUpdateField}
            onDelete={onDeleteField}
            fieldErrors={validation.getFieldErrors(index)}
            isExpanded={expandedIndices.has(index)}
            onToggleExpand={() => handleToggleExpand(index)}
          />
        ))}</div>
      </SortableContext>
    </DndContext>
  )
}
