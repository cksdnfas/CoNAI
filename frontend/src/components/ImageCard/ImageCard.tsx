import React, { useState } from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  Checkbox,
  Box,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Info as InfoIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import type { ImageRecord } from '../../types/image';
import { buildUploadsUrl, ensureAbsoluteUrl, getBackendOrigin } from '../../utils/backend';

interface ImageCardProps {
  image: ImageRecord;
  selected?: boolean;
  selectable?: boolean;
  onSelectionChange?: (id: number) => void;
  onDelete?: (id: number) => void;
  onImageClick?: () => void;
}

const ImageCard: React.FC<ImageCardProps> = ({
  image,
  selected = false,
  selectable = false,
  onSelectionChange,
  onDelete,
  onImageClick,
}) => {
  const [imageError, setImageError] = useState(false);
  const backendOrigin = getBackendOrigin();

  const handleSelectionChange = () => {
    if (onSelectionChange) {
      onSelectionChange(image.id);
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `${backendOrigin}/api/images/${image.id}/download/original`;
    link.download = image.original_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = () => {
    if (onDelete && window.confirm('이미지를 삭제하시겠습니까?')) {
      onDelete(image.id);
    }
  };



  const thumbnailUrl = ensureAbsoluteUrl(image.thumbnail_url) || buildUploadsUrl(image.thumbnail_path);
  const fallbackUrl = ensureAbsoluteUrl(image.image_url) || buildUploadsUrl(image.file_path);

  return (
    <>
      <Card
        sx={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          border: selected ? 2 : 1,
          borderColor: selected ? 'primary.main' : 'divider',
          borderRadius: 2,
          transition: 'all 0.3s ease',
          '&:hover': {
            boxShadow: 8,
            transform: 'translateY(-2px)',
          },
        }}
      >
        {selectable && (
          <Box sx={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}>
            <Checkbox
              checked={selected}
              onChange={handleSelectionChange}
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
            />
          </Box>
        )}

        <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="상세 정보">
              <IconButton
                size="small"
                onClick={() => window.open(`/#/image/${image.id}`, '_blank')}
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
                <InfoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="다운로드">
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
              <Tooltip title="삭제">
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

        <CardMedia
          component="img"
          height="250"
          image={imageError ? fallbackUrl : thumbnailUrl}
          alt={image.original_name}
          onError={() => setImageError(true)}
          sx={{
            objectFit: 'cover',
            cursor: 'pointer',
          }}
          onClick={onImageClick}
        />

        <CardContent sx={{
          flexGrow: 1,
          p: { xs: 1, sm: 1.5 },
          '&:last-child': {
            paddingBottom: { xs: '6px', sm: '8px' }
          }
        }}>
          {/* <Typography
            variant="body2"
            noWrap
            title={image.original_name}
            sx={{
              fontWeight: 500,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
            }}
          >
            {image.original_name}
          </Typography> */}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {/* 그룹 정보 */}
            {image.groups && image.groups.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {image.groups.slice(0, 2).map((group) => (
                  <Chip
                    key={group.id}
                    label={group.name}
                    size="small"
                    variant="filled"
                    sx={{
                      fontSize: { xs: '0.6rem', sm: '0.7rem' },
                      height: { xs: '18px', sm: '20px' },
                      backgroundColor: group.color || (group.collection_type === 'auto' ? '#e3f2fd' : '#f3e5f5'),
                      color: group.color ? '#fff' : (group.collection_type === 'auto' ? '#1976d2' : '#7b1fa2'),
                      '& .MuiChip-label': {
                        px: 0.5,
                      },
                    }}
                  />
                ))}
                {image.groups.length > 2 && (
                  <Chip
                    label={`+${image.groups.length - 2}`}
                    size="small"
                    variant="outlined"
                    sx={{
                      fontSize: { xs: '0.6rem', sm: '0.7rem' },
                      height: { xs: '18px', sm: '20px' },
                    }}
                  />
                )}
              </Box>
            )}

            {/* AI 도구 및 해상도 정보 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {image.ai_tool && (
                <Chip
                  label={image.ai_tool}
                  size="small"
                  variant="outlined"
                  color="primary"
                  sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    height: { xs: '20px', sm: '24px' },
                  }}
                />
              )}
              {image.width && image.height && (
                <Chip
                  label={`${image.width}×${image.height}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    height: { xs: '20px', sm: '24px' },
                  }}
                />
              )}
            </Box>
          </Box>

          {/* <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mt: 1,
              display: 'block',
              fontSize: { xs: '0.7rem', sm: '0.75rem' },
            }}
          >
            {formatFileSize(image.file_size)}
          </Typography> */}
        </CardContent>
      </Card>

    </>
  );
};

export default ImageCard;
