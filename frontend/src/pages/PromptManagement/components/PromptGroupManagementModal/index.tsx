import React, { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useSnackbar } from './hooks/useSnackbar';
import { useGroupManagement } from './hooks/useGroupManagement';
import { useGroupDragDrop } from './hooks/useGroupDragDrop';
import { GroupEditModal } from './components/GroupEditModal';
import { GroupList } from './components/GroupList';

interface PromptGroupManagementModalProps {
  open: boolean;
  onClose: () => void;
  type: 'positive' | 'negative';
  onGroupsChange: () => void;
}

const PromptGroupManagementModal: React.FC<PromptGroupManagementModalProps> = ({
  open,
  onClose,
  type,
  onGroupsChange,
}) => {
  const { t } = useTranslation('promptManagement');
  const { snackbar, showSnackbar, hideSnackbar } = useSnackbar();

  const {
    groups,
    loading,
    editingGroup,
    isEditing,
    fetchGroups,
    startAddGroup,
    startEditGroup,
    cancelEdit,
    saveGroup,
    deleteGroup,
    toggleVisibility,
    updateGroupsOrder,
    updateEditingGroup,
    setGroups,
  } = useGroupManagement(
    type,
    (message: string) => showSnackbar(t(message) || message, 'success'),
    (message: string) => showSnackbar(t(message) || message, 'error')
  );

  const { handleDragEnd } = useGroupDragDrop();

  useEffect(() => {
    if (open) {
      fetchGroups();
    }
  }, [open, fetchGroups]);

  const handleClose = () => {
    cancelEdit();
    onClose();
  };

  const handleSave = () => {
    saveGroup(onGroupsChange);
  };

  const handleDelete = (groupId: number) => {
    deleteGroup(groupId, onGroupsChange);
  };

  const handleToggleVisibility = (group: any) => {
    toggleVisibility(group, onGroupsChange);
  };

  const handleDragEndWrapper = (event: any) => {
    handleDragEnd(event, groups, (reorderedGroups) => {
      setGroups(reorderedGroups);
      updateGroupsOrder(reorderedGroups, onGroupsChange);
    });
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('groupManagement.title', {
            type: type === 'positive' ? 'Positive' : 'Negative',
          })}
        </DialogTitle>

        <DialogContent dividers sx={{ minHeight: 400 }}>
          {loading ? (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              minHeight="300px"
            >
              <CircularProgress />
            </Box>
          ) : (
            <GroupList
              groups={groups}
              isEditing={isEditing}
              onAddGroup={startAddGroup}
              onEditGroup={startEditGroup}
              onDeleteGroup={handleDelete}
              onToggleVisibility={handleToggleVisibility}
              onDragEnd={handleDragEndWrapper}
            />
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose}>
            {t('groupManagement.actions.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Modal */}
      <GroupEditModal
        open={isEditing}
        editingGroup={editingGroup}
        onUpdate={updateEditingGroup}
        onSave={handleSave}
        onCancel={cancelEdit}
      />

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={hideSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={hideSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default PromptGroupManagementModal;
