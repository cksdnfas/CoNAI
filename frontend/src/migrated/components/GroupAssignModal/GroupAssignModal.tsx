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
import { GroupTreeSelector } from '../GroupTreeSelector';
import { useAllGroupsWithHierarchy } from '../../hooks/useGroups';

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
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  // React Query hook for fetching groups
  const { data: groups = [], isLoading: loading, error: queryError } = useAllGroupsWithHierarchy();
  const error = queryError ? t('imageGroups:assignModal.loadError') : null;

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedGroupId(null);
    }
  }, [open]);

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
