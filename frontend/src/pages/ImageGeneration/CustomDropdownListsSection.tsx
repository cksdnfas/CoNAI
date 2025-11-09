import { useState, useEffect } from 'react';
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
  CloudSync as CloudSyncIcon,
  Person as PersonIcon,
  Storage as StorageIcon
} from '@mui/icons-material';
import { customDropdownListApi, type CustomDropdownList } from '../../services/api/customDropdownListApi';

export default function CustomDropdownListsSection() {
  const [lists, setLists] = useState<CustomDropdownList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState(0); // 0: 자동 수집, 1: 수동 생성
  const [openDialog, setOpenDialog] = useState(false);
  const [editingList, setEditingList] = useState<CustomDropdownList | null>(null);
  const [openComfyUIDialog, setOpenComfyUIDialog] = useState(false);
  const [comfyUIPath, setComfyUIPath] = useState('');
  const [scanLoading, setScanLoading] = useState(false);

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

  const handleSubmit = async () => {
    try {
      const items = formData.itemsText
        .split('\n')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length === 0) {
        setError('최소 1개 이상의 항목을 입력해주세요.');
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
    if (confirm('정말 이 목록을 삭제하시겠습니까?')) {
      try {
        await customDropdownListApi.deleteList(id);
        loadLists();
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  const handleOpenComfyUIDialog = () => {
    setComfyUIPath('');
    setOpenComfyUIDialog(true);
  };

  const handleCloseComfyUIDialog = () => {
    setOpenComfyUIDialog(false);
    setComfyUIPath('');
    setError(null);
  };

  const handleBrowseFolder = () => {
    // 브라우저에서는 폴더 선택을 직접 지원하지 않으므로,
    // 사용자가 경로를 직접 입력하도록 안내
    const input = document.createElement('input');
    input.type = 'file';
    // @ts-ignore - webkitdirectory는 표준이 아니지만 대부분의 브라우저에서 지원
    input.webkitdirectory = true;
    input.onchange = (e: any) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        // 첫 번째 파일의 경로에서 models 디렉토리까지의 경로 추출
        const path = files[0].webkitRelativePath || files[0].path;
        if (path) {
          // webkitRelativePath에서 폴더 이름만 추출
          const folderName = path.split('/')[0];
          setComfyUIPath(folderName);
        }
      }
    };
    input.click();
  };

  const handleScanModels = async () => {
    if (!comfyUIPath.trim()) {
      setError('ComfyUI models 경로를 입력해주세요.');
      return;
    }

    try {
      setScanLoading(true);
      setError(null);

      const response = await customDropdownListApi.scanComfyUIModels(comfyUIPath);

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
          <ListIcon /> 커스텀 드롭다운 목록
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadIcon />}
            onClick={handleOpenComfyUIDialog}
            color="secondary"
          >
            ComfyUI 모델 불러오기
          </Button>
          {currentTab === 1 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleOpenDialog()}
            >
              새 목록 추가
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
              <Box sx={{ mr: 2 }}>자동 수집</Box>
            </Badge>
          }
        />
        <Tab
          icon={<PersonIcon />}
          iconPosition="start"
          label={
            <Badge badgeContent={manualLists.length} color="secondary" max={999}>
              <Box sx={{ mr: 2 }}>수동 생성</Box>
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
                    자동 수집된 목록이 없습니다. "ComfyUI 모델 불러오기" 버튼을 사용하여 모델을 스캔하세요.
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
                              label="자동"
                              size="small"
                              color="primary"
                              sx={{ height: '18px', fontSize: '0.65rem' }}
                            />
                            <Chip
                              label={`${list.items.length}개`}
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
                      <Tooltip title="자동 수집된 항목은 편집할 수 없습니다">
                        <span>
                          <IconButton
                            size="small"
                            disabled
                            sx={{ p: 0.5 }}
                          >
                            <EditIcon sx={{ fontSize: '1rem' }} />
                          </IconButton>
                        </span>
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
                    수동으로 생성한 목록이 없습니다. "새 목록 추가" 버튼을 사용하여 목록을 만드세요.
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
                            label={`${list.items.length}개`}
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

      {/* 생성/수정 다이얼로그 */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingList ? '커스텀 목록 수정' : '새 커스텀 목록 추가'}
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
              label="목록 이름 *"
              fullWidth
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <TextField
              label="설명"
              fullWidth
              multiline
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
            <TextField
              label="항목 목록 (한 줄에 하나씩 입력) *"
              fullWidth
              multiline
              rows={10}
              value={formData.itemsText}
              onChange={(e) => setFormData({ ...formData, itemsText: e.target.value })}
              placeholder="예시:&#10;SDXL 1.0&#10;SD 1.5&#10;Realistic Vision&#10;DreamShaper"
              helperText="각 항목을 줄바꿈으로 구분하여 입력하세요"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>취소</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!formData.name.trim() || !formData.itemsText.trim()}
          >
            {editingList ? '수정' : '생성'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ComfyUI 모델 불러오기 다이얼로그 */}
      <Dialog
        open={openComfyUIDialog}
        onClose={handleCloseComfyUIDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          ComfyUI 모델 불러오기
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
              ComfyUI의 models 폴더 경로를 입력해주세요.<br />
              예: C:\ComfyUI\models 또는 /home/user/ComfyUI/models
            </Alert>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                autoFocus
                label="ComfyUI models 경로"
                fullWidth
                value={comfyUIPath}
                onChange={(e) => setComfyUIPath(e.target.value)}
                placeholder="예: C:\ComfyUI\models"
                helperText="절대 경로를 입력하거나 폴더 찾기 버튼을 사용하세요"
              />
              <Button
                variant="outlined"
                startIcon={<FolderOpenIcon />}
                onClick={handleBrowseFolder}
                sx={{ minWidth: '120px' }}
              >
                폴더 찾기
              </Button>
            </Box>
            <Alert severity="warning" sx={{ fontSize: '0.85rem' }}>
              <strong>스캔 안내:</strong><br />
              • checkpoints, unet, upscale_models 폴더를 자동으로 스캔합니다<br />
              • 이미 수집된 경로를 다시 스캔하면 <strong>항목이 최신화</strong>됩니다<br />
              • 자동 수집된 항목은 "자동 수집" 탭에서 확인할 수 있습니다
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseComfyUIDialog} disabled={scanLoading}>
            취소
          </Button>
          <Button
            onClick={handleScanModels}
            variant="contained"
            disabled={!comfyUIPath.trim() || scanLoading}
            startIcon={scanLoading ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {scanLoading ? '스캔 중...' : '모델 스캔'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
