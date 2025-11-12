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
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  FolderOpen as FolderIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon
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
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<LoraFileData[]>([]);

  // Auto-collected wildcards
  const [autoWildcards, setAutoWildcards] = useState<WildcardWithItems[]>([]);
  const [loading, setLoading] = useState(true);

  // Last scan log
  const [lastScanLog, setLastScanLog] = useState<LoraScanLog | null>(null);

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

    // 파일 처리
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pathParts = file.webkitRelativePath.split('/');

      // .safetensors 파일만 처리
      if (file.name.endsWith('.safetensors')) {
        const loraName = file.name.replace('.safetensors', '');
        const folderName = pathParts.slice(1, -1).join('/') || pathParts[0];

        // 매칭되는 txt 파일 찾기
        const txtFileName = loraName + '.txt';
        let promptLines: string[] = [];

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
        duplicateHandling
      };

      const response = await wildcardApi.scanLoraFolder(scanRequest);

      // Reload wildcards and scan log
      await loadAutoWildcards();
      await loadLastScanLog();

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
      {/* Scan Form */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          {t('wildcards:autoCollect.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('wildcards:autoCollect.description')}
        </Typography>

        <Stack spacing={3}>
          {/* Folder Selection */}
          <Box>
            <input
              type="file"
              id="lora-folder-input"
              style={{ display: 'none' }}
              // @ts-ignore - webkitdirectory is not in TypeScript definitions
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFileSelect}
            />
            <label htmlFor="lora-folder-input">
              <Button
                variant="outlined"
                component="span"
                fullWidth
                startIcon={<FolderIcon />}
                sx={{ py: 1.5 }}
              >
                {selectedFiles.length > 0
                  ? `${selectedFiles.length} ${t('wildcards:autoCollect.folderPath')} 선택됨`
                  : t('wildcards:autoCollect.folderPath')}
              </Button>
            </label>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {t('wildcards:autoCollect.folderPathHelper')}
            </Typography>
          </Box>

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

          {/* Error Alert */}
          {scanError && (
            <Alert severity="error" onClose={() => setScanError(null)}>
              {scanError}
            </Alert>
          )}

          {/* Scan Button */}
          <Button
            variant="contained"
            size="large"
            onClick={handleScan}
            disabled={scanning}
            startIcon={scanning ? <CircularProgress size={20} /> : <RefreshIcon />}
          >
            {scanning ? t('wildcards:autoCollect.scanning') : t('wildcards:autoCollect.scanButton')}
          </Button>
        </Stack>
      </Paper>

      {/* Last Scan Log */}
      {lastScanLog && (
        <Accordion sx={{ mb: 3 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">{t('wildcards:autoCollect.scanLog.title')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
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
          </AccordionDetails>
        </Accordion>
      )}

      {/* Auto-Collected Wildcards List */}
      <Typography variant="h6" gutterBottom>
        {t('wildcards:tabs.autoCollected')}
      </Typography>

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
    </Box>
  );
}
