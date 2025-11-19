import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1566';

interface ScanLog {
  id: number;
  folder_id: number;
  folder_name?: string;
  folder_path?: string;
  scan_date: string;
  scan_status: string;
  total_scanned: number;
  new_images: number;
  existing_images: number;
  updated_paths: number;
  missing_images: number;
  errors_count: number;
  duration_ms: number;
  error_details: Array<{ file: string; error: string }>;
}

interface ScanLogModalProps {
  open: boolean;
  onClose: () => void;
  folderId?: number;
}

const ScanLogModal: React.FC<ScanLogModalProps> = ({ open, onClose, folderId }) => {
  const { t } = useTranslation('settings');
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadLogs();
    }
  }, [open, folderId]);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const url = folderId
        ? `${API_BASE_URL}/api/folders/${folderId}/scan-logs`
        : `${API_BASE_URL}/api/folders/scan-logs/recent`;

      const response = await axios.get(url);
      setLogs(response.data.data);
    } catch (err) {
      console.error('Failed to load scan logs:', err);
      setError(t('folderSettings.scanLog.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'success':
        return t('folderSettings.scanLog.status.success');
      case 'error':
        return t('folderSettings.scanLog.status.error');
      default:
        return status;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {folderId ? t('folderSettings.scanLog.titleSpecific') : t('folderSettings.scanLog.titleAll')}
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : logs.length === 0 ? (
          <Alert severity="info">{t('folderSettings.scanLog.noLogs')}</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('folderSettings.scanLog.columns.scanTime')}</TableCell>
                  {!folderId && <TableCell>{t('folderSettings.scanLog.columns.folder')}</TableCell>}
                  <TableCell align="center">{t('folderSettings.scanLog.columns.status')}</TableCell>
                  <TableCell align="right">{t('folderSettings.scanLog.columns.scanned')}</TableCell>
                  <TableCell align="right">{t('folderSettings.scanLog.columns.new')}</TableCell>
                  <TableCell align="right">{t('folderSettings.scanLog.columns.existing')}</TableCell>
                  <TableCell align="right">{t('folderSettings.scanLog.columns.errors')}</TableCell>
                  <TableCell align="right">{t('folderSettings.scanLog.columns.duration')}</TableCell>
                  <TableCell>{t('folderSettings.scanLog.columns.details')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Typography variant="caption">
                        {new Date(log.scan_date).toLocaleString()}
                      </Typography>
                    </TableCell>
                    {!folderId && (
                      <TableCell>
                        <Typography variant="caption" noWrap>
                          {log.folder_name || log.folder_path}
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell align="center">
                      <Chip
                        label={getStatusText(log.scan_status)}
                        size="small"
                        color={getStatusColor(log.scan_status)}
                      />
                    </TableCell>
                    <TableCell align="right">{log.total_scanned}</TableCell>
                    <TableCell align="right">{log.new_images}</TableCell>
                    <TableCell align="right">{log.existing_images}</TableCell>
                    <TableCell align="right">
                      {log.errors_count > 0 && (
                        <Chip
                          label={log.errors_count}
                          size="small"
                          color="error"
                          icon={<ErrorIcon />}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="caption">
                        {t('folderSettings.scanLog.durationSeconds', { seconds: (log.duration_ms / 1000).toFixed(2) })}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {log.error_details && log.error_details.length > 0 && (
                        <Accordion>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography variant="caption">
                              {t('folderSettings.scanLog.errorDetails', { count: log.error_details.length })}
                            </Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                              {log.error_details.map((error, idx) => (
                                <Box key={idx} sx={{ mb: 1 }}>
                                  <Typography variant="caption" fontWeight="bold">
                                    {error.file}
                                  </Typography>
                                  <Typography variant="caption" color="error" display="block">
                                    {error.error}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          </AccordionDetails>
                        </Accordion>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={loadLogs} disabled={loading}>
          {t('folderSettings.scanLog.refresh')}
        </Button>
        <Button onClick={onClose}>{t('folderSettings.scanLog.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ScanLogModal;
