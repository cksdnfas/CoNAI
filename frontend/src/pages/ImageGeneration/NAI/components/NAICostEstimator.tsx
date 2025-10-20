import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../../services/api';
import '../NAITab.css';

interface CostEstimate {
  estimatedCost: number;
  maxSamples: number;
  canAfford: boolean;
  isOpusFree: boolean;
}

interface NAICostEstimatorProps {
  width: number;
  height: number;
  steps: number;
  n_samples: number;
  sm: boolean;
  sm_dyn: boolean;
  subscriptionTier: number;
  anlasBalance: number;
}

const NAICostEstimator: React.FC<NAICostEstimatorProps> = ({
  width,
  height,
  steps,
  n_samples,
  sm,
  sm_dyn,
  subscriptionTier,
  anlasBalance,
}) => {
  const { t } = useTranslation(['imageGeneration']);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const calculateCost = async () => {
      setLoading(true);

      try {
        const response = await api.post('/api/nai/cost/calculate', {
          width,
          height,
          steps,
          n_samples,
          sm,
          sm_dyn,
          subscriptionTier,
          anlasBalance,
        });

        setCostEstimate(response.data);
      } catch (err) {
        console.error('[NAI] Cost calculation error:', err);
        setCostEstimate(null);
      } finally {
        setLoading(false);
      }
    };

    // Debounce: 파라미터 변경 후 500ms 대기
    const timeoutId = setTimeout(calculateCost, 500);
    return () => clearTimeout(timeoutId);
  }, [width, height, steps, n_samples, sm, sm_dyn, subscriptionTier, anlasBalance]);

  if (loading || !costEstimate) {
    return (
      <div className="nai-cost-estimator loading">
        <span>Calculating cost...</span>
      </div>
    );
  }

  return (
    <div className="nai-cost-estimator">
      <h3 className="cost-title">{t('imageGeneration:nai.cost.title')}</h3>

      <div className="cost-info">
        <div className="cost-row">
          <span className="cost-label">{t('imageGeneration:nai.cost.anlas')}:</span>
          <span className="cost-value">{costEstimate.estimatedCost}</span>
        </div>

        <div className="cost-row">
          <span className="cost-label">{t('imageGeneration:nai.cost.balance')}:</span>
          <span className="cost-value">
            {anlasBalance.toLocaleString()} (
            <span className={costEstimate.canAfford ? 'sufficient' : 'insufficient'}>
              {costEstimate.canAfford
                ? t('imageGeneration:nai.cost.sufficient')
                : t('imageGeneration:nai.cost.insufficient')}
            </span>
            )
          </span>
        </div>

        {costEstimate.isOpusFree && (
          <div className="cost-row opus-free">
            <span className="opus-badge">✨ {t('imageGeneration:nai.cost.opusFree')}</span>
          </div>
        )}

        <div className="cost-row">
          <span className="cost-label">{t('imageGeneration:nai.cost.maxSamples')}:</span>
          <span className="cost-value">{costEstimate.maxSamples}</span>
        </div>
      </div>
    </div>
  );
};

export default NAICostEstimator;
