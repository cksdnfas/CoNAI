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
  showOriginal?: boolean; // 원본 이미지 표시 여부 (기본값: false, 썸네일 사용)
  onOriginalLoadError?: () => void; // 원본 이미지 로드 실패 시 콜백
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
  showOriginal = false, // 기본값: 썸네일 사용
  onOriginalLoadError,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [usePlaceholder, setUsePlaceholder] = useState(false);
  const backendOrigin = getBackendOrigin();

  // Reset error states when image or showOriginal changes
  useEffect(() => {
    setImageError(false);
    setUseFallback(false);
    setUsePlaceholder(false);
    setImageLoading(true);
  }, [image.composite_hash, showOriginal]);

  // 이미지 URL 우선순위:
  // 새 정책: 기본적으로 썸네일 사용 (90% 품질, 1080px, 빠른 로딩)
  // 원본 보기 버튼 클릭 시에만 원본 이미지 로드
  // GIF와 비디오는 항상 원본 사용 (애니메이션/재생 보존)
  const getImageUrl = () => {
    // 플레이스홀더 표시 중
    if (usePlaceholder) {
      return `${backendOrigin}/api/images/placeholder`;
    }

    const isGif = image.file_type === 'animated';
    const isVideo = image.file_type === 'video';

    // Fallback 모드: 썸네일 사용
    if (useFallback) {
      if (image.thumbnail_url) {
        return image.thumbnail_url.startsWith('http') ? image.thumbnail_url : `${backendOrigin}${image.thumbnail_url}`;
      }
      if (image.composite_hash) {
        return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`;
      }
      // 썸네일도 없으면 플레이스홀더로 전환
      return `${backendOrigin}/api/images/placeholder`;
    }

    // composite_hash null 체크
    if (!image.composite_hash) {
      // composite_hash가 없으면 image_url 또는 thumbnail_url 사용
      if (image.image_url) {
        return image.image_url.startsWith('http') ? image.image_url : `${backendOrigin}${image.image_url}`;
      }
      if (image.thumbnail_url) {
        return image.thumbnail_url.startsWith('http') ? image.thumbnail_url : `${backendOrigin}${image.thumbnail_url}`;
      }
      return `${backendOrigin}/api/images/placeholder`;
    }

    // GIF와 비디오는 항상 원본 사용 (ImageCard와 동일하게 직접 엔드포인트 사용)
    // 모든 파일 타입이 composite_hash를 사용
    if (isGif || isVideo) {
      return `${backendOrigin}/api/images/${image.composite_hash}/file`;
    }

    // 원본 보기 모드 (사용자가 버튼 클릭)
    if (showOriginal) {
      if (image.image_url) {
        return image.image_url.startsWith('http') ? image.image_url : `${backendOrigin}${image.image_url}`;
      }
      // Fallback: API 엔드포인트
      return `${backendOrigin}/api/images/${image.composite_hash}/download/original`;
    }

    // 기본: 썸네일 우선 (90% 품질, 1080px)
    if (image.thumbnail_url) {
      return image.thumbnail_url.startsWith('http') ? image.thumbnail_url : `${backendOrigin}${image.thumbnail_url}`;
    }
    // Fallback: API 엔드포인트
    return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`;
  };

  const imageUrl = getImageUrl();

  // 이미지 로드 에러 핸들러 (다단계 폴백)
  const handleImageError = () => {
    if (!imageError) {
      setImageError(true);

      // 원본 이미지 요청이 실패한 경우
      if (showOriginal && !useFallback) {
        // 썸네일로 폴백
        setUseFallback(true);
        setImageLoading(true);
        // 부모 컴포넌트에 알림 (토스트 표시)
        if (onOriginalLoadError) {
          onOriginalLoadError();
        }
      } else if (useFallback && !usePlaceholder) {
        // 썸네일도 실패 -> 플레이스홀더 표시
        setUsePlaceholder(true);
        setImageLoading(true);
      }
      // 플레이스홀더도 실패하면 더 이상 폴백 없음
    }
  };

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
      {image.file_type === 'video' ? (
        <Box
          component="video"
          key={`video-${image.composite_hash}-${useFallback}-${usePlaceholder}`}
          src={imageUrl}
          controls
          autoPlay
          loop
          muted
          onError={handleImageError}
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
          key={`img-${image.composite_hash}-${useFallback}-${usePlaceholder}`}
          src={imageUrl}
          alt={image.original_file_path ?? ''}
          draggable={false}
          onError={handleImageError}
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
