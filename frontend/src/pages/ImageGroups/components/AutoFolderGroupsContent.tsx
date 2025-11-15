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
  Button,
  Menu,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  Refresh as RefreshIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { autoFolderGroupsApi } from '../../../services/api';
import type { AutoFolderGroupWithStats } from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../../../types/image';
import { GroupBreadcrumb } from './GroupBreadcrumb';
import GroupImageGridModal from './GroupImageGridModal';
import { AutoFolderGroupCard } from './AutoFolderGroupCard';
import { AutoFolderImageViewCard } from './AutoFolderImageViewCard';
import { useAutoFolderRootGroups, useAutoFolderChildGroups, useRebuildAutoFolderGroups } from '../../../hooks/useAutoFolderGroups';

interface AutoFolderGroupsContentProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void;
}

const AutoFolderGroupsContent: React.FC<AutoFolderGroupsContentProps> = ({ onShowSnackbar }) => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null);

  // 계층 네비게이션 상태
  const [isGroupListView, setIsGroupListView] = useState(true); // true = 그룹 목록 뷰
  const [selectedRootGroupId, setSelectedRootGroupId] = useState<number | null>(null); // 선택된 루트 그룹
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [currentGroupInfo, setCurrentGroupInfo] = useState<AutoFolderGroupWithStats | null>(null); // 현재 폴더 그룹 정보
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: number; name: string }>>([]);

  // React Query hooks for data fetching
  const { data: rootGroupsData, isLoading: rootGroupsLoading, error: rootError } = useAutoFolderRootGroups();
  const { data: childGroupsData, isLoading: childGroupsLoading, error: childError } = useAutoFolderChildGroups(currentParentId);
  const rebuildMutation = useRebuildAutoFolderGroups();

  // Use appropriate data based on current navigation state
  const groups = (currentParentId === null ? rootGroupsData : childGroupsData) || [];
  const loading = currentParentId === null ? rootGroupsLoading : childGroupsLoading;

  // Debug logging
  useEffect(() => {
    console.log('[AutoFolderGroupsContent] State:', {
      currentParentId,
      isGroupListView,
      rootGroupsData,
      childGroupsData,
      groups: groups.length,
      loading,
      rootError,
      childError
    });
  }, [currentParentId, isGroupListView, rootGroupsData, childGroupsData, loading]);

  // 이미지 모달 상태
  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false);
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<AutoFolderGroupWithStats | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<25 | 50 | 100>(25);

  // 브레드크럼 로드
  const loadBreadcrumb = async (groupId: number) => {
    try {
      const response = await autoFolderGroupsApi.getBreadcrumbPath(groupId);
      if (response.success && response.data) {
        setBreadcrumb(response.data);
      }
    } catch (error) {
      console.error('Error loading breadcrumb:', error);
    }
  };

  // 브레드크럼 로드 효과
  useEffect(() => {
    if (currentParentId !== null) {
      loadBreadcrumb(currentParentId);
    }
  }, [currentParentId]);

  // 재구축
  const handleRebuild = async () => {
    try {
      const data = await rebuildMutation.mutateAsync();
      onShowSnackbar(
        `재구축 완료: ${data.groups_created}개 그룹, ${data.images_assigned}개 이미지 (${data.duration_ms}ms)`,
        'success'
      );

      // 재구축 후 항상 루트 레벨로 리셋
      setCurrentParentId(null);
      setCurrentGroupInfo(null);
      setBreadcrumb([]);
      setIsGroupListView(true);

      // 페이지 새로고침으로 모든 상태 초기화
      setTimeout(() => {
        window.location.reload();
      }, 1000); // 스낵바 메시지를 보여준 후 새로고침
    } catch (error) {
      console.error('Error rebuilding:', error);
      onShowSnackbar('재구축 중 오류 발생', 'error');
    }
  };

  // 그룹 네비게이션
  const navigateToGroup = async (group: AutoFolderGroupWithStats) => {
    // Change state - React Query hook will automatically fetch or use cached data
    setCurrentParentId(group.id);
    setCurrentGroupInfo(group); // 현재 그룹 정보 저장
    await loadBreadcrumb(group.id);
  };

  // Auto-navigation effect for single child groups
  useEffect(() => {
    if (groups.length === 1 && currentParentId !== null) {
      const singleGroup = groups[0];
      if (singleGroup.image_count === 0 && singleGroup.child_count === 1) {
        const currentGroupName = currentGroupInfo?.display_name || '폴더';
        onShowSnackbar(`하위 그룹으로 자동 이동: ${currentGroupName} → ${singleGroup.display_name}`, 'info');
        navigateToGroup(singleGroup);
      }
    }
  }, [groups, currentParentId]);

  const handleBreadcrumbClick = async (groupId: number | null) => {
    if (groupId === null) {
      // 그룹 목록으로 돌아가기
      setIsGroupListView(true);
      setSelectedRootGroupId(null);
      setCurrentParentId(null);
      setCurrentGroupInfo(null);
      setBreadcrumb([]);
    } else {
      // Change state - React Query hook will automatically fetch or use cached data
      setCurrentParentId(groupId);
      await loadBreadcrumb(groupId);

      // 현재 그룹 정보 로드
      try {
        const groupResponse = await autoFolderGroupsApi.getGroup(groupId);
        if (groupResponse.success && groupResponse.data) {
          setCurrentGroupInfo(groupResponse.data);
        }
      } catch (error) {
        console.error('Error loading current group info:', error);
      }
    }
  };

  // 컨텍스트 메뉴
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, groupId: number) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setMenuGroupId(groupId);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuGroupId(null);
  };

  const handleViewImages = () => {
    const group = groups.find(g => g.id === menuGroupId);
    if (group) {
      setSelectedGroupForImages(group);
      setGroupImagesModalOpen(true);
      loadGroupImages(group.id, 1);
    }
    handleMenuClose();
  };

  // 그룹 이미지 로드
  const loadGroupImages = async (groupId: number, page: number) => {
    try {
      setGroupImagesLoading(true);
      const response = await autoFolderGroupsApi.getGroupImages(groupId, page, groupImagesPageSize);

      if (response.success && response.data) {
        setGroupImages(response.data.items);
        setGroupImagesPage(response.data.pagination.page);
        setGroupImagesTotalPages(response.data.pagination.totalPages);
        setGroupImagesTotal(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading group images:', error);
      onShowSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error');
    } finally {
      setGroupImagesLoading(false);
    }
  };

  // 이미지 모달 핸들러
  const handleGroupImagesModalClose = () => {
    setGroupImagesModalOpen(false);
    setSelectedGroupForImages(null);
    setGroupImages([]);
    setGroupImagesPage(1);
  };

  const handleGroupImagesPageChange = (newPage: number) => {
    if (selectedGroupForImages) {
      loadGroupImages(selectedGroupForImages.id, newPage);
    }
  };

  const handleGroupImagesPageSizeChange = (newSize: 25 | 50 | 100) => {
    setGroupImagesPageSize(newSize);
    if (selectedGroupForImages) {
      loadGroupImages(selectedGroupForImages.id, 1);
    }
  };

  // 대표 이미지 URL
  const getRepresentativeImageUrl = (group: AutoFolderGroupWithStats): string => {
    if (group.image_count > 0) {
      return autoFolderGroupsApi.getThumbnailUrl(group.id);
    }

    // 이미지 없는 폴더 플레이스홀더
    const svgContent = `
      <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#424242"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="Arial, sans-serif" font-size="16" fill="#bbb">
          📁 ${group.display_name.replace(/[<>&"']/g, (char) => {
            const entities: Record<string, string> = {
              '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
            };
            return entities[char] || char;
          })}
        </text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
  };

  if (loading && groups.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {/* 상단 액션 바 */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Alert severity="info" sx={{ flex: 1, mr: 2 }}>
          읽기 전용 그룹입니다. 원본 파일 위치를 변경해야 반영됩니다.
        </Alert>
        <Button
          variant="contained"
          startIcon={rebuildMutation.isPending ? <CircularProgress size={20} /> : <RefreshIcon />}
          onClick={handleRebuild}
          disabled={rebuildMutation.isPending}
        >
          {rebuildMutation.isPending ? '재구축 중...' : '새로고침'}
        </Button>
      </Box>

      {/* 브레드크럼 (그룹 내부에서만 표시) */}
      {!isGroupListView && (
        <GroupBreadcrumb
          breadcrumb={breadcrumb}
          onNavigate={handleBreadcrumbClick}
          showGroupListRoot={true}
        />
      )}

      {/* 그룹 그리드 */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <FolderOpenIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {isGroupListView ? '자동 폴더 그룹이 없습니다' : '하위 폴더가 없습니다'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isGroupListView
              ? '새로고침 버튼을 눌러 폴더 구조를 생성하세요'
              : '현재 폴더에는 하위 폴더가 없습니다'}
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {/* 폴더 내부 뷰: 현재 폴더의 이미지 보기 카드 추가 */}
          {!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0 && (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2, xl: 1.5 }} key={`image-view-${currentParentId}`}>
              <AutoFolderImageViewCard
                group={currentGroupInfo}
                onClick={() => {
                  setSelectedGroupForImages(currentGroupInfo);
                  setGroupImagesModalOpen(true);
                  loadGroupImages(currentGroupInfo.id, 1);
                }}
              />
            </Grid>
          )}

          {/* 하위 폴더 카드들 */}
          {groups.map((group) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2, xl: 1.5 }} key={group.id}>
              <AutoFolderGroupCard
                group={group}
                onClick={() => {
                  // 그룹 목록 뷰에서는 루트 그룹을 선택하여 해당 그룹의 루트로 진입
                  if (isGroupListView) {
                    setIsGroupListView(false);
                    setSelectedRootGroupId(group.id);
                    navigateToGroup(group);
                    return;
                  }

                  // 그룹 내부에서는 기존 로직 유지
                  if (group.child_count && group.child_count > 0) {
                    navigateToGroup(group);
                  } else if (group.image_count > 0) {
                    setSelectedGroupForImages(group);
                    setGroupImagesModalOpen(true);
                    loadGroupImages(group.id, 1);
                  }
                }}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* 컨텍스트 메뉴 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleViewImages}>
          이미지 보기
        </MenuItem>
      </Menu>

      {/* 이미지 모달 (읽기 전용) */}
      <GroupImageGridModal
        open={groupImagesModalOpen}
        onClose={handleGroupImagesModalClose}
        images={groupImages}
        loading={groupImagesLoading}
        currentGroup={selectedGroupForImages as any}
        allGroups={[]}
        pageSize={groupImagesPageSize}
        onPageSizeChange={handleGroupImagesPageSizeChange}
        currentPage={groupImagesPage}
        totalPages={groupImagesTotalPages}
        total={groupImagesTotal}
        onPageChange={handleGroupImagesPageChange}
        onImagesRemoved={() => {}}
        onImagesAssigned={() => {}}
        readOnly={true}
      />
    </>
  );
};

export default AutoFolderGroupsContent;
