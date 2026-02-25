import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  ImageList,
  ImageListItem,
  ImageListItemBar,
  CircularProgress,
  Tooltip,
  useTheme,
  useMediaQuery,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { imageEditorApi } from '../../services/imageEditorApi';
import type { CanvasImage } from '../../services/imageEditorApi';
import { getBackendOrigin } from '../../utils/backend';

interface CanvasGalleryModalProps {
  open: boolean;
  onClose: () => void;
  onEditImage?: (imagePath: string) => void;
  highlightedImage?: string; // Newly saved image to highlight
}

const CanvasGalleryModal: React.FC<CanvasGalleryModalProps> = ({
  open,
  onClose,
  onEditImage,
  highlightedImage,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const backendOrigin = getBackendOrigin();

  const [images, setImages] = useState<CanvasImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  // Load images when modal opens
  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await imageEditorApi.getCanvasImages();
      if (response.success && response.data) {
        setImages(response.data.images);
      } else {
        setError(response.error || 'Failed to load images');
      }
    } catch (err) {
      console.error('Failed to load canvas images:', err);
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadImages();
    }
  }, [open, loadImages]);

  // Handle delete
  const handleDelete = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(filename);
    try {
      const response = await imageEditorApi.deleteCanvasImage(filename);
      if (response.success) {
        setImages((prev) => prev.filter((img) => img.filename !== filename));
        setSnackbar({
          open: true,
          message: t('imageEditor:canvasGallery.deleteSuccess', { defaultValue: 'Image deleted' }),
          severity: 'success',
        });
      } else {
        setSnackbar({
          open: true,
          message: response.error || 'Failed to delete',
          severity: 'error',
        });
      }
    } catch (err) {
      console.error('Failed to delete canvas image:', err);
      setSnackbar({
        open: true,
        message: 'Failed to delete image',
        severity: 'error',
      });
    } finally {
      setDeleting(null);
    }
  };

  // Handle image click
  const handleImageClick = (image: CanvasImage) => {
    if (onEditImage) {
      onEditImage(image.path);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          height: '80vh',
          maxHeight: '80vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6">
          {t('imageEditor:canvasGallery.title', { defaultValue: 'Edited Images' })}
          {images.length > 0 && (
            <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary' }}>
              ({images.length})
            </Typography>
          )}
        </Typography>
        <Box>
          <Tooltip title={t('common:actions.refresh', { defaultValue: 'Refresh' })}>
            <IconButton onClick={loadImages} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 2 }}>
        {loading ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <Typography color="error">{error}</Typography>
          </Box>
        ) : images.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              color: 'text.secondary',
            }}
          >
            <EditIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
            <Typography>
              {t('imageEditor:canvasGallery.empty', { defaultValue: 'No edited images yet' })}
            </Typography>
          </Box>
        ) : (
          <ImageList
            cols={isMobile ? 2 : 4}
            gap={12}
            sx={{
              m: 0,
              overflow: 'auto',
            }}
          >
            {images.map((image) => (
              <ImageListItem
                key={image.filename}
                onClick={() => handleImageClick(image)}
                sx={{
                  cursor: 'pointer',
                  borderRadius: 1,
                  overflow: 'hidden',
                  border: highlightedImage === image.path ? 2 : 1,
                  borderColor: highlightedImage === image.path ? 'primary.main' : 'divider',
                  transition: 'all 0.2s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    transform: 'scale(1.02)',
                  },
                }}
              >
                <img
                  src={`${backendOrigin}${image.url}`}
                  alt={image.filename}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: 200,
                    objectFit: 'cover',
                  }}
                />
                <ImageListItemBar
                  title={
                    <Tooltip title={image.filename}>
                      <Typography variant="body2" noWrap>
                        {image.filename}
                      </Typography>
                    </Tooltip>
                  }
                  subtitle={
                    <Box>
                      <Typography variant="caption" display="block">
                        {image.width} x {image.height} | {formatFileSize(image.size)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(image.modifiedAt)}
                      </Typography>
                    </Box>
                  }
                  actionIcon={
                    <Tooltip title={t('common:actions.delete', { defaultValue: 'Delete' })}>
                      <IconButton
                        sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                        onClick={(e) => handleDelete(image.filename, e)}
                        disabled={deleting === image.filename}
                      >
                        {deleting === image.filename ? (
                          <CircularProgress size={20} color="inherit" />
                        ) : (
                          <DeleteIcon />
                        )}
                      </IconButton>
                    </Tooltip>
                  }
                />
              </ImageListItem>
            ))}
          </ImageList>
        )}
      </DialogContent>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default CanvasGalleryModal;
