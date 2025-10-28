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
import { useTranslation } from 'react-i18next';
import { useBulkActions } from '../../hooks/useBulkActions';
import GroupAssignModal from '../GroupAssignModal';
import type { ImageRecord } from '../../types/image';

// ✅ composite_hash 기반으로 변경
interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: string[];  // composite_hash[]
  selectedImages?: ImageRecord[];
  onSelectionClear: () => void;
  onActionComplete?: (deletedIds?: string[]) => void;  // composite_hash[]
  onModalStateChange?: (isOpen: boolean) => void;
}

const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  selectedIds,
  selectedImages = [],
  onSelectionClear,
  onActionComplete,
  onModalStateChange,
}) => {
  const { t } = useTranslation(['common']);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const { loading, error, deleteImages, downloadImages, assignToGroup, clearError } = useBulkActions();

  // 모달 상태가 변경될 때마다 부모에게 알림
  const handleSetGroupDialogOpen = (isOpen: boolean) => {
    setGroupDialogOpen(isOpen);
    if (onModalStateChange) {
      onModalStateChange(isOpen);
    }
  };

  const handleDelete = async () => {
    // 선택된 항목 중 비디오가 있는지 확인
    const hasVideo = selectedImages.some(img => img.mime_type?.startsWith('video/'));
    const hasImage = selectedImages.some(img => !img.mime_type?.startsWith('video/'));

    let confirmMessage: string;

    // 더 구체적인 메시지 표시
    if (hasVideo && hasImage) {
      confirmMessage = t('common:bulkActions.confirmDelete.mixed', { count: selectedCount });
    } else if (hasVideo) {
      confirmMessage = t('common:bulkActions.confirmDelete.videos', { count: selectedCount });
    } else if (hasImage) {
      confirmMessage = t('common:bulkActions.confirmDelete.images', { count: selectedCount });
    } else {
      confirmMessage = t('common:bulkActions.confirmDelete.files', { count: selectedCount });
    }

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const deletedIds = [...selectedIds];
    const success = await deleteImages(deletedIds);
    if (success) {
      // 삭제된 ID를 전달하여 선택에서 제거
      if (onActionComplete) {
        onActionComplete(deletedIds);
      }
    }
  };

  const handleDownload = async () => {
    await downloadImages(selectedIds);
    // 다운로드는 선택 유지 (아무 작업도 하지 않음)
  };

  const handleGroupAssign = async (groupId: number) => {
    const success = await assignToGroup(selectedIds, groupId);

    if (success) {
      // 그룹 할당 성공 시 모달 닫기
      handleSetGroupDialogOpen(false);
      // 그룹 할당 후 선택 해제 (사용자가 빈 공간을 클릭할 필요 없도록)
      onSelectionClear();
      // 토스트 메시지는 useBulkActions에서 처리
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <Paper
        className="no-drag-select"
        elevation={4}
        onMouseDown={handleMouseDown}
        onPointerDown={handlePointerDown}
        sx={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          p: 2,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minWidth: 400,
        }}
      >
        <Typography variant="body1" sx={{ flexGrow: 1 }}>
          {t('common:bulkActions.selectedCountImages', { count: selectedCount })}
        </Typography>

        {loading && <CircularProgress size={24} />}

        <Tooltip title={t('common:bulkActions.tooltips.download')}>
          <IconButton
            onClick={handleDownload}
            disabled={loading}
            color="primary"
          >
            <DownloadIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.addToGroup')}>
          <IconButton
            onClick={() => handleSetGroupDialogOpen(true)}
            disabled={loading}
            color="primary"
          >
            <FolderOpenIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.delete')}>
          <IconButton
            onClick={handleDelete}
            disabled={loading}
            color="error"
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common:bulkActions.tooltips.clearSelection')}>
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
        onClose={() => handleSetGroupDialogOpen(false)}
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