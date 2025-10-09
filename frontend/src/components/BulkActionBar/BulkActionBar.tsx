import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemButton,
  ListItemText,
  Alert,
  CircularProgress,
  Slide,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  FolderOpen as FolderOpenIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import type { TransitionProps } from '@mui/material/transitions';
import type { GroupRecord } from '../../types/group';
import { groupApi } from '../../services/api';
import { useBulkActions } from '../../hooks/useBulkActions';

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement<any, any>;
  },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: number[];
  onSelectionClear: () => void;
  onActionComplete?: () => void;
}

const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  selectedIds,
  onSelectionClear,
  onActionComplete,
}) => {
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const { loading, error, deleteImages, downloadImages, assignToGroup, clearError } = useBulkActions();

  const loadGroups = async () => {
    setGroupsLoading(true);
    try {
      const response = await groupApi.getGroups();
      if (response.success && response.data) {
        setGroups(response.data);
      }
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    if (groupDialogOpen) {
      loadGroups();
    }
  }, [groupDialogOpen]);

  const handleDelete = async () => {
    if (!window.confirm(`선택된 ${selectedCount}개 이미지를 삭제하시겠습니까?`)) {
      return;
    }

    const success = await deleteImages(selectedIds);
    if (success) {
      onSelectionClear();
      if (onActionComplete) {
        onActionComplete();
      }
    }
  };

  const handleDownload = async () => {
    await downloadImages(selectedIds);
  };

  const handleGroupAssign = async (groupId: number) => {
    const success = await assignToGroup(selectedIds, groupId);
    setGroupDialogOpen(false);

    if (success) {
      onSelectionClear();
      if (onActionComplete) {
        onActionComplete();
      }
    }
  };

  const handleGroupDialogClose = () => {
    setGroupDialogOpen(false);
    clearError();
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <>
      <Paper
        elevation={4}
        sx={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          p: 2,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minWidth: 400,
        }}
      >
        <Typography variant="body1" sx={{ flexGrow: 1 }}>
          {selectedCount}개 이미지 선택됨
        </Typography>

        {loading && <CircularProgress size={24} />}

        <Tooltip title="다운로드">
          <IconButton
            onClick={handleDownload}
            disabled={loading}
            color="primary"
          >
            <DownloadIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="그룹에 추가">
          <IconButton
            onClick={() => setGroupDialogOpen(true)}
            disabled={loading}
            color="primary"
          >
            <FolderOpenIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="삭제">
          <IconButton
            onClick={handleDelete}
            disabled={loading}
            color="error"
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="선택 해제">
          <IconButton
            onClick={onSelectionClear}
            size="small"
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* 그룹 선택 다이얼로그 */}
      <Dialog
        open={groupDialogOpen}
        onClose={handleGroupDialogClose}
        TransitionComponent={Transition}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
        keepMounted={false}
      >
        <DialogTitle>
          그룹 선택
          <Typography variant="body2" color="text.secondary">
            {selectedCount}개 이미지를 추가할 그룹을 선택하세요
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {groupsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : groups.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                생성된 그룹이 없습니다
              </Typography>
            </Box>
          ) : (
            <List>
              {groups.map((group) => (
                <ListItemButton
                  key={group.id}
                  onClick={() => handleGroupAssign(group.id)}
                  disabled={loading}
                >
                  <ListItemText
                    primary={group.name}
                    secondary={group.description}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleGroupDialogClose}>
            취소
          </Button>
        </DialogActions>
      </Dialog>

      {/* 에러 메시지 */}
      {error && (
        <Box
          sx={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 1001,
            maxWidth: 400,
          }}
        >
          <Alert
            severity="error"
            onClose={clearError}
            action={
              <IconButton
                aria-label="close"
                color="inherit"
                size="small"
                onClick={clearError}
              >
                <CloseIcon fontSize="inherit" />
              </IconButton>
            }
          >
            {error}
          </Alert>
        </Box>
      )}
    </>
  );
};

export default BulkActionBar;