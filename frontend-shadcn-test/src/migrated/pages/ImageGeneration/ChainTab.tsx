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
    Alert,
    RadioGroup,
    Radio,
    InputAdornment
} from '@mui/material';
import {
    Add as AddIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    PlayArrow as PreviewIcon,
    Link as ChainIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from 'notistack';
import { wildcardApi, type WildcardWithItems, type WildcardWithHierarchy, type WildcardCreateData, type WildcardUpdateData, type ToolItems } from '../../services/api/wildcardApi';
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

export default function ChainTab() {
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

    const flatChains = flattenHierarchy(hierarchicalData);

    // Dialog states
    const [openDialog, setOpenDialog] = useState(false);
    const [editingChain, setEditingChain] = useState<WildcardWithItems | null>(null);
    const [currentToolTab, setCurrentToolTab] = useState(0);

    // Form Data Type
    type ChainItem = { content: string; weight: number };
    const [formData, setFormData] = useState<{
        name: string;
        description: string;
        comfyuiItems: ChainItem[];
        naiItems: ChainItem[];
        parent_id: number | null;
        include_children: boolean;
        only_children: boolean;
        chain_option: 'replace' | 'append';
    }>({
        name: '',
        description: '',
        comfyuiItems: [{ content: '', weight: 1.0 }],
        naiItems: [{ content: '', weight: 1.0 }],
        parent_id: null,
        include_children: false,
        only_children: false,
        chain_option: 'replace'
    });

    // Preview states
    const [openPreview, setOpenPreview] = useState(false);
    const [previewTool, setPreviewTool] = useState<'comfyui' | 'nai'>('comfyui');
    const [previewText, setPreviewText] = useState('');
    const [previewResults, setPreviewResults] = useState<string[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);

    // Delete confirmation dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [chainToDelete, setChainToDelete] = useState<WildcardWithHierarchy | null>(null);

    useEffect(() => {
        loadChains();
    }, []);

    const loadChains = async () => {
        try {
            setLoading(true);
            const response = await wildcardApi.getWildcardsHierarchical();

            // 체인 타입만 필터링
            const filterChains = (nodes: WildcardWithHierarchy[]): WildcardWithHierarchy[] => {
                return nodes
                    .filter((n: any) => n.type === 'chain')
                    .map(n => ({
                        ...n,
                        children: n.children ? filterChains(n.children) : undefined
                    }));
            };
            const chainData = filterChains(response.data || []);
            setHierarchicalData(chainData);
        } catch (err: any) {
            enqueueSnackbar(err.response?.data?.error || err.message, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleOpenDialog = (chain?: WildcardWithItems) => {
        if (chain) {
            setEditingChain(chain);
            // Map items to include weight
            const comfyuiItems = chain.items
                .filter(item => item.tool === 'comfyui')
                .map(item => ({ content: item.content, weight: item.weight || 1.0 }));

            const naiItems = chain.items
                .filter(item => item.tool === 'nai')
                .map(item => ({ content: item.content, weight: item.weight || 1.0 }));

            setFormData({
                name: chain.name,
                description: chain.description || '',
                comfyuiItems: comfyuiItems.length > 0 ? comfyuiItems : [{ content: '', weight: 1.0 }],
                naiItems: naiItems.length > 0 ? naiItems : [{ content: '', weight: 1.0 }],
                parent_id: chain.parent_id ?? null,
                include_children: chain.include_children === 1,
                only_children: chain.only_children === 1,
                chain_option: chain.chain_option || 'replace'
            });
        } else {
            setEditingChain(null);
            setFormData({
                name: '',
                description: '',
                comfyuiItems: [{ content: '', weight: 1.0 }],
                naiItems: [{ content: '', weight: 1.0 }],
                parent_id: selectedNode?.id ?? null,
                include_children: false,
                only_children: false,
                chain_option: 'replace'
            });
        }
        setCurrentToolTab(0);
        setOpenDialog(true);
    };

    const handleCloseDialog = () => {
        setOpenDialog(false);
        setEditingChain(null);
        setCurrentToolTab(0);
    };

    const handleSave = async () => {
        try {
            const filteredComfyuiItems = formData.comfyuiItems.filter(item => item.content.trim() !== '');
            const filteredNaiItems = formData.naiItems.filter(item => item.content.trim() !== '');

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

            if (editingChain && editingChain.id > 0) {
                const updateData: WildcardUpdateData = {
                    name: formData.name.trim(),
                    description: formData.description.trim() || undefined,
                    items,
                    parent_id: formData.parent_id,
                    include_children: formData.include_children ? 1 : 0,
                    only_children: formData.only_children ? 1 : 0,
                    type: 'chain',
                    chain_option: formData.chain_option
                };
                const response = await wildcardApi.updateWildcard(editingChain.id, updateData);
                if (response.warning) {
                    enqueueSnackbar(response.warning, { variant: 'warning' });
                }
            } else {
                const createData: WildcardCreateData = {
                    name: formData.name.trim(),
                    description: formData.description.trim() || undefined,
                    items,
                    parent_id: formData.parent_id,
                    include_children: formData.include_children ? 1 : 0,
                    only_children: formData.only_children ? 1 : 0,
                    type: 'chain',
                    chain_option: formData.chain_option
                };
                const response = await wildcardApi.createWildcard(createData);
                if (response.warning) {
                    enqueueSnackbar(response.warning, { variant: 'warning' });
                }
            }

            handleCloseDialog();
            loadChains();
            enqueueSnackbar(
                editingChain
                    ? t('wildcards:messages.updateSuccess')
                    : t('wildcards:messages.createSuccess'),
                { variant: 'success' }
            );
        } catch (err: any) {
            enqueueSnackbar(err.response?.data?.error || err.message, { variant: 'error' });
        }
    };

    const handleDelete = (chain: WildcardWithHierarchy) => {
        setChainToDelete(chain);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async (cascade: boolean) => {
        if (!chainToDelete) return;

        try {
            await wildcardApi.deleteWildcard(chainToDelete.id, cascade);
            if (selectedNode?.id === chainToDelete.id) setSelectedNode(null);
            setDeleteDialogOpen(false);
            setChainToDelete(null);
            loadChains();
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
                { content: '', weight: 1.0 }
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

    const handleItemContentChange = (tool: 'comfyui' | 'nai', index: number, value: string) => {
        setFormData(prev => ({
            ...prev,
            [tool === 'comfyui' ? 'comfyuiItems' : 'naiItems']:
                (tool === 'comfyui' ? prev.comfyuiItems : prev.naiItems).map((item, i) =>
                    i === index ? { ...item, content: value } : item
                )
        }));
    };

    const handleItemWeightChange = (tool: 'comfyui' | 'nai', index: number, value: string) => {
        const weight = parseFloat(value);
        // 허용하지 않는 값이면 무시하거나 기본값 처리 (여기서는 input type=number로 제어하므로 그대로 파싱)

        setFormData(prev => ({
            ...prev,
            [tool === 'comfyui' ? 'comfyuiItems' : 'naiItems']:
                (tool === 'comfyui' ? prev.comfyuiItems : prev.naiItems).map((item, i) =>
                    i === index ? { ...item, weight: isNaN(weight) ? 0 : weight } : item
                )
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

    const renderItemInputs = (items: ChainItem[], tool: 'comfyui' | 'nai') => (
        <Stack spacing={1}>
            {items.map((item, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 20 }}>{index + 1}.</Typography>
                    <TextField
                        value={item.content}
                        onChange={(e) => handleItemContentChange(tool, index, e.target.value)}
                        fullWidth
                        size="small"
                        placeholder={t('wildcards:form.itemPlaceholder')}
                        sx={{ flex: 1 }}
                    />
                    <TextField
                        label={t('wildcards:form.weight')}
                        type="number"
                        value={item.weight}
                        onChange={(e) => handleItemWeightChange(tool, index, e.target.value)}
                        size="small"
                        sx={{ width: 100 }}
                        InputProps={{
                            inputProps: { min: 0, step: 0.1 }
                        }}
                    />
                    <IconButton
                        size="small"
                        onClick={() => handleRemoveItem(tool, index)}
                        disabled={items.length === 1}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Box>
            ))}
        </Stack>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6">{t('wildcards:tabs.chain')}</Typography>
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
                        <IconButton size="small" onClick={loadChains}>
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
                    emptyMessage={t('wildcards:page.noChains')}
                />

                {/* Right: Detail Panel */}
                <WildcardDetailPanel
                    selectedNode={selectedNode}
                    onCopy={handleCopy}
                    onChildClick={handleSelect}
                    sortChildren={sortNodesByHierarchy}
                    emptyMessage={t('wildcards:detail.selectItem')}
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
                    {editingChain ? t('wildcards:dialog.editChainTitle') : t('wildcards:dialog.createChainTitle')}
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

                        {/* Chain Option */}
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>{t('wildcards:form.chainOption')}</Typography>
                            <RadioGroup
                                row
                                value={formData.chain_option}
                                onChange={(e) => setFormData(prev => ({ ...prev, chain_option: e.target.value as 'replace' | 'append' }))}
                            >
                                <FormControlLabel value="replace" control={<Radio />} label={t('wildcards:form.chainOptionReplace')} />
                                <FormControlLabel value="append" control={<Radio />} label={t('wildcards:form.chainOptionAppend')} />
                            </RadioGroup>
                        </Box>

                        {/* 부모 선택 */}
                        <HierarchyParentSelector
                            items={flatChains}
                            selectedParentId={formData.parent_id}
                            onParentChange={(parentId) => setFormData(prev => ({ ...prev, parent_id: parentId }))}
                            excludeIds={editingChain ? [editingChain.id] : []}
                            label={t('wildcards:form.parent')}
                            noParentLabel={t('wildcards:form.noParent')}
                            showItemCount={true}
                        />

                        {/* 하위 와일드카드 자동 포함 옵션 & 하위 와일드카드만 사용 옵션 */}
                        <Stack direction="row" spacing={2}>
                            <Tooltip title={t('wildcards:form.includeChildrenHelper')} arrow placement="bottom">
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={formData.include_children}
                                            onChange={(e) => setFormData(prev => ({
                                                ...prev,
                                                include_children: e.target.checked
                                            }))}
                                        />
                                    }
                                    label={t('wildcards:form.includeChildren')}
                                />
                            </Tooltip>

                            <Tooltip title="자신의 항목은 무시하고 하위 와일드카드 항목만 사용합니다. 폴더 정리용으로 유용합니다." arrow placement="bottom">
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={formData.only_children}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setFormData(prev => ({
                                                    ...prev,
                                                    only_children: checked,
                                                    // only_children 활성화 시 include_children은 자동으로 켜지는게 자연스러움
                                                    include_children: checked ? true : prev.include_children
                                                }));
                                            }}
                                        />
                                    }
                                    label="하위 와일드카드만 사용 (그룹용)"
                                />
                            </Tooltip>
                        </Stack>

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
                                    {renderItemInputs(formData.comfyuiItems, 'comfyui')}
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
                                    {renderItemInputs(formData.naiItems, 'nai')}
                                </Box>
                            </TabPanel>
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>{t('common:cancel')}</Button>
                    <Button onClick={handleSave} variant="contained">
                        {editingChain ? t('common:save') : t('common:create')}
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
                wildcard={chainToDelete}
                childCount={chainToDelete?.children?.length || 0}
                onClose={() => {
                    setDeleteDialogOpen(false);
                    setChainToDelete(null);
                }}
                onConfirm={handleDeleteConfirm}
            />
        </Box>
    );
}
