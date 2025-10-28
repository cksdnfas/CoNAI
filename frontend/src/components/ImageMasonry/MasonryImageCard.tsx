import React, { useState, useEffect, useRef } from 'react';
import { Card, CardMedia, Box, Skeleton, Chip } from '@mui/material';
import { CheckCircle as CheckCircleIcon, VideoLibrary as VideoLibraryIcon } from '@mui/icons-material';
import type { ImageRecord } from '../../types/image';
import { getBackendOrigin } from '../../utils/backend';

// ✅ composite_hash 기반으로 변경
interface MasonryImageCardProps {
  image: ImageRecord;
  onClick: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (compositeHash: string, event?: React.MouseEvent) => void;
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
  // GIF는 애니메이션 보존을 위해 원본 사용
  const isGif = image.mime_type === 'image/gif';
  const imageUrl = isGif
    ? `${backendOrigin}/api/images/${image.composite_hash}/optimized` // GIF optimized는 원본 복사본
    : `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`;

  const handleSelectionChange = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelectionChange) {
      onSelectionChange(image.composite_hash, e);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // 체크박스 클릭이면 무시
    if ((e.target as HTMLElement).closest('.image-card-actions')) {
      return;
    }
    onClick();
  };

  // 이미지 aspect ratio 계산 (레이아웃 시프트 방지)
  const aspectRatio = image.width && image.height
    ? image.width / image.height
    : 1;

  // Intersection Observer로 뷰포트 진입 감지
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
        rootMargin: '50px', // 50px 전에 미리 로드 시작
      }
    );

    observer.observe(cardRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

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
          paddingTop: `${(1 / aspectRatio) * 100}%`,
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
          image.mime_type?.startsWith('video/') ? (
            <Box
              component="video"
              src={imageUrl}
              muted
              loop
              autoPlay
              playsInline
              onLoadedData={handleImageLoad}
              sx={{
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
    </Card>
  );
};

export default MasonryImageCard;
