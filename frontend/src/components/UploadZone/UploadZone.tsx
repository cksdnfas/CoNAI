import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Box,
  Typography,
  Button,
  LinearProgress,
  Alert,
  Paper,
  Grid,
  Chip,
  Divider,
  Stack,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  FolderOpen as FolderOpenIcon,
  Image as ImageIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HourglassEmpty as HourglassEmptyIcon,
  AutoAwesome as AutoAwesomeIcon,
  VideoLibrary as VideoLibraryIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { imageApi } from '../../services/api';
import type { UploadProgressEvent, UploadStage } from '../../types/image';

interface UploadZoneProps {
  onUploadComplete?: () => void;
}

interface FileProgress {
  filename: string;
  status: 'waiting' | 'processing' | 'complete' | 'error';
  currentStage?: UploadStage;
  message?: string;
  imageId?: number;
  error?: string;
}

const UploadZone: React.FC<UploadZoneProps> = ({ onUploadComplete }) => {
  const { t } = useTranslation('upload');
  const [fileProgressList, setFileProgressList] = useState<FileProgress[]>([]);
  const [uploading, setUploading] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const stageLabels: Record<UploadStage, string> = {
    'upload': t('stages.upload'),
    'metadata': t('stages.metadata'),
    'thumbnail': t('stages.thumbnail'),
    'auto-collect': t('stages.autoCollect'),
    'auto-tag': t('stages.autoTag')
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setUploading(true);
    setMessage(null);

    // 파일 진행도 초기화
    const initialProgress: FileProgress[] = acceptedFiles.map(file => ({
      filename: file.name,
      status: 'waiting',
    }));
    setFileProgressList(initialProgress);
    setCurrentFileIndex(0);

    try {
      if (acceptedFiles.length === 1) {
        // 단일 파일 업로드 (기존 API 사용)
        const response = await imageApi.uploadImage(acceptedFiles[0]);
        if (response.success) {
          setFileProgressList([{
            filename: acceptedFiles[0].name,
            status: 'complete',
            message: t('messages.uploadComplete'),
            imageId: response.data?.composite_hash
          }]);
          setMessage({ type: 'success', text: t('messages.uploadSuccess') });
        } else {
          setFileProgressList([{
            filename: acceptedFiles[0].name,
            status: 'error',
            error: response.error
          }]);
          setMessage({ type: 'error', text: response.error || t('messages.uploadFailed') });
        }
      } else {
        // 다중 파일 업로드 (SSE 스트리밍)
        let completed = 0;
        let failed = 0;

        await imageApi.uploadImagesWithProgress(acceptedFiles, (event: UploadProgressEvent) => {
          const fileIndex = event.currentFile - 1;
          setCurrentFileIndex(fileIndex);

          setFileProgressList(prev => {
            const newList = [...prev];
            const item = newList[fileIndex];

            if (event.type === 'start') {
              item.status = 'processing';
              item.message = event.message;
            } else if (event.type === 'stage') {
              item.status = 'processing';
              item.currentStage = event.stage;
              item.message = event.message || (event.stage ? stageLabels[event.stage] : '');
            } else if (event.type === 'complete') {
              item.status = 'complete';
              item.message = event.message;
              item.imageId = event.compositeHash;
              completed++;
            } else if (event.type === 'error') {
              item.status = 'error';
              item.error = event.error;
              failed++;
            }

            return newList;
          });
        });

        // 최종 메시지
        if (failed === 0) {
          setMessage({ type: 'success', text: t('messages.multipleSuccess', { count: completed }) });
        } else if (completed === 0) {
          setMessage({ type: 'error', text: t('messages.allFailed') });
        } else {
          setMessage({
            type: 'info',
            text: t('messages.partialSuccess', { success: completed, failed })
          });
        }
      }

      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      setMessage({ type: 'error', text: t('messages.uploadError') });
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  }, [onUploadComplete, t, stageLabels]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'],
      'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv']
    },
    multiple: true,
  });

  const handleFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        onDrop(files);
      }
    };
    input.click();
  };

  const handleFolderSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
        .filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
      if (files.length > 0) {
        onDrop(files);
      }
    };
    input.click();
  };

  const progressPercentage = fileProgressList.length > 0
    ? (fileProgressList.filter(f => f.status === 'complete' || f.status === 'error').length / fileProgressList.length) * 100
    : 0;

  const getStatusIcon = (status: FileProgress['status']) => {
    switch (status) {
      case 'complete':
        return <CheckCircleIcon sx={{ color: 'success.main' }} />;
      case 'error':
        return <ErrorIcon sx={{ color: 'error.main' }} />;
      case 'processing':
        return <AutoAwesomeIcon sx={{ color: 'primary.main' }} />;
      default:
        return <HourglassEmptyIcon sx={{ color: 'text.secondary' }} />;
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Paper
        {...getRootProps()}
        elevation={isDragActive ? 8 : 2}
        sx={{
          p: 4,
          textAlign: 'center',
          border: '2px dashed',
          borderColor: isDragActive ? 'primary.main' : 'grey.300',
          backgroundColor: isDragActive ? 'action.hover' : 'background.paper',
          cursor: 'pointer',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            borderColor: 'primary.main',
            backgroundColor: 'action.hover',
          },
        }}
      >
        <input {...getInputProps()} />
        <CloudUploadIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          {isDragActive ? t('dropzone.dragActive') : t('dropzone.dragInactive')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('dropzone.supportedFormats')}
        </Typography>

        <Stack direction="row" spacing={2} justifyContent="center" flexWrap="wrap">
          <Chip
            icon={<ImageIcon />}
            label={t('dropzone.imageSupport')}
            variant="outlined"
            size="small"
          />
          <Chip
            icon={<VideoLibraryIcon />}
            label={t('dropzone.videoSupport')}
            variant="outlined"
            size="small"
          />
          <Chip
            label={t('dropzone.multipleSelection')}
            variant="outlined"
            size="small"
          />
        </Stack>
      </Paper>

      <Divider sx={{ my: 3 }}>{t('dropzone.divider')}</Divider>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            startIcon={<ImageIcon />}
            onClick={handleFileSelect}
            disabled={uploading}
          >
            {t('buttons.selectFiles')}
          </Button>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            startIcon={<FolderOpenIcon />}
            onClick={handleFolderSelect}
            disabled={uploading}
          >
            {t('buttons.selectFolder')}
          </Button>
        </Grid>
      </Grid>

      {uploading && fileProgressList.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('progress.title')}: {t('progress.fileCount', {
              completed: fileProgressList.filter(f => f.status === 'complete' || f.status === 'error').length,
              total: fileProgressList.length
            })}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progressPercentage}
            sx={{ height: 8, borderRadius: 4, mb: 2 }}
          />

          <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto', p: 2 }}>
            <List dense>
              {fileProgressList.map((file, index) => (
                <ListItem
                  key={index}
                  sx={{
                    bgcolor: index === currentFileIndex && file.status === 'processing' ? 'action.selected' : 'transparent',
                    borderRadius: 1,
                    mb: 0.5,
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {getStatusIcon(file.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={file.filename}
                    secondary={
                      <>
                        {file.status === 'processing' && file.currentStage && (
                          <Typography component="span" variant="caption" color="primary">
                            {stageLabels[file.currentStage]}
                          </Typography>
                        )}
                        {file.message && (
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            {file.message}
                          </Typography>
                        )}
                        {file.error && (
                          <Typography component="span" variant="caption" color="error">
                            {file.error}
                          </Typography>
                        )}
                      </>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        </Box>
      )}

      {message && (
        <Alert
          severity={message.type}
          sx={{ mt: 3 }}
          onClose={() => setMessage(null)}
        >
          {message.text}
        </Alert>
      )}

      {fileProgressList.length > 0 && !uploading && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('progress.summary', {
              total: fileProgressList.length,
              success: fileProgressList.filter(f => f.status === 'complete').length,
              failed: fileProgressList.filter(f => f.status === 'error').length
            })}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default UploadZone;
