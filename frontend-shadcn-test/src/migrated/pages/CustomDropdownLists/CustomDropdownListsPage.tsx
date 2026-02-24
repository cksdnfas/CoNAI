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
import { useTranslation } from 'react-i18next';
import { customDropdownListApi, type CustomDropdownList } from '../../services/api/customDropdownListApi';

export default function CustomDropdownListsPage() {
  const { t } = useTranslation('workflows');
  const [lists, setLists] = useState<CustomDropdownList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingList, setEditingList] = useState<CustomDropdownList | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    itemsText: '' // newline-separated text
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
      // Convert newline-separated text to array (remove empty lines)
      const items = formData.itemsText
        .split('\n')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length === 0) {
        setError(t('customDropdowns.validation.minItems'));
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
    if (confirm(t('customDropdowns.dialog.deleteConfirm'))) {
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
          {t('customDropdowns.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          {t('customDropdowns.buttons.add')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {lists.length === 0 ? (
          <Grid size={{ xs: 12 }}>
            <Card>
              <CardContent>
                <Typography variant="body1" color="text.secondary" align="center">
                  {t('customDropdowns.empty.title')}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : (
          lists.map((list) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={list.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="h6" component="div">
                      {list.name}
                    </Typography>
                    <Chip
                      label={t('customDropdowns.stats.itemCount', { count: list.items.length })}
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
                        label={t('customDropdowns.stats.moreItems', { count: list.items.length - 5 })}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                    {t('customDropdowns.stats.createdAt', { date: new Date(list.created_date).toLocaleDateString() })}
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

      {/* Create/Edit Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingList ? t('customDropdowns.dialog.edit') : t('customDropdowns.dialog.add')}
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
            label={t('customDropdowns.labels.name')}
            fullWidth
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label={t('customDropdowns.labels.description')}
            fullWidth
            multiline
            rows={2}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label={t('customDropdowns.labels.items')}
            fullWidth
            multiline
            rows={10}
            value={formData.itemsText}
            onChange={(e) => setFormData({ ...formData, itemsText: e.target.value })}
            placeholder="예시:&#10;SDXL 1.0&#10;SD 1.5&#10;Realistic Vision&#10;DreamShaper"
            helperText={t('customDropdowns.labels.itemsHelper')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>{t('customDropdowns.buttons.cancel')}</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!formData.name.trim() || !formData.itemsText.trim()}
          >
            {editingList ? t('customDropdowns.buttons.save') : t('customDropdowns.buttons.create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
