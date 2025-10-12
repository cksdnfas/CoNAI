import React, { useState, useEffect, useRef } from 'react';
import { Card, CardMedia, Box, Skeleton } from '@mui/material';
import type { ImageRecord } from '../../types/image';
import { getBackendOrigin } from '../../utils/backend';

interface MasonryImageCardProps {
  image: ImageRecord;
  onClick: () => void;
}

const MasonryImageCard: React.FC<MasonryImageCardProps> = ({ image, onClick }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const backendOrigin = getBackendOrigin();
  // API 엔드포인트를 통해 썸네일 제공 (외부 네트워크 접근 보장)
  const imageUrl = `${backendOrigin}/api/images/${image.id}/thumbnail`;

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
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 6,
        },
      }}
    >
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
    </Card>
  );
};

export default MasonryImageCard;
