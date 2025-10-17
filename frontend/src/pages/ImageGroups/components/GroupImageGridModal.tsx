import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Button,
  Toolbar,
  Alert,
  Dialog as ConfirmDialog,
  DialogActions,
  DialogContentText,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  DriveFileMove as MoveIcon,
} from '@mui/icons-material';
import type { ImageRecord, PageSize } from '../../../types/image';
import type { GroupWithStats } from '@comfyui-image-manager/shared';
import ImageGrid from '../../../components/ImageGrid/ImageGrid';
import GroupAssignModal from '../../../components/GroupAssignModal';

interface GroupImageGridModalProps {
  open: boolean;
  onClose: () => void;
  images: ImageRecord[];
  loading?: boolean;
  currentGroup: GroupWithStats | null;
  allGroups: GroupWithStats[];
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  currentPage?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onImagesRemoved?: (selectedImageIds: number[]) => void;
  onImagesAssigned?: (targetGroupId: number, selectedImageIds: number[]) => void;
}

const GroupImageGridModal: React.FC<GroupImageGridModalProps> = ({
  open,
  onClose,
  images,
  loading = false,
  currentGroup,
  allGroups: _allGroups,
  pageSize = 25,
  onPageSizeChange,
  currentPage = 1,
  totalPages = 1,
  total = 0,
  onPageChange,
  onImagesRemoved,
  onImagesAssigned,
}) => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // 모달 오픈 시 선택 상태 초기화
  useEffect(() => {
    if (open) {
      setSelectedIds([]);
    }
  }, [open]);

  // 페이지 변경 시 선택 상태 초기화
  useEffect(() => {
    setSelectedIds([]);
  }, [currentPage]);

  // 그룹 변경 시 선택 상태 초기화
  useEffect(() => {
    setSelectedIds([]);
  }, [currentGroup?.id]);

  // 선택된 이미지 정보
  const selectedImages = images.filter(img => selectedIds.includes(img.id));
  const hasManualSelected = selectedImages.some(img => {
    const groupInfo = img.groups?.find(g => g.id === currentGroup?.id);
    return groupInfo?.collection_type === 'manual';
  });
  const hasAutoSelected = selectedImages.some(img => {
    const groupInfo = img.groups?.find(g => g.id === currentGroup?.id);
    return groupInfo?.collection_type === 'auto';
  });

  // 버튼 활성화 조건
  const canRemove = hasManualSelected && !hasAutoSelected && selectedIds.length > 0;
  const canAssign = selectedIds.length > 0;

  const handleRemoveClick = () => {
    setRemoveDialogOpen(true);
  };

  const handleRemoveConfirm = () => {
    setRemoveDialogOpen(false);
    if (onImagesRemoved) {
      // 수동 수집 이미지 ID만 전달
      const manualImageIds = selectedImages
        .filter(img => {
          const groupInfo = img.groups?.find(g => g.id === currentGroup?.id);
          return groupInfo?.collection_type === 'manual';
        })
        .map(img => img.id);
      onImagesRemoved(manualImageIds);
    }
    setSelectedIds([]);
  };

  const handleAssignClick = () => {
    setAssignDialogOpen(true);
  };

  const handleAssignConfirm = async (groupId: number) => {
    if (onImagesAssigned) {
      onImagesAssigned(groupId, selectedIds);
      setSelectedIds([]);
    }
  };

  const getSelectionMessage = () => {
    if (selectedIds.length === 0) return null;

    if (hasManualSelected && hasAutoSelected) {
      return (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('imageGroups:imageModal.infoMixedSelection')}
        </Alert>
      );
    }

    if (hasAutoSelected && !hasManualSelected) {
      return (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('imageGroups:imageModal.warningAutoOnly')}
        </Alert>
      );
    }

    return null;
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="xl"
        fullWidth
        PaperProps={{
          sx: {
            height: '90vh',
            maxHeight: '90vh',
          },
        }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">
              {t('imageGroups:imageModal.title', { name: currentGroup?.name, count: total })}
            </Typography>
            <IconButton
              aria-label="close"
              onClick={onClose}
              sx={{
                color: (theme) => theme.palette.grey[500],
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>

        {/* 액션 툴바 */}
        {selectedIds.length > 0 && (
          <Toolbar
            sx={{
              bgcolor: 'action.hover',
              borderTop: 1,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {t('imageGroups:imageModal.selectedCount', { count: selectedIds.length })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleRemoveClick}
                disabled={!canRemove}
              >
                {t('imageGroups:imageModal.buttonRemove')}
              </Button>
              <Button
                variant="outlined"
                color="primary"
                startIcon={<MoveIcon />}
                onClick={handleAssignClick}
                disabled={!canAssign}
              >
                {t('imageGroups:imageModal.buttonAssign')}
              </Button>
            </Box>
          </Toolbar>
        )}

        <DialogContent
          sx={{
            p: 2,
            overflow: 'auto',
            flex: 1,
          }}
        >
          {getSelectionMessage()}

          <ImageGrid
            images={images}
            loading={loading}
            selectable={true}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            pageSize={pageSize}
            onPageSizeChange={onPageSizeChange}
            currentPage={currentPage}
            totalPages={totalPages}
            total={total}
            onPageChange={onPageChange}
            showCollectionType={true}
            currentGroupId={currentGroup?.id}
          />
        </DialogContent>
      </Dialog>

      {/* 제거 확인 다이얼로그 */}
      <ConfirmDialog
        open={removeDialogOpen}
        onClose={() => setRemoveDialogOpen(false)}
      >
        <DialogTitle>{t('imageGroups:imageModal.confirmRemoveTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('imageGroups:imageModal.confirmRemoveMessage', {
              count: selectedImages.filter(img => {
                const groupInfo = img.groups?.find(g => g.id === currentGroup?.id);
                return groupInfo?.collection_type === 'manual';
              }).length
            })}
            <br />
            <strong>{t('imageGroups:imageModal.confirmRemoveNote')}</strong>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveDialogOpen(false)}>{t('common:buttons.cancel')}</Button>
          <Button onClick={handleRemoveConfirm} color="error" variant="contained">
            {t('imageGroups:imageModal.buttonRemove')}
          </Button>
        </DialogActions>
      </ConfirmDialog>

      {/* 그룹 할당 모달 */}
      <GroupAssignModal
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        selectedImageCount={selectedIds.length}
        onAssign={handleAssignConfirm}
        currentGroupId={currentGroup?.id}
      />
    </>
  );
};

export default GroupImageGridModal;
