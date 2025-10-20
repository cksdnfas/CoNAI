import { useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardMedia,
  CardContent,
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
  Close as CloseIcon,
  ZoomIn as ZoomInIcon,
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface GeneratedImage {
  imageId: number;
  serverId: number;
  serverName: string;
  generatedImage: {
    id: number;
    filename: string;
    thumbnail_url: string;
    optimized_url: string;
  };
  executionTime?: number;
  timestamp: string;
}

interface WorkflowImageGalleryProps {
  images: GeneratedImage[];
}

export default function WorkflowImageGallery({ images }: WorkflowImageGalleryProps) {
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState<number | null>(null);

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

  if (images.length === 0) {
    return (
      <Paper
        sx={{
          p: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          minHeight: '400px'
        }}
      >
        <ZoomInIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          생성된 이미지가 여기에 표시됩니다
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">
          생성된 이미지
          <Chip label={`${images.length}개`} sx={{ ml: 1 }} size="small" />
        </Typography>
      </Box>

      <Grid container spacing={2}>
        {images.map((img, index) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={`${img.serverId}-${img.imageId}-${index}`}>
            <Card sx={{ position: 'relative', '&:hover .overlay': { opacity: 1 } }}>
              <CardMedia
                component="img"
                image={img.generatedImage.thumbnail_url}
                alt={img.generatedImage.filename}
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
              <CardContent>
                <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                  <Chip label={img.serverName} size="small" color="primary" variant="outlined" />
                  {img.executionTime && (
                    <Chip label={`${img.executionTime.toFixed(1)}초`} size="small" variant="outlined" />
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  {new Date(img.timestamp).toLocaleString()}
                </Typography>
                <Button
                  fullWidth
                  size="small"
                  startIcon={<ViewIcon />}
                  onClick={() => navigate(`/image/${img.imageId}`)}
                  sx={{ mt: 1 }}
                >
                  상세보기
                </Button>
              </CardContent>
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
                  src={images[selectedImage].generatedImage.optimized_url}
                  alt={images[selectedImage].generatedImage.filename}
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
            startIcon={<ViewIcon />}
            onClick={() => selectedImage !== null && navigate(`/image/${images[selectedImage].imageId}`)}
            variant="contained"
          >
            상세보기
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
