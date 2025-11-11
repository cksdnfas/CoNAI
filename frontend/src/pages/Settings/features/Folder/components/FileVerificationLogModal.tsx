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
import { fileVerificationApi, type VerificationLog } from '../../../../../services/fileVerificationApi';

interface FileVerificationLogModalProps {
  open: boolean;
  onClose: () => void;
}

const FileVerificationLogModal: React.FC<FileVerificationLogModalProps> = ({ open, onClose }) => {
  const [logs, setLogs] = useState<VerificationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 로그 로드
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
      setError('검증 로그를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  // 날짜 포맷팅
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

  // 소요 시간 포맷팅
  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = (ms / 1000).toFixed(2);
    return `${seconds}초`;
  };

  // 검증 타입 텍스트
  const getVerificationTypeText = (type: string) => {
    switch (type) {
      case 'auto':
        return '자동 검증';
      case 'manual':
        return '수동 검증';
      default:
        return type;
    }
  };

  // 에러 상세 파싱
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
          <Typography variant="h6">파일 검증 로그</Typography>
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
          <Alert severity="info">검증 로그가 없습니다</Alert>
        )}

        {!loading && !error && logs.length > 0 && (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>검증 시간</TableCell>
                  <TableCell align="center">검증 타입</TableCell>
                  <TableCell align="right">확인 파일</TableCell>
                  <TableCell align="right">누락 발견</TableCell>
                  <TableCell align="right">삭제 레코드</TableCell>
                  <TableCell align="right">오류</TableCell>
                  <TableCell align="right">소요 시간</TableCell>
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
                        <TableCell align="right">{log.total_checked.toLocaleString()}개</TableCell>
                        <TableCell align="right">
                          {log.missing_found > 0 ? (
                            <Chip
                              label={`${log.missing_found}개`}
                              size="small"
                              color="warning"
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              0개
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {log.deleted_records > 0 ? (
                            <Chip
                              label={`${log.deleted_records}개`}
                              size="small"
                              color="error"
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              0개
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {hasErrors ? (
                            <Chip
                              label={`${log.error_count}개`}
                              size="small"
                              color="error"
                              icon={<ErrorIcon />}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              없음
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{formatDuration(log.duration_ms)}</TableCell>
                      </TableRow>

                      {/* 에러 상세 정보 */}
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
                                    오류 상세 ({errors.length}개)
                                  </Typography>
                                </Box>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                                  {errors.map((err: any, idx: number) => (
                                    <Box key={idx} sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                                      <Typography variant="caption" display="block" color="error" fontWeight="bold">
                                        파일 ID: {err.fileId}
                                      </Typography>
                                      <Typography variant="caption" display="block" sx={{ wordBreak: 'break-all' }}>
                                        경로: {err.filePath}
                                      </Typography>
                                      <Typography variant="caption" display="block" color="text.secondary">
                                        오류: {err.error}
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
          새로고침
        </Button>
        <Button onClick={onClose} variant="contained">
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FileVerificationLogModal;
