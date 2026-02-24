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
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  DriveFileMove as MoveIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  PhotoLibrary as PhotoLibraryIcon,
  Videocam as VideocamIcon,
  TextSnippet as TextSnippetIcon,
} from '@mui/icons-material';
import type { ImageRecord, PageSize } from '../../../types/image';
import type { GroupWithStats } from '@comfyui-image-manager/shared';
import ImageList from '../../../components/ImageList/ImageList';
import GroupAssignModal from '../../../components/GroupAssignModal';
import { groupApi } from '../../../services/api/groupApi';
import { autoFolderGroupsApi } from '../../../services/api/autoFolderGroupsApi';

import { useImageListSettings } from '../../../hooks/useImageListSettings';
import LoraDatasetDialog from './LoraDatasetDialog';

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
  infiniteScroll?: {
    hasMore: boolean;
    loadMore: () => void;
  };
  onImagesRemoved?: (selectedImageIds: string[]) => void;
  onImagesAssigned?: (targetGroupId: number, selectedImageIds: string[]) => void;
  readOnly?: boolean;
  groupType?: 'custom' | 'auto-folder'; // 그룹 타입 추가
  onShowSnackbar?: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void;
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
  infiniteScroll,
  readOnly = false,
  onImagesRemoved,
  onImagesAssigned,
  groupType = 'custom', // 기본값은 custom
  onShowSnackbar,
}) => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const { settings } = useImageListSettings('group_modal');
  const activeMode = settings.activeScrollMode || 'pagination';

  const [selectedIds, setSelectedIds] = useState<number[]>([]);  // ✅ id 기반 (중복 이미지 개별 선택)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const [downloadScope, setDownloadScope] = useState<'all' | 'selected'>('all');
  const [downloadConfirmOpen, setDownloadConfirmOpen] = useState(false);
  const [pendingDownloadType, setPendingDownloadType] = useState<'thumbnail' | 'original' | 'video' | null>(null);
  const [fileCounts, setFileCounts] = useState<{ thumbnail: number; original: number; video: number } | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [loraDialogOpen, setLoraDialogOpen] = useState(false);
  const [loraDialogScope, setLoraDialogScope] = useState<'all' | 'selected'>('all');

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
  const selectedImages = images.filter(img => img.id && selectedIds.includes(img.id));
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
      // 수동 수집 이미지 composite_hash만 전달
      const manualImageIds = selectedImages
        .filter(img => {
          const groupInfo = img.groups?.find(g => g.id === currentGroup?.id);
          return groupInfo?.collection_type === 'manual';
        })
        .map(img => img.composite_hash)
        .filter((hash): hash is string => hash !== null);
      onImagesRemoved(manualImageIds);
    }
    setSelectedIds([]);
  };

  const handleAssignClick = () => {
    setAssignDialogOpen(true);
  };

  const handleAssignConfirm = async (groupId: number) => {
    if (onImagesAssigned) {
      // selectedIds (number[])를 composite_hash (string[])로 변환
      const compositeHashes = selectedImages
        .map(img => img.composite_hash)
        .filter((hash): hash is string => hash !== null);
      onImagesAssigned(groupId, compositeHashes);
      setSelectedIds([]);
    }
  };

  // 파일 개수 조회
  useEffect(() => {
    if (open && currentGroup?.id) {
      setLoadingCounts(true);

      const fetchCounts = groupType === 'custom'
        ? groupApi.getFileCountsByType(currentGroup.id)
        : autoFolderGroupsApi.getFileCounts(currentGroup.id);

      fetchCounts
        .then(response => {
          if (response.success && response.data) {
            setFileCounts(response.data);
          }
        })
        .catch(err => console.error('Failed to fetch file counts:', err))
        .finally(() => setLoadingCounts(false));
    }
  }, [open, currentGroup?.id, groupType]);

  // 다운로드 버튼 클릭
  const handleDownloadClick = (event: React.MouseEvent<HTMLElement>) => {
    setDownloadAnchorEl(event.currentTarget);
  };

  // 다운로드 메뉴 닫기
  const handleDownloadMenuClose = () => {
    setDownloadAnchorEl(null);
  };

  // 다운로드 타입 선택
  const handleDownloadTypeSelect = (type: 'thumbnail' | 'original' | 'video', scope: 'all' | 'selected') => {
    handleDownloadMenuClose();

    if (!currentGroup?.id) return;

    // 파일이 없는 경우 스낵바로 알림
    const count = scope === 'all' ? (fileCounts?.[type] || 0) : selectedIds.length;
    if (count === 0) {
      const typeLabel = type === 'thumbnail' ? t('common:thumbnail') : type === 'original' ? t('common:original') : t('common:video');
      if (onShowSnackbar) {
        onShowSnackbar(`다운로드할 ${typeLabel} 파일이 없습니다.`, 'warning');
      }
      return;
    }

    // 대용량 경고 확인 (100개 이상)
    if (count >= 100) {
      setPendingDownloadType(type);
      setDownloadScope(scope);
      setDownloadConfirmOpen(true);
    } else {
      // 바로 다운로드
      startDownload(type, scope);
    }
  };

  // 다운로드 실행
  const startDownload = async (type: 'thumbnail' | 'original' | 'video', scope: 'all' | 'selected') => {
    if (!currentGroup?.id) return;

    try {
      // 선택된 이미지의 composite_hash 추출
      let compositeHashes: string[] | undefined;
      if (scope === 'selected' && selectedIds.length > 0) {
        compositeHashes = selectedImages
          .map(img => img.composite_hash)
          .filter((hash): hash is string => hash !== null);
      }

      // 그룹 타입에 따라 다른 API 사용 (Blob 기반)
      if (groupType === 'custom') {
        await groupApi.downloadGroupBlob(currentGroup.id, type, compositeHashes);
      } else {
        // auto-folder 그룹의 경우
        await autoFolderGroupsApi.downloadGroup(currentGroup.id, type, compositeHashes);
      }

      // 다운로드 성공 스낵바
      if (onShowSnackbar) {
        onShowSnackbar('다운로드가 시작되었습니다.', 'success');
      }
    } catch (error) {
      console.error('Download failed:', error);
      if (onShowSnackbar) {
        const errorMessage = error instanceof Error ? error.message : '다운로드에 실패했습니다.';
        onShowSnackbar(errorMessage, 'error');
      }
    }
  };

  // 다운로드 확인 다이얼로그 확인
  const handleDownloadConfirm = () => {
    if (pendingDownloadType) {
      startDownload(pendingDownloadType, downloadScope);
    }
    setDownloadConfirmOpen(false);
    setPendingDownloadType(null);
  };

  // LoRA 데이터셋 다운로드 실행
  const handleLoraDatasetDownload = async (captionMode: 'auto_tags' | 'merged') => {
    setLoraDialogOpen(false);
    if (!currentGroup?.id) return;

    try {
      let compositeHashes: string[] | undefined;
      if (loraDialogScope === 'selected' && selectedIds.length > 0) {
        compositeHashes = selectedImages
          .map(img => img.composite_hash)
          .filter((hash): hash is string => hash !== null);
      }

      if (groupType === 'custom') {
        await groupApi.downloadGroupBlob(currentGroup.id, 'original', compositeHashes, captionMode);
      } else {
        await autoFolderGroupsApi.downloadGroup(currentGroup.id, 'original', compositeHashes, captionMode);
      }

      if (onShowSnackbar) {
        onShowSnackbar(t('imageGroups:download.loraDatasetStarted'), 'success');
      }
    } catch (error) {
      console.error('LoRA dataset download failed:', error);
      if (onShowSnackbar) {
        const errorMessage = error instanceof Error ? error.message : '다운로드에 실패했습니다.';
        onShowSnackbar(errorMessage, 'error');
      }
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
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton
                aria-label="download"
                onClick={handleDownloadClick}
                disabled={loadingCounts || total === 0}
                sx={{
                  color: (theme) => theme.palette.primary.main,
                }}
              >
                {loadingCounts ? <CircularProgress size={24} /> : <DownloadIcon />}
              </IconButton>
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
              {!readOnly && (
                <>
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
                </>
              )}
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

          <ImageList
            images={images}
            loading={loading}
            contextId="group_modal"
            mode={activeMode}
            infiniteScroll={infiniteScroll}
            pagination={{
              currentPage,
              totalPages,
              onPageChange: onPageChange || (() => { }),
              pageSize: pageSize as number,
              onPageSizeChange: (size) => onPageSizeChange?.(size as PageSize)
            }}
            selectable={true}
            selection={{
              selectedIds,
              onSelectionChange: setSelectedIds,
            }}
            showCollectionType={true}
            currentGroupId={currentGroup?.id}
            total={total}
            isModal={true}
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

      {/* 다운로드 메뉴 */}
      <Menu
        anchorEl={downloadAnchorEl}
        open={Boolean(downloadAnchorEl)}
        onClose={handleDownloadMenuClose}
      >
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <Typography variant="subtitle2" color="text.secondary">
            {t('imageGroups:download.menuTitle')}
          </Typography>
        </MenuItem>

        {/* 전체 다운로드 */}
        <MenuItem disabled sx={{ opacity: '1 !important', mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {t('imageGroups:download.scopeAll')}
          </Typography>
        </MenuItem>
        <MenuItem
          onClick={() => handleDownloadTypeSelect('thumbnail', 'all')}
          disabled={!fileCounts || fileCounts.thumbnail === 0}
        >
          <ListItemIcon>
            <ImageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeThumbnail')}
            {fileCounts && ` (${fileCounts.thumbnail})`}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => handleDownloadTypeSelect('original', 'all')}
          disabled={!fileCounts || fileCounts.original === 0}
        >
          <ListItemIcon>
            <PhotoLibraryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeOriginal')}
            {fileCounts && ` (${fileCounts.original})`}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => handleDownloadTypeSelect('video', 'all')}
          disabled={!fileCounts || fileCounts.video === 0}
        >
          <ListItemIcon>
            <VideocamIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeVideo')}
            {fileCounts && ` (${fileCounts.video})`}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleDownloadMenuClose();
            setLoraDialogScope('all');
            setLoraDialogOpen(true);
          }}
          disabled={!fileCounts || fileCounts.original === 0}
        >
          <ListItemIcon>
            <TextSnippetIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeLoraDataset')}
          </ListItemText>
        </MenuItem>

        {/* 선택된 이미지만 다운로드 */}
        {selectedIds.length > 0 && [
          <MenuItem key="selected-header" disabled sx={{ opacity: '1 !important', mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t('imageGroups:download.scopeSelected', { count: selectedIds.length })}
            </Typography>
          </MenuItem>,
          <MenuItem key="selected-thumbnail" onClick={() => handleDownloadTypeSelect('thumbnail', 'selected')}>
            <ListItemIcon>
              <ImageIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t('imageGroups:download.typeThumbnail')}
            </ListItemText>
          </MenuItem>,
          <MenuItem key="selected-original" onClick={() => handleDownloadTypeSelect('original', 'selected')}>
            <ListItemIcon>
              <PhotoLibraryIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t('imageGroups:download.typeOriginal')}
            </ListItemText>
          </MenuItem>,
          <MenuItem key="selected-video" onClick={() => handleDownloadTypeSelect('video', 'selected')}>
            <ListItemIcon>
              <VideocamIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t('imageGroups:download.typeVideo')}
            </ListItemText>
          </MenuItem>,
          <MenuItem key="selected-lora-dataset" onClick={() => {
            handleDownloadMenuClose();
            setLoraDialogScope('selected');
            setLoraDialogOpen(true);
          }}>
            <ListItemIcon>
              <TextSnippetIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t('imageGroups:download.typeLoraDataset')}
            </ListItemText>
          </MenuItem>
        ]}
      </Menu>

      {/* LoRA 데이터셋 다운로드 옵션 다이얼로그 */}
      <LoraDatasetDialog
        open={loraDialogOpen}
        onClose={() => setLoraDialogOpen(false)}
        onConfirm={handleLoraDatasetDownload}
      />

      {/* 대용량 다운로드 확인 다이얼로그 */}
      <ConfirmDialog
        open={downloadConfirmOpen}
        onClose={() => setDownloadConfirmOpen(false)}
      >
        <DialogTitle>{t('imageGroups:download.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('imageGroups:download.confirmMessage', {
              count: downloadScope === 'all'
                ? (fileCounts?.[pendingDownloadType || 'thumbnail'] || 0)
                : selectedIds.length
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadConfirmOpen(false)}>{t('common:buttons.cancel')}</Button>
          <Button onClick={handleDownloadConfirm} color="primary" variant="contained">
            {t('imageGroups:download.confirmButton')}
          </Button>
        </DialogActions>
      </ConfirmDialog>
    </>
  );
};

export default GroupImageGridModal;
