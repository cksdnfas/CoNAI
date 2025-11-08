import React, { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import { Card, CardMedia, Box, Skeleton, Chip } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  VideoLibrary as VideoLibraryIcon,
  HourglassEmpty as HourglassIcon
} from '@mui/icons-material';
import type { ImageRecord } from '../../types/image';
import { getBackendOrigin } from '../../utils/backend';

// ✅ composite_hash 기반으로 변경
interface MasonryImageCardProps {
  image: ImageRecord;
  onClick: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (id: number, event?: React.MouseEvent) => void;  // ✅ image_files.id
}

const MasonryImageCard: React.FC<MasonryImageCardProps> = ({
  image,
  onClick,
  selected = false,
  selectable = false,
  onSelectionChange
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const backendOrigin = getBackendOrigin();
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
      // console.log('[MasonryImageCard] GIF/Video URL:', url, 'mime_type:', image.mime_type, 'isGif:', isGif, 'isVideo:', isVideo);
      return url;
    }
    // 일반 이미지는 썸네일 사용
    // 캐시 무효화: thumbnail_path가 있으면 타임스탬프 추가하여 브라우저가 새 썸네일을 로드하도록 함
    const cacheBuster = image.thumbnail_path ? `?v=${Date.parse(image.first_seen_date)}` : '';
    return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail${cacheBuster}`;
  }, [isProcessing, isGif, isVideo, backendOrigin, image.composite_hash, image.original_file_path, image.mime_type, image.thumbnail_path, image.first_seen_date]);

  const handleSelectionChange = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[MasonryImageCard] Selection clicked:', {
      imageId: image.id,
      hasCallback: !!onSelectionChange,
      selectable
    });
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

  return (
    <Card
      ref={cardRef}
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
            opacity: isHovered || selected ? 1 : 0.3, // 항상 표시하되 투명도로 구분
            transition: 'opacity 0.2s ease-in-out',
          }}
          onClick={handleSelectionChange}
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

      <Box
        sx={{
          position: 'relative',
          width: '100%',
          // 동영상/GIF는 자연 높이 사용, 이미지는 padding-top으로 aspect ratio 유지
          ...(isVideo || isGif ? {} : { paddingTop: `${(1 / aspectRatio) * 100}%` }),
          overflow: 'hidden',
          bgcolor: 'grey.200',
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
                // 동영상은 자연 높이 사용 (원본 비율 유지)
                width: '100%',
                height: 'auto',
                display: 'block',
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
                // GIF는 자연 높이 사용 (원본 비율 유지)
                width: '100%',
                height: 'auto',
                display: 'block',
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
                // 일반 이미지는 absolute positioning으로 aspect ratio 컨테이너 채우기
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.15s ease-in-out',
              }}
            />
          )
        )}
      </Box>

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
      {isVideo && image.duration && (
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
    </Card>
  );
};

export default memo(MasonryImageCard);
