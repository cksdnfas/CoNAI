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
  LocalOffer as TagIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useBulkActions } from '../../hooks/useBulkActions';
import GroupAssignModal from '../GroupAssignModal';
import type { ImageRecord } from '../../types/image';

// ✅ id 기반으로 변경 (중복 이미지 개별 선택)
interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: number[];  // ✅ image_files.id[]
  selectedImages?: ImageRecord[];
  onSelectionClear: () => void;
  onActionComplete?: (deletedIds?: string[]) => void;  // composite_hash[] (메타데이터 작업용)
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

    // ✅ selectedIds (file_id 배열) 직접 사용 - 중복 파일 개별 삭제 지원
    const success = await deleteImages(selectedIds);
    if (success) {
      // 삭제된 이미지의 composite_hash 목록 전달 (선택 해제용)
      const deletedHashes = selectedImages
        .map(img => img.composite_hash)
        .filter((hash): hash is string => hash !== null);

      if (onActionComplete) {
        onActionComplete(deletedHashes);
      }
    }
  };

  const handleDownload = async () => {
    // selectedImages에서 composite_hash 추출 (메타데이터 작업용)
    const compositeHashes = selectedImages
      .map(img => img.composite_hash)
      .filter((hash): hash is string => hash !== null);
    await downloadImages(compositeHashes);
    // 다운로드는 선택 유지 (아무 작업도 하지 않음)
  };

  const handleGroupAssign = async (groupId: number) => {
    // selectedImages에서 composite_hash 추출 (메타데이터 작업용)
    const compositeHashes = selectedImages
      .map(img => img.composite_hash)
      .filter((hash): hash is string => hash !== null);
    const success = await assignToGroup(compositeHashes, groupId);

    if (success) {
      // 그룹 할당 성공 시 모달 닫기
      handleSetGroupDialogOpen(false);
      // 그룹 할당 후 선택 해제 (사용자가 빈 공간을 클릭할 필요 없도록)
      onSelectionClear();
      // 토스트 메시지는 useBulkActions에서 처리
    }
  };

  const handleBatchTag = async () => {
    // ✅ Phase 3.2: Batch tagging feature
    const compositeHashes = selectedImages
      .map(img => img.composite_hash)
      .filter((hash): hash is string => hash !== null);

    if (compositeHashes.length === 0) {
      return;
    }

    const confirmMessage = t('common:bulkActions.confirmBatchTag', { count: compositeHashes.length }) ||
      `태그를 생성하시겠습니까? (${compositeHashes.length}개 이미지)`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      // Import taggerBatchApi dynamically to avoid circular dependency
      const { taggerBatchApi } = await import('../../services/settingsApi');

      // Call batch tag API with selected composite_hashes
      const response = await fetch('/api/images/batch-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: compositeHashes }),
      });

      const result = await response.json();

      if (result.success) {
        alert(t('common:bulkActions.batchTagSuccess', { count: result.data?.success_count || 0 }) ||
          `${result.data?.success_count || 0}개 이미지 태그 생성 완료`);
        onSelectionClear();
      } else {
        throw new Error(result.error || 'Batch tag failed');
      }
    } catch (error) {
      console.error('Batch tag error:', error);
      alert(t('common:bulkActions.batchTagError') || '배치 태그 생성 중 오류가 발생했습니다.');
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

        <Tooltip title={t('common:bulkActions.tooltips.batchTag') || '일괄 태그 생성'}>
          <IconButton
            onClick={handleBatchTag}
            disabled={loading}
            color="primary"
          >
            <TagIcon />
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