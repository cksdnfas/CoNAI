import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { promptCollectionApi } from '../../../services/api';
import type { PromptGroupWithPrompts } from '@comfyui-image-manager/shared';

interface BulkAssignModalProps {
  open: boolean;
  onClose: () => void;
  type: 'positive' | 'negative';
  groups: PromptGroupWithPrompts[];
  onSuccess: () => void;
  selectedPromptTexts?: string[]; // 체크박스로 선택된 프롬프트 텍스트
}

export const BulkAssignModal: React.FC<BulkAssignModalProps> = ({
  open,
  onClose,
  type,
  groups,
  onSuccess,
  selectedPromptTexts = [],
}) => {
  const { t } = useTranslation('promptManagement');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [textInput, setTextInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; failed: string[] } | null>(null);

  // 선택된 프롬프트가 있으면 텍스트 입력에 자동으로 채우기
  useEffect(() => {
    if (open && selectedPromptTexts.length > 0) {
      setTextInput(selectedPromptTexts.join('\n'));
    }
  }, [open, selectedPromptTexts]);

  const parsePrompts = (input: string): string[] => {
    // 쉼표 또는 줄바꿈으로 구분
    const prompts = input
      .split(/[,\n]+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    // 중복 제거
    return Array.from(new Set(prompts));
  };

  const parsedPrompts = parsePrompts(textInput);

  const handleAssign = async () => {
    if (parsedPrompts.length === 0) {
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await promptCollectionApi.batchAssignPromptsToGroup(
        parsedPrompts,
        groupId,
        type
      );

      if (response.success) {
        setResult({
          created: response.created || 0,
          updated: response.updated || 0,
          failed: response.failed || [],
        });
        onSuccess();
      }
    } catch (error) {
      console.error('Error batch assigning prompts:', error);
      setResult({
        created: 0,
        updated: 0,
        failed: parsedPrompts,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setGroupId(null);
      setTextInput('');
      setResult(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('bulkAssignDialog.title')}</DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* 그룹 선택 */}
          <FormControl fullWidth>
            <InputLabel>{t('bulkAssignDialog.groupSelect.label')}</InputLabel>
            <Select
              value={groupId || ''}
              label={t('bulkAssignDialog.groupSelect.label')}
              onChange={(e) => setGroupId(e.target.value as number | null)}
              disabled={loading || result !== null}
            >
              <MenuItem value="">{t('assignDialog.selectGroup.unassigned')}</MenuItem>
              {groups
                .filter(group => group.is_visible)
                .map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.group_name} ({group.prompt_count})
                  </MenuItem>
                ))}
            </Select>
          </FormControl>

          {/* 텍스트 입력 */}
          <TextField
            label={t('bulkAssignDialog.textInput.label')}
            placeholder={t('bulkAssignDialog.textInput.placeholder')}
            multiline
            rows={6}
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={loading || result !== null}
            helperText={t('bulkAssignDialog.textInput.example')}
          />

          {/* 프리뷰 */}
          {parsedPrompts.length > 0 && !result && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('bulkAssignDialog.preview.title', { count: parsedPrompts.length })}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 150, overflow: 'auto', p: 1, bgcolor: 'background.default', borderRadius: 1 }}>
                {parsedPrompts.slice(0, 20).map((prompt, index) => (
                  <Chip key={index} label={prompt} size="small" variant="outlined" />
                ))}
                {parsedPrompts.length > 20 && (
                  <Chip
                    label={`+${parsedPrompts.length - 20}개 더`}
                    size="small"
                    color="primary"
                  />
                )}
              </Box>
            </Box>
          )}

          {/* 결과 표시 */}
          {result && (
            <Box>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                {t('bulkAssignDialog.results.title')}
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Alert severity="success">
                  {t('bulkAssignDialog.results.created', { count: result.created })}
                </Alert>
                <Alert severity="info">
                  {t('bulkAssignDialog.results.updated', { count: result.updated })}
                </Alert>
                {result.failed.length > 0 && (
                  <Alert severity="error">
                    {t('bulkAssignDialog.results.failed', { count: result.failed.length })}
                    <Box sx={{ mt: 1 }}>
                      {result.failed.slice(0, 5).map((prompt, index) => (
                        <Typography key={index} variant="body2">
                          • {prompt}
                        </Typography>
                      ))}
                      {result.failed.length > 5 && (
                        <Typography variant="body2" color="text.secondary">
                          ... 및 {result.failed.length - 5}개 더
                        </Typography>
                      )}
                    </Box>
                  </Alert>
                )}
                <Alert severity="success">
                  {t('bulkAssignDialog.results.total', {
                    count: result.created + result.updated,
                  })}
                </Alert>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {result ? t('bulkAssignDialog.actions.close') : t('bulkAssignDialog.actions.cancel')}
        </Button>
        {!result && (
          <Button
            onClick={handleAssign}
            variant="contained"
            disabled={loading || parsedPrompts.length === 0}
            startIcon={loading ? <CircularProgress size={20} /> : null}
          >
            {t('bulkAssignDialog.actions.assign')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
