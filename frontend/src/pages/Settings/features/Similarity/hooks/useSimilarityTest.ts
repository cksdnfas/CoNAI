import { useState } from 'react';
import { similarityApi, type SimilarImage } from '../../../../../services/similarityApi';
import { imageApi } from '../../../../../services/api';
import type { ImageRecord } from '../../../../../types/image';

export const useSimilarityTest = () => {
  const [testImageId, setTestImageId] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResults, setTestResults] = useState<SimilarImage[]>([]);
  const [testType, setTestType] = useState<'duplicates' | 'similar' | 'color'>('similar');
  const [queryImage, setQueryImage] = useState<ImageRecord | null>(null);

  // Settings
  const [duplicateThreshold, setDuplicateThreshold] = useState(5);
  const [similarThreshold, setSimilarThreshold] = useState(15);
  const [colorThreshold, setColorThreshold] = useState(85);
  const [searchLimit, setSearchLimit] = useState(20);

  const handleTestSearch = async (t: any) => {
    const compositeHash = testImageId.trim();
    if (!compositeHash) {
      alert(t('tagger.test.invalidId'));
      return;
    }

    setTestLoading(true);
    setTestResults([]);
    setQueryImage(null);
    try {
      const imageResponse = await imageApi.getImage(compositeHash);
      if (imageResponse.success && imageResponse.data) {
        setQueryImage(imageResponse.data);
      }

      let results: SimilarImage[] = [];

      if (testType === 'duplicates') {
        results = await similarityApi.findDuplicates(compositeHash, duplicateThreshold);
      } else if (testType === 'similar') {
        results = await similarityApi.findSimilar(compositeHash, {
          threshold: similarThreshold,
          limit: searchLimit,
          includeColorSimilarity: true,
        });
      } else if (testType === 'color') {
        results = await similarityApi.findSimilarByColor(compositeHash, colorThreshold, searchLimit);
      }

      setTestResults(results);
    } catch (error: any) {
      alert(error.response?.data?.error || t('similarity.test.searchFailed'));
      console.error('Failed to search:', error);
    } finally {
      setTestLoading(false);
    }
  };

  return {
    testImageId,
    testLoading,
    testResults,
    testType,
    queryImage,
    duplicateThreshold,
    similarThreshold,
    colorThreshold,
    searchLimit,
    setTestImageId,
    setTestType,
    setDuplicateThreshold,
    setSimilarThreshold,
    setColorThreshold,
    setSearchLimit,
    handleTestSearch,
  };
};
