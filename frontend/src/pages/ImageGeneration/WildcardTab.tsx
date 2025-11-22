import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Stack,
  CircularProgress,
  Paper,
  Divider,
  Tabs,
  Tab,
  Tooltip,
  useMediaQuery,
  useTheme,
  FormControlLabel,
  Checkbox,
  Alert
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  PlayArrow as PreviewIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from 'notistack';
import { wildcardApi, type WildcardWithItems, type WildcardWithHierarchy, type WildcardCreateData, type WildcardUpdateData, type ToolItems } from '../../services/api/wildcardApi';
import AutoCollectedWildcardsTab from './AutoCollectedWildcardsTab';
import { HierarchyParentSelector } from '../../components/GroupTreeSelector';
import { WildcardDeleteConfirmDialog } from './components/WildcardDeleteConfirmDialog';
import { useWildcardTree } from '../../hooks/useWildcardTree';
import { WildcardTreePanel } from '../../components/Wildcard/WildcardTreePanel';
import { WildcardDetailPanel } from '../../components/Wildcard/WildcardDetailPanel';

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [hierarchicalData, setHierarchicalData] = useState<WildcardWithHierarchy[]>([]);
  const [loading, setLoading] = useState(true);

  // Use common wildcard tree hook
  const {
    selectedNode,
    expandedIds,
    handleSelect,
    handleToggle,
    handleExpandAll,
    handleCollapseAll,
    handleCopy,
    sortNodesByHierarchy,
    setSelectedNode
  } = useWildcardTree(hierarchicalData);

  // Helper function to flatten hierarchical data
  const flattenHierarchy = (nodes: WildcardWithHierarchy[]): WildcardWithHierarchy[] => {
    const result: WildcardWithHierarchy[] = [];
    const flatten = (items: WildcardWithHierarchy[]) => {
      items.forEach(item => {
        result.push(item);
        if (item.children && item.children.length > 0) {
          flatten(item.children);
        }
      });
    };
    flatten(nodes);
    return result;
  };

  const flatWildcards = flattenHierarchy(hierarchicalData);

  // Dialog states
  const [openDialog, setOpenDialog] = useState(false);
  const [editingWildcard, setEditingWildcard] = useState<WildcardWithItems | null>(null);
  const [currentToolTab, setCurrentToolTab] = useState(0);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    comfyuiItems: string[];
    naiItems: string[];
    parent_id: number | null;
    include_children: boolean;
  }>({
    name: '',
    description: '',
    comfyuiItems: [''],
    naiItems: [''],
    parent_id: null,
    include_children: true
  });

  // Preview states
  const [openPreview, setOpenPreview] = useState(false);
  const [previewTool, setPreviewTool] = useState<'comfyui' | 'nai'>('comfyui');
  const [previewText, setPreviewText] = useState('');
  const [previewResults, setPreviewResults] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [wildcardToDelete, setWildcardToDelete] = useState<WildcardWithHierarchy | null>(null);

  useEffect(() => {
    loadWildcards();
  }, []);

  const loadWildcards = async () => {
    try {
      setLoading(true);
      const response = await wildcardApi.getWildcardsHierarchical();
      // 자동 수집된 와일드카드 제외
      const filterManual = (nodes: WildcardWithHierarchy[]): WildcardWithHierarchy[] => {
        return nodes
          .filter((n: any) => n.is_auto_collected !== 1)
          .map(n => ({
            ...n,
            children: n.children ? filterManual(n.children) : undefined
          }));
      };
      const manualData = filterManual(response.data || []);
      setHierarchicalData(manualData);
    } catch (err: any) {
      enqueueSnackbar(err.response?.data?.error || err.message, { variant: 'error' });
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
        naiItems: naiItems.length > 0 ? naiItems : [''],
        parent_id: wildcard.parent_id ?? null,
        include_children: wildcard.include_children === 1
      });
    } else {
      setEditingWildcard(null);
      setFormData({
        name: '',
        description: '',
        comfyuiItems: [''],
        naiItems: [''],
        parent_id: selectedNode?.id ?? null,
        include_children: true
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
      const filteredComfyuiItems = formData.comfyuiItems.filter(item => item.trim() !== '');
      const filteredNaiItems = formData.naiItems.filter(item => item.trim() !== '');

      if (!formData.name.trim()) {
        enqueueSnackbar(t('wildcards:errors.nameRequired'), { variant: 'error' });
        return;
      }

      if (filteredComfyuiItems.length === 0 && filteredNaiItems.length === 0) {
        enqueueSnackbar(t('wildcards:errors.itemsRequired'), { variant: 'error' });
        return;
      }

      const items: ToolItems = {
        comfyui: filteredComfyuiItems,
        nai: filteredNaiItems
      };

      if (editingWildcard && editingWildcard.id > 0) {
        const updateData: WildcardUpdateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          items,
          parent_id: formData.parent_id,
          include_children: formData.include_children ? 1 : 0
        };
        const response = await wildcardApi.updateWildcard(editingWildcard.id, updateData);
        if (response.warning) {
          enqueueSnackbar(response.warning, { variant: 'warning' });
        }
      } else {
        const createData: WildcardCreateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          items,
          parent_id: formData.parent_id,
          include_children: formData.include_children ? 1 : 0
        };
        const response = await wildcardApi.createWildcard(createData);
        if (response.warning) {
          enqueueSnackbar(response.warning, { variant: 'warning' });
        }
      }

      handleCloseDialog();
      loadWildcards();
      enqueueSnackbar(
        editingWildcard
          ? t('wildcards:messages.updateSuccess')
          : t('wildcards:messages.createSuccess'),
        { variant: 'success' }
      );
    } catch (err: any) {
      enqueueSnackbar(err.response?.data?.error || err.message, { variant: 'error' });
    }
  };

  const handleDelete = (wildcard: WildcardWithHierarchy) => {
    setWildcardToDelete(wildcard);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async (cascade: boolean) => {
    if (!wildcardToDelete) return;

    try {
      await wildcardApi.deleteWildcard(wildcardToDelete.id, cascade);
      if (selectedNode?.id === wildcardToDelete.id) setSelectedNode(null);
      setDeleteDialogOpen(false);
      setWildcardToDelete(null);
      loadWildcards();
      enqueueSnackbar(t('wildcards:messages.deleteSuccess'), { variant: 'success' });
    } catch (err: any) {
      enqueueSnackbar(err.response?.data?.error || t('wildcards:messages.deleteFailed'), { variant: 'error' });
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
      enqueueSnackbar(t('wildcards:errors.previewTextRequired'), { variant: 'error' });
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
      enqueueSnackbar(err.response?.data?.error || err.message, { variant: 'error' });
    } finally {
      setPreviewLoading(false);
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">{t('wildcards:page.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={t('wildcards:actions.add')}>
            <IconButton size="small" color="primary" onClick={() => handleOpenDialog()}>
              <AddIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('wildcards:actions.preview')}>
            <IconButton size="small" onClick={() => setOpenPreview(true)}>
              <PreviewIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common:refresh')}>
            <IconButton size="small" onClick={loadWildcards}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Explorer Layout */}
      <Box sx={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: 2,
        flex: 1,
        minHeight: 0
      }}>
        {/* Left: Tree View */}
        <WildcardTreePanel
          data={hierarchicalData}
          selectedId={selectedNode?.id ?? null}
          expandedIds={expandedIds}
          onSelect={handleSelect}
          onToggle={handleToggle}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          sortChildren={sortNodesByHierarchy}
          emptyMessage={t('wildcards:page.noWildcards')}
        />

        {/* Right: Detail Panel */}
        <WildcardDetailPanel
          selectedNode={selectedNode}
          onCopy={handleCopy}
          onChildClick={handleSelect}
          sortChildren={sortNodesByHierarchy}
          emptyMessage={t('wildcards:detail.selectItem') || '좌측에서 항목을 선택하세요'}
          actionButtons={
            selectedNode ? (
              <>
                <Tooltip title={t('wildcards:actions.edit')}>
                  <IconButton size="small" onClick={() => handleOpenDialog(selectedNode)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('wildcards:actions.delete')}>
                  <IconButton size="small" color="error" onClick={() => handleDelete(selectedNode)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            ) : undefined
          }
        />
      </Box>

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

            {/* 부모 선택 */}
            <HierarchyParentSelector
              items={flatWildcards}
              selectedParentId={formData.parent_id}
              onParentChange={(parentId) => setFormData(prev => ({ ...prev, parent_id: parentId }))}
              excludeIds={editingWildcard ? [editingWildcard.id] : []}
              label={t('wildcards:form.parent')}
              noParentLabel={t('wildcards:form.noParent')}
              showItemCount={true}
            />

            {/* 하위 와일드카드 자동 포함 옵션 */}
            <Tooltip title={t('wildcards:form.includeChildrenHelper')} arrow placement="bottom">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.include_children}
                    onChange={(e) => setFormData(prev => ({ ...prev, include_children: e.target.checked }))}
                  />
                }
                label={t('wildcards:form.includeChildren')}
              />
            </Tooltip>

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
                    <Typography variant="subtitle2">{t('wildcards:form.comfyuiItems')}</Typography>
                    <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddItem('comfyui')}>
                      {t('wildcards:actions.addItem')}
                    </Button>
                  </Box>
                  <Alert severity="info" sx={{ mb: 2 }}>{t('wildcards:form.itemsHelper')}</Alert>
                  <Stack spacing={1}>
                    {formData.comfyuiItems.map((item, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ minWidth: 30 }}>{index + 1}.</Typography>
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
                    <Typography variant="subtitle2">{t('wildcards:form.naiItems')}</Typography>
                    <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddItem('nai')}>
                      {t('wildcards:actions.addItem')}
                    </Button>
                  </Box>
                  <Alert severity="info" sx={{ mb: 2 }}>{t('wildcards:form.itemsHelper')}</Alert>
                  <Stack spacing={1}>
                    {formData.naiItems.map((item, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ minWidth: 30 }}>{index + 1}.</Typography>
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
                <Typography variant="subtitle2" sx={{ mb: 2 }}>{t('wildcards:preview.results')}</Typography>
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

      {/* 삭제 확인 다이얼로그 */}
      <WildcardDeleteConfirmDialog
        open={deleteDialogOpen}
        wildcard={wildcardToDelete}
        childCount={wildcardToDelete?.children?.length || 0}
        onClose={() => {
          setDeleteDialogOpen(false);
          setWildcardToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
      />
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
