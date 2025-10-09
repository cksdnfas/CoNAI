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

import { promptGroupApi } from '../../../services/api';
import type { PromptGroupWithPrompts, PromptGroupData } from '../../../types/promptCollection';

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
        showSnackbar('그룹 목록을 불러오는데 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      showSnackbar('그룹 목록을 불러오는데 실패했습니다.', 'error');
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
      showSnackbar('그룹명을 입력해주세요.', 'error');
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
          `그룹이 ${editingGroup.id ? '수정' : '생성'}되었습니다.`,
          'success'
        );
        fetchGroups();
        onGroupsChange();
        handleCancelEdit();
      } else {
        showSnackbar(
          response.error || `그룹 ${editingGroup.id ? '수정' : '생성'}에 실패했습니다.`,
          'error'
        );
      }
    } catch (error) {
      console.error('Error saving group:', error);
      showSnackbar(`그룹 ${editingGroup?.id ? '수정' : '생성'}에 실패했습니다.`, 'error');
    }
  };

  // 그룹 삭제
  const handleDeleteGroup = async (groupId: number) => {
    if (!confirm('정말로 이 그룹을 삭제하시겠습니까?')) {
      return;
    }

    try {
      const response = await promptGroupApi.deleteGroup(groupId, type);
      if (response.success) {
        showSnackbar('그룹이 삭제되었습니다.', 'success');
        fetchGroups();
        onGroupsChange();
      } else {
        showSnackbar(response.error || '그룹 삭제에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      showSnackbar('그룹 삭제에 실패했습니다.', 'error');
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
        showSnackbar(response.error || '그룹 설정 변경에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Error toggling visibility:', error);
      showSnackbar('그룹 설정 변경에 실패했습니다.', 'error');
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
          {type === 'positive' ? 'Positive' : 'Negative'} 프롬프트 그룹 관리
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
                    {editingGroup.id ? '그룹 편집' : '새 그룹 추가'}
                  </Typography>

                  <TextField
                    label="그룹명"
                    fullWidth
                    value={editingGroup.group_name}
                    onChange={(e) => setEditingGroup({
                      ...editingGroup,
                      group_name: e.target.value
                    })}
                    sx={{ mb: 2 }}
                  />

                  <TextField
                    label="표시 순서"
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
                    label="표시"
                  />

                  <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                    <Button variant="contained" onClick={handleSaveGroup}>
                      저장
                    </Button>
                    <Button onClick={handleCancelEdit}>
                      취소
                    </Button>
                  </Box>
                </Box>
              )}

              {/* 그룹 목록 */}
              <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                  그룹 목록 ({groups.length}개)
                </Typography>
                {!isEditing && (
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={handleAddGroup}
                  >
                    그룹 추가
                  </Button>
                )}
              </Box>

              {groups.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <Typography color="text.secondary">
                    생성된 그룹이 없습니다.
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
                                label={`${group.prompt_count}개`}
                                size="small"
                                variant="outlined"
                                color="primary"
                              />
                              {!group.is_visible && (
                                <Chip
                                  label="숨김"
                                  size="small"
                                  color="default"
                                />
                              )}
                            </Box>
                          }
                          secondary={`표시 순서: ${group.display_order}`}
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
            닫기
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