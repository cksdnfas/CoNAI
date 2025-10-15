import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Card,
  CardMedia,
  CardContent,
  Chip,
  CircularProgress,
  DialogContentText,
} from '@mui/material';
import {
  Collections as GroupIcon,
  AutoAwesome as AutoIcon,
} from '@mui/icons-material';
import { Alert } from '@mui/material';
import { groupApi } from '../../services/api';
import type { GroupWithStats } from '../../types/group';

interface GroupAssignModalProps {
  open: boolean;
  onClose: () => void;
  selectedImageCount: number;
  onAssign: (groupId: number) => void | Promise<void>;
  currentGroupId?: number;
}

const GroupAssignModal: React.FC<GroupAssignModalProps> = ({
  open,
  onClose,
  selectedImageCount,
  onAssign,
  currentGroupId,
}) => {
  const [groups, setGroups] = useState<GroupWithStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  // 그룹 목록 로드
  useEffect(() => {
    if (open) {
      loadGroups();
      setSelectedGroupId('');
      setError(null);
    }
  }, [open]);

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('🔍 그룹 로딩 시작...');
      const response = await groupApi.getGroups();
      console.log('📦 API 응답:', response);

      if (response.success && response.data) {
        console.log('✅ 그룹 데이터:', response.data, '개수:', response.data.length);
        setGroups(response.data);
      } else {
        console.error('❌ API 응답 실패:', response);
        setError('그룹 목록을 불러오는데 실패했습니다.');
      }
    } catch (error) {
      console.error('❌ 그룹 로딩 에러:', error);
      setError('그룹 목록을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (selectedGroupId) {
      await onAssign(selectedGroupId as number);
      onClose();
    }
  };

  const handleDialogMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleDialogPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      onMouseDown={handleDialogMouseDown}
      onPointerDown={handleDialogPointerDown}
    >
      <DialogTitle>그룹에 할당</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          선택된 {selectedImageCount}개의 이미지를 그룹에 할당합니다.
        </DialogContentText>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : groups.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">
              생성된 그룹이 없습니다
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {groups.map((group) => {
              const isCurrentGroup = group.id === currentGroupId;
              const thumbnailUrl = group.image_count > 0
                ? groupApi.getThumbnailUrl(group.id)
                : '';

              const handleCardClick = (e: React.MouseEvent) => {
                e.stopPropagation();
                setSelectedGroupId(group.id);
              };

              return (
                <Card
                  key={group.id}
                    sx={{
                      display: 'flex',
                      width: '100%',
                      cursor: 'pointer',
                      border: 2,
                      borderColor: selectedGroupId === group.id
                        ? 'primary.main'
                        : isCurrentGroup
                          ? 'info.light'
                          : 'divider',
                      borderStyle: isCurrentGroup ? 'dashed' : 'solid',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: 'primary.main',
                        boxShadow: 4,
                      },
                    }}
                    onClick={handleCardClick}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* 색상 바 */}
                    {group.color && (
                      <Box
                        sx={{
                          width: 6,
                          bgcolor: group.color,
                          flexShrink: 0,
                        }}
                      />
                    )}

                    {/* 썸네일 */}
                    {thumbnailUrl ? (
                      <CardMedia
                        component="img"
                        sx={{
                          width: 100,
                          height: 100,
                          objectFit: 'cover',
                          flexShrink: 0,
                        }}
                        image={thumbnailUrl}
                        alt={group.name}
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Box
                        sx={{
                          width: 100,
                          height: 100,
                          bgcolor: 'grey.100',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <GroupIcon sx={{ fontSize: 40, color: 'grey.400' }} />
                      </Box>
                    )}

                    {/* 그룹 정보 */}
                    <CardContent sx={{ flex: 1, py: 1.5, px: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {group.name}
                        </Typography>
                        {isCurrentGroup && (
                          <Chip
                            label="현재 그룹"
                            size="small"
                            color="info"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>

                      {group.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            mb: 1,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            fontSize: '0.8rem',
                          }}
                        >
                          {group.description}
                        </Typography>
                      )}

                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Chip
                          icon={<GroupIcon />}
                          label={`${group.image_count}개`}
                          size="small"
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                        {group.auto_collect_enabled && (
                          <Chip
                            icon={<AutoIcon />}
                            label="자동수집"
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ height: 22, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                    </CardContent>
                  </Card>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button
          onClick={handleAssign}
          color="primary"
          variant="contained"
          disabled={!selectedGroupId}
        >
          할당
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GroupAssignModal;
