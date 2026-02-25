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
  AccordionDetails,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Error as ErrorIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { fileVerificationApi, type VerificationLog } from '../../../../../services/fileVerificationApi';

interface FileVerificationLogModalProps {
  open: boolean;
  onClose: () => void;
}

const FileVerificationLogModal: React.FC<FileVerificationLogModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation('settings');
  const [logs, setLogs] = useState<VerificationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadLogs();
    }
  }, [open]);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fileVerificationApi.getLogs(50);
      setLogs(data);
    } catch (err) {
      console.error('Failed to load verification logs:', err);
      setError(t('folderSettings.verificationLog.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return t('folderSettings.verificationLog.durationMs', { ms });
    }
    const seconds = (ms / 1000).toFixed(2);
    return t('folderSettings.verificationLog.durationSeconds', { seconds });
  };

  const getVerificationTypeText = (type: string) => {
    switch (type) {
      case 'auto':
        return t('folderSettings.verificationLog.verificationType.auto');
      case 'manual':
        return t('folderSettings.verificationLog.verificationType.manual');
      default:
        return type;
    }
  };

  const parseErrorDetails = (errorDetails: string | null) => {
    if (!errorDetails) return [];
    try {
      return JSON.parse(errorDetails);
    } catch {
      return [];
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <CheckCircleIcon color="primary" />
          <Typography variant="h6">{t('folderSettings.verificationLog.title')}</Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && logs.length === 0 && (
          <Alert severity="info">{t('folderSettings.verificationLog.noLogs')}</Alert>
        )}

        {!loading && !error && logs.length > 0 && (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('folderSettings.verificationLog.columns.verificationTime')}</TableCell>
                  <TableCell align="center">{t('folderSettings.verificationLog.columns.verificationType')}</TableCell>
                  <TableCell align="right">{t('folderSettings.verificationLog.columns.checked')}</TableCell>
                  <TableCell align="right">{t('folderSettings.verificationLog.columns.missingFound')}</TableCell>
                  <TableCell align="right">{t('folderSettings.verificationLog.columns.deletedRecords')}</TableCell>
                  <TableCell align="right">{t('folderSettings.verificationLog.columns.errors')}</TableCell>
                  <TableCell align="right">{t('folderSettings.verificationLog.columns.duration')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => {
                  const errors = parseErrorDetails(log.error_details);
                  const hasErrors = log.error_count > 0 || errors.length > 0;

                  return (
                    <React.Fragment key={log.id}>
                      <TableRow hover>
                        <TableCell>{formatDate(log.verification_date)}</TableCell>
                        <TableCell align="center">
                          <Chip
                            label={getVerificationTypeText(log.verification_type)}
                            size="small"
                            color={log.verification_type === 'auto' ? 'default' : 'primary'}
                          />
                        </TableCell>
                        <TableCell align="right">{log.total_checked.toLocaleString()}</TableCell>
                        <TableCell align="right">
                          {log.missing_found > 0 ? (
                            <Chip
                              label={t('folderSettings.verificationLog.countFormat', { count: log.missing_found })}
                              size="small"
                              color="warning"
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {t('folderSettings.verificationLog.countFormat', { count: 0 })}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {log.deleted_records > 0 ? (
                            <Chip
                              label={t('folderSettings.verificationLog.countFormat', { count: log.deleted_records })}
                              size="small"
                              color="error"
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {t('folderSettings.verificationLog.countFormat', { count: 0 })}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {hasErrors ? (
                            <Chip
                              label={t('folderSettings.verificationLog.countFormat', { count: log.error_count })}
                              size="small"
                              color="error"
                              icon={<ErrorIcon />}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {t('folderSettings.verificationLog.noErrors')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{formatDuration(log.duration_ms)}</TableCell>
                      </TableRow>

                      {hasErrors && errors.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={7} sx={{ py: 0 }}>
                            <Accordion sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
                              <AccordionSummary
                                expandIcon={<ExpandMoreIcon />}
                                sx={{ minHeight: 'auto', '& .MuiAccordionSummary-content': { my: 1 } }}
                              >
                                <Box display="flex" alignItems="center" gap={1}>
                                  <ErrorIcon color="error" fontSize="small" />
                                  <Typography variant="body2" color="error">
                                    {t('folderSettings.verificationLog.errorDetails', { count: errors.length })}
                                  </Typography>
                                </Box>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                                  {errors.map((err: any, idx: number) => (
                                    <Box key={idx} sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                                      <Typography variant="caption" display="block" color="error" fontWeight="bold">
                                        {t('folderSettings.verificationLog.errorItem.fileId', { id: err.fileId })}
                                      </Typography>
                                      <Typography variant="caption" display="block" sx={{ wordBreak: 'break-all' }}>
                                        {t('folderSettings.verificationLog.errorItem.path', { path: err.filePath })}
                                      </Typography>
                                      <Typography variant="caption" display="block" color="text.secondary">
                                        {t('folderSettings.verificationLog.errorItem.error', { error: err.error })}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Box>
                              </AccordionDetails>
                            </Accordion>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={loadLogs} disabled={loading}>
          {t('folderSettings.verificationLog.refresh')}
        </Button>
        <Button onClick={onClose} variant="contained">
          {t('folderSettings.verificationLog.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FileVerificationLogModal;
