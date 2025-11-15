import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  DialogContentText,
} from '@mui/material';
import { Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { groupApi } from '../../services/api';
import type { GroupWithHierarchy } from '@comfyui-image-manager/shared';
import { GroupTreeSelector } from '../GroupTreeSelector';

interface GroupAssignModalProps {
  open: boolean;
  onClose: () => void;
  selectedImageCount: number;
  onAssign: (groupId: number) => void | Promise<void>;
  currentGroupId?: number;
}

const GroupAssignModal: React.FC<GroupAssignModalProps> = ({
  open,
  onClose,
  selectedImageCount,
  onAssign,
  currentGroupId,
}) => {
  const { t } = useTranslation(['common', 'imageGroups']);
  const [groups, setGroups] = useState<GroupWithHierarchy[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 그룹 목록 로드
  useEffect(() => {
    if (open) {
      loadGroups();
      setSelectedGroupId(null);
      setError(null);
    }
  }, [open]);

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await groupApi.getAllGroupsWithHierarchy();

      if (response.success && response.data) {
        setGroups(response.data);
      } else {
        setError(t('imageGroups:assignModal.loadError'));
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
      setError(t('imageGroups:assignModal.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectionChange = (selectedIds: number[]) => {
    setSelectedGroupId(selectedIds[0] || null);
  };

  const handleAssign = async () => {
    if (selectedGroupId && selectedGroupId !== currentGroupId) {
      await onAssign(selectedGroupId);
      onClose();
    }
  };

  const handleDialogMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleDialogPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      onMouseDown={handleDialogMouseDown}
      onPointerDown={handleDialogPointerDown}
    >
      <DialogTitle>{t('imageGroups:assignModal.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('imageGroups:assignModal.description', { count: selectedImageCount })}
        </DialogContentText>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : groups.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">
              {t('imageGroups:assignModal.emptyGroups')}
            </Typography>
          </Box>
        ) : (
          <GroupTreeSelector
            groups={groups}
            selectedIds={selectedGroupId ? [selectedGroupId] : []}
            onSelectionChange={handleSelectionChange}
            multiSelect={false}
            showSearch={true}
            emptyMessage={t('imageGroups:assignModal.emptyGroups')}
            maxHeight={500}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('imageGroups:assignModal.buttonCancel')}</Button>
        <Button
          onClick={handleAssign}
          color="primary"
          variant="contained"
          disabled={!selectedGroupId}
        >
          {t('imageGroups:assignModal.buttonAssign')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GroupAssignModal;
