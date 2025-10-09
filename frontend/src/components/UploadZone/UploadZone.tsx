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
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  FolderOpen as FolderOpenIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { imageApi } from '../../services/api';

interface UploadZoneProps {
  onUploadComplete?: () => void;
}

const MAX_FILES = 50;

interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  uploading: boolean;
}

const UploadZone: React.FC<UploadZoneProps> = ({ onUploadComplete }) => {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    uploading: false,
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // 파일 개수 제한 검사
    if (acceptedFiles.length > MAX_FILES) {
      setMessage({
        type: 'error',
        text: `최대 ${MAX_FILES}개 파일까지 업로드할 수 있습니다. (선택된 파일: ${acceptedFiles.length}개)`
      });
      return;
    }

    setUploadProgress({
      total: acceptedFiles.length,
      completed: 0,
      failed: 0,
      uploading: true,
    });
    setMessage(null);

    try {
      if (acceptedFiles.length === 1) {
        // 단일 파일 업로드
        const response = await imageApi.uploadImage(acceptedFiles[0]);
        if (response.success) {
          setUploadProgress(prev => ({ ...prev, completed: 1, uploading: false }));
          setMessage({ type: 'success', text: '이미지 업로드가 완료되었습니다.' });
        } else {
          setUploadProgress(prev => ({ ...prev, failed: 1, uploading: false }));
          setMessage({ type: 'error', text: response.error || '업로드에 실패했습니다.' });
        }
      } else {
        // 다중 파일 업로드
        const responses = await imageApi.uploadImages(acceptedFiles);
        const successCount = responses.filter(r => r.success).length;
        const failedCount = responses.length - successCount;

        setUploadProgress({
          total: acceptedFiles.length,
          completed: successCount,
          failed: failedCount,
          uploading: false,
        });

        if (failedCount === 0) {
          setMessage({ type: 'success', text: `${successCount}개 이미지 업로드가 완료되었습니다.` });
        } else if (successCount === 0) {
          setMessage({ type: 'error', text: '모든 이미지 업로드에 실패했습니다.' });
        } else {
          setMessage({
            type: 'info',
            text: `${successCount}개 성공, ${failedCount}개 실패했습니다.`
          });
        }
      }

      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      setUploadProgress(prev => ({ ...prev, uploading: false, failed: prev.total }));
      setMessage({ type: 'error', text: '업로드 중 오류가 발생했습니다.' });
      console.error('Upload error:', error);
    }
  }, [onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
    },
    multiple: true,
  });

  const handleFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
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
        .filter(file => file.type.startsWith('image/'));
      if (files.length > 0) {
        onDrop(files);
      }
    };
    input.click();
  };

  const progressPercentage = uploadProgress.total > 0
    ? ((uploadProgress.completed + uploadProgress.failed) / uploadProgress.total) * 100
    : 0;

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
          {isDragActive ? '파일을 여기에 놓으세요' : '이미지를 드래그하거나 클릭하여 업로드'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          JPG, PNG, GIF, BMP, WebP, TIFF 형식을 지원합니다 (최대 {MAX_FILES}개 파일)
        </Typography>

        <Stack direction="row" spacing={2} justifyContent="center">
          <Chip
            icon={<ImageIcon />}
            label="지원 형식"
            variant="outlined"
            size="small"
          />
          <Chip
            label={`다중 선택 가능 (최대 ${MAX_FILES}개)`}
            variant="outlined"
            size="small"
          />
        </Stack>
      </Paper>

      <Divider sx={{ my: 3 }}>또는</Divider>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            startIcon={<ImageIcon />}
            onClick={handleFileSelect}
            disabled={uploadProgress.uploading}
          >
            파일 선택
          </Button>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            startIcon={<FolderOpenIcon />}
            onClick={handleFolderSelect}
            disabled={uploadProgress.uploading}
          >
            폴더 선택
          </Button>
        </Grid>
      </Grid>

      {uploadProgress.uploading && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            업로드 중... ({uploadProgress.completed + uploadProgress.failed}/{uploadProgress.total})
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progressPercentage}
            sx={{ height: 8, borderRadius: 4 }}
          />
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

      {uploadProgress.total > 0 && !uploadProgress.uploading && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            총 {uploadProgress.total}개 파일 -
            성공: {uploadProgress.completed}개,
            실패: {uploadProgress.failed}개
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default UploadZone;