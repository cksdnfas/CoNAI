import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Fab,
  Menu,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
  Container,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Collections as GroupIcon,
  AutoAwesome as AutoIcon,
} from '@mui/icons-material';

import { groupApi } from '../../services/api';
import type { GroupWithStats } from '../../types/group';
import type { ImageRecord, PageSize } from '../../types/image';
import GroupCreateEditModal from './components/GroupCreateEditModal';
import { ImageGridModal } from '../../components/ImageGrid';

const ImageGroupsPage: React.FC = () => {
  const [groups, setGroups] = useState<GroupWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithStats | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // 그룹 이미지 모달 관련 상태
  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false);
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<GroupWithStats | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(25);

  // 그룹 목록 조회
  const fetchGroups = async () => {
    try {
      setLoading(true);
      const response = await groupApi.getGroups();
      if (response.success && response.data) {
        setGroups(response.data);
      } else {
        showSnackbar('그룹 목록을 불러오는데 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      showSnackbar('그룹 목록을 불러오는데 실패했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  // 그룹 이미지 조회
  const fetchGroupImages = async (groupId: number, page: number = 1, pageSize?: PageSize) => {
    try {
      setGroupImagesLoading(true);
      const actualPageSize = pageSize || groupImagesPageSize;
      const response = await groupApi.getGroupImages(groupId, page, actualPageSize);

      if (response.success && response.data) {
        setGroupImages(response.data.images || []);
        setGroupImagesPage(response.data.pagination?.page || 1);
        setGroupImagesTotalPages(response.data.pagination?.totalPages || 1);
        setGroupImagesTotal(response.data.pagination?.total || 0);
      } else {
        showSnackbar('그룹 이미지를 불러오는데 실패했습니다.', 'error');
        setGroupImages([]);
      }
    } catch (error) {
      console.error('Error fetching group images:', error);
      showSnackbar('그룹 이미지를 불러오는데 실패했습니다.', 'error');
      setGroupImages([]);
    } finally {
      setGroupImagesLoading(false);
    }
  };

  // 스낵바 표시
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
    setSnackbar({ open: true, message, severity });
  };

  // 스낵바 닫기
  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 메뉴 열기
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, groupId: number) => {
    setAnchorEl(event.currentTarget);
    setMenuGroupId(groupId);
  };

  // 메뉴 닫기
  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuGroupId(null);
  };

  // 그룹 편집
  const handleEditGroup = () => {
    const group = groups.find(g => g.id === menuGroupId);
    if (group) {
      setSelectedGroup(group);
      setIsEditModalOpen(true);
    }
    handleMenuClose();
  };

  // 그룹 삭제
  const handleDeleteGroup = async () => {
    if (!menuGroupId) return;

    try {
      const response = await groupApi.deleteGroup(menuGroupId);
      if (response.success) {
        showSnackbar('그룹이 삭제되었습니다.', 'success');
        fetchGroups();
      } else {
        showSnackbar(response.error || '그룹 삭제에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      showSnackbar('그룹 삭제에 실패했습니다.', 'error');
    }
    handleMenuClose();
  };

  // 자동수집 실행
  const handleRunAutoCollection = async () => {
    if (!menuGroupId) return;

    try {
      const response = await groupApi.runAutoCollection(menuGroupId);
      if (response.success && response.data) {
        const result = response.data;
        showSnackbar(
          `자동수집 완료: ${result.images_added}개 추가, ${result.images_removed}개 제거`,
          'success'
        );
        fetchGroups();
      } else {
        showSnackbar(response.error || '자동수집 실행에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Error running auto collection:', error);
      showSnackbar('자동수집 실행에 실패했습니다.', 'error');
    }
    handleMenuClose();
  };

  // 그룹 생성 성공 핸들러
  const handleGroupCreated = () => {
    setIsCreateModalOpen(false);
    fetchGroups();
    showSnackbar('그룹이 생성되었습니다.', 'success');
  };

  // 그룹 수정 성공 핸들러
  const handleGroupUpdated = () => {
    setIsEditModalOpen(false);
    setSelectedGroup(null);
    fetchGroups();
    showSnackbar('그룹이 수정되었습니다.', 'success');
  };

  // 그룹 카드 클릭 핸들러 (이미지 보기)
  const handleGroupClick = (group: GroupWithStats) => {
    setSelectedGroupForImages(group);
    setGroupImagesModalOpen(true);
    setGroupImagesPage(1); // 페이지 초기화
    fetchGroupImages(group.id, 1, groupImagesPageSize);
  };

  // 그룹 이미지 모달 닫기
  const handleGroupImagesModalClose = () => {
    setGroupImagesModalOpen(false);
    setSelectedGroupForImages(null);
    setGroupImages([]);
    setGroupImagesPage(1);
  };

  // 그룹 이미지 페이지 변경
  const handleGroupImagesPageChange = (page: number) => {
    if (selectedGroupForImages) {
      setGroupImagesPage(page);
      fetchGroupImages(selectedGroupForImages.id, page, groupImagesPageSize);
    }
  };

  // 그룹 이미지 페이지 사이즈 변경
  const handleGroupImagesPageSizeChange = (size: PageSize) => {
    setGroupImagesPageSize(size);
    if (selectedGroupForImages) {
      setGroupImagesPage(1);
      fetchGroupImages(selectedGroupForImages.id, 1, size);
    }
  };

  // 대표 이미지 URL 생성
  const getRepresentativeImageUrl = (group: GroupWithStats): string => {
    // 그룹에 이미지가 있으면 랜덤 썸네일을 사용, 없으면 플레이스홀더
    if (group.image_count > 0) {
      return groupApi.getThumbnailUrl(group.id);
    }

    // 이미지가 없을 때 플레이스홀더 SVG
    const svgContent = `
      <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f5f5f5"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="Arial, sans-serif" font-size="16" fill="#666">
          ${group.name.replace(/[<>&"']/g, (char) => {
      const entities: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entities[char] || char;
    })}
        </text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          이미지 그룹
        </Typography>
        <Typography variant="body1" color="text.secondary">
          이미지를 그룹별로 관리하고 자동 수집 규칙을 설정할 수 있습니다.
        </Typography>
      </Box>

      {groups.length === 0 ? (
        <Box textAlign="center" py={8}>
          <GroupIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            아직 생성된 그룹이 없습니다
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            새 그룹을 만들어서 이미지를 체계적으로 관리해보세요.
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {groups.map((group) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={group.id}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: (theme) => theme.shadows[8],
                  },
                }}
                onClick={() => handleGroupClick(group)}
              >
                <CardMedia
                  component="img"
                  height="200"
                  image={getRepresentativeImageUrl(group)}
                  alt={group.name}
                  sx={{
                    objectFit: 'cover',
                    backgroundColor: 'grey.100',
                  }}
                  onError={(e) => {
                    // 이미지 로드 실패 시 플레이스홀더로 대체
                    const target = e.target as HTMLImageElement;
                    if (target.src !== getRepresentativeImageUrl({...group, image_count: 0})) {
                      target.src = getRepresentativeImageUrl({...group, image_count: 0});
                    }
                  }}
                />
                <CardContent sx={{ flexGrow: 1, position: 'relative' }}>
                  <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation(); // 카드 클릭 이벤트 방지
                        handleMenuOpen(e, group.id);
                      }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>

                  <Typography
                    variant="h6"
                    component="h2"
                    gutterBottom
                    noWrap
                    sx={{ pr: 5 }}
                  >
                    {group.name}
                  </Typography>

                  {group.description ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mb: 2,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {group.description}
                    </Typography>
                  ) : null}

                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                    <Chip
                      icon={<GroupIcon />}
                      label={`${group.image_count}개 이미지`}
                      size="small"
                      variant="outlined"
                    />
                    {group.auto_collect_enabled ? (
                      <Chip
                        icon={<AutoIcon />}
                        label="자동수집"
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ) : null}
                  </Box>

                  {group.auto_collect_enabled && group.image_count > 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      자동: {group.auto_collected_count || 0}개 | 수동: {group.manual_added_count || 0}개
                    </Typography>
                  ) : null}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* 그룹 생성 FAB */}
      <Fab
        color="primary"
        aria-label="add group"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
        }}
        onClick={() => setIsCreateModalOpen(true)}
      >
        <AddIcon />
      </Fab>

      {/* 컨텍스트 메뉴 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEditGroup}>
          <EditIcon sx={{ mr: 1 }} fontSize="small" />
          편집
        </MenuItem>
        {groups.find(g => g.id === menuGroupId)?.auto_collect_enabled ? (
          <MenuItem onClick={handleRunAutoCollection}>
            <PlayIcon sx={{ mr: 1 }} fontSize="small" />
            자동수집 실행
          </MenuItem>
        ) : null}
        <MenuItem onClick={handleDeleteGroup} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} fontSize="small" />
          삭제
        </MenuItem>
      </Menu>

      {/* 그룹 생성 모달 */}
      <GroupCreateEditModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleGroupCreated}
      />

      {/* 그룹 편집 모달 */}
      {selectedGroup ? (
        <GroupCreateEditModal
          open={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedGroup(null);
          }}
          onSuccess={handleGroupUpdated}
          group={selectedGroup}
        />
      ) : null}

      {/* 그룹 이미지 모달 */}
      <ImageGridModal
        open={groupImagesModalOpen}
        onClose={handleGroupImagesModalClose}
        images={groupImages}
        loading={groupImagesLoading}
        title={selectedGroupForImages ? `${selectedGroupForImages.name} (${groupImagesTotal}개 이미지)` : '그룹 이미지'}
        pageSize={groupImagesPageSize}
        onPageSizeChange={handleGroupImagesPageSizeChange}
        currentPage={groupImagesPage}
        totalPages={groupImagesTotalPages}
        total={groupImagesTotal}
        onPageChange={handleGroupImagesPageChange}
      />

      {/* 스낵바 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleSnackbarClose}
      >
        <Alert
          onClose={handleSnackbarClose}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default ImageGroupsPage;