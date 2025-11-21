import { useState, useEffect, useMemo } from 'react';
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
  ListItemIcon,
  ListItemButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  Tooltip,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  FolderOpen as FolderIcon,
  Folder as FolderClosedIcon,
  History as HistoryIcon,
  Upload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Description as FileIcon,
  ContentCopy as CopyIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from 'notistack';
import {
  wildcardApi,
  type WildcardWithItems,
  type WildcardWithHierarchy,
  type LoraScanRequest,
  type LoraScanLog,
  type LoraFileData
} from '../../services/api/wildcardApi';

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

  const handleClick = () => {
    onSelect(node);
    if (hasChildren && !isExpanded) {
      onToggle(node.id);
    }
  };

  return (
    <>
      <ListItemButton
        onClick={handleClick}
        selected={isSelected}
        sx={{
          pl: 1 + level * 2,
          py: 0.5,
          minHeight: 36,
          '&.Mui-selected': {
            bgcolor: 'primary.dark',
            '&:hover': { bgcolor: 'primary.dark' }
          }
        }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            sx={{ p: 0.25, mr: 0.5 }}
          >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 28 }} />
        )}
        <ListItemIcon sx={{ minWidth: 28 }}>
          {hasChildren ? (
            isExpanded ? <FolderIcon fontSize="small" color="warning" /> : <FolderClosedIcon fontSize="small" color="warning" />
          ) : (
            <FileIcon fontSize="small" color="info" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={node.name}
          primaryTypographyProps={{
            variant: 'body2',
            noWrap: true,
            sx: { fontWeight: isSelected ? 600 : 400 }
          }}
        />
      </ListItemButton>
      {hasChildren && (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          {/* 폴더(자식 있음)를 먼저, 파일(리프)를 나중에 정렬 */}
          {[...node.children!]
            .sort((a, b) => {
              const aHasChildren = a.children && a.children.length > 0;
              const bHasChildren = b.children && b.children.length > 0;
              if (aHasChildren && !bHasChildren) return -1;
              if (!aHasChildren && bHasChildren) return 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
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
        </Collapse>
      )}
    </>
  );
}

export default function AutoCollectedWildcardsTab() {
  const { t } = useTranslation(['wildcards', 'common']);
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Scan form states
  const [loraWeight, setLoraWeight] = useState(1.0);
  const [duplicateHandling, setDuplicateHandling] = useState<'number' | 'parent'>('number');
  const [matchingMode, setMatchingMode] = useState<'filename' | 'common'>('filename');
  const [commonTextFilename, setCommonTextFilename] = useState('add.txt');
  const [matchingPriority, setMatchingPriority] = useState<'filename' | 'common'>('filename');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<LoraFileData[]>([]);

  // Hierarchical wildcards data
  const [hierarchyData, setHierarchyData] = useState<WildcardWithHierarchy[]>([]);
  const [loading, setLoading] = useState(true);

  // Tree navigation state
  const [selectedNode, setSelectedNode] = useState<WildcardWithHierarchy | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Last scan log
  const [lastScanLog, setLastScanLog] = useState<LoraScanLog | null>(null);

  // Modal states
  const [openScanDialog, setOpenScanDialog] = useState(false);
  const [openLogDialog, setOpenLogDialog] = useState(false);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      enqueueSnackbar(`"${text}" ${t('wildcards:actions.copiedToClipboard') || '클립보드에 복사됨!'}`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(t('wildcards:errors.copyFailed') || '복사 실패', { variant: 'error' });
    }
  };

  useEffect(() => {
    loadHierarchyData();
    loadLastScanLog();
  }, []);

  const loadHierarchyData = async () => {
    try {
      setLoading(true);
      const response = await wildcardApi.getWildcardsHierarchical();
      // Filter only auto-collected (is_auto_collected === 1)
      const autoCollected = response.data.filter((wc: any) => wc.is_auto_collected === 1);
      setHierarchyData(autoCollected);

      // 첫 번째 루트 노드 자동 선택
      if (autoCollected.length > 0 && !selectedNode) {
        setSelectedNode(autoCollected[0]);
      }
    } catch (err: any) {
      console.error('Error loading hierarchy data:', err);
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

  // 총 와일드카드 수 계산
  const totalCount = useMemo(() => {
    const countNodes = (nodes: WildcardWithHierarchy[]): number => {
      return nodes.reduce((sum, node) => {
        return sum + 1 + (node.children ? countNodes(node.children) : 0);
      }, 0);
    };
    return countNodes(hierarchyData);
  }, [hierarchyData]);

  // 트리 노드 선택 핸들러
  const handleSelectNode = (node: WildcardWithHierarchy) => {
    setSelectedNode(node);
  };

  // 트리 노드 토글 핸들러
  const handleToggleNode = (id: number) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 모든 노드 확장
  const handleExpandAll = () => {
    const collectIds = (nodes: WildcardWithHierarchy[]): number[] => {
      return nodes.flatMap((node) => [
        node.id,
        ...(node.children ? collectIds(node.children) : [])
      ]);
    };
    setExpandedIds(new Set(collectIds(hierarchyData)));
  };

  // 모든 노드 축소
  const handleCollapseAll = () => {
    setExpandedIds(new Set());
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
          if (matchingPriority === 'common') {
            if (commonTextCache.has(folderPath)) {
              promptLines = commonTextCache.get(folderPath)!;
            } else {
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

      // Reload data
      setSelectedNode(null);
      await loadHierarchyData();
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          {t('wildcards:tabs.autoCollected')}
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            ({totalCount} {t('wildcards:autoCollect.filters.totalWildcards', { count: totalCount }).split(' ').pop()})
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {lastScanLog && (
            <Tooltip title={t('wildcards:buttons.openLogDialog')}>
              <IconButton
                size="small"
                onClick={handleOpenLogDialog}
                color="secondary"
              >
                <HistoryIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('wildcards:buttons.openScanDialog')}>
            <IconButton
              size="small"
              onClick={handleOpenScanDialog}
              color="primary"
            >
              <UploadIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {hierarchyData.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', flex: 1 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('wildcards:autoCollect.noAutoWildcards')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('wildcards:autoCollect.noAutoWildcardsDesc')}
          </Typography>
        </Paper>
      ) : (
        <Box sx={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 2,
          flex: 1,
          minHeight: 0
        }}>
          {/* Left Panel - Tree View */}
          <Paper
            variant="outlined"
            sx={{
              width: isMobile ? '100%' : 280,
              minWidth: isMobile ? 'auto' : 280,
              maxHeight: isMobile ? 300 : 'none',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            {/* Tree Controls */}
            <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5 }}>
              <Button size="small" onClick={handleExpandAll}>
                {t('common:expandAll') || 'Expand All'}
              </Button>
              <Button size="small" onClick={handleCollapseAll}>
                {t('common:collapseAll') || 'Collapse All'}
              </Button>
            </Box>
            {/* Tree List */}
            <List
              dense
              sx={{
                flex: 1,
                overflow: 'auto',
                py: 0,
                '& .MuiListItemButton-root': {
                  borderRadius: 0
                }
              }}
            >
              {/* 루트 레벨도 폴더 먼저 정렬 */}
              {[...hierarchyData]
                .sort((a, b) => {
                  const aHasChildren = a.children && a.children.length > 0;
                  const bHasChildren = b.children && b.children.length > 0;
                  if (aHasChildren && !bHasChildren) return -1;
                  if (!aHasChildren && bHasChildren) return 1;
                  return a.name.localeCompare(b.name);
                })
                .map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    level={0}
                    selectedId={selectedNode?.id ?? null}
                    expandedIds={expandedIds}
                    onSelect={handleSelectNode}
                    onToggle={handleToggleNode}
                  />
                ))}
            </List>
          </Paper>

          {/* Right Panel - Detail View */}
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              minHeight: isMobile ? 300 : 'auto',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              p: 2
            }}
          >
            {selectedNode ? (
              <>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box
                    sx={{ cursor: 'pointer', '&:hover': { opacity: 0.7 } }}
                    onClick={() => handleCopy(`++${selectedNode.name}++`)}
                    title={t('common:copy') || 'Copy'}
                  >
                    <Typography variant="h5" sx={{ fontFamily: 'monospace' }}>
                      ++{selectedNode.name}++
                    </Typography>
                    {selectedNode.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {selectedNode.description}
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    onClick={() => handleCopy(`++${selectedNode.name}++`)}
                    title={t('common:copy') || 'Copy'}
                  >
                    <CopyIcon />
                  </IconButton>
                </Box>

                <Divider sx={{ mb: 2 }} />

                {/* Content: Children or Items */}
                {selectedNode.children && selectedNode.children.length > 0 ? (
                  // 자식이 있으면 자식 목록 표시
                  <Box sx={{ flex: 1, overflow: 'auto' }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                      {t('wildcards:autoCollect.childCount', { count: selectedNode.children.length }) || `${selectedNode.children.length} children`}
                    </Typography>
                    <Stack spacing={1}>
                      {selectedNode.children.map((child) => (
                        <Card
                          key={child.id}
                          variant="outlined"
                          sx={{
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                          onClick={() => {
                            handleSelectNode(child);
                            // 자동으로 부모 확장
                            setExpandedIds((prev) => new Set([...prev, selectedNode.id]));
                          }}
                        >
                          <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                              {child.children && child.children.length > 0 ? (
                                <FolderIcon fontSize="small" color="warning" />
                              ) : (
                                <FileIcon fontSize="small" color="info" />
                              )}
                              <Typography variant="body1" sx={{ flex: 1 }}>++{child.name}++</Typography>
                              {child.children && child.children.length > 0 && (
                                <Chip
                                  label={`${child.children.length} sub`}
                                  size="small"
                                  variant="outlined"
                                />
                              )}
                              {child.items && child.items.length > 0 && (
                                <Chip
                                  label={`${child.items.filter(i => i.tool === 'comfyui').length} items`}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                              )}
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(`++${child.name}++`);
                                }}
                                title={t('common:copy') || 'Copy'}
                              >
                                <CopyIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  </Box>
                ) : (
                  // 자식이 없으면 items 상세 표시
                  <Box sx={{ flex: 1, overflow: 'auto' }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                      {t('wildcards:detailDialog.itemList', {
                        count: selectedNode.items?.filter((i) => i.tool === 'comfyui').length || 0
                      })}
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        bgcolor: 'background.default',
                        maxHeight: 400,
                        overflow: 'auto'
                      }}
                    >
                      {selectedNode.items && selectedNode.items.filter((i) => i.tool === 'comfyui').length > 0 ? (
                        selectedNode.items
                          .filter((item) => item.tool === 'comfyui')
                          .map((item, idx) => (
                            <Typography
                              key={idx}
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.85em',
                                py: 0.5,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                '&:last-child': { borderBottom: 'none' }
                              }}
                            >
                              {item.content}
                            </Typography>
                          ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {t('wildcards:autoCollect.noItems') || 'No items'}
                        </Typography>
                      )}
                    </Paper>
                  </Box>
                )}
              </>
            ) : (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Typography variant="body1" color="text.secondary">
                  {t('wildcards:autoCollect.selectWildcard') || 'Select a wildcard from the tree'}
                </Typography>
              </Box>
            )}
          </Paper>
        </Box>
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
                  ? t('wildcards:autoCollect.filesSelected', { count: selectedFiles.length })
                  : t('wildcards:autoCollect.folderPath')}
              </Button>
            </label>

            {/* Preview Selected Files */}
            {selectedFiles.length > 0 && (
              <Alert severity="success">
                {t('wildcards:autoCollect.filesFound', { count: selectedFiles.length })}
                <Box component="ul" sx={{ mt: 1, mb: 0 }}>
                  {selectedFiles.slice(0, 5).map((file, idx) => (
                    <li key={idx}>
                      <strong>{file.loraName}</strong>
                      {file.promptLines.length > 0 && ` (${t('wildcards:autoCollect.promptsCount', { count: file.promptLines.length })})`}
                    </li>
                  ))}
                  {selectedFiles.length > 5 && (
                    <li>{t('wildcards:autoCollect.moreFiles', { count: selectedFiles.length - 5 })}</li>
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
              <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
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
