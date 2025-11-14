import { useCallback, useMemo } from 'react';
import {
  Card,
  CardMedia,
  Box,
  Typography,
  Chip,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import type { AutoFolderGroupWithStats } from '@comfyui-image-manager/shared';
import { autoFolderGroupsApi } from '../../../services/api/autoFolderGroupsApi';
import { useImageRotation } from '../../../hooks/useImageRotation';
import type { ImageRecord } from '../../../types/image';

interface AutoFolderImageViewCardProps {
  group: AutoFolderGroupWithStats;
  onClick: () => void;
}

/**
 * 자동 폴더 이미지 보기 카드 컴포넌트
 * - 폴더의 직접 이미지들만 표시 (하위 폴더 제외)
 * - 3초마다 이미지 자동 회전
 * - 클릭 시 이미지 그리드 모달 열기
 */
export function AutoFolderImageViewCard({ group, onClick }: AutoFolderImageViewCardProps) {
  // 이미지 가져오기 함수 (하위 폴더 제외)
  const fetchImages = useCallback(
    async (count: number): Promise<ImageRecord[]> => {
      try {
        const response = await autoFolderGroupsApi.getPreviewImages(group.id, count, false); // includeChildren = false
        return response.data || [];
      } catch (error) {
        console.error(`Failed to load preview images for auto folder group ${group.id}:`, error);
        return [];
      }
    },
    [group.id]
  );

  // 이미지 회전 훅 사용
  const { currentImage, images, isLoading } = useImageRotation(fetchImages, {
    groupId: `${group.id}-direct`, // 캐시 키 (하위 폴더 포함 버전과 구분)
    groupType: 'auto-folder-direct',
    interval: 3000,
    preloadCount: 8,
    includeChildren: false,
    enabled: true,
  });

  // 비디오 여부 확인
  const isVideo = useMemo(() => currentImage?.file_type === 'video', [currentImage]);

  // 대표 이미지/비디오 URL 결정
  const mediaUrl = useMemo(() => {
    if (currentImage?.thumbnail_url) {
      return currentImage.thumbnail_url;
    }
    // 로딩 중이거나 이미지가 없으면 이미지 아이콘 SVG
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24">
        <rect width="24" height="24" fill="#1a1a1a"/>
        <path fill="#666" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
      </svg>`
    )}`;
  }, [currentImage]);

  return (
    <Card
      sx={{
        cursor: 'pointer',
        transition: 'all 0.2s',
        aspectRatio: '5 / 7',
        position: 'relative',
        overflow: 'hidden',
        border: '2px solid',
        borderColor: 'primary.main',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
          borderColor: 'primary.light',
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
      {/* 배경 미디어 (회전) - 비디오 또는 이미지 */}
      {isVideo ? (
        <Box
          component="video"
          src={mediaUrl}
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
            transition: 'opacity 0.6s ease-in-out',
          }}
        />
      ) : (
        <CardMedia
          component="img"
          image={mediaUrl}
          alt="이미지 보기"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'opacity 0.6s ease-in-out',
          }}
        />
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
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ImageIcon sx={{ color: 'primary.light', fontSize: '1.2rem' }} />
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
            이미지 보기
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
        }}
      >
        <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
          {group.display_name} - 이미지
        </Typography>

        <Typography
          variant="body2"
          sx={{
            color: 'rgba(255, 255, 255, 0.9)',
          }}
        >
          이 폴더의 직접 이미지들을 확인합니다
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            label={`${group.image_count || 0} 이미지`}
            size="small"
            sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', color: 'white' }}
          />
        </Box>

        {images.length > 1 && (
          <Typography
            variant="caption"
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              mt: 'auto',
            }}
          >
            {images.length}개 이미지 회전 중
          </Typography>
        )}
      </Box>
    </Card>
  );
}
