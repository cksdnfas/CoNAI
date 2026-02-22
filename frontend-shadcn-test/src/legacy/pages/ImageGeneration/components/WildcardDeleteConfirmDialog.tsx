import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Box,
  Alert,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { WildcardWithItems } from '../../../services/api/wildcardApi';

interface WildcardDeleteConfirmDialogProps {
  open: boolean;
  wildcard: WildcardWithItems | null;
  childCount: number;
  onClose: () => void;
  onConfirm: (cascade: boolean) => void;
}

export const WildcardDeleteConfirmDialog: React.FC<WildcardDeleteConfirmDialogProps> = ({
  open,
  wildcard,
  childCount,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation(['wildcards', 'common']);
  const [deleteMode, setDeleteMode] = React.useState<'moveUp' | 'cascade'>('moveUp');

  const hasChildren = childCount > 0;

  const handleConfirm = () => {
    onConfirm(deleteMode === 'cascade');
  };

  if (!wildcard) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('wildcards:deleteConfirm.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body1" gutterBottom>
            {t('wildcards:deleteConfirm.message', { name: wildcard.name })}
          </Typography>
        </Box>

        {/* 와일드카드 정보 */}
        <Box sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('wildcards:deleteConfirm.wildcardInfo.itemCount', { count: wildcard.items.length })}
          </Typography>
          {hasChildren && (
            <Typography variant="body2" color="text.secondary">
              {t('wildcards:deleteConfirm.wildcardInfo.childCount', { count: childCount })}
            </Typography>
          )}
        </Box>

        {/* 삭제 옵션 (하위 와일드카드가 있을 때만 표시) */}
        {hasChildren && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('wildcards:deleteConfirm.childrenNotice')}
            </Alert>

            <FormControl component="fieldset" fullWidth>
              <Typography variant="subtitle2" gutterBottom>
                {t('wildcards:deleteConfirm.options.title')}
              </Typography>
              <RadioGroup value={deleteMode} onChange={(e) => setDeleteMode(e.target.value as 'moveUp' | 'cascade')}>
                <FormControlLabel
                  value="moveUp"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">
                        {t('wildcards:deleteConfirm.options.moveUp.label')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('wildcards:deleteConfirm.options.moveUp.description')}
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="cascade"
                  control={<Radio color="error" />}
                  label={
                    <Box>
                      <Typography variant="body2" color="error">
                        {t('wildcards:deleteConfirm.options.cascade.label')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('wildcards:deleteConfirm.options.cascade.description', { count: childCount })}
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </FormControl>
          </>
        )}

        {!hasChildren && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('wildcards:deleteConfirm.warning.permanent')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={handleConfirm} color="error" variant="contained">
          {t('common:delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
