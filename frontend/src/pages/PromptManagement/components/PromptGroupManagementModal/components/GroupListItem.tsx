import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Box,
  IconButton,
  Chip,
  Typography,
} from '@mui/material';
import {
  DragIndicator as DragIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { PromptGroupWithPrompts } from '@comfyui-image-manager/shared';

interface GroupListItemProps {
  group: PromptGroupWithPrompts;
  isEditing: boolean;
  onEdit: (group: PromptGroupWithPrompts) => void;
  onDelete: (groupId: number) => void;
  onToggleVisibility: (group: PromptGroupWithPrompts) => void;
}

export const GroupListItem: React.FC<GroupListItemProps> = ({
  group,
  isEditing,
  onEdit,
  onDelete,
  onToggleVisibility,
}) => {
  const { t } = useTranslation('promptManagement');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={{
        cursor: isDragging ? 'grabbing' : 'default',
        bgcolor: 'background.paper',
        '&:hover': {
          bgcolor: 'action.hover',
        },
      }}
    >
      {/* Drag Handle */}
      <Box
        {...attributes}
        {...listeners}
        sx={{
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          mr: 2,
          color: 'text.secondary',
        }}
      >
        <DragIcon />
      </Box>

      {/* Order Number */}
      <Typography
        variant="body2"
        sx={{
          minWidth: 30,
          color: 'text.secondary',
          mr: 2,
        }}
      >
        {group.display_order}
      </Typography>

      {/* Group Info */}
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1">
              {group.group_name}
            </Typography>
            <Chip
              label={t('groupManagement.groupList.promptCount', { count: group.prompt_count })}
              size="small"
              variant="outlined"
              color="primary"
            />
            {!group.is_visible && (
              <Chip
                label={t('groupManagement.editForm.visibility.hidden')}
                size="small"
                color="default"
              />
            )}
          </Box>
        }
        secondary={t('groupManagement.groupList.displayOrder', { order: group.display_order })}
      />

      {/* Actions */}
      <ListItemSecondaryAction>
        <IconButton
          edge="end"
          onClick={() => onToggleVisibility(group)}
          sx={{ mr: 1 }}
        >
          {group.is_visible ? <VisibilityIcon /> : <VisibilityOffIcon />}
        </IconButton>
        <IconButton
          edge="end"
          onClick={() => onEdit(group)}
          disabled={isEditing}
          sx={{ mr: 1 }}
        >
          <EditIcon />
        </IconButton>
        <IconButton
          edge="end"
          onClick={() => onDelete(group.id)}
          disabled={isEditing}
          color="error"
        >
          <DeleteIcon />
        </IconButton>
      </ListItemSecondaryAction>
    </ListItem>
  );
};
