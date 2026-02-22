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
  Tooltip,
  Switch
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
  PlayArrow as PlayIcon,
  History as HistoryIcon,
  Autorenew as AutorenewIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { folderApi } from '../../../../../services/folderApi';
import FolderFormDialog from './FolderFormDialog';
import ScanLogModal from './ScanLogModal';
import type { WatchedFolder } from '../../../../../types/folder';

const WatchedFoldersList: React.FC = () => {
  const { t } = useTranslation('settings');
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<WatchedFolder | null>(null);
  const [scanningFolderId, setScanningFolderId] = useState<number | null>(null);
  const [scanningAll, setScanningAll] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logFolderId, setLogFolderId] = useState<number | undefined>(undefined);
  const [watcherActioningId, setWatcherActioningId] = useState<number | null>(null);

  // 폴더 목록 로드
  const loadFolders = async () => {
    try {
      setError(null);
      const data = await folderApi.getFolders();
      // 기본 업로드 폴더 제외 (별도 섹션에서 관리)
      setFolders(data.filter(f => !f.is_default));
    } catch (err) {
      console.error('Failed to load folders:', err);
      setError(t('folderSettings.watchedFolders.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFolders();

    // 10초마다 폴더 상태 갱신 (watcher 상태 포함)
    const interval = setInterval(() => {
      loadFolders();
    }, 10000);

    return () => clearInterval(interval);
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
    if (!window.confirm(t('folderSettings.watchedFolders.messages.deleteConfirm', { name: folder.folder_name || folder.folder_path }))) {
      return;
    }

    try {
      await folderApi.deleteFolder(folder.id);
      loadFolders();
    } catch (err) {
      console.error('Failed to delete folder:', err);
      setError(t('folderSettings.watchedFolders.messages.deleteFailed'));
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
      setError(t('folderSettings.watchedFolders.messages.scanFailed'));
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

      const errorsPart = summary.totalErrors > 0
        ? t('folderSettings.watchedFolders.messages.scanAllErrors', { totalErrors: summary.totalErrors })
        : '';

      const message = t('folderSettings.watchedFolders.messages.scanAllComplete', {
        totalFolders: summary.totalFolders,
        totalNew: summary.totalNew,
        totalExisting: summary.totalExisting,
        errors: errorsPart
      });

      alert(message);
      loadFolders();
    } catch (err) {
      console.error('Failed to scan all folders:', err);
      setError(t('folderSettings.watchedFolders.messages.scanAllFailed'));
    } finally {
      setScanningAll(false);
    }
  };

  // Watcher 시작
  const handleStartWatcher = async (folderId: number) => {
    setWatcherActioningId(folderId);
    try {
      await folderApi.startWatcher(folderId);
      loadFolders();
    } catch (err) {
      console.error('Failed to start watcher:', err);
      setError(t('folderSettings.watchedFolders.messages.watcherStartFailed'));
    } finally {
      setWatcherActioningId(null);
    }
  };

  // Watcher 중지
  const handleStopWatcher = async (folderId: number) => {
    setWatcherActioningId(folderId);
    try {
      await folderApi.stopWatcher(folderId);
      loadFolders();
    } catch (err) {
      console.error('Failed to stop watcher:', err);
      setError(t('folderSettings.watchedFolders.messages.watcherStopFailed'));
    } finally {
      setWatcherActioningId(null);
    }
  };

  // Watcher 상태 텍스트 (툴팁용)
  const getWatcherStatusText = (folder: WatchedFolder) => {
    const { watcher_status, watcher_enabled } = folder;

    // watcher_enabled가 1이고 status가 NULL이면 시작 중
    if (watcher_enabled === 1 && !watcher_status) {
      return t('folderSettings.watchedFolders.watcherStatus.starting');
    }

    switch (watcher_status) {
      case 'watching':
        return t('folderSettings.watchedFolders.watcherStatus.watching');
      case 'error':
        return t('folderSettings.watchedFolders.watcherStatus.error');
      case 'stopped':
        return t('folderSettings.watchedFolders.watcherStatus.stopped');
      default:
        return t('folderSettings.watchedFolders.watcherStatus.inactive');
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
        <Typography variant="h6">{t('folderSettings.watchedFolders.title')}</Typography>
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
            {t('folderSettings.watchedFolders.viewAllLogs')}
          </Button>
          <Button
            startIcon={scanningAll ? <CircularProgress size={16} /> : <PlayIcon />}
            onClick={handleScanAll}
            disabled={scanningAll || folders.length === 0}
            variant="outlined"
            color="primary"
          >
            {t('folderSettings.watchedFolders.scanAll')}
          </Button>
          <Button
            startIcon={<RefreshIcon />}
            onClick={loadFolders}
            size="small"
          >
            {t('folderSettings.watchedFolders.refresh')}
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
            <Card
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 220,
                position: 'relative',
              }}
            >
              {/* 헤더: 폴더명 + 모든 상태 */}
              <Box sx={{
                p: 2,
                pb: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}>
                <Tooltip title={folder.folder_path} placement="top" arrow>
                  <Typography
                    variant="h6"
                    component="div"
                    sx={{
                      fontWeight: 600,
                      fontSize: '1.1rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      mb: 0.5,
                    }}
                  >
                    {folder.folder_name || t('folderSettings.watchedFolders.noName')}
                  </Typography>
                </Tooltip>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* 활성 상태 */}
                  <Chip
                    label={folder.is_active ? t('folderSettings.watchedFolders.active') : t('folderSettings.watchedFolders.inactive')}
                    size="small"
                    color={folder.is_active ? 'success' : 'default'}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />

                  {/* 자동 스캔 설정 */}
                  {folder.auto_scan === 1 && (
                    <Chip
                      icon={<AutorenewIcon sx={{ fontSize: 14 }} />}
                      label={t('folderSettings.watchedFolders.autoScanInterval', { interval: folder.scan_interval })}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  )}

                  {/* 스캔 상태 - 색상으로만 표시 */}
                  {folder.last_scan_status && (
                    <Chip
                      label={t('folderSettings.watchedFolders.scanStatus')}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        color:
                          folder.last_scan_status === 'success' ? 'success.main' :
                          folder.last_scan_status === 'error' ? 'error.main' :
                          folder.last_scan_status === 'in_progress' ? 'info.main' : 'grey.500',
                        borderColor:
                          folder.last_scan_status === 'success' ? 'success.main' :
                          folder.last_scan_status === 'error' ? 'error.main' :
                          folder.last_scan_status === 'in_progress' ? 'info.main' : 'grey.400',
                      }}
                      variant="outlined"
                    />
                  )}

                  {/* 감시 상태 - 아이콘으로만 표시 */}
                  {folder.watcher_enabled === 1 && (
                    <Tooltip title={getWatcherStatusText(folder)} arrow>
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 32,
                          height: 20,
                          border: '1px solid',
                          borderRadius: '10px',
                          color:
                            folder.watcher_status === 'watching' ? 'success.main' :
                            folder.watcher_status === 'error' ? 'error.main' : 'grey.500',
                          borderColor:
                            folder.watcher_status === 'watching' ? 'success.main' :
                            folder.watcher_status === 'error' ? 'error.main' : 'grey.400',
                        }}
                      >
                        {folder.watcher_status === 'watching' ? (
                          <VisibilityIcon sx={{ fontSize: 14 }} />
                        ) : folder.watcher_status === 'error' ? (
                          <VisibilityOffIcon sx={{ fontSize: 14 }} />
                        ) : (
                          <VisibilityOffIcon sx={{ fontSize: 14 }} />
                        )}
                      </Box>
                    </Tooltip>
                  )}
                </Box>
              </Box>

              {/* 메인: 타임스탬프 + 에러 메시지 */}
              <CardContent sx={{ flexGrow: 1, p: 2, pb: 1, minHeight: 60 }}>
                {folder.watcher_error ? (
                  <Alert severity="error" sx={{ py: 0.5, fontSize: '0.75rem' }}>
                    {folder.watcher_error}
                  </Alert>
                ) : (
                  <Box>
                    {folder.last_scan_date ? (
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>
                        {t('folderSettings.watchedFolders.lastScan', {
                          date: new Date(folder.last_scan_date).toLocaleString('ko-KR', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        })}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>
                        {t('folderSettings.watchedFolders.noScanHistory')}
                      </Typography>
                    )}
                  </Box>
                )}
              </CardContent>

              {/* 푸터: 토글 스위치 + 액션 버튼 */}
              <CardActions sx={{
                p: 2,
                pt: 1,
                borderTop: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                {/* 왼쪽: 감시 토글 스위치 */}
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {folder.watcher_enabled === 1 && (
                    <Tooltip
                      title={
                        watcherActioningId === folder.id ? t('folderSettings.watchedFolders.tooltips.processing') :
                        folder.watcher_status === 'watching' ? t('folderSettings.watchedFolders.tooltips.watcherStop') : t('folderSettings.watchedFolders.tooltips.watcherStart')
                      }
                      arrow
                    >
                      <Switch
                        size="small"
                        checked={folder.watcher_status === 'watching'}
                        onChange={(e) => {
                          if (e.target.checked) {
                            handleStartWatcher(folder.id);
                          } else {
                            handleStopWatcher(folder.id);
                          }
                        }}
                        disabled={watcherActioningId === folder.id}
                        color="success"
                      />
                    </Tooltip>
                  )}
                </Box>

                {/* 오른쪽: 액션 버튼 */}
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <Tooltip title={t('folderSettings.watchedFolders.tooltips.scan')} arrow>
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
                  <Tooltip title={t('folderSettings.watchedFolders.tooltips.log')} arrow>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setLogFolderId(folder.id);
                        setLogModalOpen(true);
                      }}
                    >
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('folderSettings.watchedFolders.tooltips.edit')} arrow>
                    <IconButton
                      size="small"
                      onClick={() => handleOpenDialog(folder)}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('folderSettings.watchedFolders.tooltips.delete')} arrow>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(folder)}
                      color="error"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </CardActions>
            </Card>
          </Grid>
        ))}

        {/* 폴더 추가 카드 */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card
            sx={{
              border: '2px dashed',
              borderColor: 'primary.main',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 220,
              transition: 'all 0.2s',
              '&:hover': {
                backgroundColor: 'action.hover',
                borderColor: 'primary.dark',
                '& .add-icon-circle': {
                  transform: 'scale(1.1)',
                  backgroundColor: 'primary.dark',
                },
              },
            }}
            onClick={() => handleOpenDialog()}
          >
            <Box sx={{ textAlign: 'center', p: 2 }}>
              <Box
                className="add-icon-circle"
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  backgroundColor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                  transition: 'all 0.2s',
                }}
              >
                <AddIcon sx={{ fontSize: 32, color: 'white' }} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('folderSettings.watchedFolders.addFolder')}
              </Typography>
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
