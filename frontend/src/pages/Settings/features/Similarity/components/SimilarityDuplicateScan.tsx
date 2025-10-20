import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  CircularProgress,
  Stack,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
} from '@mui/material';
import {
  FindInPage as FindInPageIcon,
  ContentCopy as ContentCopyIcon,
  ExpandMore as ExpandMoreIcon,
  Delete as DeleteIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { DuplicateGroup } from '../../../../../services/similarityApi';
import { getThumbnailUrl } from '../utils/similarityHelpers';
import { imageApi } from '../../../../../services/api';

interface SimilarityDuplicateScanProps {
  duplicateGroups: DuplicateGroup[];
  scanLoading: boolean;
  onScanDuplicates: () => void;
  onImagesDeleted?: () => void;
}

export const SimilarityDuplicateScan: React.FC<SimilarityDuplicateScanProps> = ({
  duplicateGroups,
  scanLoading,
  onScanDuplicates,
  onImagesDeleted,
}) => {
  const { t } = useTranslation('settings');

  // 선택된 이미지 관리
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 이미지 선택 토글
  const handleToggleImage = (imageId: number) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  };

  // 그룹 전체 선택/해제
  const handleToggleGroup = (group: DuplicateGroup, selectAll: boolean) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      group.images.forEach(image => {
        if (selectAll) {
          newSet.add(image.id);
        } else {
          newSet.delete(image.id);
        }
      });
      return newSet;
    });
  };

  // 그룹에서 하나만 남기고 나머지 선택
  const handleSelectAllButOne = (group: DuplicateGroup) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      // 첫 번째 이미지를 제외한 나머지 모두 선택
      group.images.slice(1).forEach(image => {
        newSet.add(image.id);
      });
      return newSet;
    });
  };

  // 선택된 이미지 삭제
  const handleDeleteSelected = async () => {
    if (selectedImages.size === 0) return;

    setDeleting(true);
    try {
      const imageIds = Array.from(selectedImages);
      const results = await imageApi.deleteImages(imageIds);

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      if (failCount > 0) {
        alert(t('similarity.duplicateScan.deletePartialSuccess', { success: successCount, failed: failCount }));
      } else {
        alert(t('similarity.duplicateScan.deleteSuccess', { count: successCount }));
      }

      // 선택 초기화
      setSelectedImages(new Set());
      setDeleteDialogOpen(false);

      // 부모 컴포넌트에 알림 (스캔 재실행 등)
      if (onImagesDeleted) {
        onImagesDeleted();
      }
    } catch (error) {
      console.error('Failed to delete images:', error);
      alert(t('similarity.duplicateScan.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  // 그룹이 모두 선택되었는지 확인
  const isGroupFullySelected = (group: DuplicateGroup) => {
    return group.images.every(image => selectedImages.has(image.id));
  };

  // 그룹이 부분적으로 선택되었는지 확인
  const isGroupPartiallySelected = (group: DuplicateGroup) => {
    return group.images.some(image => selectedImages.has(image.id)) && !isGroupFullySelected(group);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('similarity.duplicateScan.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('similarity.duplicateScan.description')}
        </Typography>

        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={scanLoading ? <CircularProgress size={20} /> : <FindInPageIcon />}
              onClick={onScanDuplicates}
              disabled={scanLoading}
            >
              {scanLoading ? t('similarity.duplicateScan.scanning') : t('similarity.duplicateScan.scanButton')}
            </Button>

            {selectedImages.size > 0 && (
              <Button
                variant="contained"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setDeleteDialogOpen(true)}
              >
                {t('similarity.duplicateScan.deleteSelected', { count: selectedImages.size })}
              </Button>
            )}
          </Stack>

          {duplicateGroups.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('similarity.duplicateScan.foundGroups', { count: duplicateGroups.length })}
              </Typography>
              {duplicateGroups.map((group) => (
                <Accordion key={group.groupId}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                      <ContentCopyIcon color="warning" />
                      <Typography sx={{ flex: 1 }}>
                        {t('similarity.duplicateScan.groupLabel', { id: group.groupId, count: group.images.length })}
                      </Typography>
                      <Chip
                        label={t('similarity.duplicateScan.similarityLabel', { percent: group.similarity.toFixed(1) })}
                        size="small"
                        color="warning"
                      />
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    {/* 그룹 제어 버튼 */}
                    <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
                      <Tooltip title={t('similarity.duplicateScan.selectAll')}>
                        <Button
                          size="small"
                          variant={isGroupFullySelected(group) ? "contained" : "outlined"}
                          startIcon={<SelectAllIcon />}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleGroup(group, !isGroupFullySelected(group));
                          }}
                        >
                          {t('similarity.duplicateScan.selectAll')}
                        </Button>
                      </Tooltip>
                      <Tooltip title={t('similarity.duplicateScan.keepOneDelete')}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectAllButOne(group);
                          }}
                        >
                          {t('similarity.duplicateScan.keepOne')}
                        </Button>
                      </Tooltip>
                      {(isGroupFullySelected(group) || isGroupPartiallySelected(group)) && (
                        <Tooltip title={t('similarity.duplicateScan.deselectAll')}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<DeselectIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleGroup(group, false);
                            }}
                          >
                            {t('similarity.duplicateScan.deselectAll')}
                          </Button>
                        </Tooltip>
                      )}
                    </Stack>

                    {/* 이미지 그리드 */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 2 }}>
                      {group.images.map((image) => {
                        const isSelected = selectedImages.has(image.id);
                        return (
                          <Box
                            key={image.id}
                            sx={{
                              position: 'relative',
                              cursor: 'pointer',
                              border: isSelected ? '3px solid' : '1px solid',
                              borderColor: isSelected ? 'error.main' : 'divider',
                              borderRadius: 1,
                              overflow: 'hidden',
                              transition: 'all 0.2s',
                              '&:hover': {
                                borderColor: isSelected ? 'error.dark' : 'primary.main',
                                transform: 'scale(1.02)',
                              },
                            }}
                            onClick={() => handleToggleImage(image.id)}
                          >
                            {/* 체크박스 */}
                            <Checkbox
                              checked={isSelected}
                              onChange={() => handleToggleImage(image.id)}
                              sx={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                                bgcolor: 'background.paper',
                                borderRadius: '50%',
                                '&:hover': {
                                  bgcolor: 'background.paper',
                                },
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />

                            {/* 이미지 */}
                            <Box
                              component="img"
                              src={getThumbnailUrl(image)}
                              alt={image.filename}
                              sx={{
                                width: '100%',
                                height: 150,
                                objectFit: 'cover',
                                opacity: isSelected ? 0.6 : 1,
                              }}
                            />

                            {/* 이미지 정보 */}
                            <Box sx={{ p: 1, bgcolor: isSelected ? 'error.light' : 'background.paper' }}>
                              <Typography variant="caption" display="block" noWrap sx={{ color: isSelected ? 'error.contrastText' : 'text.primary' }}>
                                ID: {image.id}
                              </Typography>
                              <Typography variant="caption" display="block" noWrap sx={{ color: isSelected ? 'error.contrastText' : 'text.secondary' }}>
                                {image.width} × {image.height}
                              </Typography>
                            </Box>

                            {/* 삭제 표시 */}
                            {isSelected && (
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: '50%',
                                  left: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  bgcolor: 'rgba(211, 47, 47, 0.9)',
                                  borderRadius: '50%',
                                  p: 1,
                                }}
                              >
                                <DeleteIcon sx={{ color: 'white', fontSize: 32 }} />
                              </Box>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          )}

          {duplicateGroups.length === 0 && !scanLoading && (
            <Alert severity="info">
              {t('similarity.duplicateScan.noResults')}
            </Alert>
          )}
        </Stack>
      </CardContent>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
        <DialogTitle>{t('similarity.duplicateScan.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('similarity.duplicateScan.deleteConfirmMessage', { count: selectedImages.size })}
          </DialogContentText>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('similarity.duplicateScan.deleteWarning')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            {t('similarity.duplicateScan.cancel')}
          </Button>
          <Button
            onClick={handleDeleteSelected}
            color="error"
            variant="contained"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {deleting ? t('similarity.duplicateScan.deleting') : t('similarity.duplicateScan.confirmDelete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};
