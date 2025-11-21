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
  Alert,
  CircularProgress,
  Paper,
  Divider,
  Tabs,
  Tab,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Tooltip,
  useMediaQuery,
  useTheme,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Refresh as RefreshIcon,
  PlayArrow as PreviewIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Description as FileIcon,
  ExpandLess,
  ExpandMore
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from 'notistack';
import { wildcardApi, type WildcardWithItems, type WildcardWithHierarchy, type WildcardCreateData, type WildcardUpdateData, type ToolItems } from '../../services/api/wildcardApi';
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

// 트리 노드 컴포넌트
interface TreeNodeProps {
  node: WildcardWithHierarchy;
  level: number;
  selectedId: number | null;
  expandedIds: Set<number>;
  onSelect: (node: WildcardWithHierarchy) => void;
  onToggle: (id: number) => void;
}

function TreeNode({ node, level, selectedId, expandedIds, onSelect, onToggle }: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  // 하위 계층이 있는 노드(폴더)를 먼저 정렬
  const sortedChildren = hasChildren
    ? [...node.children!].sort((a, b) => {
        const aHasChildren = a.children && a.children.length > 0;
        const bHasChildren = b.children && b.children.length > 0;
        if (aHasChildren && !bHasChildren) return -1;
        if (!aHasChildren && bHasChildren) return 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  const handleClick = () => {
    onSelect(node);
    if (hasChildren && !isExpanded) {
      onToggle(node.id);
    }
  };

  return (
    <>
      <ListItemButton
        selected={isSelected}
        onClick={handleClick}
        sx={{ pl: 2 + level * 2 }}
      >
        {hasChildren ? (
          <ListItemIcon sx={{ minWidth: 32 }}>
            {isExpanded ? <FolderOpenIcon color="primary" /> : <FolderIcon color="primary" />}
          </ListItemIcon>
        ) : (
          <ListItemIcon sx={{ minWidth: 32 }}>
            <FileIcon color="action" />
          </ListItemIcon>
        )}
        <ListItemText
          primary={node.name}
          primaryTypographyProps={{ noWrap: true, fontSize: '0.875rem' }}
        />
        {hasChildren && (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          >
            {isExpanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        )}
      </ListItemButton>
      {hasChildren && (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {sortedChildren.map(child => (
              <TreeNode
                key={child.id}
                node={child}
                level={level + 1}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}

// 수동 생성 탭 컴포넌트
function ManualWildcardsTab() {
  const { t } = useTranslation(['wildcards', 'common']);
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [hierarchicalData, setHierarchicalData] = useState<WildcardWithHierarchy[]>([]);
  const [flatWildcards, setFlatWildcards] = useState<WildcardWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tree state
  const [selectedNode, setSelectedNode] = useState<WildcardWithHierarchy | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

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
  }>({
    name: '',
    description: '',
    comfyuiItems: [''],
    naiItems: [''],
    parent_id: null
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

      // Flat 목록도 로드 (부모 선택용)
      const flatResponse = await wildcardApi.getAllWildcards(false);
      const manualFlat = (flatResponse.data || []).filter((wc: any) => wc.is_auto_collected !== 1);
      setFlatWildcards(manualFlat);

      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (id: number) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleSelect = (node: WildcardWithHierarchy) => {
    setSelectedNode(node);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      enqueueSnackbar(`"${text}" ${t('wildcards:actions.copiedToClipboard') || '클립보드에 복사됨!'}`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(t('wildcards:errors.copyFailed') || '복사 실패', { variant: 'error' });
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
        parent_id: wildcard.parent_id ?? null
      });
    } else {
      setEditingWildcard(null);
      setFormData({
        name: '',
        description: '',
        comfyuiItems: [''],
        naiItems: [''],
        parent_id: selectedNode?.id ?? null
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
        const updateData: WildcardUpdateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          items,
          parent_id: formData.parent_id
        };
        const response = await wildcardApi.updateWildcard(editingWildcard.id, updateData);
        if (response.warning) setError(response.warning);
      } else {
        const createData: WildcardCreateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          items,
          parent_id: formData.parent_id
        };
        const response = await wildcardApi.createWildcard(createData);
        if (response.warning) setError(response.warning);
      }

      handleCloseDialog();
      loadWildcards();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('wildcards:actions.confirmDelete', { name }))) return;

    try {
      await wildcardApi.deleteWildcard(id);
      if (selectedNode?.id === id) setSelectedNode(null);
      loadWildcards();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
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

  // 정렬된 루트 노드 (폴더 먼저)
  const sortedRootNodes = [...hierarchicalData].sort((a, b) => {
    const aHasChildren = a.children && a.children.length > 0;
    const bHasChildren = b.children && b.children.length > 0;
    if (aHasChildren && !bHasChildren) return -1;
    if (!aHasChildren && bHasChildren) return 1;
    return a.name.localeCompare(b.name);
  });

  // 선택된 노드의 하위 항목들 (폴더 먼저 정렬)
  const childItems = selectedNode?.children
    ? [...selectedNode.children].sort((a, b) => {
        const aHasChildren = a.children && a.children.length > 0;
        const bHasChildren = b.children && b.children.length > 0;
        if (aHasChildren && !bHasChildren) return -1;
        if (!aHasChildren && bHasChildren) return 1;
        return a.name.localeCompare(b.name);
      })
    : [];

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

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Explorer Layout */}
      <Box sx={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: 2,
        flex: 1,
        minHeight: 0
      }}>
        {/* Left: Tree View */}
        <Paper
          variant="outlined"
          sx={{
            width: isMobile ? '100%' : 280,
            minWidth: isMobile ? 'auto' : 200,
            maxHeight: isMobile ? 300 : 'none',
            overflow: 'auto',
            flexShrink: 0
          }}
        >
          <List component="nav" dense>
            {sortedRootNodes.map(node => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedNode?.id ?? null}
                expandedIds={expandedIds}
                onSelect={handleSelect}
                onToggle={handleToggle}
              />
            ))}
            {sortedRootNodes.length === 0 && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('wildcards:page.noWildcards')}
                </Typography>
              </Box>
            )}
          </List>
        </Paper>

        {/* Right: Detail Panel */}
        <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {selectedNode ? (
            <Box>
              {/* Selected Item Header */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography
                    variant="h6"
                    onClick={() => handleCopy(`++${selectedNode.name}++`)}
                    sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                  >
                    ++{selectedNode.name}++
                  </Typography>
                  {selectedNode.description && (
                    <Typography variant="body2" color="text.secondary">{selectedNode.description}</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title={t('wildcards:actions.copy')}>
                    <IconButton size="small" onClick={() => handleCopy(`++${selectedNode.name}++`)}>
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('wildcards:actions.edit')}>
                    <IconButton size="small" onClick={() => handleOpenDialog(selectedNode)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('wildcards:actions.delete')}>
                    <IconButton size="small" color="error" onClick={() => handleDelete(selectedNode.id, selectedNode.name)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Item Counts */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Chip
                  label={`ComfyUI: ${getItemCount(selectedNode, 'comfyui')}${t('wildcards:card.itemsCount')}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  label={`NAI: ${getItemCount(selectedNode, 'nai')}${t('wildcards:card.itemsCount')}`}
                  size="small"
                  color="secondary"
                  variant="outlined"
                />
              </Box>

              {/* Child Items */}
              {childItems.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('wildcards:detail.children') || '하위 항목'}
                  </Typography>
                  <List dense>
                    {childItems.map(child => {
                      const hasSubChildren = child.children && child.children.length > 0;
                      return (
                        <ListItemButton
                          key={child.id}
                          onClick={() => handleSelect(child)}
                          sx={{ borderRadius: 1, mb: 0.5 }}
                        >
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            {hasSubChildren ? <FolderIcon color="primary" /> : <FileIcon color="action" />}
                          </ListItemIcon>
                          <ListItemText
                            primary={child.name}
                            secondary={`ComfyUI: ${getItemCount(child, 'comfyui')}, NAI: ${getItemCount(child, 'nai')}`}
                          />
                          <Tooltip title={t('wildcards:actions.copy')}>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); handleCopy(`++${child.name}++`); }}
                            >
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemButton>
                      );
                    })}
                  </List>
                </Box>
              )}

              {/* Items Preview */}
              {selectedNode.items.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('wildcards:detail.items') || '항목 목록'}
                  </Typography>
                  <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                    {selectedNode.items.slice(0, 20).map((item, idx) => (
                      <Chip
                        key={idx}
                        label={item.content}
                        size="small"
                        variant="outlined"
                        color={item.tool === 'comfyui' ? 'primary' : 'secondary'}
                        sx={{ m: 0.25 }}
                        onClick={() => handleCopy(item.content)}
                      />
                    ))}
                    {selectedNode.items.length > 20 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        +{selectedNode.items.length - 20} {t('wildcards:detail.moreItems') || '더 보기'}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
              <Typography variant="body2" color="text.secondary">
                {t('wildcards:detail.selectItem') || '좌측에서 항목을 선택하세요'}
              </Typography>
            </Box>
          )}
        </Paper>
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
            <FormControl fullWidth>
              <InputLabel>{t('wildcards:form.parent') || '상위 와일드카드'}</InputLabel>
              <Select
                value={formData.parent_id ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, parent_id: e.target.value === '' ? null : Number(e.target.value) }))}
                label={t('wildcards:form.parent') || '상위 와일드카드'}
              >
                <MenuItem value="">{t('wildcards:form.noParent') || '없음 (루트)'}</MenuItem>
                {flatWildcards
                  .filter(wc => wc.id !== editingWildcard?.id)
                  .map(wc => (
                    <MenuItem key={wc.id} value={wc.id}>{wc.name}</MenuItem>
                  ))
                }
              </Select>
            </FormControl>

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
