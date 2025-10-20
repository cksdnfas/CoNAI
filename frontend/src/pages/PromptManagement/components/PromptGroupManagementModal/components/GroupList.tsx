import React from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Box, Typography, Button, List, Divider, Alert } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { PromptGroupWithPrompts } from '@comfyui-image-manager/shared';
import { GroupListItem } from './GroupListItem';

interface GroupListProps {
  groups: PromptGroupWithPrompts[];
  isEditing: boolean;
  onAddGroup: () => void;
  onEditGroup: (group: PromptGroupWithPrompts) => void;
  onDeleteGroup: (groupId: number) => void;
  onToggleVisibility: (group: PromptGroupWithPrompts) => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export const GroupList: React.FC<GroupListProps> = ({
  groups,
  isEditing,
  onAddGroup,
  onEditGroup,
  onDeleteGroup,
  onToggleVisibility,
  onDragEnd,
}) => {
  const { t } = useTranslation('promptManagement');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h6">
          {t('groupManagement.groupList.title', { count: groups.length })}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onAddGroup}
        >
          {t('groupManagement.groupList.add')}
        </Button>
      </Box>

      {/* Drag Hint */}
      {groups.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('groupManagement.dragHint')}
        </Alert>
      )}

      {/* Empty State */}
      {groups.length === 0 ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 6,
            color: 'text.secondary',
          }}
        >
          <Typography variant="body1">
            {t('groupManagement.groupList.empty')}
          </Typography>
        </Box>
      ) : (
        /* Group List */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={groups.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            <List>
              {groups.map((group, index) => (
                <React.Fragment key={group.id}>
                  <GroupListItem
                    group={group}
                    isEditing={isEditing}
                    onEdit={onEditGroup}
                    onDelete={onDeleteGroup}
                    onToggleVisibility={onToggleVisibility}
                  />
                  {index < groups.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          </SortableContext>
        </DndContext>
      )}
    </Box>
  );
};
