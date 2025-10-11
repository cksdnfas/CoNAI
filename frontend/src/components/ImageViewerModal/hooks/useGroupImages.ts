import { useState, useCallback } from 'react';
import type { ImageRecord, PageSize } from '../../../types/image';
import { groupApi } from '../../../services/api';

type ImageGroupInfo = NonNullable<ImageRecord['groups']>[number];

interface UseGroupImagesResult {
  groupModalOpen: boolean;
  selectedGroup: ImageGroupInfo | null;
  groupImages: ImageRecord[];
  groupImagesLoading: boolean;
  groupImagesPage: number;
  groupImagesTotalPages: number;
  groupImagesTotal: number;
  groupImagesPageSize: PageSize;
  handleGroupClick: (group: ImageGroupInfo) => Promise<void>;
  handleGroupModalClose: () => void;
  handleGroupImagesPageChange: (page: number) => void;
  handleGroupImagesPageSizeChange: (size: PageSize) => void;
}

/**
 * Custom hook for managing group images modal and data fetching
 */
export const useGroupImages = (): UseGroupImagesResult => {
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ImageGroupInfo | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(25);

  const fetchGroupImages = useCallback(async (groupId: number, page: number = 1, pageSize?: PageSize) => {
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
        setGroupImages([]);
      }
    } catch (error) {
      console.error('Error fetching group images:', error);
      setGroupImages([]);
    } finally {
      setGroupImagesLoading(false);
    }
  }, [groupImagesPageSize]);

  const handleGroupClick = useCallback(async (group: ImageGroupInfo) => {
    setSelectedGroup(group);
    setGroupImagesLoading(true);
    setGroupModalOpen(true);
    await fetchGroupImages(group.id, 1, groupImagesPageSize);
  }, [fetchGroupImages, groupImagesPageSize]);

  const handleGroupModalClose = useCallback(() => {
    setGroupModalOpen(false);
  }, []);

  const handleGroupImagesPageChange = useCallback((page: number) => {
    if (selectedGroup) {
      fetchGroupImages(selectedGroup.id, page, groupImagesPageSize);
    }
  }, [selectedGroup, fetchGroupImages, groupImagesPageSize]);

  const handleGroupImagesPageSizeChange = useCallback((size: PageSize) => {
    setGroupImagesPageSize(size);
    if (selectedGroup) {
      fetchGroupImages(selectedGroup.id, 1, size);
    }
  }, [selectedGroup, fetchGroupImages]);

  return {
    groupModalOpen,
    selectedGroup,
    groupImages,
    groupImagesLoading,
    groupImagesPage,
    groupImagesTotalPages,
    groupImagesTotal,
    groupImagesPageSize,
    handleGroupClick,
    handleGroupModalClose,
    handleGroupImagesPageChange,
    handleGroupImagesPageSizeChange,
  };
};
