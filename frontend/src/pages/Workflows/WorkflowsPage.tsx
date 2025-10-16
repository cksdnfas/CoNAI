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
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Workspaces as WorkflowIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { workflowApi, type Workflow } from '../../services/api/workflowApi';

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      const response = await workflowApi.getAllWorkflows();
      setWorkflows(response.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('정말 이 워크플로우를 삭제하시겠습니까?')) {
      try {
        await workflowApi.deleteWorkflow(id);
        loadWorkflows();
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
          <WorkflowIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          워크플로우 관리
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/workflows/new')}
        >
          워크플로우 추가
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {workflows.map((workflow) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={workflow.id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Typography variant="h6" component="div">
                    {workflow.name}
                  </Typography>
                  <Chip
                    label={workflow.is_active ? '활성' : '비활성'}
                    color={workflow.is_active ? 'success' : 'default'}
                    size="small"
                  />
                </Box>

                {workflow.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {workflow.description}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {workflow.marked_fields && workflow.marked_fields.length > 0 && (
                    <Chip
                      label={`${workflow.marked_fields.length}개 필드`}
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Box>

                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                  생성일: {new Date(workflow.created_date).toLocaleDateString()}
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
                <Button
                  size="small"
                  startIcon={<PlayIcon />}
                  onClick={() => navigate(`/workflows/${workflow.id}/generate`)}
                  disabled={!workflow.is_active}
                >
                  이미지 생성
                </Button>
                <Box>
                  <IconButton
                    size="small"
                    onClick={() => navigate(`/workflows/${workflow.id}/edit`)}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(workflow.id)}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {workflows.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary">
            등록된 워크플로우가 없습니다
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            "워크플로우 추가" 버튼을 클릭하여 ComfyUI 워크플로우를 추가하세요
          </Typography>
        </Box>
      )}
    </Box>
  );
}
