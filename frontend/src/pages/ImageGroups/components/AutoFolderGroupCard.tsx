import { useCallback, useMemo } from 'react';
import {
  Card,
  CardMedia,
  Box,
  Typography,
  Chip,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import type { AutoFolderGroupWithStats } from '@comfyui-image-manager/shared';
import { autoFolderGroupsApi } from '../../../services/api/autoFolderGroupsApi';
import { useImageRotation } from '../../../hooks/useImageRotation';
import type { ImageRecord } from '../../../types/image';

interface AutoFolderGroupCardProps {
  group: AutoFolderGroupWithStats;
  onClick: () => void;
}

/**
 * 자동 폴더 그룹 카드 컴포넌트 (이미지 회전 기능 포함)
 * - 3초마다 이미지 자동 회전
 * - 부모 폴더는 자식 폴더 이미지 표시
 * - 이미지 없으면 폴더 아이콘 표시
 */
export function AutoFolderGroupCard({ group, onClick }: AutoFolderGroupCardProps) {
  // 이미지 가져오기 함수
  const fetchImages = useCallback(
    async (count: number, includeChildren: boolean): Promise<ImageRecord[]> => {
      try {
        const response = await autoFolderGroupsApi.getPreviewImages(group.id, count, includeChildren);
        return response.data || [];
      } catch (error) {
        console.error(`Failed to load preview images for auto folder group ${group.id}:`, error);
        return [];
      }
    },
    [group.id]
  );

  // 이미지 회전 훅 사용 (React Query 캐싱 포함)
  const { currentImage, images, isLoading } = useImageRotation(fetchImages, {
    groupId: group.id, // 캐시 키로 사용
    groupType: 'auto-folder',
    interval: 3000,
    preloadCount: 8,
    includeChildren: true,
    enabled: true,
  });

  // 대표 이미지 URL 결정
  const imageUrl = useMemo(() => {
    if (currentImage?.thumbnail_url) {
      return currentImage.thumbnail_url;
    }
    // 이미지 없으면 폴더 아이콘 SVG
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24">
        <rect width="24" height="24" fill="#1a1a1a"/>
        <path fill="#666" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
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
      {/* 배경 이미지 (회전) */}
      <CardMedia
        component="img"
        image={imageUrl}
        alt={group.display_name}
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
          <FolderIcon sx={{ color: 'primary.light', fontSize: '1.2rem' }} />
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
            {group.display_name}
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
          {group.display_name}
        </Typography>

        <Typography
          variant="caption"
          sx={{
            color: 'rgba(255, 255, 255, 0.7)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {group.folder_path}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            label={`${group.image_count || 0} 이미지`}
            size="small"
            sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', color: 'white' }}
          />
          {group.child_count !== undefined && group.child_count > 0 && (
            <Chip
              label={`${group.child_count} 하위폴더`}
              size="small"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', color: 'white' }}
            />
          )}
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
