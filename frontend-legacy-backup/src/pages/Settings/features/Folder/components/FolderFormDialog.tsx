import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControlLabel,
  Switch,
  Alert,
  Box,
  Chip,
  Tooltip,
  IconButton,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Add as AddIcon,
  InfoOutlined as InfoOutlinedIcon,
  HelpOutline as HelpOutlineIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { folderApi } from '../../../../../services/folderApi';
import type { WatchedFolder, WatchedFolderCreate, WatchedFolderUpdate } from '../../../../../types/folder';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  folder?: WatchedFolder | null;
}

const FolderFormDialog: React.FC<Props> = ({ open, onClose, folder, onSuccess }) => {
  const { t } = useTranslation('settings');
  const isEdit = !!folder;

  const [formData, setFormData] = useState<WatchedFolderCreate>({
    folder_path: '',
    folder_name: '',
    auto_scan: true,
    scan_interval: 60,
    recursive: true,
    exclude_extensions: [],
    exclude_patterns: [],
    watcher_enabled: true,
    watcher_polling_interval: null
  });

  const [newExtension, setNewExtension] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (folder) {
      setFormData({
        folder_path: folder.folder_path,
        folder_name: folder.folder_name || '',
        auto_scan: folder.auto_scan === 1,
        scan_interval: folder.scan_interval,
        recursive: folder.recursive === 1,
        exclude_extensions: folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [],
        exclude_patterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : [],
        watcher_enabled: folder.watcher_enabled === 1,
        watcher_polling_interval: folder.watcher_polling_interval
      });
    } else {
      setFormData({
        folder_path: '',
        folder_name: '',
        auto_scan: true,
        scan_interval: 60,
        recursive: true,
        exclude_extensions: [],
        exclude_patterns: [],
        watcher_enabled: true,
        watcher_polling_interval: null
      });
    }
    setError(null);
  }, [folder, open]);

  const handleAddExtension = () => {
    if (!newExtension.trim()) return;
    const ext = newExtension.trim().startsWith('.') ? newExtension.trim() : `.${newExtension.trim()}`;
    if (!formData.exclude_extensions?.includes(ext)) {
      setFormData({
        ...formData,
        exclude_extensions: [...(formData.exclude_extensions || []), ext]
      });
    }
    setNewExtension('');
  };

  const handleRemoveExtension = (ext: string) => {
    setFormData({
      ...formData,
      exclude_extensions: formData.exclude_extensions?.filter(e => e !== ext)
    });
  };

  const handleAddPattern = () => {
    if (!newPattern.trim()) return;
    if (!formData.exclude_patterns?.includes(newPattern.trim())) {
      setFormData({
        ...formData,
        exclude_patterns: [...(formData.exclude_patterns || []), newPattern.trim()]
      });
    }
    setNewPattern('');
  };

  const handleRemovePattern = (pattern: string) => {
    setFormData({
      ...formData,
      exclude_patterns: formData.exclude_patterns?.filter(p => p !== pattern)
    });
  };

  const handleSave = async () => {
    if (!formData.folder_path.trim()) {
      setError(t('folderSettings.dialog.errorPath'));
      return;
    }

    setSaving(true);
    try {
      setError(null);

      if (isEdit && folder) {
        const updates: WatchedFolderUpdate = {
          folder_name: formData.folder_name,
          auto_scan: formData.auto_scan,
          scan_interval: formData.scan_interval,
          recursive: formData.recursive,
          exclude_extensions: formData.exclude_extensions,
          exclude_patterns: formData.exclude_patterns,
          watcher_enabled: formData.watcher_enabled,
          watcher_polling_interval: formData.watcher_polling_interval
        };
        await folderApi.updateFolder(folder.id, updates);
      } else {
        await folderApi.addFolder(formData);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || t('folderSettings.dialog.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? t('folderSettings.dialog.editTitle') : t('folderSettings.dialog.addTitle')}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 0.5 }}>
          <TextField
            fullWidth
            label={t('folderSettings.dialog.folderPath')}
            value={formData.folder_path}
            onChange={(e) => setFormData({ ...formData, folder_path: e.target.value })}
            disabled={isEdit}
            helperText={
              isEdit
                ? t('folderSettings.dialog.folderPathDisabled')
                : t('folderSettings.dialog.folderPathHelper')
            }
          />

          <TextField
            fullWidth
            label={t('folderSettings.dialog.folderName')}
            value={formData.folder_name}
            onChange={(e) => setFormData({ ...formData, folder_name: e.target.value })}
            helperText={t('folderSettings.dialog.folderNameHelper')}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.watcher_enabled}
                  onChange={(e) => setFormData({ ...formData, watcher_enabled: e.target.checked })}
                />
              }
              label={t('folderSettings.dialog.watcherEnabled')}
            />
            <Tooltip
              title={t('folderSettings.dialog.watcherTooltip')}
              arrow
              placement="right"
            >
              <IconButton size="small">
                <InfoOutlinedIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </Box>

          {formData.watcher_enabled && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('folderSettings.dialog.pollingInterval')}
                </Typography>
                <Tooltip
                  title={t('folderSettings.dialog.pollingIntervalTooltip')}
                  arrow
                >
                  <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                </Tooltip>
              </Box>
              <TextField
                size="small"
                type="number"
                label={t('folderSettings.dialog.pollingIntervalLabel')}
                value={formData.watcher_polling_interval ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  watcher_polling_interval: e.target.value === '' ? null : parseInt(e.target.value) || null
                })}
                placeholder={t('folderSettings.dialog.pollingIntervalPlaceholder')}
                helperText={t('folderSettings.dialog.pollingIntervalHelper')}
                sx={{ maxWidth: 300 }}
                inputProps={{ min: 100, step: 100 }}
              />
            </Box>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={formData.auto_scan}
                onChange={(e) => setFormData({ ...formData, auto_scan: e.target.checked })}
              />
            }
            label={t('folderSettings.dialog.autoScan')}
          />

          {formData.auto_scan && (
            <TextField
              fullWidth
              type="number"
              label={t('folderSettings.dialog.scanInterval')}
              value={formData.scan_interval}
              onChange={(e) => setFormData({ ...formData, scan_interval: parseInt(e.target.value) || 60 })}
              helperText={t('folderSettings.dialog.scanIntervalHelper')}
            />
          )}

          <Accordion sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
              <Typography variant="body2" color="text.secondary">{t('folderSettings.dialog.advancedOptions')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.recursive}
                      onChange={(e) => setFormData({ ...formData, recursive: e.target.checked })}
                    />
                  }
                  label={t('folderSettings.dialog.recursive')}
                />

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('folderSettings.dialog.excludeExtensions')}
                  </Typography>
                  <Tooltip
                    title={t('folderSettings.dialog.excludeExtensionsTooltip')}
                    arrow
                  >
                    <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    value={newExtension}
                    onChange={(e) => setNewExtension(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddExtension()}
                    placeholder={t('folderSettings.dialog.excludeExtensionsPlaceholder')}
                    sx={{ width: 200 }}
                  />
                  <Button onClick={handleAddExtension} startIcon={<AddIcon />} variant="outlined" size="small">
                    {t('folderSettings.dialog.addButton')}
                  </Button>
                </Box>
                {formData.exclude_extensions && formData.exclude_extensions.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {formData.exclude_extensions.map((ext) => (
                      <Chip
                        key={ext}
                        label={ext}
                        onDelete={() => handleRemoveExtension(ext)}
                        size="small"
                        color="error"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                )}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('folderSettings.dialog.excludePatterns')}
                  </Typography>
                  <Tooltip
                    title={t('folderSettings.dialog.excludePatternsTooltip')}
                    arrow
                  >
                    <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPattern()}
                    placeholder={t('folderSettings.dialog.excludePatternsPlaceholder')}
                    sx={{ width: 300 }}
                  />
                  <Button onClick={handleAddPattern} startIcon={<AddIcon />} variant="outlined" size="small">
                    {t('folderSettings.dialog.addButton')}
                  </Button>
                </Box>
                {formData.exclude_patterns && formData.exclude_patterns.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {formData.exclude_patterns.map((pattern) => (
                      <Chip
                        key={pattern}
                        label={pattern}
                        onDelete={() => handleRemovePattern(pattern)}
                        size="small"
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('folderSettings.dialog.cancelButton')}
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? t('folderSettings.dialog.savingButton') : t('folderSettings.dialog.saveButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderFormDialog;
