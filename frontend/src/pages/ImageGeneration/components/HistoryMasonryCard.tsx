import React, { useState, useEffect, useRef } from 'react';
import { Card, CardMedia, Box, Skeleton, Chip, Typography, IconButton } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  // CheckCircleOutline as CompletedIcon,
  // Error as FailedIcon,
  // HourglassEmpty as PendingIcon,
  // Sync as ProcessingIcon,
} from '@mui/icons-material';
import type { ImageRecord } from '../../../types/image';
import type { GenerationStatus, ServiceType } from '@comfyui-image-manager/shared';
import { getBackendOrigin } from '../../../utils/backend';

interface HistoryMasonryCardProps {
  image: ImageRecord;
  onClick: () => void;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (id: number, event?: React.MouseEvent) => void;
  onDelete?: (id: number) => void;
  // 히스토리 전용 추가 정보
  generationStatus?: GenerationStatus;
  serviceType?: ServiceType;
}

const HistoryMasonryCard: React.FC<HistoryMasonryCardProps> = ({
  image,
  onClick,
  selected = false,
  selectable = false,
  onSelectionChange,
  onDelete,
  serviceType,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const backendOrigin = getBackendOrigin();

  // 히스토리 이미지는 thumbnail_url 사용, 일반 이미지는 API 사용
  const imageUrl = image.thumbnail_url
    ? `${backendOrigin}${image.thumbnail_url}`
    : `${backendOrigin}/api/images/${image.id}/thumbnail`;

  const handleSelectionChange = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelectionChange) {
      onSelectionChange(image.id, e);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // 체크박스 또는 삭제 버튼 클릭이면 무시
    if ((e.target as HTMLElement).closest('.image-card-actions')) {
      return;
    }
    onClick();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(image.id);
    }
  };

  // 이미지 aspect ratio 계산 (레이아웃 시프트 방지)
  const aspectRatio = image.width && image.height ? image.width / image.height : 1;

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

  // 상태 배지 렌더링 - 주석 처리됨 (사용하지 않음)
  // const getStatusBadge = () => {
  //   if (!generationStatus) return null;
  //   return null;
  // };

  // 서비스 타입 배지
  const getServiceBadge = () => {
    if (!serviceType) return null;

    return (
      <Chip
        label={serviceType === 'comfyui' ? 'ComfyUI' : 'NovelAI'}
        size="small"
        sx={{
          fontSize: '0.7rem',
          height: '22px',
          fontWeight: 600,
          bgcolor: 'rgba(0, 0, 0, 0.75)',
          color: 'white',
          backdropFilter: 'blur(4px)',
        }}
      />
    );
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
            opacity: isHovered || selected ? 1 : 0.3,
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

        {/* 이미지 - 뷰포트에 들어왔을 때만 로드 */}
        {isVisible && (
          <CardMedia
            component="img"
            image={imageUrl}
            alt={image.original_name}
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
        )}
      </Box>

      {/* 배지 컨테이너 - 우측 상단 */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          alignItems: 'flex-end',
        }}
      >
        {/* 상태 배지 - 이미지가 정상적으로 생성되었으므로 주석 처리 */}
        {/* {getStatusBadge()} */}
        {getServiceBadge()}

        {/* 삭제 버튼 - 호버 시 표시 */}
        {onDelete && isHovered && (
          <IconButton
            className="image-card-actions"
            onClick={handleDelete}
            size="small"
            sx={{
              bgcolor: 'rgba(244, 67, 54, 0.9)',
              color: 'white',
              backdropFilter: 'blur(4px)',
              '&:hover': {
                bgcolor: 'rgba(211, 47, 47, 1)',
              },
              width: 32,
              height: 32,
            }}
          >
            <DeleteIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
        )}
      </Box>

      {/* 프롬프트 미리보기 - 하단 오버레이 (호버 시 표시) */}
      {image.prompt && isHovered && (
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

      {/* 이미지 크기 정보 - 좌측 하단 */}
      {image.width && image.height && (
        <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1 }}>
          <Chip
            label={`${image.width} × ${image.height}`}
            size="small"
            sx={{
              fontSize: '0.65rem',
              height: '20px',
              fontWeight: 600,
              bgcolor: 'rgba(0, 0, 0, 0.65)',
              color: 'white',
              backdropFilter: 'blur(4px)',
            }}
          />
        </Box>
      )}
    </Card>
  );
};

export default HistoryMasonryCard;
