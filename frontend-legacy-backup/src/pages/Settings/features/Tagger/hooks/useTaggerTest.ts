import { useState } from 'react';
import { taggerBatchApi } from '../../../../../services/settingsApi';
import { validateImageId } from '../utils/taggerHelpers';

export const useTaggerTest = () => {
  const [testImageId, setTestImageId] = useState('');
  const [testProcessing, setTestProcessing] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const handleTestImage = async (t: any) => {
    const validation = validateImageId(testImageId);

    if (!validation.isValid) {
      alert(t('tagger.test.invalidId'));
      return;
    }

    setTestProcessing(true);
    setTestResult(null);
    try {
      const result = await taggerBatchApi.testImage(String(validation.imageId!));
      setTestResult(result);
    } catch (error) {
      alert(t('tagger.test.failed'));
      console.error('Failed to test image:', error);
    } finally {
      setTestProcessing(false);
    }
  };

  return {
    testImageId,
    testProcessing,
    testResult,
    setTestImageId,
    handleTestImage,
  };
};
