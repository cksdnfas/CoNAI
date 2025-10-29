import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Grid,
  Tooltip
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
  FolderOpen as FolderIcon,
  PlayArrow as PlayIcon,
  History as HistoryIcon,
  Autorenew as AutorenewIcon
} from '@mui/icons-material';
import { folderApi } from '../../../../../services/folderApi';
import FolderFormDialog from './FolderFormDialog';
import ScanLogModal from './ScanLogModal';
import type { WatchedFolder } from '../../../../../types/folder';

const WatchedFoldersList: React.FC = () => {
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<WatchedFolder | null>(null);
  const [scanningFolderId, setScanningFolderId] = useState<number | null>(null);
  const [scanningAll, setScanningAll] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logFolderId, setLogFolderId] = useState<number | undefined>(undefined);

  // 폴더 목록 로드
  const loadFolders = async () => {
    try {
      setError(null);
      const data = await folderApi.getFolders();
      // 기본 업로드 폴더 제외 (별도 섹션에서 관리)
      setFolders(data.filter(f => !f.folder_path.includes('uploads/images')));
    } catch (err) {
      console.error('Failed to load folders:', err);
      setError('폴더 목록을 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFolders();
  }, []);

  // 폴더 추가/편집 다이얼로그
  const handleOpenDialog = (folder?: WatchedFolder) => {
    setSelectedFolder(folder || null);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedFolder(null);
  };

  const handleDialogSuccess = () => {
    loadFolders();
  };

  // 폴더 삭제
  const handleDelete = async (folder: WatchedFolder) => {
    if (!window.confirm(`"${folder.folder_name || folder.folder_path}" 폴더를 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await folderApi.deleteFolder(folder.id);
      loadFolders();
    } catch (err) {
      console.error('Failed to delete folder:', err);
      setError('폴더 삭제에 실패했습니다');
    }
  };

  // 폴더 스캔
  const handleScan = async (folderId: number) => {
    setScanningFolderId(folderId);
    try {
      await folderApi.scanFolder(folderId);
      loadFolders();
    } catch (err) {
      console.error('Failed to scan folder:', err);
      setError('폴더 스캔에 실패했습니다');
    } finally {
      setScanningFolderId(null);
    }
  };

  // 모든 폴더 스캔
  const handleScanAll = async () => {
    setScanningAll(true);
    try {
      setError(null);
      const summary = await folderApi.scanAllFolders();

      const message = `전체 스캔 완료: ${summary.totalFolders}개 폴더, 신규 ${summary.totalNew}개, 기존 ${summary.totalExisting}개${
        summary.totalErrors > 0 ? `, 오류 ${summary.totalErrors}개` : ''
      }`;

      // 성공 메시지를 Alert로 표시하기 위해 임시로 error state 활용 (추후 success state 추가 가능)
      alert(message);
      loadFolders();
    } catch (err) {
      console.error('Failed to scan all folders:', err);
      setError('전체 폴더 스캔에 실패했습니다');
    } finally {
      setScanningAll(false);
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
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">감시 폴더 목록</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<HistoryIcon />}
            onClick={() => {
              setLogFolderId(undefined);
              setLogModalOpen(true);
            }}
            size="small"
            variant="outlined"
          >
            전체 로그
          </Button>
          <Button
            startIcon={scanningAll ? <CircularProgress size={16} /> : <PlayIcon />}
            onClick={handleScanAll}
            disabled={scanningAll || folders.length === 0}
            variant="outlined"
            color="primary"
          >
            전체 스캔
          </Button>
          <Button
            startIcon={<RefreshIcon />}
            onClick={loadFolders}
            size="small"
          >
            새로고침
          </Button>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            onClick={() => handleOpenDialog()}
          >
            폴더 추가
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* 기존 폴더 카드들 */}
        {folders.map((folder) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={folder.id}>
            <Tooltip title={folder.folder_path} placement="top" arrow>
              <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                  {/* 제목 + 활성 상태 */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                    <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
                      {folder.folder_name || '이름 없음'}
                    </Typography>
                    <Chip
                      label={folder.is_active ? '활성' : '비활성'}
                      size="small"
                      color={folder.is_active ? 'success' : 'default'}
                    />
                  </Box>

                  {/* 설정 및 상태 정보 */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      {folder.auto_scan === 1 && (
                        <Chip
                          icon={<AutorenewIcon />}
                          label={`${folder.scan_interval}분`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                      {folder.last_scan_status && (
                        <Chip
                          label={getStatusText(folder.last_scan_status)}
                          size="small"
                          color={getStatusColor(folder.last_scan_status)}
                        />
                      )}
                    </Box>
                    {folder.last_scan_date && (
                      <Typography variant="caption" color="text.secondary">
                        {new Date(folder.last_scan_date).toLocaleString('ko-KR', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </Typography>
                    )}
                  </Box>
                </CardContent>

                <CardActions sx={{ pt: 0, px: 2, pb: 1.5, gap: 0.5 }}>
                <Tooltip title="스캔" arrow>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => handleScan(folder.id)}
                      disabled={scanningFolderId === folder.id}
                      color="primary"
                    >
                      {scanningFolderId === folder.id ? <CircularProgress size={18} /> : <PlayIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="로그" arrow>
                  <IconButton
                    size="small"
                    onClick={() => {
                      setLogFolderId(folder.id);
                      setLogModalOpen(true);
                    }}
                    color="primary"
                  >
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="편집" arrow>
                  <IconButton
                    size="small"
                    onClick={() => handleOpenDialog(folder)}
                    color="primary"
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="삭제" arrow>
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(folder)}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </CardActions>
              </Card>
            </Tooltip>
          </Grid>
        ))}

        {/* 폴더 추가 카드 */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card
            sx={{
              border: '2px dashed',
              borderColor: 'success.main',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 180,
              transition: 'all 0.2s',
              '&:hover': {
                backgroundColor: 'action.hover',
                borderColor: 'success.dark',
              },
            }}
            onClick={() => handleOpenDialog()}
          >
            <Box sx={{ textAlign: 'center', p: 2 }}>
              <Box
                sx={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  backgroundColor: 'success.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                }}
              >
                <AddIcon sx={{ fontSize: 40, color: 'white' }} />
              </Box>
            </Box>
          </Card>
        </Grid>
      </Grid>

      <FolderFormDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSuccess={handleDialogSuccess}
        folder={selectedFolder}
      />

      <ScanLogModal
        open={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        folderId={logFolderId}
      />
    </Box>
  );
};

export default WatchedFoldersList;
