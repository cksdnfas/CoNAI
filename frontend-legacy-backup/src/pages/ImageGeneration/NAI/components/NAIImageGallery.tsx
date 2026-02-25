import { useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardMedia,
  CardActions,
  Button,
  Dialog,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Typography,
  Paper
} from '@mui/material';
import {
  Download as DownloadIcon,
  CloudUpload as UploadIcon,
  Close as CloseIcon,
  ZoomIn as ZoomInIcon,
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ImageData {
  filename: string;
  data: string;
}

interface NAIImageGalleryProps {
  images: ImageData[];
  metadata?: any;
  onUpload: (imageIndex: number) => void;
  uploading: boolean;
  uploadStatus?: {[key: number]: 'pending' | 'uploading' | 'success' | 'error'};
}

export default function NAIImageGallery({ images, metadata, onUpload, uploading, uploadStatus = {} }: NAIImageGalleryProps) {
  const { t } = useTranslation(['imageGeneration']);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);

  const getUploadButtonText = (index: number) => {
    const status = uploadStatus[index];
    if (status === 'uploading') return '업로드 중...';
    if (status === 'success') return '업로드 완료';
    if (status === 'error') return '재시도';
    return t('imageGeneration:nai.generate.upload');
  };

  const getUploadButtonColor = (index: number) => {
    const status = uploadStatus[index];
    if (status === 'success') return 'success';
    if (status === 'error') return 'error';
    return 'primary';
  };

  const handleImageClick = (index: number) => {
    setSelectedImage(index);
  };

  const handleClose = () => {
    setSelectedImage(null);
  };

  const handlePrevious = () => {
    if (selectedImage !== null && selectedImage > 0) {
      setSelectedImage(selectedImage - 1);
    }
  };

  const handleNext = () => {
    if (selectedImage !== null && selectedImage < images.length - 1) {
      setSelectedImage(selectedImage + 1);
    }
  };

  const handleDownloadAll = () => {
    images.forEach((img) => {
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${img.data}`;
      link.download = img.filename;
      link.click();
    });
  };

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">
          {t('imageGeneration:nai.generate.resultTitle')}
          <Chip label={`${images.length} ${t('imageGeneration:nai.gallery.images')}`} sx={{ ml: 1 }} size="small" />
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={() => setShowMetadata(!showMetadata)}
          >
            {showMetadata ? t('imageGeneration:nai.gallery.hideMetadata') : t('imageGeneration:nai.gallery.showMetadata')}
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadAll}
          >
            {t('imageGeneration:nai.gallery.downloadAll')}
          </Button>
        </Box>
      </Box>

      {/* Metadata Panel */}
      {showMetadata && metadata && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
          <Typography variant="subtitle2" gutterBottom fontWeight="bold">
            {t('imageGeneration:nai.generate.metadata')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            <Chip label={`Model: ${metadata.model}`} size="small" variant="outlined" />
            <Chip label={`${metadata.resolution}`} size="small" variant="outlined" />
            <Chip label={`Steps: ${metadata.steps}`} size="small" variant="outlined" />
            <Chip label={`Scale: ${metadata.scale}`} size="small" variant="outlined" />
            <Chip label={`Sampler: ${metadata.sampler}`} size="small" variant="outlined" />
            <Chip label={`Seed: ${metadata.seed}`} size="small" variant="outlined" />
          </Box>
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" fontWeight="bold">
              Prompt:
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {metadata.prompt}
            </Typography>
          </Box>
          {metadata.negative_prompt && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight="bold">
                Negative Prompt:
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {metadata.negative_prompt}
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* Image Grid */}
      <Grid container spacing={2}>
        {images.map((img, index) => (
          <Grid size={{ xs: 12, sm: 6, md: 4}} key={index}>
            <Card sx={{ position: 'relative', '&:hover .overlay': { opacity: 1 } }}>
              <CardMedia
                component="img"
                image={`data:image/png;base64,${img.data}`}
                alt={`Generated ${index + 1}`}
                sx={{ cursor: 'pointer', aspectRatio: '1/1', objectFit: 'cover' }}
                onClick={() => handleImageClick(index)}
              />
              <Box
                className="overlay"
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.3s',
                  cursor: 'pointer'
                }}
                onClick={() => handleImageClick(index)}
              >
                <IconButton sx={{ color: 'white' }}>
                  <ZoomInIcon fontSize="large" />
                </IconButton>
              </Box>
              <CardActions sx={{ justifyContent: 'space-between' }}>
                <Button
                  size="small"
                  startIcon={<DownloadIcon />}
                  href={`data:image/png;base64,${img.data}`}
                  download={img.filename}
                >
                  {t('imageGeneration:nai.generate.download')}
                </Button>
                <Button
                  size="small"
                  startIcon={<UploadIcon />}
                  onClick={() => onUpload(index)}
                  disabled={uploading || uploadStatus[index] === 'uploading'}
                  color={getUploadButtonColor(index) as any}
                >
                  {getUploadButtonText(index)}
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Image Modal */}
      <Dialog
        open={selectedImage !== null}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
      >
        <DialogContent sx={{ p: 0, position: 'relative', bgcolor: 'black' }}>
          <IconButton
            onClick={handleClose}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: 'white',
              bgcolor: 'rgba(0,0,0,0.5)',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
            }}
          >
            <CloseIcon />
          </IconButton>

          {selectedImage !== null && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <img
                  src={`data:image/png;base64,${images[selectedImage].data}`}
                  alt={`Generated ${selectedImage + 1}`}
                  style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
                />
              </Box>

              {/* Navigation */}
              {images.length > 1 && (
                <>
                  <IconButton
                    onClick={handlePrevious}
                    disabled={selectedImage === 0}
                    sx={{
                      position: 'absolute',
                      left: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'white',
                      bgcolor: 'rgba(0,0,0,0.5)',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
                    }}
                  >
                    <PrevIcon />
                  </IconButton>
                  <IconButton
                    onClick={handleNext}
                    disabled={selectedImage === images.length - 1}
                    sx={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'white',
                      bgcolor: 'rgba(0,0,0,0.5)',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
                    }}
                  >
                    <NextIcon />
                  </IconButton>
                </>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ bgcolor: 'background.paper' }}>
          <Chip label={`${(selectedImage || 0) + 1} / ${images.length}`} size="small" />
          <Box sx={{ flexGrow: 1 }} />
          <Button
            startIcon={<DownloadIcon />}
            href={selectedImage !== null ? `data:image/png;base64,${images[selectedImage].data}` : ''}
            download={selectedImage !== null ? images[selectedImage].filename : ''}
          >
            {t('imageGeneration:nai.generate.download')}
          </Button>
          <Button
            startIcon={<UploadIcon />}
            onClick={() => selectedImage !== null && onUpload(selectedImage)}
            disabled={uploading || (selectedImage !== null && uploadStatus[selectedImage] === 'uploading')}
            variant="contained"
            color={selectedImage !== null ? getUploadButtonColor(selectedImage) as any : 'primary'}
          >
            {selectedImage !== null ? getUploadButtonText(selectedImage) : t('imageGeneration:nai.generate.upload')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
