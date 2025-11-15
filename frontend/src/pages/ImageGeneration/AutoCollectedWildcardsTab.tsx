import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  Stack,
  Alert,
  CircularProgress,
  Paper,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Divider,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  FolderOpen as FolderIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  History as HistoryIcon,
  Upload as UploadIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  wildcardApi,
  type WildcardWithItems,
  type LoraScanRequest,
  type LoraScanLog,
  type LoraFileData
} from '../../services/api/wildcardApi';

export default function AutoCollectedWildcardsTab() {
  const { t } = useTranslation(['wildcards', 'common']);

  // Scan form states
  const [loraWeight, setLoraWeight] = useState(1.0);
  const [duplicateHandling, setDuplicateHandling] = useState<'number' | 'parent'>('number');
  const [matchingMode, setMatchingMode] = useState<'filename' | 'common'>('filename');
  const [commonTextFilename, setCommonTextFilename] = useState('add.txt');
  const [matchingPriority, setMatchingPriority] = useState<'filename' | 'common'>('filename');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<LoraFileData[]>([]);

  // Auto-collected wildcards
  const [autoWildcards, setAutoWildcards] = useState<WildcardWithItems[]>([]);
  const [loading, setLoading] = useState(true);

  // Last scan log
  const [lastScanLog, setLastScanLog] = useState<LoraScanLog | null>(null);

  // Modal states
  const [openScanDialog, setOpenScanDialog] = useState(false);
  const [openLogDialog, setOpenLogDialog] = useState(false);

  useEffect(() => {
    loadAutoWildcards();
    loadLastScanLog();
  }, []);

  const loadAutoWildcards = async () => {
    try {
      setLoading(true);
      const response = await wildcardApi.getAllWildcards(true);
      // Filter only auto-collected wildcards
      const autoCollected = response.data.filter((wc: any) => wc.is_auto_collected === 1);
      setAutoWildcards(autoCollected);
    } catch (err: any) {
      console.error('Error loading auto wildcards:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLastScanLog = async () => {
    try {
      const response = await wildcardApi.getLastScanLog();
      setLastScanLog(response.data);
    } catch (err: any) {
      console.error('Error loading last scan log:', err);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setScanError(null);
    const loraFiles: LoraFileData[] = [];

    // 폴더별 공용 텍스트 파일 캐시
    const commonTextCache = new Map<string, string[]>();

    // 공용 텍스트 파일 먼저 스캔 (matchingMode가 'common'일 때)
    if (matchingMode === 'common') {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name === commonTextFilename) {
          const pathParts = file.webkitRelativePath.split('/');
          const folderPath = pathParts.slice(0, -1).join('/');
          try {
            const text = await file.text();
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            commonTextCache.set(folderPath, lines);
          } catch (err) {
            console.error('Error reading common text file:', err);
          }
        }
      }
    }

    // 파일 처리
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pathParts = file.webkitRelativePath.split('/');

      // .safetensors 파일만 처리
      if (file.name.endsWith('.safetensors')) {
        const loraName = file.name.replace('.safetensors', '');
        const folderName = pathParts.slice(1, -1).join('/') || pathParts[0];
        const folderPath = pathParts.slice(0, -1).join('/');

        let promptLines: string[] = [];

        // 매칭 우선순위에 따라 처리
        if (matchingMode === 'filename') {
          // 파일명 매칭 모드: 파일명 매칭만 사용
          const txtFileName = loraName + '.txt';
          for (let j = 0; j < files.length; j++) {
            const txtFile = files[j];
            if (txtFile.webkitRelativePath === file.webkitRelativePath.replace(file.name, txtFileName)) {
              try {
                const text = await txtFile.text();
                promptLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              } catch (err) {
                console.error('Error reading txt file:', err);
              }
              break;
            }
          }
        } else {
          // 공용 텍스트 모드
          if (matchingPriority === 'common') {
            // 공용 텍스트 우선
            if (commonTextCache.has(folderPath)) {
              promptLines = commonTextCache.get(folderPath)!;
            } else {
              // 공용 텍스트 없으면 파일명 매칭 시도
              const txtFileName = loraName + '.txt';
              for (let j = 0; j < files.length; j++) {
                const txtFile = files[j];
                if (txtFile.webkitRelativePath === file.webkitRelativePath.replace(file.name, txtFileName)) {
                  try {
                    const text = await txtFile.text();
                    promptLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                  } catch (err) {
                    console.error('Error reading txt file:', err);
                  }
                  break;
                }
              }
            }
          } else {
            // 파일명 매칭 우선
            const txtFileName = loraName + '.txt';
            let found = false;
            for (let j = 0; j < files.length; j++) {
              const txtFile = files[j];
              if (txtFile.webkitRelativePath === file.webkitRelativePath.replace(file.name, txtFileName)) {
                try {
                  const text = await txtFile.text();
                  promptLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                  found = true;
                } catch (err) {
                  console.error('Error reading txt file:', err);
                }
                break;
              }
            }
            // 파일명 매칭 실패시 공용 텍스트 사용
            if (!found && commonTextCache.has(folderPath)) {
              promptLines = commonTextCache.get(folderPath)!;
            }
          }
        }

        loraFiles.push({
          folderName,
          loraName,
          promptLines
        });
      }
    }

    setSelectedFiles(loraFiles);
  };

  const handleScan = async () => {
    if (selectedFiles.length === 0) {
      setScanError(t('wildcards:autoCollect.errors.folderPathRequired'));
      return;
    }

    if (loraWeight < 0.1 || loraWeight > 2.0) {
      setScanError(t('wildcards:autoCollect.errors.invalidWeight'));
      return;
    }

    try {
      setScanning(true);
      setScanError(null);

      const scanRequest: LoraScanRequest = {
        loraFiles: selectedFiles,
        loraWeight,
        duplicateHandling,
        matchingMode,
        commonTextFilename,
        matchingPriority
      };

      const response = await wildcardApi.scanLoraFolder(scanRequest);

      // Reload wildcards and scan log
      await loadAutoWildcards();
      await loadLastScanLog();

      // Close dialog and reset
      setOpenScanDialog(false);
      setSelectedFiles([]);

      alert(`${t('common:success')}! ${response.data.created} ${t('wildcards:autoCollect.scanLog.totalWildcards')}`);
    } catch (err: any) {
      setScanError(
        t('wildcards:autoCollect.errors.scanFailed', {
          error: err.response?.data?.error || err.message
        })
      );
    } finally {
      setScanning(false);
    }
  };

  const handleOpenScanDialog = () => {
    setScanError(null);
    setSelectedFiles([]);
    setOpenScanDialog(true);
  };

  const handleCloseScanDialog = () => {
    if (!scanning) {
      setOpenScanDialog(false);
      setScanError(null);
      setSelectedFiles([]);
    }
  };

  const handleOpenLogDialog = () => {
    setOpenLogDialog(true);
  };

  const handleCloseLogDialog = () => {
    setOpenLogDialog(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('common:confirmDelete'))) {
      return;
    }

    try {
      await wildcardApi.deleteWildcard(id);
      await loadAutoWildcards();
      await loadLastScanLog();
    } catch (err: any) {
      alert(t('common:error') + ': ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header with Title and Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">
          {t('wildcards:tabs.autoCollected')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {lastScanLog && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<HistoryIcon />}
              onClick={handleOpenLogDialog}
              color="secondary"
            >
              {t('wildcards:buttons.openLogDialog')}
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadIcon />}
            onClick={handleOpenScanDialog}
            color="primary"
          >
            {t('wildcards:buttons.openScanDialog')}
          </Button>
        </Box>
      </Box>

      {autoWildcards.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('wildcards:autoCollect.noAutoWildcards')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('wildcards:autoCollect.noAutoWildcardsDesc')}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {autoWildcards.map((wildcard) => (
            <Card key={wildcard.id} variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box flex={1}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="h6">++{wildcard.name}++</Typography>
                      <Chip
                        label={t('wildcards:autoCollect.autoCollectedBadge')}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </Stack>
                    {wildcard.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {wildcard.description}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {wildcard.items.filter((i) => i.tool === 'comfyui').length} ComfyUI{' '}
                      {t('wildcards:card.items', { count: wildcard.items.filter((i) => i.tool === 'comfyui').length })}
                    </Typography>
                  </Box>
                  <IconButton color="error" onClick={() => handleDelete(wildcard.id)}>
                    <DeleteIcon />
                  </IconButton>
                </Stack>

                {/* Show first few items */}
                <Box sx={{ mt: 2 }}>
                  {wildcard.items
                    .filter((item) => item.tool === 'comfyui')
                    .slice(0, 3)
                    .map((item, idx) => (
                      <Typography
                        key={idx}
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.85em',
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {item.content}
                      </Typography>
                    ))}
                  {wildcard.items.filter((item) => item.tool === 'comfyui').length > 3 && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {t('wildcards:card.moreItems', {
                        count: wildcard.items.filter((item) => item.tool === 'comfyui').length - 3
                      })}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* LORA Scan Dialog */}
      <Dialog
        open={openScanDialog}
        onClose={handleCloseScanDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{t('wildcards:scanDialog.title')}</DialogTitle>
        <DialogContent>
          {scanError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setScanError(null)}>
              {scanError}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="info">{t('wildcards:scanDialog.infoMessage')}</Alert>

            {/* Folder Selection */}
            <input
              type="file"
              id="lora-folder-input-dialog"
              style={{ display: 'none' }}
              // @ts-ignore - webkitdirectory is not in TypeScript definitions
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFileSelect}
            />
            <label htmlFor="lora-folder-input-dialog">
              <Button
                variant="contained"
                component="span"
                fullWidth
                size="large"
                startIcon={<FolderIcon />}
              >
                {selectedFiles.length > 0
                  ? `${selectedFiles.length}개 LORA 파일 선택됨`
                  : t('wildcards:autoCollect.folderPath')}
              </Button>
            </label>

            {/* Preview Selected Files */}
            {selectedFiles.length > 0 && (
              <Alert severity="success">
                <strong>{selectedFiles.length}개 LORA 파일</strong>을 발견했습니다:
                <Box component="ul" sx={{ mt: 1, mb: 0 }}>
                  {selectedFiles.slice(0, 5).map((file, idx) => (
                    <li key={idx}>
                      <strong>{file.loraName}</strong>
                      {file.promptLines.length > 0 && ` (${file.promptLines.length}개 프롬프트)`}
                    </li>
                  ))}
                  {selectedFiles.length > 5 && (
                    <li>...외 {selectedFiles.length - 5}개 파일</li>
                  )}
                </Box>
              </Alert>
            )}

            {/* LORA Weight */}
            <TextField
              fullWidth
              type="number"
              label={t('wildcards:autoCollect.loraWeight')}
              value={loraWeight}
              onChange={(e) => setLoraWeight(parseFloat(e.target.value))}
              helperText={t('wildcards:autoCollect.loraWeightHelper')}
              inputProps={{ min: 0.1, max: 2.0, step: 0.1 }}
            />

            {/* Duplicate Handling */}
            <FormControl component="fieldset">
              <FormLabel component="legend">{t('wildcards:autoCollect.duplicateHandling')}</FormLabel>
              <RadioGroup
                value={duplicateHandling}
                onChange={(e) => setDuplicateHandling(e.target.value as 'number' | 'parent')}
              >
                <FormControlLabel
                  value="number"
                  control={<Radio />}
                  label={t('wildcards:autoCollect.duplicateNumber')}
                />
                <FormControlLabel
                  value="parent"
                  control={<Radio />}
                  label={t('wildcards:autoCollect.duplicateParent')}
                />
              </RadioGroup>
            </FormControl>

            {/* Matching Mode */}
            <FormControl component="fieldset">
              <FormLabel component="legend">{t('wildcards:autoCollect.matchingMode')}</FormLabel>
              <RadioGroup
                value={matchingMode}
                onChange={(e) => setMatchingMode(e.target.value as 'filename' | 'common')}
              >
                <FormControlLabel
                  value="filename"
                  control={<Radio />}
                  label={t('wildcards:autoCollect.matchingModeFilename')}
                />
                <FormControlLabel
                  value="common"
                  control={<Radio />}
                  label={t('wildcards:autoCollect.matchingModeCommon')}
                />
              </RadioGroup>
            </FormControl>

            {/* Common Text Filename (shown only when matchingMode is 'common') */}
            {matchingMode === 'common' && (
              <>
                <TextField
                  fullWidth
                  label={t('wildcards:autoCollect.commonTextFilename')}
                  value={commonTextFilename}
                  onChange={(e) => setCommonTextFilename(e.target.value)}
                  helperText={t('wildcards:autoCollect.commonTextFilenameHelper')}
                />

                {/* Matching Priority */}
                <FormControl component="fieldset">
                  <FormLabel component="legend">{t('wildcards:autoCollect.matchingPriority')}</FormLabel>
                  <RadioGroup
                    value={matchingPriority}
                    onChange={(e) => setMatchingPriority(e.target.value as 'filename' | 'common')}
                  >
                    <FormControlLabel
                      value="filename"
                      control={<Radio />}
                      label={t('wildcards:autoCollect.priorityFilename')}
                    />
                    <FormControlLabel
                      value="common"
                      control={<Radio />}
                      label={t('wildcards:autoCollect.priorityCommon')}
                    />
                  </RadioGroup>
                </FormControl>
              </>
            )}

            <Alert severity="warning">
              <strong>{t('wildcards:scanDialog.warningTitle')}</strong>
              <Box component="ul" sx={{ mt: 1, mb: 0 }}>
                <li>{t('wildcards:scanDialog.warning1')}</li>
                <li>{t('wildcards:scanDialog.warning2')}</li>
                <li>{t('wildcards:scanDialog.warning3')}</li>
              </Box>
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseScanDialog} disabled={scanning}>
            {t('common:cancel')}
          </Button>
          <Button
            onClick={handleScan}
            variant="contained"
            disabled={selectedFiles.length === 0 || scanning}
            startIcon={scanning ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {scanning ? t('wildcards:autoCollect.scanning') : t('wildcards:scanDialog.scanButton')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Scan Log Dialog */}
      <Dialog
        open={openLogDialog}
        onClose={handleCloseLogDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('wildcards:logDialog.title')}</DialogTitle>
        <DialogContent>
          {lastScanLog && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('wildcards:autoCollect.scanLog.timestamp')}
                </Typography>
                <Typography>{new Date(lastScanLog.timestamp).toLocaleString()}</Typography>
              </Box>
              <Stack direction="row" spacing={4}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('wildcards:autoCollect.scanLog.totalWildcards')}
                  </Typography>
                  <Typography variant="h6">{lastScanLog.totalWildcards}</Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('wildcards:autoCollect.scanLog.totalItems')}
                  </Typography>
                  <Typography variant="h6">{lastScanLog.totalItems}</Typography>
                </Box>
              </Stack>
              <Divider />
              <Typography variant="subtitle2">{t('wildcards:autoCollect.scanLog.details')}</Typography>
              <List dense>
                {lastScanLog.wildcards.map((wc) => (
                  <ListItem key={wc.id}>
                    <ListItemText
                      primary={`++${wc.name}++`}
                      secondary={`${wc.folderName} (${wc.itemCount} ${t('wildcards:autoCollect.scanLog.itemCount')})`}
                    />
                  </ListItem>
                ))}
              </List>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLogDialog}>{t('common:close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
