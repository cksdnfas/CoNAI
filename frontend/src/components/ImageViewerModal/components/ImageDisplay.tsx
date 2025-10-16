import React, { useState, useEffect } from 'react';
import { Box, Skeleton } from '@mui/material';
import type { ImageRecord } from '../../../types/image';
import { getBackendOrigin } from '../../../utils/backend';

interface ImageDisplayProps {
  image: ImageRecord;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  imagePosition: { x: number; y: number };
  isDragging: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Image display component with transformations and loading states
 */
export const ImageDisplay: React.FC<ImageDisplayProps> = ({
  image,
  scale,
  rotation,
  flipX,
  flipY,
  imagePosition,
  isDragging,
  containerRef,
  onMouseDown,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const backendOrigin = getBackendOrigin();

  // Reset loading states when image changes
  useEffect(() => {
    setImageError(false);
    setImageLoading(true);
  }, [image.id]);

  // API 엔드포인트를 통해 이미지 제공 (외부 네트워크 접근 보장)
  const imageUrl = `${backendOrigin}/api/images/${image.id}/optimized`;
  const fallbackUrl = `${backendOrigin}/api/images/${image.id}/download/original`;

  return (
    <Box
      id="image-container"
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'none',
      }}
      onMouseDown={onMouseDown}
      ref={containerRef}
    >
      {imageLoading && (
        <Skeleton
          variant="rectangular"
          sx={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            bgcolor: 'grey.800',
          }}
        />
      )}
      {image.mime_type?.startsWith('video/') ? (
        <Box
          component="video"
          src={imageError ? fallbackUrl : imageUrl}
          controls
          autoPlay
          loop
          muted
          onError={() => setImageError(true)}
          onLoadedData={() => setImageLoading(false)}
          sx={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            opacity: imageLoading ? 0 : 1,
            transition: isDragging ? 'opacity 0.3s ease' : 'opacity 0.3s ease, transform 0.15s ease-out',
            transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${scale}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
            transformOrigin: 'center center',
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
            userSelect: 'none',
            pointerEvents: 'auto', // 비디오 컨트롤 클릭 가능하도록
          }}
        />
      ) : (
        <Box
          component="img"
          src={imageError ? fallbackUrl : imageUrl}
          alt={image.original_name}
          draggable={false}
          onError={() => setImageError(true)}
          onLoad={() => setImageLoading(false)}
          sx={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            opacity: imageLoading ? 0 : 1,
            transition: isDragging ? 'opacity 0.3s ease' : 'opacity 0.3s ease, transform 0.15s ease-out',
            transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) scale(${scale}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
            transformOrigin: 'center center',
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      )}
    </Box>
  );
};
