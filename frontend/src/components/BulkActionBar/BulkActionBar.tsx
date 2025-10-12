import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  FolderOpen as FolderOpenIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useBulkActions } from '../../hooks/useBulkActions';
import GroupAssignModal from '../GroupAssignModal';

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
  const { loading, error, deleteImages, downloadImages, assignToGroup, clearError } = useBulkActions();

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

    if (success) {
      onSelectionClear();
      if (onActionComplete) {
        onActionComplete();
      }
    }
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

      {/* 그룹 선택 모달 */}
      <GroupAssignModal
        open={groupDialogOpen}
        onClose={() => setGroupDialogOpen(false)}
        selectedImageCount={selectedCount}
        onAssign={handleGroupAssign}
      />

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