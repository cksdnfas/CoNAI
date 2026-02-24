import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiRefreshCw } from 'react-icons/fi';
import api from '../../../../services/api';
import '../NAITab.css';

interface UserData {
  subscription: {
    tier: number;
    active: boolean;
    tierName: string;
  };
  anlasBalance: number;
}

interface NAIAnlasDisplayProps {
  token: string;
}

const NAIAnlasDisplay: React.FC<NAIAnlasDisplayProps> = ({ token }) => {
  const { t } = useTranslation(['imageGeneration']);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUserData = async () => {
    // Only fetch user data if token exists
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.get('/api/nai/user/data', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      setUserData(response.data);
    } catch (err: any) {
      console.error('[NAI] User data fetch error:', err);
      setError(err.response?.data?.error || 'Failed to fetch user data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch on mount if token exists
    if (token) {
      fetchUserData();
    }
  }, [token]);

  const getTierBadgeClass = (tier: number): string => {
    switch (tier) {
      case 3:
        return 'tier-opus';
      case 2:
        return 'tier-scroll';
      case 1:
        return 'tier-tablet';
      default:
        return 'tier-free';
    }
  };

  // 401 에러(로그인 안 함)는 조용히 숨김 처리
  if (error) {
    return null;
  }

  return (
    <div className="nai-anlas-display">
      {loading ? (
        <span className="loading-text">Loading...</span>
      ) : userData ? (
        <>
          <div className="anlas-info">
            <span className="anlas-label">{t('imageGeneration:nai.anlas.balance')}:</span>
            <span className="anlas-value">{userData.anlasBalance.toLocaleString()}</span>
          </div>

          <div className="subscription-info">
            <span className="subscription-label">{t('imageGeneration:nai.anlas.subscription')}:</span>
            <span className={`tier-badge ${getTierBadgeClass(userData.subscription.tier)}`}>
              {userData.subscription.tierName}
            </span>
          </div>

          <button
            onClick={fetchUserData}
            className="refresh-button"
            title={t('imageGeneration:nai.anlas.refresh')}
          >
            <FiRefreshCw />
          </button>
        </>
      ) : (
        <span className="no-data-text">No data</span>
      )}
    </div>
  );
};

export default NAIAnlasDisplay;
