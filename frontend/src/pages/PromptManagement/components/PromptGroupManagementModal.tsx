import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Typography,
  Divider,
  Alert,
  Snackbar,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  DragIndicator as DragIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { promptGroupApi } from '../../../services/api';
import type { PromptGroupWithPrompts, PromptGroupData } from '@comfyui-image-manager/shared';

interface PromptGroupManagementModalProps {
  open: boolean;
  onClose: () => void;
  type: 'positive' | 'negative';
  onGroupsChange: () => void;
}

interface EditingGroup {
  id?: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
}

const PromptGroupManagementModal: React.FC<PromptGroupManagementModalProps> = ({
  open,
  onClose,
  type,
  onGroupsChange
}) => {
  const { t } = useTranslation('promptManagement');
  const [groups, setGroups] = useState<PromptGroupWithPrompts[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 스낵바 상태
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // 그룹 목록 조회
  const fetchGroups = async () => {
    try {
      setLoading(true);
      const response = await promptGroupApi.getGroups(true, type);
      if (response.success && response.data) {
        // 표시 순서로 정렬
        const sortedGroups = response.data.sort((a, b) => a.display_order - b.display_order);
        setGroups(sortedGroups);
      } else {
        showSnackbar(t('groupManagement.messages.loadFailed'), 'error');
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      showSnackbar(t('groupManagement.messages.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchGroups();
    }
  }, [open, type]);

  // 스낵바 표시
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
    setSnackbar({ open: true, message, severity });
  };

  // 스낵바 닫기
  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 새 그룹 추가 시작
  const handleAddGroup = () => {
    const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.display_order)) : 0;
    setEditingGroup({
      group_name: '',
      display_order: maxOrder + 1,
      is_visible: true,
    });
    setIsEditing(true);
  };

  // 그룹 편집 시작
  const handleEditGroup = (group: PromptGroupWithPrompts) => {
    setEditingGroup({
      id: group.id,
      group_name: group.group_name,
      display_order: group.display_order,
      is_visible: group.is_visible,
    });
    setIsEditing(true);
  };

  // 편집 취소
  const handleCancelEdit = () => {
    setEditingGroup(null);
    setIsEditing(false);
  };

  // 그룹 저장
  const handleSaveGroup = async () => {
    if (!editingGroup || !editingGroup.group_name.trim()) {
      showSnackbar(t('groupManagement.editForm.groupName.required'), 'error');
      return;
    }

    try {
      const groupData: PromptGroupData = {
        group_name: editingGroup.group_name.trim(),
        display_order: editingGroup.display_order,
        is_visible: editingGroup.is_visible,
      };

      let response;
      if (editingGroup.id) {
        // 수정
        response = await promptGroupApi.updateGroup(editingGroup.id, groupData, type);
      } else {
        // 생성
        response = await promptGroupApi.createGroup(groupData, type);
      }

      if (response.success) {
        showSnackbar(
          editingGroup.id ? t('groupManagement.messages.updateSuccess') : t('groupManagement.messages.createSuccess'),
          'success'
        );
        fetchGroups();
        onGroupsChange();
        handleCancelEdit();
      } else {
        showSnackbar(
          response.error || (editingGroup.id ? t('groupManagement.messages.updateFailed') : t('groupManagement.messages.createFailed')),
          'error'
        );
      }
    } catch (error) {
      console.error('Error saving group:', error);
      showSnackbar(editingGroup?.id ? t('groupManagement.messages.updateFailed') : t('groupManagement.messages.createFailed'), 'error');
    }
  };

  // 그룹 삭제
  const handleDeleteGroup = async (groupId: number) => {
    if (!confirm(t('groupManagement.actions.deleteConfirm'))) {
      return;
    }

    try {
      const response = await promptGroupApi.deleteGroup(groupId, type);
      if (response.success) {
        showSnackbar(t('groupManagement.messages.deleteSuccess'), 'success');
        fetchGroups();
        onGroupsChange();
      } else {
        showSnackbar(response.error || t('groupManagement.messages.deleteFailed'), 'error');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      showSnackbar(t('groupManagement.messages.deleteFailed'), 'error');
    }
  };

  // 가시성 토글
  const handleToggleVisibility = async (group: PromptGroupWithPrompts) => {
    try {
      const groupData: PromptGroupData = {
        group_name: group.group_name,
        display_order: group.display_order,
        is_visible: !group.is_visible,
      };

      const response = await promptGroupApi.updateGroup(group.id, groupData, type);
      if (response.success) {
        fetchGroups();
        onGroupsChange();
      } else {
        showSnackbar(response.error || t('groupManagement.messages.visibilityFailed'), 'error');
      }
    } catch (error) {
      console.error('Error toggling visibility:', error);
      showSnackbar(t('groupManagement.messages.visibilityFailed'), 'error');
    }
  };

  // 모달 닫기
  const handleClose = () => {
    handleCancelEdit();
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('groupManagement.title', { type: type === 'positive' ? 'Positive' : 'Negative' })}
        </DialogTitle>

        <DialogContent dividers sx={{ minHeight: 400 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
              <CircularProgress />
            </Box>
          ) : (
            <>
              {/* 편집 폼 */}
              {isEditing && editingGroup && (
                <Box sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'primary.main', borderRadius: 1 }}>
                  <Typography variant="h6" gutterBottom>
                    {editingGroup.id ? t('groupManagement.editForm.titleEdit') : t('groupManagement.editForm.titleAdd')}
                  </Typography>

                  <TextField
                    label={t('groupManagement.editForm.groupName.label')}
                    fullWidth
                    value={editingGroup.group_name}
                    onChange={(e) => setEditingGroup({
                      ...editingGroup,
                      group_name: e.target.value
                    })}
                    sx={{ mb: 2 }}
                  />

                  <TextField
                    label={t('groupManagement.editForm.displayOrder.label')}
                    type="number"
                    value={editingGroup.display_order}
                    onChange={(e) => setEditingGroup({
                      ...editingGroup,
                      display_order: parseInt(e.target.value) || 0
                    })}
                    sx={{ mb: 2, width: 150 }}
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={editingGroup.is_visible}
                        onChange={(e) => setEditingGroup({
                          ...editingGroup,
                          is_visible: e.target.checked
                        })}
                      />
                    }
                    label={t('groupManagement.editForm.visibility.label')}
                  />

                  <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                    <Button variant="contained" onClick={handleSaveGroup}>
                      {t('groupManagement.editForm.actions.save')}
                    </Button>
                    <Button onClick={handleCancelEdit}>
                      {t('groupManagement.editForm.actions.cancel')}
                    </Button>
                  </Box>
                </Box>
              )}

              {/* 그룹 목록 */}
              <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                  {t('groupManagement.groupList.title', { count: groups.length })}
                </Typography>
                {!isEditing && (
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={handleAddGroup}
                  >
                    {t('groupManagement.groupList.add')}
                  </Button>
                )}
              </Box>

              {groups.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <Typography color="text.secondary">
                    {t('groupManagement.groupList.empty')}
                  </Typography>
                </Box>
              ) : (
                <List>
                  {groups.map((group, index) => (
                    <React.Fragment key={group.id}>
                      <ListItem>
                        <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
                          <DragIcon color="disabled" />
                          <Typography variant="body2" sx={{ ml: 1, color: 'text.secondary' }}>
                            {group.display_order}
                          </Typography>
                        </Box>

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

                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleToggleVisibility(group)}
                            sx={{ mr: 1 }}
                          >
                            {group.is_visible ? <VisibilityIcon /> : <VisibilityOffIcon />}
                          </IconButton>
                          <IconButton
                            edge="end"
                            onClick={() => handleEditGroup(group)}
                            disabled={isEditing}
                            sx={{ mr: 1 }}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            edge="end"
                            onClick={() => handleDeleteGroup(group.id)}
                            disabled={isEditing}
                            color="error"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                      {index < groups.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </List>
              )}
            </>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose}>
            {t('groupManagement.actions.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 스낵바 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleSnackbarClose}
      >
        <Alert
          onClose={handleSnackbarClose}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default PromptGroupManagementModal;