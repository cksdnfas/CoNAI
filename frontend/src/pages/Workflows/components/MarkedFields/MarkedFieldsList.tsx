import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { MarkedField } from '../../../../services/api/workflowApi';
import { SortableMarkedFieldCard } from './SortableMarkedFieldCard';
import { useMarkedFieldValidation } from './hooks/useMarkedFieldValidation';

interface MarkedFieldsListProps {
  fields: MarkedField[];
  onFieldsChange: (fields: MarkedField[]) => void;
  onUpdateField: (index: number, updates: Partial<MarkedField>) => void;
  onDeleteField: (index: number) => void;
}

export const MarkedFieldsList: React.FC<MarkedFieldsListProps> = ({
  fields,
  onFieldsChange,
  onUpdateField,
  onDeleteField,
}) => {
  const { t } = useTranslation();

  // Setup validation
  const validation = useMarkedFieldValidation(fields);

  // Setup drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex((f) => f.id === active.id);
      const newIndex = fields.findIndex((f) => f.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newFields = arrayMove(fields, oldIndex, newIndex);
        onFieldsChange(newFields);
      }
    }
  };

  // Empty state
  if (fields.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
        <Typography variant="body2">{t('workflows:markedFields.noFields')}</Typography>
      </Box>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <Box>
          {fields.map((field, index) => {
            const fieldErrors = validation.getFieldErrors(index);
            return (
              <SortableMarkedFieldCard
                key={field.id}
                field={field}
                index={index}
                onUpdate={onUpdateField}
                onDelete={onDeleteField}
                fieldErrors={fieldErrors}
              />
            );
          })}
        </Box>
      </SortableContext>
    </DndContext>
  );
};
