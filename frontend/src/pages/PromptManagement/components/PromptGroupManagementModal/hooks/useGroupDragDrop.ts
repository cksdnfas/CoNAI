import { useState } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { PromptGroupWithPrompts } from '@comfyui-image-manager/shared';

export const useGroupDragDrop = () => {
  const [activeId, setActiveId] = useState<number | null>(null);

  const handleDragStart = (event: { active: { id: number } }) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (
    event: DragEndEvent,
    groups: PromptGroupWithPrompts[],
    onReorder: (reorderedGroups: PromptGroupWithPrompts[]) => void
  ) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveId(null);
      return;
    }

    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedGroups = arrayMove(groups, oldIndex, newIndex).map((group, index) => ({
        ...group,
        display_order: index + 1,
      }));

      onReorder(reorderedGroups);
    }

    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  return {
    activeId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
};
