import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  IconButton,
  Skeleton,
  Alert,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  ArrowBack as ArrowBackIcon,
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import { imageApi } from '../../services/api';
import type { ImageRecord } from '../../types/image';
import { getBackendOrigin } from '../../utils/backend';
import PromptDisplay from '../../components/PromptDisplay';
import { settingsApi } from '../../services/settingsApi';

const ImageDetailPage: React.FC = () => {
  const { t } = useTranslation(['imageDetail', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [image, setImage] = useState<ImageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false);
  const backendOrigin = getBackendOrigin();

  // Load settings to check if tagger is enabled
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingsApi.getSettings();
        setIsTaggerEnabled(settings.tagger.enabled);
      } catch (err) {
        console.error('Failed to load settings:', err);
        setIsTaggerEnabled(false);
      }
    };

    loadSettings();
  }, []);

  useEffect(() => {
    const loadImage = async () => {
      if (!id) {
        setError(t('imageDetail:page.noIdProvided'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await imageApi.getImage(parseInt(id));

        if (response.success && response.data) {
          setImage(response.data);
        } else {
          setError(response.error || t('imageDetail:page.notFound'));
        }
      } catch (err) {
        setError(t('imageDetail:page.errorLoading'));
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [id, t]);

  // Reload image after auto-tag generation
  const handleAutoTagGenerated = async () => {
    if (!id) return;
    try {
      const response = await imageApi.getImage(parseInt(id));
      if (response.success && response.data) {
        setImage(response.data);
      }
    } catch (err) {
      console.error('Failed to reload image after tagging:', err);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  const handleDownload = () => {
    if (!image) return;
    const link = document.createElement('a');
    link.href = `${backendOrigin}/api/images/${image.id}/download/original`;
    link.download = image.original_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBack = () => {
    // 히스토리가 있으면 뒤로가기, 없으면 갤러리로 이동
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/gallery');
    }
  };

  const truncateFilename = (filename: string, maxLength: number = 50) => {
    if (filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop();
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const truncatedName = nameWithoutExt.substring(0, maxLength - ext!.length - 4) + '...';
    return `${truncatedName}.${ext}`;
  };

  if (loading) {
    return (
      <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Skeleton variant="circular" width={40} height={40} />
          <Skeleton variant="text" width={200} height={40} />
        </Box>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Skeleton variant="rectangular" height={600} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Skeleton variant="rectangular" height={600} />
          </Grid>
        </Grid>
      </Box>
    );
  }

  if (error || !image) {
    return (
      <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={handleBack}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">{t('imageDetail:page.title')}</Typography>
        </Box>
        <Alert severity="error">
          {error || t('imageDetail:page.notFound')}
        </Alert>
      </Box>
    );
  }

  // API 엔드포인트를 통해 이미지 제공 (외부 네트워크 접근 보장)
  const imageUrl = image ? `${backendOrigin}/api/images/${image.id}/optimized` : '';
  const fallbackUrl = image ? `${backendOrigin}/api/images/${image.id}/download/original` : '';

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* 헤더 */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={handleBack}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t('imageDetail:page.title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* <Tooltip title={t('imageDetail:actions.share')}>
            <IconButton onClick={handleShare}>
              <ShareIcon />
            </IconButton>
          </Tooltip> */}
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
          >
            {t('imageDetail:actions.download')}
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* 1열: 이미지, 파일정보, 이미지정보 */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* 이미지/비디오 영역 */}
            <Paper sx={{ p: 2, borderRadius: 2 }}>
              {image.mime_type?.startsWith('video/') ? (
                <Box
                  component="video"
                  src={imageError ? fallbackUrl : imageUrl}
                  controls
                  onError={() => setImageError(true)}
                  sx={{
                    width: '100%',
                    height: 'auto',
                    maxHeight: '80vh',
                    borderRadius: 1,
                  }}
                />
              ) : (
                <Box
                  component="img"
                  src={imageError ? fallbackUrl : imageUrl}
                  alt={image.original_name}
                  onError={() => setImageError(true)}
                  sx={{
                    width: '100%',
                    height: 'auto',
                    maxHeight: '80vh',
                    objectFit: 'contain',
                    borderRadius: 1,
                  }}
                />
              )}
            </Paper>

            {/* 파일명 영역 */}
            <Paper sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="h6" gutterBottom>
                {t('imageDetail:sections.fileInfo')}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                title={image.original_name}
                sx={{ mb: 1 }}
              >
                {t('imageDetail:fileInfo.originalFilename')}: {truncateFilename(image.original_name)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('imageDetail:fileInfo.filename')}: {image.filename}
              </Typography>
            </Paper>

            {/* 이미지/비디오 정보 영역 */}
            <Paper sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="h6" gutterBottom>
                {image.mime_type?.startsWith('video/') ? t('imageDetail:sections.videoInfo') : t('imageDetail:sections.imageInfo')}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="body2">
                  <strong>{t('imageDetail:fileInfo.size')}:</strong> {image.width} × {image.height}
                </Typography>
                <Typography variant="body2">
                  <strong>{t('imageDetail:fileInfo.fileSize')}:</strong> {formatFileSize(image.file_size)}
                </Typography>
                <Typography variant="body2">
                  <strong>{t('imageDetail:fileInfo.mimeType')}:</strong> {image.mime_type}
                </Typography>

                {/* 비디오 전용 메타데이터 */}
                {image.mime_type?.startsWith('video/') && (
                  <>
                    {image.duration && (
                      <Typography variant="body2">
                        <strong>{t('imageDetail:videoInfo.duration')}:</strong> {t('imageDetail:videoInfo.durationValue', {
                          minutes: Math.floor(image.duration / 60),
                          seconds: Math.floor(image.duration % 60)
                        })}
                      </Typography>
                    )}
                    {image.fps && (
                      <Typography variant="body2">
                        <strong>{t('imageDetail:videoInfo.fps')}:</strong> {t('imageDetail:videoInfo.fpsValue', { fps: image.fps.toFixed(2) })}
                      </Typography>
                    )}
                    {image.video_codec && (
                      <Typography variant="body2">
                        <strong>{t('imageDetail:videoInfo.videoCodec')}:</strong> {image.video_codec}
                      </Typography>
                    )}
                    {image.audio_codec && (
                      <Typography variant="body2">
                        <strong>{t('imageDetail:videoInfo.audioCodec')}:</strong> {image.audio_codec}
                      </Typography>
                    )}
                    {image.bitrate && (
                      <Typography variant="body2">
                        <strong>{t('imageDetail:videoInfo.bitrate')}:</strong> {t('imageDetail:videoInfo.bitrateValue', { bitrate: (image.bitrate / 1000).toFixed(2) })}
                      </Typography>
                    )}
                  </>
                )}

                <Typography variant="body2">
                  <strong>{t('imageDetail:fileInfo.uploadDate')}:</strong> {formatDate(image.upload_date)}
                </Typography>
              </Box>
            </Paper>

            {/* 그룹 정보 영역 */}
            {image.groups && image.groups.length > 0 && (
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom>
                  {t('imageDetail:sections.groupInfo')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {image.groups.map((group) => (
                    <Chip
                      key={group.id}
                      label={t('imageDetail:groupInfo.groupLabel', {
                        name: group.name,
                        type: group.collection_type === 'auto' ? t('imageDetail:groupInfo.autoType') : t('imageDetail:groupInfo.manualType')
                      })}
                      size="small"
                      variant="filled"
                      sx={{
                        backgroundColor: group.color || (group.collection_type === 'auto' ? '#e3f2fd' : '#f3e5f5'),
                        color: group.color ? '#fff' : (group.collection_type === 'auto' ? '#1976d2' : '#7b1fa2'),
                      }}
                    />
                  ))}
                </Box>
              </Paper>
            )}
        </Box>
        </Grid>

        {/* 2열: AI생성정보, 프롬프트정보 */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 325 }}>
            {/* AI 생성 정보 영역 */}
            {image.ai_metadata && (
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom>
                  {t('imageDetail:sections.aiInfo')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {image.ai_metadata.ai_tool && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.tool')}:</strong> {image.ai_metadata.ai_tool}
                    </Typography>
                  )}
                  {image.ai_metadata.model_name && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.model')}:</strong> {image.ai_metadata.model_name}
                    </Typography>
                  )}
                  {image.ai_metadata.lora_models && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.lora')}:</strong> {JSON.stringify(image.ai_metadata.lora_models)}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.steps && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.steps')}:</strong> {image.ai_metadata.generation_params.steps}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.cfg_scale && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.cfgScale')}:</strong> {image.ai_metadata.generation_params.cfg_scale}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.sampler && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.sampler')}:</strong> {image.ai_metadata.generation_params.sampler}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.scheduler && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.scheduler')}:</strong> {image.ai_metadata.generation_params.scheduler}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.seed && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.seed')}:</strong> {image.ai_metadata.generation_params.seed}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.denoise_strength && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.denoiseStrength')}:</strong> {image.ai_metadata.generation_params.denoise_strength}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.generation_time && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.generationTime')}:</strong> {t('imageDetail:aiInfo.generationTimeValue', { time: image.ai_metadata.generation_params.generation_time })}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.batch_size && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.batchSize')}:</strong> {image.ai_metadata.generation_params.batch_size}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.batch_index && (
                    <Typography variant="body2">
                      <strong>{t('imageDetail:aiInfo.batchIndex')}:</strong> {image.ai_metadata.generation_params.batch_index}
                    </Typography>
                  )}
                </Box>
              </Paper>
            )}

            {/* 프롬프트 영역 */}
            {(image.ai_metadata && (image.ai_metadata.prompts.prompt || image.ai_metadata.prompts.negative_prompt)) || isTaggerEnabled ? (
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom>
                  {t('imageDetail:sections.promptInfo')}
                </Typography>
                <PromptDisplay
                  prompt={image.ai_metadata?.prompts.prompt}
                  negativePrompt={image.ai_metadata?.prompts.negative_prompt}
                  maxHeight={800}
                  variant="none"
                  imageId={image.id}
                  autoTags={image.auto_tags}
                  isTaggerEnabled={isTaggerEnabled}
                  onAutoTagGenerated={handleAutoTagGenerated}
                />
              </Paper>
            ) : null}
        </Box>
        </Grid>
      </Grid>

      {/* 전체 메타데이터 섹션 */}
      <Box sx={{ mt: 3 }}>
        <Accordion defaultExpanded={false}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="metadata-content"
            id="metadata-header"
          >
            <Typography variant="h6">{t('imageDetail:sections.fullMetadata')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box
              component="pre"
              sx={{
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                maxHeight: '750px',
                fontSize: '0.875rem',
              }}
            >
              {JSON.stringify(image, null, 2)}
            </Box>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Box>
  );
};

export default ImageDetailPage;
