import React, { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react';
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
import RatingBadge from '../RatingBadge/RatingBadge';
import { useRatingTiers } from '../../hooks/useRatingTiers';
import { useCardWidth } from '../../hooks/useCardWidth';

// ✅ composite_hash 기반으로 변경
interface ImageCardProps {
  image: ImageRecord;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (id: number, event?: React.MouseEvent) => void;  // ✅ image_files.id
  onDelete?: (compositeHash: string) => void;  // composite_hash (메타데이터 작업용)
  onImageClick?: () => void;
  showCollectionType?: boolean; // 그룹 모달에서만 collection_type 표시
  currentGroupId?: number; // 현재 그룹 ID (collection_type 표시용)
  minimal?: boolean; // Deprecated, using responsive logic
  fitScreen?: boolean; // 화면 맞춤 모드 (1열 뷰용)
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
  minimal = false,
  fitScreen = false,
}) => {
  const { t } = useTranslation(['common']);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const backendOrigin = getBackendOrigin();
  const { getTierByScore } = useRatingTiers();

  const { ref: resizeRef, isSmall } = useCardWidth(200);
  const cardRef = useRef<HTMLDivElement>(null);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    // We can use this to merge refs if we needed internal ref access, 
    // but here we just need to attach the resize observer.
    (resizeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    // If we needed cardRef locally we would set it here too
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [resizeRef]);


  // Get rating tier for this image
  const ratingTier = useMemo(() => {
    const tier = getTierByScore(image.rating_score);
    // Debug: Log first image only to avoid spam
    if (image.composite_hash && Math.random() < 0.1) {
      console.log('[ImageCard] Rating debug:', {
        has_rating_score: image.rating_score !== null,
        rating_score: image.rating_score,
        tier_found: !!tier,
        tier_name: tier?.tier_name
      });
    }
    return tier;
  }, [image.rating_score, getTierByScore, image.composite_hash]);

  // 현재 그룹의 collection_type 찾기
  const currentGroupInfo = currentGroupId
    ? image.groups?.find(g => g.id === currentGroupId)
    : null;
  const isAutoCollected = currentGroupInfo?.collection_type === 'auto';

  // ✅ id 사용 (중복 이미지 개별 선택 가능)
  const handleSelectionClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 이벤트 전파 방지
    if (onSelectionChange && image.id) {
      onSelectionChange(image.id, e);
    }
  }, [onSelectionChange, image.id]);

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

  // ✅ composite_hash 사용 - API 엔드포인트를 통해 썸네일 및 원본 이미지 제공
  // Phase 1: composite_hash가 NULL이면 경로 기반 URL 사용
  // GIF는 애니메이션 보존을 위해 원본 사용 (file_type='animated')
  const isGif = image.file_type === 'animated';
  const isVideo = image.file_type === 'video';
  const isProcessing = image.is_processing || !image.composite_hash;

  const thumbnailUrl = useMemo(() => {
    if (isProcessing) {
      return `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`;
    }
    // GIF와 비디오는 원본 파일 사용
    // 모든 파일 타입이 composite_hash를 사용
    if (isGif || isVideo) {
      const url = `${backendOrigin}/api/images/${image.composite_hash}/file`;
      // console.log('[ImageCard] GIF/Video URL:', url, 'mime_type:', image.mime_type, 'composite_hash:', image.composite_hash, 'isGif:', isGif, 'isVideo:', isVideo);
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
    // 일반 이미지도 /file 엔드포인트 사용 (download/original은 attachment 헤더로 인해 표시 불가)
    return `${backendOrigin}/api/images/${image.composite_hash}/file`;
  }, [isProcessing, isGif, isVideo, backendOrigin, image.composite_hash, image.original_file_path]);

  // Image Style for fitScreen
  const imageStyle = fitScreen ? {
    width: 'auto',
    maxWidth: '100%',
    height: 'auto',
    maxHeight: '85vh',
    display: 'block',
    margin: '0 auto',
    objectFit: 'contain' as const,
  } : {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  };

  return (
    <>
      <Card
        ref={setRefs}
        className={selectable ? 'selectable-image' : ''}
        data-image-id={image.composite_hash}
        data-selectable={selectable}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        sx={{
          position: 'relative',
          aspectRatio: fitScreen ? 'auto' : '5 / 7',
          overflow: 'hidden',
          border: selected ? 3 : (showCollectionType && isAutoCollected ? 3 : 1),
          borderColor: selected
            ? 'primary.main'
            : (showCollectionType && isAutoCollected
              ? (theme) => theme.palette.mode === 'dark' ? '#42a5f5' : '#1976d2'
              : 'divider'),
          borderStyle: (showCollectionType && isAutoCollected) ? 'dashed' : 'solid',
          borderRadius: 2,
          transition: 'all 0.3s ease',
          boxShadow: (showCollectionType && isAutoCollected)
            ? (theme) => `0 0 8px ${theme.palette.mode === 'dark' ? 'rgba(66, 165, 245, 0.4)' : 'rgba(25, 118, 210, 0.3)'}`
            : 'none',
          '&:hover': {
            boxShadow: (showCollectionType && isAutoCollected)
              ? (theme) => `0 4px 12px ${theme.palette.mode === 'dark' ? 'rgba(66, 165, 245, 0.5)' : 'rgba(25, 118, 210, 0.4)'}, 0 8px 24px rgba(0,0,0,0.2)`
              : 8,
            transform: 'translateY(-2px)',
          },
          // Fit Screen Center Content
          ...(fitScreen && {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            minHeight: '200px', // Prevents collapse if image not loaded yet
          }),
        }}
      >
        {/* 높이 제공용 spacer (aspect ratio 유지) - fitScreen일 때는 제거 */}
        {!fitScreen && <Box sx={{ width: '100%', paddingTop: '140%' /* 7/5 = 140% */ }} />}

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
            onClick={handleSelectionClick}
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

        {/* Phase 1 처리 중 배지 - minimal에서도 보여줄지 고민, 중요하니 보여줌 (작게) */}
        {image.is_processing && !isSmall && (
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

        {/* 비디오 배지 (재생 시간 표시) - Minimal Hide */}
        {image.mime_type?.startsWith('video/') && image.duration && !isSmall && (
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

        {/* Rating 배지 + 자동수집 배지 - Minimal Hide */}
        {(ratingTier || (showCollectionType && isAutoCollected)) && !isSmall && (
          <Box sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            display: 'flex',
            gap: 0.5,
            alignItems: 'center',
            zIndex: 1,
          }}>
            {/* 자동수집 배지 - 왼쪽에 위치 */}
            {showCollectionType && isAutoCollected && (
              <Chip
                icon={<AutoAwesomeIcon sx={{ fontSize: '0.85rem', color: 'white !important' }} />}
                size="small"
                sx={{
                  height: '26px',
                  minWidth: '26px',
                  width: '26px',
                  padding: 0,
                  bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(33, 150, 243, 0.9)'
                    : 'rgba(33, 150, 243, 0.95)',
                  backdropFilter: 'blur(4px)',
                  '& .MuiChip-icon': {
                    margin: 0,
                  },
                  '& .MuiChip-label': {
                    display: 'none',
                  },
                }}
              />
            )}

            {/* Rating 배지 - 오른쪽에 위치 */}
            {ratingTier && image.rating_score !== null && image.rating_score !== undefined && (
              <RatingBadge tier={ratingTier} score={image.rating_score} />
            )}
          </Box>
        )}

        {/* Action Buttons (Download/Delete) - Minimal Hide */}
        {!isSmall && (
          <Box className="image-card-actions" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
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
        )}

        {/* 비디오인 경우 video 태그, GIF와 이미지는 img 태그 - apply imageStyle */}
        {isVideo ? (
          <Box
            component="video"
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
              ...imageStyle,
              cursor: 'pointer',
            }}
            onClick={onImageClick}
          />
        ) : isGif ? (
          <CardMedia
            component="img"
            image={imageError ? fallbackUrl : thumbnailUrl}
            alt={image.original_file_path ?? ''}
            draggable={false}
            onError={(e) => {
              console.error('[ImageCard] Image load error:', imageError ? fallbackUrl : thumbnailUrl, 'isGif:', isGif, 'mime_type:', image.mime_type, e);
              setImageError(true);
            }}
            sx={{
              ...imageStyle,
              cursor: 'pointer',
            }}
            onClick={onImageClick}
          />
        ) : (
          <CardMedia
            component="img"
            image={imageError ? fallbackUrl : thumbnailUrl}
            alt={image.original_file_path ?? ''}
            draggable={false}
            onError={(e) => {
              console.error('[ImageCard] Image load error:', imageError ? fallbackUrl : thumbnailUrl, 'isGif:', isGif, 'mime_type:', image.mime_type, e);
              setImageError(true);
            }}
            sx={{
              ...imageStyle,
              cursor: 'pointer',
            }}
            onClick={onImageClick}
          />
        )}

        {/* 그룹 정보와 AI 도구 정보 - 메인 갤러리에서만 표시 */}
        {!showCollectionType && !isSmall && (
          <Box sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            alignItems: 'center',
            zIndex: 1,
          }}>
            {/* 그룹 정보 */}
            {image.groups && image.groups.length > 0 && (
              <>
                {image.groups.slice(0, 1).map((group) => (
                  <Chip
                    key={group.id}
                    label={group.name}
                    size="small"
                    variant="filled"
                    sx={{
                      fontSize: { xs: '0.6rem', sm: '0.7rem' },
                      height: { xs: '20px', sm: '22px' },
                      maxWidth: '120px',
                      backgroundColor: group.color || (group.collection_type === 'auto' ? '#e3f2fd' : '#f3e5f5'),
                      color: group.color ? '#fff' : (group.collection_type === 'auto' ? '#1976d2' : '#7b1fa2'),
                      backdropFilter: 'blur(4px)',
                      '& .MuiChip-label': {
                        px: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  />
                ))}
                {image.groups.length > 1 && (
                  <Chip
                    label={`+${image.groups.length - 1}`}
                    size="small"
                    variant="outlined"
                    sx={{
                      fontSize: { xs: '0.6rem', sm: '0.7rem' },
                      height: { xs: '20px', sm: '22px' },
                      bgcolor: 'rgba(0, 0, 0, 0.6)',
                      color: 'white',
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                      backdropFilter: 'blur(4px)',
                    }}
                  />
                )}
              </>
            )}

            {/* AI 도구 정보 */}
            {image.ai_tool && (
              <Chip
                label={image.ai_tool}
                size="small"
                variant="outlined"
                sx={{
                  fontSize: { xs: '0.65rem', sm: '0.75rem' },
                  height: { xs: '20px', sm: '22px' },
                  bgcolor: 'rgba(25, 118, 210, 0.9)',
                  color: 'white',
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backdropFilter: 'blur(4px)',
                }}
              />
            )}
          </Box>
        )}
      </Card>

    </>
  );
};

export default memo(ImageCard);
