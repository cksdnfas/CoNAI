import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { MarkedField } from '../../../../services/api/workflowApi';
import { MarkedFieldCard } from './MarkedFieldCard';
import type { FieldError } from './hooks/useMarkedFieldValidation';

interface SortableMarkedFieldCardProps {
  field: MarkedField;
  index: number;
  onUpdate: (index: number, updates: Partial<MarkedField>) => void;
  onDelete: (index: number) => void;
  fieldErrors?: FieldError[];
}

export const SortableMarkedFieldCard: React.FC<SortableMarkedFieldCardProps> = ({
  field,
  index,
  onUpdate,
  onDelete,
  fieldErrors,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <MarkedFieldCard
        field={field}
        index={index}
        onUpdate={onUpdate}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
        fieldErrors={fieldErrors}
      />
    </div>
  );
};
