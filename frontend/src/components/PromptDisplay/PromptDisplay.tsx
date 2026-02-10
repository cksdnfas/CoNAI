import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { groupPromptTerms, type GroupedPromptResult } from '../../utils/promptGrouping';
import type { AutoTagsData } from '../../types/image';
import AutoTagDisplay from './AutoTagDisplay';
import PromptCard from './PromptCard';

export interface NaiCharacterPrompt {
  char_caption: string;
  centers: { x: number; y: number }[];
}

interface PromptDisplayProps {
  prompt?: string | null;
  negativePrompt?: string | null;
  maxHeight?: number | string;
  showLabels?: boolean;
  variant?: 'outlined' | 'elevation' | 'none';
  showGrouped?: boolean;
  // AUTO tab props
  imageId?: string;
  autoTags?: AutoTagsData | null;
  isTaggerEnabled?: boolean;
  onAutoTagGenerated?: () => void;
  // History context props
  isHistoryContext?: boolean;
  // NAI character prompts
  characterPrompts?: NaiCharacterPrompt[];
}

const PromptDisplay: React.FC<PromptDisplayProps> = ({
  prompt,
  negativePrompt,
  showGrouped = false,
  imageId,
  autoTags,
  isTaggerEnabled = false,
  onAutoTagGenerated,
  characterPrompts,
}) => {
  const { t } = useTranslation('promptManagement');
  const [positiveGrouped, setPositiveGrouped] = useState<GroupedPromptResult | null>(null);
  const [negativeGrouped, setNegativeGrouped] = useState<GroupedPromptResult | null>(null);
  const [loading, setLoading] = useState(false);

  const hasPrompt = prompt && prompt.trim();
  const hasNegativePrompt = negativePrompt && negativePrompt.trim();
  const hasCharacterPrompts = characterPrompts && characterPrompts.some(cp => cp.char_caption.trim());
  const showAutoSection = (isTaggerEnabled && imageId !== undefined) || (autoTags && Object.keys(autoTags).length > 0);

  // Memoize prompts to prevent unnecessary re-renders
  const memoizedPrompt = React.useMemo(() => prompt?.trim() || '', [prompt?.trim()]);
  const memoizedNegativePrompt = React.useMemo(() => negativePrompt?.trim() || '', [negativePrompt?.trim()]);

  // Grouped prompt processing
  useEffect(() => {
    if (showGrouped) {
      const loadGroupedData = async () => {
        setLoading(true);
        try {
          if (hasPrompt) {
            const positiveResult = await groupPromptTerms(memoizedPrompt, 'positive');
            setPositiveGrouped(positiveResult);
          }
          if (hasNegativePrompt) {
            const negativeResult = await groupPromptTerms(memoizedNegativePrompt, 'negative');
            setNegativeGrouped(negativeResult);
          }
        } catch (error) {
          console.error('Error grouping prompts:', error);
        } finally {
          setLoading(false);
        }
      };

      loadGroupedData();
    } else {
      setPositiveGrouped(null);
      setNegativeGrouped(null);
    }
  }, [showGrouped, memoizedPrompt, memoizedNegativePrompt, hasPrompt, hasNegativePrompt]);

  // Render grouped prompt content
  const renderGroupedContent = (data: GroupedPromptResult | null, isNegative: boolean = false) => {
    if (loading) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>
          {t('promptDisplay.loading')}
        </Typography>
      );
    }
    if (!data) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>
          {t('promptDisplay.loadFailed')}
        </Typography>
      );
    }

    return (
      <Box>
        {data.groups.map((group) => (
          <Box key={group.id} sx={{ mb: 1 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                color: isNegative ? 'error.main' : 'primary.main',
                fontSize: '0.75rem',
              }}
            >
              {group.group_name}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                lineHeight: 1.6,
                wordBreak: 'break-word',
                fontSize: '0.8rem',
                color: 'text.primary',
              }}
            >
              {group.terms.join(', ')}
            </Typography>
          </Box>
        ))}

        {data.unclassified_terms.length > 0 && (
          <Box>
            <Typography
              variant="body2"
              sx={{
                lineHeight: 1.6,
                wordBreak: 'break-word',
                fontSize: '0.8rem',
                color: 'text.secondary',
              }}
            >
              {data.unclassified_terms.join(', ')}
            </Typography>
          </Box>
        )}
      </Box>
    );
  };

  // No content at all
  if (!hasPrompt && !hasNegativePrompt && !hasCharacterPrompts && !showAutoSection) {
    return (
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {t('promptDisplay.noPrompt')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        pr: 0.5,
        '&::-webkit-scrollbar': {
          width: '4px',
        },
        '&::-webkit-scrollbar-track': {
          background: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(128,128,128,0.3)',
          borderRadius: '2px',
          '&:hover': {
            background: 'rgba(128,128,128,0.5)',
          },
        },
      }}
    >
      {/* Positive prompt card */}
      {hasPrompt && (
        <PromptCard
          cardId="positive"
          title={t('promptDisplay.cards.positive', 'Positive Prompt')}
          copyText={prompt || ''}
          color="primary.main"
        >
          {showGrouped
            ? renderGroupedContent(positiveGrouped, false)
            : (
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  fontSize: '0.8rem',
                }}
              >
                {prompt}
              </Typography>
            )
          }
        </PromptCard>
      )}

      {/* Character prompt cards (NAI v4) */}
      {hasCharacterPrompts && characterPrompts!.map((cp, index) => {
        if (!cp.char_caption.trim()) return null;
        return (
          <PromptCard
            key={`char_${index}`}
            cardId={`char_${index}`}
            title={t('promptDisplay.cards.character', { index: index + 1, defaultValue: `Character {{index}}` })}
            copyText={cp.char_caption}
            color="secondary.main"
          >
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                wordBreak: 'break-word',
                fontSize: '0.8rem',
              }}
            >
              {cp.char_caption}
            </Typography>
          </PromptCard>
        );
      })}

      {/* Negative prompt card */}
      {hasNegativePrompt && (
        <PromptCard
          cardId="negative"
          title={t('promptDisplay.cards.negative', 'Negative Prompt')}
          copyText={negativePrompt || ''}
          color="error.main"
        >
          {showGrouped
            ? renderGroupedContent(negativeGrouped, true)
            : (
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  fontSize: '0.8rem',
                  color: 'text.secondary',
                }}
              >
                {negativePrompt}
              </Typography>
            )
          }
        </PromptCard>
      )}

      {/* AUTO tag card */}
      {showAutoSection && (
        <PromptCard
          cardId="auto"
          title={t('promptDisplay.cards.auto', 'AUTO Tags')}
          color="info.main"
        >
          <AutoTagDisplay
            imageId={imageId!}
            autoTags={autoTags ?? null}
            onTagGenerated={onAutoTagGenerated}
          />
        </PromptCard>
      )}
    </Box>
  );
};

export default PromptDisplay;
