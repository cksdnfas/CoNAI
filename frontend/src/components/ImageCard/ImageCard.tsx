import React, { useState, useCallback, useMemo, memo } from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  Box,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Info as InfoIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  AutoAwesome as AutoAwesomeIcon,
  CheckCircle as CheckCircleIcon,
  VideoLibrary as VideoLibraryIcon,
  HourglassEmpty as HourglassIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../types/image';
import { getBackendOrigin } from '../../utils/backend';

// ✅ composite_hash 기반으로 변경
interface ImageCardProps {
  image: ImageRecord;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (compositeHash: string, event?: React.MouseEvent) => void;  // composite_hash
  onDelete?: (compositeHash: string) => void;  // composite_hash
  onImageClick?: () => void;
  showCollectionType?: boolean; // 그룹 모달에서만 collection_type 표시
  currentGroupId?: number; // 현재 그룹 ID (collection_type 표시용)
}

const ImageCard: React.FC<ImageCardProps> = ({
  image,
  selected = false,
  selectable = false,
  onSelectionChange,
  onDelete,
  onImageClick,
  showCollectionType = false,
  currentGroupId,
}) => {
  const { t } = useTranslation(['common']);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const backendOrigin = getBackendOrigin();

  // 현재 그룹의 collection_type 찾기
  const currentGroupInfo = currentGroupId
    ? image.groups?.find(g => g.id === currentGroupId)
    : null;
  const isAutoCollected = currentGroupInfo?.collection_type === 'auto';

  // ✅ composite_hash 사용 (NULL 처리 포함)
  const handleSelectionClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 이벤트 전파 방지
    if (onSelectionChange && image.composite_hash) {
      onSelectionChange(image.composite_hash, e);
    }
  }, [onSelectionChange, image.composite_hash]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 이벤트 전파 방지
    const link = document.createElement('a');

    // Phase 1: composite_hash가 없으면 경로 기반 다운로드
    if (image.is_processing || !image.composite_hash) {
      link.href = `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`;
    } else {
      link.href = `${backendOrigin}/api/images/${image.composite_hash}/download/original`;
    }

    link.download = image.original_file_path || `image_${image.composite_hash?.substring(0, 8) || 'unknown'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [backendOrigin, image.is_processing, image.composite_hash, image.original_file_path]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 이벤트 전파 방지
    const isVideo = image.mime_type?.startsWith('video/');
    const confirmMessage = isVideo
      ? t('common:imageCard.confirmDelete.video')
      : t('common:imageCard.confirmDelete.image');
    if (onDelete && image.composite_hash && window.confirm(confirmMessage)) {
      onDelete(image.composite_hash);
    }
  }, [onDelete, image.composite_hash, image.mime_type, t]);

  const handleInfoClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 이벤트 전파 방지
    if (image.composite_hash) {
      window.open(`/#/image/${image.composite_hash}`, '_blank');
    }
  }, [image.composite_hash]);

  // ✅ composite_hash 사용 - API 엔드포인트를 통해 썸네일 및 원본 이미지 제공
  // Phase 1: composite_hash가 NULL이면 경로 기반 URL 사용
  // GIF는 애니메이션 보존을 위해 원본 사용 (file_type='animated')
  // file_type 우선 확인 (백엔드에서 정확히 분류됨)
  const isGif = image.file_type === 'animated' || image.mime_type === 'image/gif' || image.mime_type === 'video/gif';
  const isVideo = image.file_type === 'video' || (image.mime_type?.startsWith('video/') && image.file_type !== 'animated');
  const isProcessing = image.is_processing || !image.composite_hash;

  const thumbnailUrl = useMemo(() => {
    if (isProcessing) {
      return `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`;
    }
    // GIF와 비디오는 원본 파일 사용
    // 모든 파일 타입이 composite_hash를 사용
    if (isGif || isVideo) {
      const url = `${backendOrigin}/api/images/${image.composite_hash}/file`;
      console.log('[ImageCard] GIF/Video URL:', url, 'mime_type:', image.mime_type, 'composite_hash:', image.composite_hash, 'isGif:', isGif, 'isVideo:', isVideo);
      return url;
    }
    // 일반 이미지는 썸네일 사용
    // 캐시 무효화: thumbnail_path가 있으면 타임스탬프 추가하여 브라우저가 새 썸네일을 로드하도록 함
    const cacheBuster = image.thumbnail_path ? `?v=${Date.parse(image.first_seen_date)}` : '';
    return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail${cacheBuster}`;
  }, [isProcessing, isGif, isVideo, backendOrigin, image.composite_hash, image.original_file_path, image.mime_type, image.thumbnail_path, image.first_seen_date]);

  const fallbackUrl = useMemo(() => {
    if (isProcessing) {
      return `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`;
    }
    // GIF/비디오는 경로 기반 폴백 사용 (download는 attachment 헤더 때문에 표시 안됨)
    if (isGif || isVideo) {
      return image.original_file_path
        ? `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path)}`
        : `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`;
    }
    return `${backendOrigin}/api/images/${image.composite_hash}/download/original`;
  }, [isProcessing, isGif, isVideo, backendOrigin, image.composite_hash, image.original_file_path]);

  return (
    <>
      <Card
        className={selectable ? 'selectable-image' : ''}
        data-image-id={image.composite_hash}
        data-selectable={selectable}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        sx={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          border: selected ? 3 : (showCollectionType && isAutoCollected ? 2 : 1),
          borderColor: selected
            ? 'primary.main'
            : (showCollectionType && isAutoCollected ? 'info.light' : 'divider'),
          borderStyle: (showCollectionType && isAutoCollected) ? 'dashed' : 'solid',
          borderRadius: 2,
          transition: 'all 0.3s ease',
          '&:hover': {
            boxShadow: 8,
            transform: 'translateY(-2px)',
          },
        }}
      >
        {/* 선택 체크박스/아이콘 - selectable일 때 항상 표시 */}
        {selectable && (
          <Box
            className="image-card-actions"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 2,
              opacity: isHovered || selected ? 1 : 0.3,
              transition: 'opacity 0.2s ease-in-out',
            }}
            onClick={handleSelectionClick}
          >
            {selected ? (
              <CheckCircleIcon
                sx={{
                  fontSize: 32,
                  color: 'primary.main',
                  bgcolor: 'white',
                  borderRadius: '50%',
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
                }}
              />
            ) : (
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: '2px solid white',
                  bgcolor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    bgcolor: 'rgba(0, 0, 0, 0.7)',
                    transform: 'scale(1.1)',
                  },
                }}
              />
            )}
          </Box>
        )}

        {/* 선택 오버레이 */}
        {selected && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              bgcolor: 'rgba(33, 150, 243, 0.15)',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* 자동수집 배지 */}
        {showCollectionType && isAutoCollected && (
          <Box sx={{ position: 'absolute', top: selectable ? 54 : 8, left: 8, zIndex: 1 }}>
            <Chip
              icon={<AutoAwesomeIcon sx={{ fontSize: '0.9rem' }} />}
              label={t('common:imageCard.badges.auto')}
              size="small"
              color="info"
              sx={{
                fontSize: '0.7rem',
                height: '24px',
                fontWeight: 600,
                bgcolor: (theme) => theme.palette.mode === 'dark'
                  ? 'rgba(33, 150, 243, 0.8)'
                  : 'rgba(33, 150, 243, 0.9)',
                color: 'white',
                '& .MuiChip-icon': {
                  color: 'white',
                },
              }}
            />
          </Box>
        )}

        {/* Phase 1 처리 중 배지 */}
        {image.is_processing && (
          <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
            <Chip
              icon={<HourglassIcon sx={{ fontSize: '0.8rem' }} />}
              label="Processing"
              size="small"
              sx={{
                fontSize: '0.7rem',
                height: '22px',
                fontWeight: 600,
                bgcolor: 'rgba(255, 152, 0, 0.9)',
                color: 'white',
                backdropFilter: 'blur(4px)',
                '& .MuiChip-icon': {
                  color: 'white',
                },
              }}
            />
          </Box>
        )}

        {/* 비디오 배지 (재생 시간 표시) */}
        {image.mime_type?.startsWith('video/') && image.duration && (
          <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1 }}>
            <Chip
              icon={<VideoLibraryIcon sx={{ fontSize: '0.8rem' }} />}
              label={`${Math.floor(image.duration / 60)}:${String(Math.floor(image.duration % 60)).padStart(2, '0')}`}
              size="small"
              sx={{
                fontSize: '0.7rem',
                height: '22px',
                fontWeight: 600,
                bgcolor: 'rgba(0, 0, 0, 0.75)',
                color: 'white',
                backdropFilter: 'blur(4px)',
                '& .MuiChip-icon': {
                  color: 'white',
                },
              }}
            />
          </Box>
        )}

        <Box className="image-card-actions" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('common:imageCard.tooltips.viewDetails')}>
              <IconButton
                size="small"
                onClick={handleInfoClick}
                sx={{
                  bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(0, 0, 0, 0.6)'
                    : 'rgba(255, 255, 255, 0.8)',
                  borderRadius: 1,
                  '&:hover': {
                    bgcolor: (theme) => theme.palette.mode === 'dark'
                      ? 'rgba(0, 0, 0, 0.8)'
                      : 'rgba(255, 255, 255, 0.9)',
                  },
                }}
              >
                <InfoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('common:imageCard.tooltips.download')}>
              <IconButton
                size="small"
                onClick={handleDownload}
                sx={{
                  bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(0, 0, 0, 0.6)'
                    : 'rgba(255, 255, 255, 0.8)',
                  borderRadius: 1,
                  '&:hover': {
                    bgcolor: (theme) => theme.palette.mode === 'dark'
                      ? 'rgba(0, 0, 0, 0.8)'
                      : 'rgba(255, 255, 255, 0.9)',
                  },
                }}
              >
                <DownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {onDelete && (
              <Tooltip title={t('common:imageCard.tooltips.delete')}>
                <IconButton
                  size="small"
                  onClick={handleDelete}
                  sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark'
                      ? 'rgba(0, 0, 0, 0.6)'
                      : 'rgba(255, 255, 255, 0.8)',
                    borderRadius: 1,
                    '&:hover': {
                      bgcolor: (theme) => theme.palette.mode === 'dark'
                        ? 'rgba(0, 0, 0, 0.8)'
                        : 'rgba(255, 255, 255, 0.9)',
                    },
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* 비디오인 경우 video 태그, GIF와 이미지는 img 태그 */}
        {isVideo ? (
          <Box
            component="video"
            height="250"
            src={thumbnailUrl}
            muted
            loop
            autoPlay
            playsInline
            onError={(e) => {
              console.error('[ImageCard] Video load error:', thumbnailUrl, e);
              setImageError(true);
            }}
            sx={{
              width: '100%',
              objectFit: 'cover',
              cursor: 'pointer',
            }}
            onClick={onImageClick}
          />
        ) : (
          <CardMedia
            component="img"
            height="250"
            image={imageError ? fallbackUrl : thumbnailUrl}
            alt={image.original_file_path ?? ''}
            draggable={false}
            onError={(e) => {
              console.error('[ImageCard] Image load error:', imageError ? fallbackUrl : thumbnailUrl, 'isGif:', isGif, 'mime_type:', image.mime_type, e);
              setImageError(true);
            }}
            sx={{
              objectFit: 'cover',
              cursor: 'pointer',
            }}
            onClick={onImageClick}
          />
        )}

        <CardContent sx={{
          flexGrow: 1,
          p: { xs: 1, sm: 1.5 },
          '&:last-child': {
            paddingBottom: { xs: '6px', sm: '8px' }
          }
        }}>
          {/* <Typography
            variant="body2"
            noWrap
            title={image.original_name}
            sx={{
              fontWeight: 500,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
            }}
          >
            {image.original_name}
          </Typography> */}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {/* 그룹 정보 */}
            {image.groups && image.groups.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {image.groups.slice(0, 2).map((group) => (
                  <Chip
                    key={group.id}
                    label={group.name}
                    size="small"
                    variant="filled"
                    sx={{
                      fontSize: { xs: '0.6rem', sm: '0.7rem' },
                      height: { xs: '18px', sm: '20px' },
                      backgroundColor: group.color || (group.collection_type === 'auto' ? '#e3f2fd' : '#f3e5f5'),
                      color: group.color ? '#fff' : (group.collection_type === 'auto' ? '#1976d2' : '#7b1fa2'),
                      '& .MuiChip-label': {
                        px: 0.5,
                      },
                    }}
                  />
                ))}
                {image.groups.length > 2 && (
                  <Chip
                    label={`+${image.groups.length - 2}`}
                    size="small"
                    variant="outlined"
                    sx={{
                      fontSize: { xs: '0.6rem', sm: '0.7rem' },
                      height: { xs: '18px', sm: '20px' },
                    }}
                  />
                )}
              </Box>
            )}

            {/* AI 도구 및 해상도 정보 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {image.ai_tool && (
                <Chip
                  label={image.ai_tool}
                  size="small"
                  variant="outlined"
                  color="primary"
                  sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    height: { xs: '20px', sm: '24px' },
                  }}
                />
              )}
              {image.width && image.height && (
                <Chip
                  label={`${image.width}×${image.height}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    height: { xs: '20px', sm: '24px' },
                  }}
                />
              )}
            </Box>
          </Box>

          {/* <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mt: 1,
              display: 'block',
              fontSize: { xs: '0.7rem', sm: '0.75rem' },
            }}
          >
            {formatFileSize(image.file_size)}
          </Typography> */}
        </CardContent>
      </Card>

    </>
  );
};

export default memo(ImageCard);
