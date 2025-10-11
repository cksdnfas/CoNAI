import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Skeleton,
  Alert,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  ArrowBack as ArrowBackIcon,
  Download as DownloadIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { imageApi } from '../../services/api';
import type { ImageRecord } from '../../types/image';
import { buildUploadsUrl, ensureAbsoluteUrl, getBackendOrigin } from '../../utils/backend';
import PromptDisplay from '../../components/PromptDisplay';
import { settingsApi } from '../../services/settingsApi';

const ImageDetailPage: React.FC = () => {
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
        setError('이미지 ID가 제공되지 않았습니다.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await imageApi.getImage(parseInt(id));

        if (response.success && response.data) {
          setImage(response.data);
        } else {
          setError(response.error || '이미지를 찾을 수 없습니다.');
        }
      } catch (err) {
        setError('이미지를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [id]);

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

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `이미지: ${image?.original_name}`,
          url: window.location.href,
        });
      } catch (err) {
        // 사용자가 공유를 취소했거나 오류 발생
      }
    } else {
      // Fallback: 클립보드에 URL 복사
      navigator.clipboard.writeText(window.location.href);
      alert('URL이 클립보드에 복사되었습니다.');
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
          <IconButton onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">이미지 상세 정보</Typography>
        </Box>
        <Alert severity="error">
          {error || '이미지를 찾을 수 없습니다.'}
        </Alert>
      </Box>
    );
  }

  const imageUrl = image ? (ensureAbsoluteUrl(image.image_url) || buildUploadsUrl(image.file_path)) : '';
  const fallbackUrl = image ? buildUploadsUrl(image.file_path) : '';

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* 헤더 */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ flex: 1 }}>
          이미지 상세 정보
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="공유">
            <IconButton onClick={handleShare}>
              <ShareIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
          >
            다운로드
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* 이미지 영역 */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
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
          </Paper>
        </Grid>

        {/* 상세 정보 영역 */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* 파일명 영역 */}
            <Paper sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="h6" gutterBottom>
                파일 정보
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                title={image.original_name}
                sx={{ mb: 1 }}
              >
                원본 파일명: {truncateFilename(image.original_name)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                파일명: {image.filename}
              </Typography>
            </Paper>

            {/* 이미지 정보 영역 */}
            <Paper sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="h6" gutterBottom>
                이미지 정보
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="body2">
                  <strong>크기:</strong> {image.width} × {image.height}
                </Typography>
                <Typography variant="body2">
                  <strong>파일 크기:</strong> {formatFileSize(image.file_size)}
                </Typography>
                <Typography variant="body2">
                  <strong>MIME 타입:</strong> {image.mime_type}
                </Typography>
                <Typography variant="body2">
                  <strong>업로드 날짜:</strong> {formatDate(image.upload_date)}
                </Typography>
              </Box>
            </Paper>

            {/* 그룹 정보 영역 */}
            {image.groups && image.groups.length > 0 && (
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom>
                  소속 그룹
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {image.groups.map((group) => (
                    <Chip
                      key={group.id}
                      label={`${group.name} (${group.collection_type === 'auto' ? '자동' : '수동'})`}
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

            {/* AI 생성 정보 영역 */}
            {image.ai_metadata && (
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom>
                  AI 생성 정보
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {image.ai_metadata.ai_tool && (
                    <Typography variant="body2">
                      <strong>AI 도구:</strong> {image.ai_metadata.ai_tool}
                    </Typography>
                  )}
                  {image.ai_metadata.model_name && (
                    <Typography variant="body2">
                      <strong>모델:</strong> {image.ai_metadata.model_name}
                    </Typography>
                  )}
                  {image.ai_metadata.lora_models && (
                    <Typography variant="body2">
                      <strong>LoRA:</strong> {JSON.stringify(image.ai_metadata.lora_models)}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.steps && (
                    <Typography variant="body2">
                      <strong>스텝:</strong> {image.ai_metadata.generation_params.steps}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.cfg_scale && (
                    <Typography variant="body2">
                      <strong>CFG Scale:</strong> {image.ai_metadata.generation_params.cfg_scale}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.sampler && (
                    <Typography variant="body2">
                      <strong>샘플러:</strong> {image.ai_metadata.generation_params.sampler}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.scheduler && (
                    <Typography variant="body2">
                      <strong>스케줄러:</strong> {image.ai_metadata.generation_params.scheduler}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.seed && (
                    <Typography variant="body2">
                      <strong>시드:</strong> {image.ai_metadata.generation_params.seed}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.denoise_strength && (
                    <Typography variant="body2">
                      <strong>디노이즈 강도:</strong> {image.ai_metadata.generation_params.denoise_strength}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.generation_time && (
                    <Typography variant="body2">
                      <strong>생성 시간:</strong> {image.ai_metadata.generation_params.generation_time}초
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.batch_size && (
                    <Typography variant="body2">
                      <strong>배치 크기:</strong> {image.ai_metadata.generation_params.batch_size}
                    </Typography>
                  )}
                  {image.ai_metadata.generation_params.batch_index && (
                    <Typography variant="body2">
                      <strong>배치 인덱스:</strong> {image.ai_metadata.generation_params.batch_index}
                    </Typography>
                  )}
                </Box>
              </Paper>
            )}

            {/* 프롬프트 영역 */}
            {(image.ai_metadata && (image.ai_metadata.prompts.prompt || image.ai_metadata.prompts.negative_prompt)) || isTaggerEnabled ? (
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom>
                  프롬프트 정보
                </Typography>
                <PromptDisplay
                  prompt={image.ai_metadata?.prompts.prompt}
                  negativePrompt={image.ai_metadata?.prompts.negative_prompt}
                  maxHeight={400}
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
    </Box>
  );
};

export default ImageDetailPage;
