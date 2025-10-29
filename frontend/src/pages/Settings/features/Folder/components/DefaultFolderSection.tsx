import React, { useState, useEffect } from 'react';
import {
  Paper,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Divider
} from '@mui/material';
import {
  Folder as FolderIcon,
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { folderApi } from '../../../../../services/folderApi';
import type { WatchedFolder } from '../../../../../types/folder';

const DefaultFolderSection: React.FC = () => {
  const [defaultFolder, setDefaultFolder] = useState<WatchedFolder | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 기본 폴더 로드
  useEffect(() => {
    loadDefaultFolder();
  }, []);

  const loadDefaultFolder = async () => {
    try {
      setError(null);
      const folder = await folderApi.getDefaultFolder();
      setDefaultFolder(folder);
      setFolderPath(folder.folder_path);
    } catch (err) {
      console.error('Failed to load default folder:', err);
      setError('기본 폴더 정보를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  // 경로 검증
  const handleValidatePath = async () => {
    if (!folderPath.trim()) {
      setError('폴더 경로를 입력해주세요');
      return;
    }

    try {
      setError(null);
      await folderApi.validateFolderPath(folderPath);
      setSuccessMessage('유효한 폴더 경로입니다');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || '유효하지 않은 폴더 경로입니다');
    }
  };

  // 저장
  const handleSave = async () => {
    if (!folderPath.trim()) {
      setError('폴더 경로를 입력해주세요');
      return;
    }

    setSaving(true);
    try {
      setError(null);
      setSuccessMessage(null);
      await folderApi.updateDefaultFolder(folderPath);
      setSuccessMessage('기본 업로드 폴더가 업데이트되었습니다');
      await loadDefaultFolder();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || '폴더 업데이트에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  // 폴더 스캔
  const handleScan = async () => {
    if (!defaultFolder) {
      setError('기본 폴더 정보가 없습니다');
      return;
    }

    setScanning(true);
    try {
      setError(null);
      setSuccessMessage(null);
      const result = await folderApi.scanFolder(defaultFolder.id);
      setSuccessMessage(
        `스캔 완료: 신규 ${result.newImages}개, 기존 ${result.existingImages}개${
          result.errors.length > 0 ? `, 오류 ${result.errors.length}개` : ''
        }`
      );
      await loadDefaultFolder();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setError(err.response?.data?.message || '폴더 스캔에 실패했습니다');
    } finally {
      setScanning(false);
    }
  };

  // 상태 칩 색상
  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'in_progress':
        return 'info';
      default:
        return 'default';
    }
  };

  // 상태 텍스트
  const getStatusText = (status: string | null) => {
    switch (status) {
      case 'success':
        return '성공';
      case 'error':
        return '오류';
      case 'in_progress':
        return '진행 중';
      default:
        return '대기';
    }
  };

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <FolderIcon sx={{ mr: 1 }} />
        <Typography variant="h6">기본 업로드 폴더</Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        이미지를 직접 업로드할 때 저장될 기본 폴더를 설정합니다.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}

      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          label="폴더 경로"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          placeholder="예: D:\Images\Upload"
          helperText="절대 경로를 입력해주세요"
          disabled={saving}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button variant="outlined" onClick={handleValidatePath} disabled={saving}>
          경로 검증
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !folderPath.trim()}
        >
          {saving ? <CircularProgress size={24} /> : '저장'}
        </Button>
      </Box>

      {defaultFolder && (
        <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            현재 기본 폴더
          </Typography>
          <Typography variant="body2">{defaultFolder.folder_path}</Typography>
        </Box>
      )}

      {defaultFolder && (
        <>
          <Divider sx={{ my: 3 }} />

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">스캔 관리</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  startIcon={<RefreshIcon />}
                  onClick={loadDefaultFolder}
                  size="small"
                  disabled={scanning}
                >
                  새로고침
                </Button>
                <Button
                  startIcon={scanning ? <CircularProgress size={16} /> : <PlayIcon />}
                  variant="contained"
                  onClick={handleScan}
                  disabled={scanning}
                >
                  스캔 시작
                </Button>
              </Box>
            </Box>

            {defaultFolder.last_scan_date && (
              <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" gutterBottom>
                  마지막 스캔
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                  <Chip
                    label={getStatusText(defaultFolder.last_scan_status)}
                    size="small"
                    color={getStatusColor(defaultFolder.last_scan_status)}
                  />
                  <Typography variant="caption">
                    {defaultFolder.last_scan_found}개 발견
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(defaultFolder.last_scan_date).toLocaleString()}
                  </Typography>
                </Box>
                {defaultFolder.last_scan_error && (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                    오류: {defaultFolder.last_scan_error}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
};

export default DefaultFolderSection;
