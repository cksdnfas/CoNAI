import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  Paper,
  Divider,
  Tabs,
  Tab
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Refresh as RefreshIcon,
  PlayArrow as PreviewIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from 'notistack';
import { wildcardApi, type WildcardWithItems, type WildcardCreateData, type WildcardUpdateData, type ToolItems } from '../../services/api/wildcardApi';
import AutoCollectedWildcardsTab from './AutoCollectedWildcardsTab';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

// 수동 생성 탭 컴포넌트
function ManualWildcardsTab() {
  const { t } = useTranslation(['wildcards', 'common']);
  const { enqueueSnackbar } = useSnackbar();
  const [wildcards, setWildcards] = useState<WildcardWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [openDialog, setOpenDialog] = useState(false);
  const [editingWildcard, setEditingWildcard] = useState<WildcardWithItems | null>(null);
  const [currentToolTab, setCurrentToolTab] = useState(0); // 다이얼로그 내 ComfyUI/NAI 탭
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    comfyuiItems: string[];
    naiItems: string[];
  }>({
    name: '',
    description: '',
    comfyuiItems: [''],
    naiItems: ['']
  });

  // Preview states
  const [openPreview, setOpenPreview] = useState(false);
  const [previewTool, setPreviewTool] = useState<'comfyui' | 'nai'>('comfyui');
  const [previewText, setPreviewText] = useState('');
  const [previewResults, setPreviewResults] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    loadWildcards();
  }, []);

  const loadWildcards = async () => {
    try {
      setLoading(true);
      const response = await wildcardApi.getAllWildcards(true);
      // 자동 수집된 와일드카드는 수동 생성 탭에서 제외
      const manualWildcards = (response.data || []).filter((wc: any) => wc.is_auto_collected !== 1);
      setWildcards(manualWildcards);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (wildcard?: WildcardWithItems) => {
    if (wildcard) {
      setEditingWildcard(wildcard);
      const comfyuiItems = wildcard.items.filter(item => item.tool === 'comfyui').map(item => item.content);
      const naiItems = wildcard.items.filter(item => item.tool === 'nai').map(item => item.content);

      setFormData({
        name: wildcard.name,
        description: wildcard.description || '',
        comfyuiItems: comfyuiItems.length > 0 ? comfyuiItems : [''],
        naiItems: naiItems.length > 0 ? naiItems : ['']
      });
    } else {
      setEditingWildcard(null);
      setFormData({
        name: '',
        description: '',
        comfyuiItems: [''],
        naiItems: ['']
      });
    }
    setCurrentToolTab(0);
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingWildcard(null);
    setCurrentToolTab(0);
  };

  const handleSave = async () => {
    try {
      // 빈 항목 제거
      const filteredComfyuiItems = formData.comfyuiItems.filter(item => item.trim() !== '');
      const filteredNaiItems = formData.naiItems.filter(item => item.trim() !== '');

      if (!formData.name.trim()) {
        setError(t('wildcards:errors.nameRequired'));
        return;
      }

      if (filteredComfyuiItems.length === 0 && filteredNaiItems.length === 0) {
        setError(t('wildcards:errors.itemsRequired'));
        return;
      }

      const items: ToolItems = {
        comfyui: filteredComfyuiItems,
        nai: filteredNaiItems
      };

      if (editingWildcard && editingWildcard.id > 0) {
        // 수정 (id가 0보다 큰 경우만)
        const updateData: WildcardUpdateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          items
        };
        const response = await wildcardApi.updateWildcard(editingWildcard.id, updateData);

        if (response.warning) {
          setError(response.warning);
        }
      } else {
        // 생성 (editingWildcard가 없거나 id가 0인 경우)
        const createData: WildcardCreateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          items
        };
        const response = await wildcardApi.createWildcard(createData);

        if (response.warning) {
          setError(response.warning);
        }
      }

      handleCloseDialog();
      loadWildcards();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('wildcards:actions.confirmDelete', { name }))) {
      return;
    }

    try {
      await wildcardApi.deleteWildcard(id);
      loadWildcards();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleCopyName = async (wildcardName: string) => {
    try {
      await navigator.clipboard.writeText(`++${wildcardName}++`);
      enqueueSnackbar(t('wildcards:actions.copiedToClipboard'), { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(t('wildcards:errors.copyFailed'), { variant: 'error' });
    }
  };

  const handleAddItem = (tool: 'comfyui' | 'nai') => {
    setFormData(prev => ({
      ...prev,
      [tool === 'comfyui' ? 'comfyuiItems' : 'naiItems']: [
        ...(tool === 'comfyui' ? prev.comfyuiItems : prev.naiItems),
        ''
      ]
    }));
  };

  const handleRemoveItem = (tool: 'comfyui' | 'nai', index: number) => {
    setFormData(prev => ({
      ...prev,
      [tool === 'comfyui' ? 'comfyuiItems' : 'naiItems']:
        (tool === 'comfyui' ? prev.comfyuiItems : prev.naiItems).filter((_, i) => i !== index)
    }));
  };

  const handleItemChange = (tool: 'comfyui' | 'nai', index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      [tool === 'comfyui' ? 'comfyuiItems' : 'naiItems']:
        (tool === 'comfyui' ? prev.comfyuiItems : prev.naiItems).map((item, i) => i === index ? value : item)
    }));
  };

  const handlePreview = async () => {
    if (!previewText.trim()) {
      setError(t('wildcards:errors.previewTextRequired'));
      return;
    }

    try {
      setPreviewLoading(true);
      const response = await wildcardApi.parseWildcards({
        text: previewText,
        tool: previewTool,
        count: 5
      });
      setPreviewResults(response.data.results);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const getItemCount = (wildcard: WildcardWithItems, tool: 'comfyui' | 'nai') => {
    return wildcard.items.filter(item => item.tool === tool).length;
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
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h6">
          {t('wildcards:page.title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
          >
            {t('wildcards:actions.add')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<PreviewIcon />}
            onClick={() => setOpenPreview(true)}
          >
            {t('wildcards:actions.preview')}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Wildcard List */}
      <Stack spacing={2}>
        {wildcards.map((wildcard) => (
          <Card key={wildcard.id}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography
                    variant="h6"
                    component="div"
                    onClick={() => handleCopyName(wildcard.name)}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        color: 'primary.main',
                        textDecoration: 'underline'
                      }
                    }}
                  >
                    ++{wildcard.name}++
                  </Typography>
                  {wildcard.description && (
                    <Typography variant="body2" color="text.secondary">
                      {wildcard.description}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <IconButton size="small" onClick={() => handleCopyName(wildcard.name)}>
                    <CopyIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleOpenDialog(wildcard)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(wildcard.id, wildcard.name)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Chip
                  label={`ComfyUI: ${getItemCount(wildcard, 'comfyui')}${t('wildcards:card.itemsCount')}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  label={`NAI: ${getItemCount(wildcard, 'nai')}${t('wildcards:card.itemsCount')}`}
                  size="small"
                  color="secondary"
                  variant="outlined"
                />
              </Box>
            </CardContent>
          </Card>
        ))}

        {wildcards.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary">
              {t('wildcards:page.noWildcards')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('wildcards:page.noWildcardsDesc')}
            </Typography>
          </Box>
        )}
      </Stack>

      {/* Create/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingWildcard ? t('wildcards:dialog.editTitle') : t('wildcards:dialog.createTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('wildcards:form.name')}
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              fullWidth
              helperText={t('wildcards:form.nameHelper')}
            />

            <TextField
              label={t('wildcards:form.description')}
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              fullWidth
              multiline
              rows={2}
            />

            <Divider />

            {/* Tool Tabs */}
            <Box>
              <Tabs value={currentToolTab} onChange={(_, v) => setCurrentToolTab(v)}>
                <Tab label="ComfyUI" />
                <Tab label="NovelAI" />
              </Tabs>

              <TabPanel value={currentToolTab} index={0}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2">
                      {t('wildcards:form.comfyuiItems')}
                    </Typography>
                    <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddItem('comfyui')}>
                      {t('wildcards:actions.addItem')}
                    </Button>
                  </Box>

                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t('wildcards:form.itemsHelper')}
                  </Alert>

                  <Stack spacing={1}>
                    {formData.comfyuiItems.map((item, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ minWidth: 30 }}>
                          {index + 1}.
                        </Typography>
                        <TextField
                          value={item}
                          onChange={(e) => handleItemChange('comfyui', index, e.target.value)}
                          fullWidth
                          size="small"
                          placeholder={t('wildcards:form.itemPlaceholder')}
                        />
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveItem('comfyui', index)}
                          disabled={formData.comfyuiItems.length === 1}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </TabPanel>

              <TabPanel value={currentToolTab} index={1}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2">
                      {t('wildcards:form.naiItems')}
                    </Typography>
                    <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddItem('nai')}>
                      {t('wildcards:actions.addItem')}
                    </Button>
                  </Box>

                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t('wildcards:form.itemsHelper')}
                  </Alert>

                  <Stack spacing={1}>
                    {formData.naiItems.map((item, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ minWidth: 30 }}>
                          {index + 1}.
                        </Typography>
                        <TextField
                          value={item}
                          onChange={(e) => handleItemChange('nai', index, e.target.value)}
                          fullWidth
                          size="small"
                          placeholder={t('wildcards:form.itemPlaceholder')}
                        />
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveItem('nai', index)}
                          disabled={formData.naiItems.length === 1}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </TabPanel>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>{t('common:cancel')}</Button>
          <Button onClick={handleSave} variant="contained">
            {editingWildcard ? t('common:save') : t('common:create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={openPreview} onClose={() => setOpenPreview(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('wildcards:preview.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Tabs value={previewTool === 'comfyui' ? 0 : 1} onChange={(_, v) => setPreviewTool(v === 0 ? 'comfyui' : 'nai')}>
              <Tab label="ComfyUI" />
              <Tab label="NovelAI" />
            </Tabs>

            <TextField
              label={t('wildcards:preview.inputLabel')}
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              fullWidth
              multiline
              rows={3}
              placeholder={t('wildcards:preview.inputPlaceholder')}
            />

            <Button
              variant="contained"
              startIcon={previewLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
              onClick={handlePreview}
              disabled={previewLoading}
            >
              {t('wildcards:preview.generate')}
            </Button>

            {previewResults.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  {t('wildcards:preview.results')}
                </Typography>
                <Stack spacing={1}>
                  {previewResults.map((result, index) => (
                    <Box key={index} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {t('wildcards:preview.result', { number: index + 1 })}
                      </Typography>
                      <Typography variant="body2">{result}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenPreview(false)}>{t('common:close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// 메인 WildcardTab 컴포넌트 (2탭 구조)
export default function WildcardTab() {
  const { t } = useTranslation(['wildcards', 'common']);
  const [mainTabValue, setMainTabValue] = useState(0);

  const handleMainTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setMainTabValue(newValue);
  };

  return (
    <Box>
      <Tabs value={mainTabValue} onChange={handleMainTabChange} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={t('wildcards:tabs.manual')} />
        <Tab label={t('wildcards:tabs.autoCollected')} />
      </Tabs>

      <TabPanel value={mainTabValue} index={0}>
        <ManualWildcardsTab />
      </TabPanel>

      <TabPanel value={mainTabValue} index={1}>
        <AutoCollectedWildcardsTab />
      </TabPanel>
    </Box>
  );
}
