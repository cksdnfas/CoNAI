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
  Stack
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  List as ListIcon
} from '@mui/icons-material';
import { customDropdownListApi, type CustomDropdownList } from '../../services/api/customDropdownListApi';

export default function CustomDropdownListsSection() {
  const [lists, setLists] = useState<CustomDropdownList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingList, setEditingList] = useState<CustomDropdownList | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    itemsText: ''
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

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ListIcon /> 커스텀 드롭다운 목록
        </Typography>
        <Button
          variant="outlined"
          size="small"
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

      {loading ? (
        <Box display="flex" justifyContent="center" p={3}>
          <CircularProgress size={30} />
        </Box>
      ) : lists.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary" align="center">
              등록된 커스텀 드롭다운 목록이 없습니다.
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
          {lists.map((list) => (
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
                      color="primary"
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
    </Box>
  );
}
