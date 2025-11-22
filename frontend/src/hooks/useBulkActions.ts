import { useState, useCallback } from 'react';
import { imageApi, groupApi } from '../services/api';

export const useBulkActions = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ file_id 기반 삭제 (중복 파일 개별 삭제 지원)
  const deleteImages = useCallback(async (fileIds: number[]): Promise<boolean> => {
    if (fileIds.length === 0) return false;

    setLoading(true);
    setError(null);

    try {
      const result = await imageApi.deleteImageFiles(fileIds);

      if (!result.success) {
        setError(result.error || '이미지 삭제에 실패했습니다.');
        return false;
      }

      return true;
    } catch (err) {
      setError('이미지 삭제 중 오류가 발생했습니다.');
      console.error('Bulk delete error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ composite_hash 기반으로 변경
  const downloadImages = useCallback(async (compositeHashes: string[]) => {
    if (compositeHashes.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // 각 이미지를 순차적으로 다운로드
      // 브라우저에서 동시 다운로드 제한을 고려하여 순차 처리
      for (const compositeHash of compositeHashes) {
        const link = document.createElement('a');
        link.href = imageApi.getDownloadUrl(compositeHash);
        link.download = `image_${compositeHash.substring(0, 8)}`;  // 해시의 처음 8자만 사용
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 다운로드 간 짧은 지연 (브라우저 제한 회피)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      setError('이미지 다운로드 중 오류가 발생했습니다.');
      console.error('Bulk download error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ composite_hash 기반으로 변경
  const assignToGroup = useCallback(async (compositeHashes: string[], groupId: number): Promise<boolean> => {
    if (compositeHashes.length === 0) return false;

    setLoading(true);
    setError(null);

    try {
      const result = await groupApi.addImagesToGroup(groupId, compositeHashes);

      if (!result.success) {
        setError(result.error || '그룹 할당에 실패했습니다.');
        return false;
      }

      return true;
    } catch (err) {
      setError('그룹 할당 중 오류가 발생했습니다.');
      console.error('Group assignment error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    deleteImages,
    downloadImages,
    assignToGroup,
    clearError: () => setError(null),
  };
};