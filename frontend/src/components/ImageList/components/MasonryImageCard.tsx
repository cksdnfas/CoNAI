import React, { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import { Card, CardMedia, Box, Skeleton, Chip, Typography, IconButton, Tooltip } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  VideoLibrary as VideoLibraryIcon,
  HourglassEmpty as HourglassIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';
import { getBackendOrigin } from '../../../utils/backend';
import RatingBadge from '../../RatingBadge/RatingBadge';
import { useRatingTiers } from '../../../hooks/useRatingTiers';
import { useCardWidth } from '../../../hooks/useCardWidth';

// ✅ composite_hash 기반으로 변경
interface MasonryImageCardProps {
  image: ImageRecord;
  onClick: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (id: number, event?: React.MouseEvent) => void;  // ✅ image_files.id
  onDelete?: (compositeHash: string) => void;
  minimal?: boolean; // Deprecated but kept for compatibility logic if needed, usually ignored now
  fitScreen?: boolean;
}

const MasonryImageCard: React.FC<MasonryImageCardProps> = ({
  image,
  onClick,
  selected = false,
  selectable = false,
  onSelectionChange,
  onDelete,
  minimal = false, // We use responsive logic now, but can use this as a hint or override if needed
  fitScreen = false,
}) => {
  const { t } = useTranslation(['common']);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Responsive width detection
  const { ref: resizeRef, isSmall } = useCardWidth(200);

  // Combine refs (one for intersection observer/logic, one for resize observer)
  const cardRef = useRef<HTMLDivElement>(null);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    (resizeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [resizeRef]);

  const backendOrigin = getBackendOrigin();
  const { getTierByScore } = useRatingTiers();

  // Get rating tier for this image
  const ratingTier = useMemo(() => {
    const tier = getTierByScore(image.rating_score);
    return tier;
  }, [image.rating_score, image.composite_hash, image.auto_tags, getTierByScore]);
  // ✅ composite_hash 사용 - API 엔드포인트를 통해 썸네일 제공 (외부 네트워크 접근 보장)
  // GIF는 애니메이션 보존을 위해 원본 사용 (file_type='animated')
  const isGif = image.file_type === 'animated';
  const isVideo = image.file_type === 'video';
  const isProcessing = image.is_processing || !image.composite_hash;

  const imageUrl = useMemo(() => {
    if (isProcessing) {
      return `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`;
    }
    // 비디오와 GIF는 원본 파일 사용 (애니메이션/재생 보존)
    if (isVideo || isGif) {
      const url = `${backendOrigin}/api/images/${image.composite_hash}/file`;
      return url;
    }
    // 일반 이미지는 썸네일 사용
    // 캐시 무효화: thumbnail_path가 있으면 타임스탬프 추가하여 브라우저가 새 썸네일을 로드하도록 함
    const cacheBuster = image.thumbnail_path ? `?v=${Date.parse(image.first_seen_date)}` : '';
    return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail${cacheBuster}`;
  }, [isProcessing, isGif, isVideo, backendOrigin, image.composite_hash, image.original_file_path, image.mime_type, image.thumbnail_path, image.first_seen_date]);

  const handleSelectionChange = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelectionChange && image.id) {
      onSelectionChange(image.id, e);
    }
  }, [onSelectionChange, image.id, selectable]);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // 체크박스 클릭이면 무시
    if ((e.target as HTMLElement).closest('.image-card-actions')) {
      return;
    }
    onClick();
  }, [onClick]);

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

  // 이미지 aspect ratio 계산 (레이아웃 시프트 방지)
  const aspectRatio = useMemo(() => {
    return image.width && image.height
      ? image.width / image.height
      : 1;
  }, [image.width, image.height]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  // Intersection Observer로 뷰포트 진입 감지 (200px 전에 미리 로드)
  useEffect(() => {
    if (!cardRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '200px', // 200px 전에 미리 로드 시작
      }
    );

    observer.observe(cardRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  const imageStyle = fitScreen ? {
    width: 'auto',
    maxWidth: '100%',
    height: 'auto',
    maxHeight: '85vh',
    display: 'block',
    margin: '0 auto',
    objectFit: 'contain' as const,
  } : {
    // Masonry default behavior: 100% width, auto height
    width: '100%',
    height: 'auto',
    display: 'block',
  };

  return (
    <Card
      ref={setRefs}
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      sx={{
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        position: 'relative',
        border: selected ? 3 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 6,
        },
        // Fit Screen Center Content
        ...(fitScreen && {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.paper',
          minHeight: '200px', // Minimum height just in case
        }),
      }}
    >
      {/* 선택 체크박스/아이콘 - minimal mode에서는 선택된 경우에만 표시하거나 hover 시 표시 */}
      {selectable && (!isSmall || isHovered || selected) && (
        <Box
          className="image-card-actions"
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            opacity: isHovered || selected ? 1 : (isSmall ? 0 : 0.3),
            transition: 'opacity 0.2s ease-in-out',
          }}
          onClick={handleSelectionChange}
        >
          {selected ? (
            <CheckCircleIcon
              sx={{
                fontSize: isSmall ? 24 : 32,
                color: 'primary.main',
                bgcolor: 'white',
                borderRadius: '50%',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
              }}
            />
          ) : (
            <Box
              sx={{
                width: isSmall ? 24 : 32,
                height: isSmall ? 24 : 32,
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

      <Box
        sx={{
          position: 'relative',
          width: '100%',
          overflow: 'hidden',
          bgcolor: 'transparent',
        }}
      >
        {/* Skeleton 로딩 표시 */}
        {!imageLoaded && (
          <Skeleton
            variant="rectangular"
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              minHeight: '200px',
            }}
          />
        )}

        {/* 이미지/비디오 - 뷰포트에 들어왔을 때만 로드 */}
        {isVisible && (
          isVideo ? (
            <Box
              component="video"
              src={imageUrl}
              muted
              loop
              autoPlay
              playsInline
              onLoadedData={handleImageLoad}
              sx={{
                ...imageStyle,
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.15s ease-in-out',
              }}
            />
          ) : isGif ? (
            <CardMedia
              component="img"
              image={imageUrl}
              alt={image.original_file_path || 'Image'}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={handleImageLoad}
              sx={{
                ...imageStyle,
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.15s ease-in-out',
              }}
            />
          ) : (
            <CardMedia
              component="img"
              image={imageUrl}
              alt={image.original_file_path || 'Image'}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={handleImageLoad}
              sx={{
                ...imageStyle,
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.15s ease-in-out',
              }}
            />
          )
        )}
      </Box>

      {/* Prrompt Overlay - Hide in small mode */}
      {image.prompt && isHovered && !isSmall && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            bgcolor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(4px)',
            p: 1,
            maxHeight: '80px',
            overflow: 'hidden',
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: 'white',
              fontSize: '0.7rem',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {image.prompt}
          </Typography>
        </Box>
      )}

      {/* Badges Container - Top Right - Hide in small mode */}
      {!isSmall && (
        <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1, display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
          {/* Action Buttons (Download/Delete) - Moved to Top Right (Unified) */}
          <Box className="image-card-actions" sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('common:imageCard.tooltips.download')}>
              <IconButton
                size="small"
                onClick={handleDownload}
                sx={{
                  bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(0, 0, 0, 0.6)'
                    : 'rgba(255, 255, 255, 0.8)',
                  borderRadius: 1,
                  display: isHovered || selected ? 'flex' : 'none',
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
                    display: isHovered || selected ? 'flex' : 'none',
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

          {/* Processing Badge */}
          {image.is_processing && (
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
          )}
        </Box>
      )}

      {/* Video Duration Badge - Bottom Left - Hide in small mode */}
      {isVideo && image.duration && !isSmall && (
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

      {/* AI Tool Badge - Moved to Bottom Left to match Grid */}
      {image.ai_tool && !isSmall && !isVideo && (
        <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1 }}>
          <Chip
            label={image.ai_tool}
            size="small"
            sx={{
              fontSize: '0.7rem',
              height: '22px',
              fontWeight: 600,
              bgcolor: 'rgba(25, 118, 210, 0.9)',
              color: 'white',
              backdropFilter: 'blur(4px)',
            }}
          />
        </Box>
      )}

      {/* Rating Badge - Bottom Right - Hide in small mode */}
      {ratingTier && image.rating_score !== null && image.rating_score !== undefined && !isSmall && (
        <Box sx={{ position: 'absolute', bottom: 8, right: 8, zIndex: 1 }}>
          <RatingBadge tier={ratingTier} score={image.rating_score} />
        </Box>
      )}
    </Card>
  );
};

export default memo(MasonryImageCard);
