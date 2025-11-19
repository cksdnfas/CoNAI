import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardActions,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Stack,
  Tabs,
  Tab,
  Tooltip,
  Badge
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  List as ListIcon,
  FolderOpen as FolderOpenIcon,
  Upload as UploadIcon,
  Person as PersonIcon,
  Storage as StorageIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import FormGroup from '@mui/material/FormGroup';
import { customDropdownListApi, type CustomDropdownList, type ComfyUIModelFolder } from '../../services/api/customDropdownListApi';

export default function CustomDropdownListsSection() {
  const { t } = useTranslation('imageGeneration');
  const [lists, setLists] = useState<CustomDropdownList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState(0); // 0: 자동 수집, 1: 수동 생성
  const [openDialog, setOpenDialog] = useState(false);
  const [editingList, setEditingList] = useState<CustomDropdownList | null>(null);
  const [openViewDialog, setOpenViewDialog] = useState(false);
  const [viewingList, setViewingList] = useState<CustomDropdownList | null>(null);
  const [openComfyUIDialog, setOpenComfyUIDialog] = useState(false);
  const [selectedModelFolders, setSelectedModelFolders] = useState<ComfyUIModelFolder[]>([]);
  const [scanLoading, setScanLoading] = useState(false);

  // 모델 타입별 전체 경로 포함 여부
  const [includeFullPath, setIncludeFullPath] = useState({
    checkpoints: true,  // 기본값: 체크됨
    unet: false,
    upscale_models: false
  });

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    itemsText: ''
  });

  // 탭별로 목록 필터링
  const autoCollectedLists = lists.filter(list => list.is_auto_collected);
  const manualLists = lists.filter(list => !list.is_auto_collected);

  useEffect(() => {
    loadLists();
  }, []);

  const loadLists = async () => {
    try {
      setLoading(true);
      const response = await customDropdownListApi.getAllLists();
      setLists(response.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (list?: CustomDropdownList) => {
    if (list) {
      setEditingList(list);
      setFormData({
        name: list.name,
        description: list.description || '',
        itemsText: list.items.join('\n')
      });
    } else {
      setEditingList(null);
      setFormData({
        name: '',
        description: '',
        itemsText: ''
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingList(null);
    setError(null);
  };

  const handleOpenViewDialog = (list: CustomDropdownList) => {
    setViewingList(list);
    setOpenViewDialog(true);
  };

  const handleCloseViewDialog = () => {
    setOpenViewDialog(false);
    setViewingList(null);
  };

  const handleSubmit = async () => {
    try {
      const items = formData.itemsText
        .split('\n')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length === 0) {
        setError(t('customDropdown.messages.minItemError'));
        return;
      }

      const data = {
        name: formData.name,
        description: formData.description || undefined,
        items
      };

      if (editingList) {
        await customDropdownListApi.updateList(editingList.id, data);
      } else {
        await customDropdownListApi.createList(data);
      }
      handleCloseDialog();
      loadLists();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm(t('customDropdown.messages.deleteConfirm'))) {
      try {
        await customDropdownListApi.deleteList(id);
        loadLists();
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  const handleOpenComfyUIDialog = () => {
    setSelectedModelFolders([]);
    setOpenComfyUIDialog(true);
  };

  const handleCloseComfyUIDialog = () => {
    setOpenComfyUIDialog(false);
    setSelectedModelFolders([]);
    setError(null);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setError(null);

    // 모델 파일 확장자
    const modelExtensions = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin'];

    // 타겟 폴더 이름 (checkpoints, unet, upscale_models)
    const targetFolders = ['checkpoints', 'unet', 'upscale_models'];

    // 폴더별로 파일 그룹화
    const folderMap = new Map<string, string[]>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pathParts = file.webkitRelativePath.split('/');

      // 확장자 확인
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!modelExtensions.includes(ext)) continue;

      // 경로 분석: models/checkpoints/subfolder/file.safetensors 형식
      // pathParts[0] = 'models', pathParts[1] = 'checkpoints', pathParts[2...] = 하위경로
      if (pathParts.length < 2) continue;

      const baseFolderName = pathParts[1]; // checkpoints, unet, upscale_models 등
      if (!targetFolders.includes(baseFolderName)) continue;

      // 하위 폴더 경로 구성
      const subPath = pathParts.slice(2, -1).join('/');
      const displayName = subPath
        ? `${baseFolderName}/${subPath}`
        : baseFolderName;

      if (!folderMap.has(displayName)) {
        folderMap.set(displayName, []);
      }

      // 체크박스 설정에 따라 전체 경로 또는 파일명만 저장
      const shouldIncludeFullPath = includeFullPath[baseFolderName as keyof typeof includeFullPath] ?? false;
      const fileEntry = shouldIncludeFullPath && subPath
        ? `${subPath}/${file.name}`  // 전체 경로 포함
        : file.name;  // 파일명만

      folderMap.get(displayName)!.push(fileEntry);
    }

    // Map을 ComfyUIModelFolder 배열로 변환
    const modelFolders: ComfyUIModelFolder[] = Array.from(folderMap.entries()).map(([displayName, files]) => {
      const baseFolderName = displayName.split('/')[0];
      return {
        folderName: baseFolderName,
        displayName,
        files: files.sort()
      };
    });

    setSelectedModelFolders(modelFolders);
  };

  const handleScanModels = async () => {
    if (selectedModelFolders.length === 0) {
      setError(t('customDropdown.messages.selectFolderError'));
      return;
    }

    try {
      setScanLoading(true);
      setError(null);

      const response = await customDropdownListApi.scanComfyUIModels({
        modelFolders: selectedModelFolders,
        sourcePath: 'client-selected'
      });

      if (response.success && response.data) {
        handleCloseComfyUIDialog();
        loadLists(); // 목록 새로고침
        setCurrentTab(0); // 자동 수집 탭으로 이동
        alert(response.data.message);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setScanLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ListIcon /> {t('customDropdown.title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadIcon />}
            onClick={handleOpenComfyUIDialog}
            color="secondary"
          >
            {t('customDropdown.buttons.loadComfyUI')}
          </Button>
          {currentTab === 1 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleOpenDialog()}
            >
              {t('customDropdown.buttons.addList')}
            </Button>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Tabs
        value={currentTab}
        onChange={(_, newValue) => setCurrentTab(newValue)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          icon={<StorageIcon />}
          iconPosition="start"
          label={
            <Badge badgeContent={autoCollectedLists.length} color="primary" max={999}>
              <Box sx={{ mr: 2 }}>{t('customDropdown.tabs.autoCollected')}</Box>
            </Badge>
          }
        />
        <Tab
          icon={<PersonIcon />}
          iconPosition="start"
          label={
            <Badge badgeContent={manualLists.length} color="secondary" max={999}>
              <Box sx={{ mr: 2 }}>{t('customDropdown.tabs.manual')}</Box>
            </Badge>
          }
        />
      </Tabs>

      {loading ? (
        <Box display="flex" justifyContent="center" p={3}>
          <CircularProgress size={30} />
        </Box>
      ) : (
        <>
          {/* 자동 수집 탭 */}
          {currentTab === 0 && (
            autoCollectedLists.length === 0 ? (
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" align="center">
                    {t('customDropdown.messages.noAutoCollected')}
                  </Typography>
                </CardContent>
              </Card>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, 1fr)',
                    md: 'repeat(3, 1fr)',
                    lg: 'repeat(4, 1fr)',
                  },
                  gap: 1.5,
                }}
              >
                {autoCollectedLists.map((list) => (
                  <Card key={list.id} sx={{ height: '100%', borderLeft: 3, borderColor: 'primary.main' }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Stack spacing={1}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>
                            {list.name}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <Chip
                              label={t('customDropdown.labels.auto')}
                              size="small"
                              color="primary"
                              sx={{ height: '18px', fontSize: '0.65rem' }}
                            />
                            <Chip
                              label={t('customDropdown.labels.itemCount', { count: list.items.length })}
                              size="small"
                              color="default"
                              sx={{ height: '18px', fontSize: '0.65rem' }}
                            />
                          </Box>
                        </Box>
                        {list.source_path && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                            📁 {list.source_path}
                          </Typography>
                        )}
                        {list.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                            {list.description}
                          </Typography>
                        )}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, userSelect: 'text' }}>
                          {list.items.slice(0, 3).map((item, index) => (
                            <Chip
                              key={index}
                              label={item}
                              size="small"
                              variant="outlined"
                              sx={{ height: '20px', fontSize: '0.7rem', cursor: 'text' }}
                            />
                          ))}
                          {list.items.length > 3 && (
                            <Chip
                              label={`+${list.items.length - 3}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: '20px', fontSize: '0.7rem' }}
                            />
                          )}
                        </Box>
                      </Stack>
                    </CardContent>
                    <CardActions sx={{ p: 1, pt: 0, justifyContent: 'flex-end' }}>
                      <Tooltip title={t('customDropdown.buttons.viewList')}>
                        <IconButton
                          size="small"
                          onClick={() => handleOpenViewDialog(list)}
                          sx={{ p: 0.5 }}
                        >
                          <VisibilityIcon sx={{ fontSize: '1rem' }} />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(list.id)}
                        sx={{ p: 0.5 }}
                      >
                        <DeleteIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                    </CardActions>
                  </Card>
                ))}
              </Box>
            )
          )}

          {/* 수동 생성 탭 */}
          {currentTab === 1 && (
            manualLists.length === 0 ? (
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" align="center">
                    {t('customDropdown.messages.noManual')}
                  </Typography>
                </CardContent>
              </Card>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, 1fr)',
                    md: 'repeat(3, 1fr)',
                    lg: 'repeat(4, 1fr)',
                  },
                  gap: 1.5,
                }}
              >
                {manualLists.map((list) => (
                  <Card key={list.id} sx={{ height: '100%' }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Stack spacing={1}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            {list.name}
                          </Typography>
                          <Chip
                            label={t('customDropdown.labels.itemCount', { count: list.items.length })}
                            size="small"
                            color="secondary"
                            sx={{ height: '18px', fontSize: '0.7rem' }}
                          />
                        </Box>
                        {list.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                            {list.description}
                          </Typography>
                        )}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {list.items.slice(0, 3).map((item, index) => (
                            <Chip
                              key={index}
                              label={item}
                              size="small"
                              variant="outlined"
                              sx={{ height: '20px', fontSize: '0.7rem' }}
                            />
                          ))}
                          {list.items.length > 3 && (
                            <Chip
                              label={`+${list.items.length - 3}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: '20px', fontSize: '0.7rem' }}
                            />
                          )}
                        </Box>
                      </Stack>
                    </CardContent>
                    <CardActions sx={{ p: 1, pt: 0, justifyContent: 'flex-end' }}>
                      <IconButton
                        size="small"
                        onClick={() => handleOpenDialog(list)}
                        sx={{ p: 0.5 }}
                      >
                        <EditIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(list.id)}
                        sx={{ p: 0.5 }}
                      >
                        <DeleteIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                    </CardActions>
                  </Card>
                ))}
              </Box>
            )
          )}
        </>
      )}

      {/* 읽기 전용 다이얼로그 */}
      <Dialog
        open={openViewDialog}
        onClose={handleCloseViewDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('customDropdown.dialog.viewTitle')}
        </DialogTitle>
        <DialogContent>
          {viewingList && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
                {t('customDropdown.messages.autoCollectedReadOnly')}
              </Alert>
              <TextField
                label={t('customDropdown.labels.listName')}
                fullWidth
                value={viewingList.name}
                InputProps={{ readOnly: true }}
              />
              {viewingList.description && (
                <TextField
                  label={t('customDropdown.labels.description')}
                  fullWidth
                  multiline
                  rows={2}
                  value={viewingList.description}
                  InputProps={{ readOnly: true }}
                />
              )}
              {viewingList.source_path && (
                <TextField
                  label={t('customDropdown.labels.path')}
                  fullWidth
                  value={viewingList.source_path}
                  InputProps={{ readOnly: true }}
                />
              )}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  {t('customDropdown.labels.itemListCount', { count: viewingList.items.length })}
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={15}
                  value={viewingList.items.join('\n')}
                  InputProps={{ readOnly: true }}
                  sx={{
                    '& .MuiInputBase-input': {
                      fontFamily: 'monospace',
                      fontSize: '0.9rem'
                    }
                  }}
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseViewDialog} variant="contained">
            {t('customDropdown.buttons.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 생성/수정 다이얼로그 */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingList ? t('customDropdown.dialog.editTitle') : t('customDropdown.dialog.createTitle')}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              autoFocus
              label={t('customDropdown.labels.listNameRequired')}
              fullWidth
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <TextField
              label={t('customDropdown.labels.description')}
              fullWidth
              multiline
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
            <TextField
              label={t('customDropdown.labels.itemList')}
              fullWidth
              multiline
              rows={10}
              value={formData.itemsText}
              onChange={(e) => setFormData({ ...formData, itemsText: e.target.value })}
              placeholder={t('customDropdown.placeholders.itemList')}
              helperText={t('customDropdown.helperText.itemList')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>{t('customDropdown.buttons.cancel')}</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!formData.name.trim() || !formData.itemsText.trim()}
          >
            {editingList ? t('customDropdown.buttons.edit') : t('customDropdown.buttons.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ComfyUI 모델 불러오기 다이얼로그 */}
      <Dialog
        open={openComfyUIDialog}
        onClose={handleCloseComfyUIDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('customDropdown.dialog.comfyUITitle')}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
              {t('customDropdown.messages.selectComfyUIFolder').split('\n').map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line.includes('models') ? (
                    <>
                      {line.split('models')[0]}<strong>models</strong>{line.split('models')[1]}
                    </>
                  ) : line}
                </span>
              ))}
            </Alert>
            <Button
              variant="contained"
              startIcon={<FolderOpenIcon />}
              component="label"
              fullWidth
              size="large"
            >
              {t('customDropdown.buttons.selectFolder')}
              <input
                type="file"
                hidden
                // @ts-ignore - webkitdirectory is not in the standard types
                webkitdirectory=""
                directory=""
                onChange={handleFileSelect}
              />
            </Button>
            {selectedModelFolders.length > 0 && (
              <>
                <Alert severity="success" sx={{ fontSize: '0.85rem' }}>
                  {t('customDropdown.messages.foldersDetected', { count: selectedModelFolders.length })}
                  <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                    {selectedModelFolders.slice(0, 5).map((folder, idx) => (
                      <li key={idx}>
                        <strong>{folder.displayName}</strong>: {t('customDropdown.messages.fileCount', { count: folder.files.length })}
                      </li>
                    ))}
                    {selectedModelFolders.length > 5 && (
                      <li>{t('customDropdown.messages.moreCount', { count: selectedModelFolders.length - 5 })}</li>
                    )}
                  </Box>
                </Alert>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    {t('customDropdown.labels.pathOptions')}
                  </Typography>
                  <FormGroup>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={includeFullPath.checkpoints}
                          onChange={(e) => setIncludeFullPath({ ...includeFullPath, checkpoints: e.target.checked })}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {t('customDropdown.labels.checkpointsFullPath')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('customDropdown.messages.pathExample', {
                              example: includeFullPath.checkpoints
                                ? 'Illustrious/ETC/model.safetensors'
                                : 'model.safetensors'
                            })}
                          </Typography>
                        </Box>
                      }
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={includeFullPath.unet}
                          onChange={(e) => setIncludeFullPath({ ...includeFullPath, unet: e.target.checked })}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {t('customDropdown.labels.unetFullPath')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('customDropdown.messages.pathExample', {
                              example: includeFullPath.unet
                                ? 'subfolder/model.safetensors'
                                : 'model.safetensors'
                            })}
                          </Typography>
                        </Box>
                      }
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={includeFullPath.upscale_models}
                          onChange={(e) => setIncludeFullPath({ ...includeFullPath, upscale_models: e.target.checked })}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {t('customDropdown.labels.upscaleModelsFullPath')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('customDropdown.messages.pathExample', {
                              example: includeFullPath.upscale_models
                                ? 'subfolder/model.pth'
                                : 'model.pth'
                            })}
                          </Typography>
                        </Box>
                      }
                    />
                  </FormGroup>
                </Box>
              </>
            )}
            <Alert severity="warning" sx={{ fontSize: '0.85rem' }}>
              {t('customDropdown.messages.scanInfo').split('\n').map((line, i) => (
                <span key={i}>
                  {i > 0 && <><br /></>}
                  {line.includes('항목이 최신화') ? (
                    <>
                      {line.split('항목이 최신화')[0]}<strong>{line.match(/항목이 최신화/)?.[0]}</strong>{line.split('항목이 최신화')[1]}
                    </>
                  ) : line.startsWith('스캔') ? (
                    <strong>{line}</strong>
                  ) : (
                    line
                  )}
                </span>
              ))}
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseComfyUIDialog} disabled={scanLoading}>
            {t('customDropdown.buttons.cancel')}
          </Button>
          <Button
            onClick={handleScanModels}
            variant="contained"
            disabled={selectedModelFolders.length === 0 || scanLoading}
            startIcon={scanLoading ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {scanLoading ? t('customDropdown.messages.collecting') : t('customDropdown.buttons.collect')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
