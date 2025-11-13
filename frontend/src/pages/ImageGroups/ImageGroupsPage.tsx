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
  Tabs,
  Tab,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Collections as GroupIcon,
  AutoAwesome as AutoIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { groupApi } from '../../services/api';
import type { GroupWithStats, GroupWithHierarchy, BreadcrumbItem } from '@comfyui-image-manager/shared';
import type { ImageRecord, PageSize } from '../../types/image';
import GroupCreateEditModal from './components/GroupCreateEditModal';
import GroupImageGridModal from './components/GroupImageGridModal';
import { GroupBreadcrumb } from './components/GroupBreadcrumb';
import AutoFolderGroupsContent from './components/AutoFolderGroupsContent';

const ImageGroupsPage: React.FC = () => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [tabValue, setTabValue] = useState(0);
  const [groups, setGroups] = useState<GroupWithHierarchy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithHierarchy | null>(null);
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

  // 계층 네비게이션 상태
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  // 그룹 이미지 모달 관련 상태
  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false);
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<GroupWithStats | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(25);

  // 그룹 목록 조회 (계층 기반)
  const fetchGroups = async (parentId: number | null = null) => {
    try {
      setLoading(true);
      const response = parentId === null
        ? await groupApi.getRootGroups()
        : await groupApi.getChildGroups(parentId);

      if (response.success && response.data) {
        setGroups(response.data);
      } else {
        showSnackbar(t('imageGroups:messages.loadFailed'), 'error');
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      showSnackbar(t('imageGroups:messages.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // 브레드크럼 로드
  const loadBreadcrumb = async (groupId: number) => {
    try {
      const response = await groupApi.getBreadcrumbPath(groupId);
      if (response.success && response.data) {
        setBreadcrumb(response.data);
      }
    } catch (error) {
      console.error('Error loading breadcrumb:', error);
    }
  };

  // 그룹 네비게이션 (하위 그룹이 1개만 있으면 자동 진입)
  const navigateToGroup = async (groupId: number | null, autoNavigate: boolean = true) => {
    setCurrentParentId(groupId);
    if (groupId === null) {
      setBreadcrumb([]);
    } else {
      await loadBreadcrumb(groupId);
    }

    // 그룹 목록 조회
    const response = groupId === null
      ? await groupApi.getRootGroups()
      : await groupApi.getChildGroups(groupId);

    if (response.success && response.data) {
      const fetchedGroups = response.data;
      setGroups(fetchedGroups);

      // 자동 진입 조건: autoNavigate가 true이고, 하위 그룹이 정확히 1개이고, 이미지가 없으면 계속 진입
      if (autoNavigate && fetchedGroups.length === 1) {
        const singleGroup = fetchedGroups[0];

        if (singleGroup.image_count === 0 && singleGroup.child_count === 1) {
          // 재귀적으로 하위 그룹으로 진입
          await navigateToGroup(singleGroup.id, true);
          return;
        }
      }
    } else {
      showSnackbar(t('imageGroups:messages.loadFailed'), 'error');
    }
  };

  // 하위 그룹 열기
  const openSubgroups = (group: GroupWithHierarchy) => {
    navigateToGroup(group.id);
  };

  // 브레드크럼 클릭 핸들러 (자동 진입 비활성화)
  const handleBreadcrumbNavigate = (groupId: number | null) => {
    navigateToGroup(groupId, false);
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
        showSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error');
        setGroupImages([]);
      }
    } catch (error) {
      console.error('Error fetching group images:', error);
      showSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error');
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
        showSnackbar(t('imageGroups:messages.deleteSuccess'), 'success');
        fetchGroups();
      } else {
        showSnackbar(response.error || t('imageGroups:messages.deleteFailed'), 'error');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      showSnackbar(t('imageGroups:messages.deleteFailed'), 'error');
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
          t('imageGroups:messages.autoCollectSuccess', {
            added: result.images_added,
            removed: result.images_removed
          }),
          'success'
        );
        fetchGroups();
      } else {
        showSnackbar(response.error || t('imageGroups:messages.autoCollectFailed'), 'error');
      }
    } catch (error) {
      console.error('Error running auto collection:', error);
      showSnackbar(t('imageGroups:messages.autoCollectFailed'), 'error');
    }
    handleMenuClose();
  };

  // 그룹 생성 성공 핸들러
  const handleGroupCreated = () => {
    setIsCreateModalOpen(false);
    fetchGroups();
    showSnackbar(t('imageGroups:messages.createSuccess'), 'success');
  };

  // 그룹 수정 성공 핸들러
  const handleGroupUpdated = () => {
    setIsEditModalOpen(false);
    setSelectedGroup(null);
    fetchGroups();
    showSnackbar(t('imageGroups:messages.updateSuccess'), 'success');
  };

  // 그룹 카드 클릭 핸들러 (하위 그룹 우선, 없으면 이미지 보기)
  const handleGroupClick = (group: GroupWithStats) => {
    // 하위 그룹이 있으면 하위 그룹 목록으로 이동
    if (group.child_count && group.child_count > 0) {
      navigateToGroup(group.id);
    } else if (group.image_count > 0) {
      // 하위 그룹 없고 이미지가 있으면 모달 열기
      setSelectedGroupForImages(group);
      setGroupImagesModalOpen(true);
      setGroupImagesPage(1); // 페이지 초기화
      fetchGroupImages(group.id, 1, groupImagesPageSize);
    } else {
      // 둘 다 없으면 빈 그룹 메시지 표시
      showSnackbar(t('imageGroups:messages.emptyGroup'), 'info');
    }
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

  // 이미지 제거 핸들러
  const handleImagesRemoved = async (manualImageIds: string[]) => {
    if (!selectedGroupForImages) return;

    try {
      if (manualImageIds.length === 0) {
        showSnackbar(t('imageGroups:messages.removeWarning'), 'warning');
        return;
      }

      const result = await groupApi.removeImagesFromGroup(selectedGroupForImages.id, manualImageIds);

      if (result.success) {
        showSnackbar(t('imageGroups:messages.removeSuccess', { count: result.removed }), 'success');
      } else {
        showSnackbar(
          t('imageGroups:messages.removePartialSuccess', {
            removed: result.removed,
            failed: result.errors.length
          }),
          'warning'
        );
      }

      // 제거 후 그룹 이미지 목록 다시 조회하여 페이지 확인
      const updatedResult = await groupApi.getGroupImages(
        selectedGroupForImages.id,
        groupImagesPage,
        groupImagesPageSize
      );

      // 현재 페이지가 비어있고, 이전 페이지가 존재하면 이전 페이지로 이동
      if (updatedResult.success && updatedResult.data) {
        const hasImages = updatedResult.data.images && updatedResult.data.images.length > 0;
        const hasPreviousPage = groupImagesPage > 1;

        if (!hasImages && hasPreviousPage) {
          // 빈 페이지이고 이전 페이지가 있으면 이전 페이지로 이동
          setGroupImagesPage(groupImagesPage - 1);
          fetchGroupImages(selectedGroupForImages.id, groupImagesPage - 1, groupImagesPageSize);
        } else {
          // 현재 페이지에 이미지가 있거나 첫 페이지면 현재 페이지 유지
          fetchGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize);
        }
      } else {
        // 조회 실패 시 현재 페이지 새로고침
        fetchGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize);
      }

      // 그룹 목록 새로고침
      fetchGroups();
    } catch (error) {
      console.error('Error removing images:', error);
      showSnackbar(t('imageGroups:messages.removeError'), 'error');
    }
  };

  // 이미지 할당 핸들러
  const handleImagesAssigned = async (targetGroupId: number, selectedImageIds: string[]) => {
    try {
      const response = await groupApi.addImagesToGroup(targetGroupId, selectedImageIds);

      if (response.success && response.data) {
        const { added_count, converted_count, skipped_count } = response.data;
        showSnackbar(
          t('imageGroups:messages.assignSuccess', {
            added: added_count,
            converted: converted_count,
            skipped: skipped_count
          }),
          'success'
        );
      } else {
        showSnackbar(response.error || t('imageGroups:messages.assignFailed'), 'error');
      }

      // 그룹 목록 새로고침
      fetchGroups();
    } catch (error) {
      console.error('Error assigning images:', error);
      showSnackbar(t('imageGroups:messages.assignError'), 'error');
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
          {t('imageGroups:page.title')}
        </Typography>

        {/* 탭 네비게이션 */}
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)} sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('imageGroups:page.customGroupsTab')} />
          <Tab label={t('imageGroups:page.autoFolderGroupsTab')} />
        </Tabs>
      </Box>

      {/* 커스텀 그룹 탭 */}
      {tabValue === 0 && (<>
      {/* 브레드크럼 네비게이션 */}
      {(currentParentId !== null || breadcrumb.length > 0) && (
        <GroupBreadcrumb
          breadcrumb={breadcrumb}
          onNavigate={handleBreadcrumbNavigate}
        />
      )}

      {groups.length === 0 ? (
        <Box textAlign="center" py={8}>
          <GroupIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('imageGroups:page.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('imageGroups:page.emptyDescription')}
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {groups.map((group) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2, xl: 1.5 }} key={group.id}>
              <Card
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  aspectRatio: '5 / 7',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                    '& .hover-info': {
                      opacity: 1,
                    },
                    '& .hover-overlay': {
                      opacity: 1,
                    },
                  },
                  opacity: group.image_count > 0 ? 1 : 0.7,
                }}
                onClick={() => handleGroupClick(group)}
              >
                {/* 배경 이미지 */}
                <CardMedia
                  component="img"
                  image={getRepresentativeImageUrl(group)}
                  alt={group.name}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (target.src !== getRepresentativeImageUrl({...group, image_count: 0})) {
                      target.src = getRepresentativeImageUrl({...group, image_count: 0});
                    }
                  }}
                />

                {/* 기본 정보 (항상 표시) */}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 70%, transparent 100%)',
                    p: 1.5,
                    pb: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FolderIcon sx={{ color: 'primary.light', fontSize: '1.2rem' }} />
                    <Typography
                      variant="subtitle1"
                      component="div"
                      sx={{
                        flex: 1,
                        color: 'white',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.name}
                    </Typography>
                  </Box>
                </Box>

                {/* 호버 시 표시되는 상세 정보 */}
                <Box
                  className="hover-overlay"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    bgcolor: 'rgba(0, 0, 0, 0.6)',
                    opacity: 0,
                    transition: 'opacity 0.2s',
                  }}
                />
                <Box
                  className="hover-info"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    p: 2,
                    opacity: 0,
                    transition: 'opacity 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  {/* 상단: 메뉴 버튼 */}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMenuOpen(e, group.id);
                      }}
                      sx={{
                        bgcolor: 'rgba(255, 255, 255, 0.2)',
                        '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.3)' },
                      }}
                    >
                      <MoreVertIcon sx={{ color: 'white' }} />
                    </IconButton>
                  </Box>

                  {/* 중간: 설명 */}
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    {group.description && (
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'white',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {group.description}
                      </Typography>
                    )}
                  </Box>

                  {/* 하단: Chip 정보 */}
                  <Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                      <Chip
                        label={t('imageGroups:groupCard.imageCount', { count: group.image_count })}
                        size="small"
                        sx={{
                          bgcolor: group.image_count > 0 ? 'primary.main' : 'rgba(255, 255, 255, 0.3)',
                          color: 'white',
                        }}
                      />
                      {group.auto_collect_enabled && (
                        <Chip
                          icon={<AutoIcon sx={{ color: 'white !important' }} />}
                          label={t('imageGroups:groupCard.autoCollect')}
                          size="small"
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'white',
                          }}
                        />
                      )}
                      {group.has_children && (
                        <Chip
                          label={t('imageGroups:hierarchy.childGroups', { count: group.child_count })}
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSubgroups(group);
                          }}
                          sx={{
                            bgcolor: 'secondary.main',
                            color: 'white',
                            cursor: 'pointer',
                          }}
                        />
                      )}
                    </Box>
                    {group.auto_collect_enabled && group.image_count > 0 && (
                      <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        {t('imageGroups:groupCard.stats', {
                          auto: group.auto_collected_count || 0,
                          manual: group.manual_added_count || 0
                        })}
                      </Typography>
                    )}
                  </Box>
                </Box>
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
          {t('common:edit')}
        </MenuItem>
        {groups.find(g => g.id === menuGroupId)?.auto_collect_enabled ? (
          <MenuItem onClick={handleRunAutoCollection}>
            <PlayIcon sx={{ mr: 1 }} fontSize="small" />
            {t('imageGroups:menu.runAutoCollection')}
          </MenuItem>
        ) : null}
        <MenuItem onClick={handleDeleteGroup} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} fontSize="small" />
          {t('common:delete')}
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
      <GroupImageGridModal
        open={groupImagesModalOpen}
        onClose={handleGroupImagesModalClose}
        images={groupImages}
        loading={groupImagesLoading}
        currentGroup={selectedGroupForImages}
        allGroups={groups}
        pageSize={groupImagesPageSize}
        onPageSizeChange={handleGroupImagesPageSizeChange}
        currentPage={groupImagesPage}
        totalPages={groupImagesTotalPages}
        total={groupImagesTotal}
        onPageChange={handleGroupImagesPageChange}
        onImagesRemoved={handleImagesRemoved}
        onImagesAssigned={handleImagesAssigned}
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
      </>)}

      {/* 자동폴더 그룹 탭 */}
      {tabValue === 1 && (
        <AutoFolderGroupsContent onShowSnackbar={showSnackbar} />
      )}
    </Container>
  );
};

export default ImageGroupsPage;