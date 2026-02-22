import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Checkbox,
  Box,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
} from '@mui/material';
import { CloudUpload, Download, Link as LinkIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { civitaiApi } from '../../services/civitaiApi';
import { getBackendOrigin, buildUploadsUrl } from '../../utils/backend';

interface CivitaiUploadModalProps {
  open: boolean;
  onClose: () => void;
  compositeHash: string;
  imageName?: string;
  imageUrl?: string; // 썸네일 또는 원본 이미지 경로
}

type UploadMethod = 'intent' | 'clipboard';

export const CivitaiUploadModal: React.FC<CivitaiUploadModalProps> = ({
  open,
  onClose,
  compositeHash,
  imageName,
  imageUrl,
}) => {
  const { t } = useTranslation('settings');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>('clipboard');

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  // Intent URL 방식 (외부 접속 가능할 때)
  const handleIntentUpload = async () => {
    try {
      setIsLoading(true);
      setError('');
      setSuccess('');

      const result = await civitaiApi.createIntent({
        compositeHashes: [compositeHash],
        includeMetadata,
        title: title || undefined,
        description: description || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      // Open Civitai in new tab
      window.open(result.intentUrl, '_blank');
      onClose();
    } catch (err: any) {
      setError(err.message || t('civitai.upload.error'));
    } finally {
      setIsLoading(false);
    }
  };

  // 다운로드 + Civitai 열기 방식
  const handleDownloadAndOpen = async () => {
    try {
      setIsLoading(true);
      setError('');
      setSuccess('');

      // 이미지 다운로드
      const backendOrigin = getBackendOrigin();
      const imgUrl = `${backendOrigin}/api/images/${compositeHash}/download/original`;

      const response = await fetch(imgUrl, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }

      const blob = await response.blob();

      // 파일 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = imageName || `civitai_upload_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess(t('civitai.upload.downloadSuccess'));

      // Civitai 업로드 페이지 열기
      setTimeout(() => {
        window.open('https://civitai.com/posts/create', '_blank');
        onClose();
      }, 1000);

    } catch (err: any) {
      console.error('Download failed:', err);
      setError(err.message || t('civitai.upload.downloadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (uploadMethod === 'intent') {
      await handleIntentUpload();
    } else {
      await handleDownloadAndOpen();
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setTitle('');
      setDescription('');
      setTags([]);
      setTagInput('');
      setIncludeMetadata(true);
      setError('');
      setSuccess('');
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <CloudUpload />
          {t('civitai.upload.title')}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        {error && (
          <Alert severity="error" onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" onClose={() => setSuccess('')}>
            {success}
          </Alert>
        )}

        {imageName && (
          <Typography variant="body2" color="text.secondary">
            {t('civitai.upload.selectedImage')}: {imageName}
          </Typography>
        )}

        {/* 업로드 방식 선택 */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t('civitai.upload.methodLabel')}
          </Typography>
          <ToggleButtonGroup
            value={uploadMethod}
            exclusive
            onChange={(_, value) => value && setUploadMethod(value)}
            fullWidth
            size="small"
          >
            <Tooltip title={t('civitai.upload.downloadTooltip')} arrow>
              <ToggleButton value="clipboard">
                <Download sx={{ mr: 1 }} />
                {t('civitai.upload.downloadMethod')}
              </ToggleButton>
            </Tooltip>
            <Tooltip title={t('civitai.upload.intentTooltip')} arrow>
              <ToggleButton value="intent">
                <LinkIcon sx={{ mr: 1 }} />
                {t('civitai.upload.intentMethod')}
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {/* Intent 방식일 때만 추가 옵션 표시 */}
        {uploadMethod === 'intent' && (
          <>
            <TextField
              fullWidth
              label={t('civitai.upload.postTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('civitai.upload.postTitlePlaceholder')}
            />

            <TextField
              fullWidth
              label={t('civitai.upload.postDescription')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={3}
              placeholder={t('civitai.upload.postDescriptionPlaceholder')}
            />

            <Box>
              <TextField
                fullWidth
                label={t('civitai.upload.tags')}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('civitai.upload.tagsPlaceholder')}
                size="small"
              />
              {tags.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      size="small"
                      onDelete={() => handleRemoveTag(tag)}
                    />
                  ))}
                </Box>
              )}
            </Box>

            <Tooltip title={t('civitai.upload.includeMetadataDescription')} arrow placement="right">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={includeMetadata}
                    onChange={(e) => setIncludeMetadata(e.target.checked)}
                  />
                }
                label={t('civitai.upload.includeMetadata')}
              />
            </Tooltip>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t('common.cancel')}
        </Button>
        <Tooltip
          title={uploadMethod === 'clipboard'
            ? t('civitai.upload.downloadButtonTooltip')
            : t('civitai.upload.intentButtonTooltip')
          }
          arrow
        >
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={20} /> : (uploadMethod === 'clipboard' ? <Download /> : <CloudUpload />)}
          >
            {isLoading
              ? t('civitai.upload.uploading')
              : (uploadMethod === 'clipboard'
                ? t('civitai.upload.downloadAndOpen')
                : t('civitai.upload.uploadButton')
              )
            }
          </Button>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
};

export default CivitaiUploadModal;
