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
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  List as ListIcon
} from '@mui/icons-material';
import { customDropdownListApi, type CustomDropdownList } from '../../services/api/customDropdownListApi';

export default function CustomDropdownListsPage() {
  const [lists, setLists] = useState<CustomDropdownList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingList, setEditingList] = useState<CustomDropdownList | null>(null);

  // 폼 상태
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    itemsText: '' // 줄바꿈으로 구분된 텍스트
  });

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
      // 줄바꿈으로 구분된 텍스트를 배열로 변환 (빈 줄 제거)
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4">
          <ListIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          커스텀 드롭다운 목록 관리
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          새 목록 추가
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {lists.length === 0 ? (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="body1" color="text.secondary" align="center">
                  등록된 커스텀 드롭다운 목록이 없습니다.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : (
          lists.map((list) => (
            <Grid item xs={12} sm={6} md={4} key={list.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="h6" component="div">
                      {list.name}
                    </Typography>
                    <Chip
                      label={`${list.items.length}개`}
                      size="small"
                      color="primary"
                    />
                  </Box>
                  {list.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      {list.description}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 2 }}>
                    {list.items.slice(0, 5).map((item, index) => (
                      <Chip
                        key={index}
                        label={item}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                    {list.items.length > 5 && (
                      <Chip
                        label={`+${list.items.length - 5}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                    생성일: {new Date(list.created_date).toLocaleDateString()}
                  </Typography>
                </CardContent>
                <CardActions>
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => handleOpenDialog(list)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDelete(list.id)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </CardActions>
              </Card>
            </Grid>
          ))
        )}
      </Grid>

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
          <TextField
            autoFocus
            margin="dense"
            label="목록 이름 *"
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="설명"
            fullWidth
            multiline
            rows={2}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="항목 목록 (한 줄에 하나씩 입력) *"
            fullWidth
            multiline
            rows={10}
            value={formData.itemsText}
            onChange={(e) => setFormData({ ...formData, itemsText: e.target.value })}
            placeholder="예시:&#10;SDXL 1.0&#10;SD 1.5&#10;Realistic Vision&#10;DreamShaper"
            helperText="각 항목을 줄바꿈으로 구분하여 입력하세요"
          />
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
    </Box>
  );
}
