import { useCallback, useMemo } from 'react';
import {
  Card,
  CardMedia,
  Box,
  Typography,
  Chip,
  IconButton,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import type { GroupWithStats } from '@comfyui-image-manager/shared';
import { groupApi } from '../../../services/api/groupApi';
import { useImageRotation } from '../../../hooks/useImageRotation';
import type { ImageRecord } from '../../../types/image';
import { getBackendOrigin } from '../../../utils/backend';

interface GroupCardProps {
  group: GroupWithStats & { child_count?: number; has_children?: boolean };
  onClick: () => void;
  onSettingsClick?: (groupId: number) => void;
}

/**
 * 그룹 카드 컴포넌트 (이미지 회전 기능 포함)
 * - 3초마다 이미지 자동 회전
 * - 부모 그룹은 자식 이미지 표시
 * - 이미지 없으면 폴더 아이콘 표시
 */
export function GroupCard({ group, onClick, onSettingsClick }: GroupCardProps) {
  const backendOrigin = getBackendOrigin();

  // 설정 버튼 클릭 핸들러
  const handleSettingsClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 카드 클릭 이벤트 방지
    onSettingsClick?.(group.id);
  }, [group.id, onSettingsClick]);
  // 이미지 가져오기 함수 (useCallback으로 메모이제이션)
  const fetchImages = useCallback(
    async (count: number, includeChildren: boolean): Promise<ImageRecord[]> => {
      try {
        const response = await groupApi.getPreviewImages(group.id, count, includeChildren);
        return response.data || [];
      } catch (error) {
        console.error(`Failed to load preview images for group ${group.id}:`, error);
        return [];
      }
    },
    [group.id]
  );

  // 이미지 회전 훅 사용 (React Query 캐싱 포함)
  const { currentImage, nextImage, images, isTransitioning, offset, isLoading } = useImageRotation(fetchImages, {
    groupId: group.id, // 캐시 키로 사용
    groupType: 'group',
    interval: 3000, // 3초마다 회전
    preloadCount: 8, // 8개 이미지 미리 로드
    includeChildren: true, // 자식 그룹 검색 허용
    enabled: true,
  });

  // 비디오/GIF 여부 확인
  const isCurrentVideo = useMemo(() => currentImage?.file_type === 'video', [currentImage]);
  const isCurrentGif = useMemo(() => currentImage?.file_type === 'animated', [currentImage]);
  const isCurrentProcessing = useMemo(() => currentImage?.is_processing || !currentImage?.composite_hash, [currentImage]);

  const isNextVideo = useMemo(() => nextImage?.file_type === 'video', [nextImage]);
  const isNextGif = useMemo(() => nextImage?.file_type === 'animated', [nextImage]);
  const isNextProcessing = useMemo(() => nextImage?.is_processing || !nextImage?.composite_hash, [nextImage]);

  // 폴더 아이콘 SVG
  const folderIconSvg = useMemo(() =>
    `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24">
        <rect width="24" height="24" fill="#1a1a1a"/>
        <path fill="#666" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>`
    )}`, []
  );

  // 랜덤 플레이스홀더 이미지 선택 (컴포넌트 마운트 시 한 번만)
  const randomPlaceholder = useMemo(() => {
    const PLACEHOLDER_COUNT = 12; // config.json의 count와 일치
    const randomIndex = Math.floor(Math.random() * PLACEHOLDER_COUNT) + 1;
    return `/placeholders/folder-overlay-${randomIndex}.webp`;
  }, [group.id]); // group.id를 의존성으로 추가하여 각 그룹마다 다른 이미지

  // 대표 이미지/비디오 URL 결정 (MasonryImageCard와 동일한 로직)
  const currentMediaUrl = useMemo(() => {
    if (!currentImage) return folderIconSvg;

    // 처리 중인 이미지는 경로 기반 URL 사용
    if (isCurrentProcessing) {
      return `${backendOrigin}/api/images/by-path/${encodeURIComponent(currentImage.original_file_path || '')}`;
    }

    // 비디오와 GIF는 원본 파일 사용 (애니메이션/재생 보존)
    if (isCurrentVideo || isCurrentGif) {
      return `${backendOrigin}/api/images/${currentImage.composite_hash}/file`;
    }

    // 일반 이미지는 썸네일 사용
    const cacheBuster = currentImage.thumbnail_path ? `?v=${Date.parse(currentImage.first_seen_date)}` : '';
    return `${backendOrigin}/api/images/${currentImage.composite_hash}/thumbnail${cacheBuster}`;
  }, [currentImage, isCurrentVideo, isCurrentGif, isCurrentProcessing, backendOrigin, folderIconSvg]);

  const nextMediaUrl = useMemo(() => {
    if (!nextImage) return folderIconSvg;

    // 처리 중인 이미지는 경로 기반 URL 사용
    if (isNextProcessing) {
      return `${backendOrigin}/api/images/by-path/${encodeURIComponent(nextImage.original_file_path || '')}`;
    }

    // 비디오와 GIF는 원본 파일 사용 (애니메이션/재생 보존)
    if (isNextVideo || isNextGif) {
      return `${backendOrigin}/api/images/${nextImage.composite_hash}/file`;
    }

    // 일반 이미지는 썸네일 사용
    const cacheBuster = nextImage.thumbnail_path ? `?v=${Date.parse(nextImage.first_seen_date)}` : '';
    return `${backendOrigin}/api/images/${nextImage.composite_hash}/thumbnail${cacheBuster}`;
  }, [nextImage, isNextVideo, isNextGif, isNextProcessing, backendOrigin, folderIconSvg]);

  return (
    <Card
      sx={{
        cursor: 'pointer',
        transition: 'all 0.2s',
        aspectRatio: '5 / 7',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 1,
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
          '& .hover-info': {
            opacity: 1,
          },
          '& .hover-overlay': {
            opacity: 1,
          },
        },
        opacity: images.length > 0 || isLoading ? 1 : 0.7,
      }}
      onClick={onClick}
    >
      {/* 높이 제공용 spacer (aspect ratio 유지) */}
      <Box sx={{ width: '100%', paddingTop: '140%' /* 7/5 = 140% */ }} />

      {/* 현재 이미지 레이어 */}
      {!currentImage ? (
        // 이미지가 없을 때: 폴더 배경 + 플레이스홀더 오버레이
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 1,
          }}
        >
          {/* 배경: 폴더 아이콘 */}
          <CardMedia
            component="img"
            image={folderIconSvg}
            alt="Empty folder"
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.4,
            }}
          />
          {/* 오버레이: 랜덤 플레이스홀더 이미지 */}
          <Box
            component="img"
            src={randomPlaceholder}
            alt="Placeholder"
            sx={{
              position: 'absolute',
              top: '58%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '70%',
              height: 'auto',
              maxWidth: '200px',
              opacity: 0.8,
              objectFit: 'contain',
            }}
          />
        </Box>
      ) : isCurrentVideo ? (
        <Box
          component="video"
          src={currentMediaUrl}
          muted
          loop
          autoPlay
          playsInline
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 1,
            transform: `translateX(${offset}%)`,
            transition: isTransitioning ? 'transform 0.6s ease-in-out' : 'none',
          }}
        />
      ) : (
        <CardMedia
          component="img"
          image={currentMediaUrl}
          alt={group.name}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 1,
            transform: `translateX(${offset}%)`,
            transition: isTransitioning ? 'transform 0.6s ease-in-out' : 'none',
          }}
        />
      )}

      {/* 다음 이미지 레이어 (슬라이드 대기) */}
      {images.length > 1 && (
        isNextVideo ? (
          <Box
            component="video"
            src={nextMediaUrl}
            muted
            loop
            autoPlay
            playsInline
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              zIndex: 0,
              transform: `translateX(${offset + 100}%)`,
              transition: isTransitioning ? 'transform 0.6s ease-in-out' : 'none',
            }}
          />
        ) : (
          <CardMedia
            component="img"
            image={nextMediaUrl}
            alt={group.name}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              zIndex: 0,
              transform: `translateX(${offset + 100}%)`,
              transition: isTransitioning ? 'transform 0.6s ease-in-out' : 'none',
            }}
          />
        )
      )}

      {/* 설정 버튼 (우측 하단) */}
      {onSettingsClick && (
        <IconButton
          onClick={handleSettingsClick}
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            zIndex: 4,
            bgcolor: 'rgba(0, 0, 0, 0.6)',
            color: 'white',
            width: 32,
            height: 32,
            '&:hover': {
              bgcolor: 'rgba(0, 0, 0, 0.8)',
              color: 'primary.light',
            },
            transition: 'all 0.2s',
          }}
          size="small"
        >
          <SettingsIcon sx={{ fontSize: '1.1rem' }} />
        </IconButton>
      )}

      {/* 기본 정보 (항상 표시) */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background:
            'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 70%, transparent 100%)',
          p: 1.5,
          pb: 1,
          pr: onSettingsClick ? 6 : 1.5, // 설정 버튼이 있으면 오른쪽 패딩 증가
          zIndex: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FolderIcon sx={{ color: group.color || 'primary.light', fontSize: '1.2rem' }} />
          <Typography
            variant="subtitle1"
            component="div"
            sx={{
              flex: 1,
              color: 'white',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {group.name}
          </Typography>
        </Box>
      </Box>

      {/* 호버 시 표시되는 상세 정보 */}
      <Box
        className="hover-overlay"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          bgcolor: 'rgba(0, 0, 0, 0.6)',
          opacity: 0,
          transition: 'opacity 0.2s',
          zIndex: 2,
        }}
      />
      <Box
        className="hover-info"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          p: 2,
          opacity: 0,
          transition: 'opacity 0.2s',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          zIndex: 3,
        }}
      >
        <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
          {group.name}
        </Typography>

        {group.description && (
          <Typography
            variant="body2"
            sx={{
              color: 'rgba(255, 255, 255, 0.9)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {group.description}
          </Typography>
        )}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            label={`${group.image_count || 0} 이미지`}
            size="small"
            sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', color: 'white' }}
          />
          {group.child_count !== undefined && group.child_count > 0 && (
            <Chip
              label={`${group.child_count} 하위그룹`}
              size="small"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', color: 'white' }}
            />
          )}
          {Boolean(group.auto_collect_enabled) && (
            <Chip
              label="자동수집"
              size="small"
              color="primary"
              sx={{ color: 'white' }}
            />
          )}
        </Box>

        {/* {images.length > 1 && (
          <Typography
            variant="caption"
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              mt: 'auto',
            }}
          >
            {images.length}개 이미지 회전 중
          </Typography>
        )} */}
      </Box>
    </Card>
  );
}
