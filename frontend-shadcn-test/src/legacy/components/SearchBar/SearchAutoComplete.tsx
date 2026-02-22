import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    TextField,
    InputAdornment,
    Paper,
    Tabs,
    Tab,
    Typography,
    List,
    ListItemButton,
    ListItemText,
    Chip,
    ClickAwayListener,
    Popper,
    Fade,
    useTheme,
    CircularProgress,
    Tooltip
} from '@mui/material';
import {
    Search as SearchIcon,
    CheckCircle as PositiveIcon,
    AutoAwesome as AutoIcon,
    Block as NegativeIcon,
    Star as RatingIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import apiClient from '../../services/api/apiClient';
import type { RatingTier } from '../../types/rating';

export interface PromptSearchResult {
    id: number;
    prompt: string;
    usage_count: number;
    group_id: number | null;
    synonyms: string[];
    type: 'positive' | 'negative' | 'auto' | 'rating';
    min_score?: number;
    max_score?: number | null;
    color?: string | null;
}

interface SearchAutoCompleteProps {
    value: string;
    onChange: (value: string) => void;
    onSelectTag?: (tag: PromptSearchResult) => void;
    onKeyPress?: (event: React.KeyboardEvent) => void;
    placeholder?: string;
    autoFocus?: boolean;
}

type TabType = 'positive' | 'auto' | 'negative' | 'rating';

const SearchAutoComplete: React.FC<SearchAutoCompleteProps> = ({
    value,
    onChange,
    onSelectTag,
    onKeyPress,
    placeholder,
    autoFocus
}) => {
    const { t } = useTranslation(['search']);
    const theme = useTheme();

    // State
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('positive');
    const [suggestions, setSuggestions] = useState<PromptSearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentTerm, setCurrentTerm] = useState('');
    const [cursorPosition, setCursorPosition] = useState(0);

    // Stats for tabs
    const [stats, setStats] = useState<{
        positive: number;
        auto: number;
        negative: number;
        rating: number;
    }>({ positive: 0, auto: 0, negative: 0, rating: 0 });

    const anchorRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Parse current term based on cursor position
    useEffect(() => {
        // Determine the word being typed at cursor position
        const textBeforeCursor = value.slice(0, cursorPosition);
        const textAfterCursor = value.slice(cursorPosition);

        // Split by comma or space (simple parser for now, can be improved)
        // We want to find the last delimiter before cursor
        const lastCommaIndex = textBeforeCursor.lastIndexOf(',');

        let termStart = lastCommaIndex + 1;
        // skip whitespace after comma
        while (termStart < textBeforeCursor.length && textBeforeCursor[termStart] === ' ') {
            termStart++;
        }

        // Find next comma or end of string
        const nextCommaIndex = textAfterCursor.indexOf(',');
        let termEnd = nextCommaIndex === -1 ? value.length : cursorPosition + nextCommaIndex;

        const term = value.slice(termStart, termEnd).trim();
        setCurrentTerm(term);
    }, [value, cursorPosition]);

    // Fetch suggestions when current term changes or tab changes
    useEffect(() => {
        if (!currentTerm && !open && activeTab !== 'rating') return;

        const fetchSuggestions = async () => {
            setLoading(true);
            try {
                if (activeTab === 'rating') {
                    // Fetch Rating Tiers
                    const response = await apiClient.get('/api/settings/rating/tiers');
                    if (response.data.success) {
                        let tiers = response.data.data as RatingTier[];

                        // Filter by term if present
                        if (currentTerm) {
                            tiers = tiers.filter(tier =>
                                tier.tier_name.toLowerCase().includes(currentTerm.toLowerCase())
                            );
                        }

                        const ratingResults: PromptSearchResult[] = tiers.map(tier => ({
                            id: tier.id,
                            prompt: tier.tier_name,
                            usage_count: 0, // Not applicable for static tiers
                            group_id: null,
                            synonyms: [],
                            type: 'rating',
                            min_score: tier.min_score,
                            max_score: tier.max_score,
                            color: tier.color
                        }));

                        setSuggestions(ratingResults);
                        setStats(prev => ({ ...prev, rating: tiers.length }));
                    }
                } else {
                    // Fetch suggestions for current tab
                    const response = await apiClient.get('/api/prompt-collection/search', {
                        params: {
                            q: currentTerm,
                            type: activeTab,
                            limit: 20
                        }
                    });

                    if (response.data.success) {
                        setSuggestions(response.data.data);

                        setStats(prev => ({
                            ...prev,
                            [activeTab]: response.data.pagination.total
                        }));

                        // If we want valid counts for other tabs, we need to fetch them
                        if (currentTerm.length >= 2) {
                            const types: TabType[] = ['positive', 'auto', 'negative'];
                            const otherTypes = types.filter(t => t !== activeTab);

                            otherTypes.forEach(type => {
                                apiClient.get('/api/prompt-collection/search', {
                                    params: { q: currentTerm, type, limit: 1 }
                                }).then(res => {
                                    if (res.data.success) {
                                        setStats(prev => ({ ...prev, [type]: res.data.pagination.total }));
                                    }
                                });
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to fetch suggestions', error);
            } finally {
                setLoading(false);
            }
        };

        const timer = setTimeout(() => {
            fetchSuggestions();
        }, 300);

        return () => clearTimeout(timer);
    }, [currentTerm, activeTab, open]);

    const handleTabChange = (_event: React.SyntheticEvent, newValue: TabType) => {
        setActiveTab(newValue);
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    const handleSelectTag = (tag: PromptSearchResult) => {
        if (onSelectTag) {
            onSelectTag(tag);
        } else {
            // Fallback: Replace current term
            const textBeforeCursor = value.slice(0, cursorPosition);
            const textAfterCursor = value.slice(cursorPosition);

            const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
            let termStart = lastCommaIndex + 1;

            const nextCommaIndex = textAfterCursor.indexOf(',');
            let termEnd = nextCommaIndex === -1 ? value.length : cursorPosition + nextCommaIndex;

            let newValue = '';
            if (lastCommaIndex === -1) {
                newValue = tag.prompt + (nextCommaIndex === -1 ? ', ' : '');
                if (nextCommaIndex !== -1) {
                    newValue += value.slice(nextCommaIndex);
                }
            } else {
                newValue = value.slice(0, termStart) + ' ' + tag.prompt + (nextCommaIndex === -1 ? ', ' : '') + value.slice(termEnd);
            }
            onChange(newValue);
        }

        setOpen(false);
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    const getTagColor = (option: PromptSearchResult) => {
        if (option.type === 'rating' && option.color) {
            return option.color;
        }

        switch (option.type) {
            case 'positive': return theme.palette.success.main;
            case 'negative': return theme.palette.error.main;
            case 'auto': return theme.palette.info.main;
            case 'rating': return theme.palette.warning.main;
            default: return theme.palette.text.primary;
        }
    };

    return (
        <Box sx={{ position: 'relative' }}>
            <TextField
                fullWidth
                variant="outlined"
                placeholder={placeholder}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setOpen(true);
                }}
                onKeyPress={onKeyPress}
                autoFocus={autoFocus}
                inputRef={inputRef}
                onClick={() => setOpen(true)}
                onSelect={(e: any) => setCursorPosition(e.target.selectionStart)}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start">
                            <SearchIcon />
                        </InputAdornment>
                    ),
                    ref: anchorRef
                }}
            />

            <Popper
                open={open && (suggestions.length > 0 || currentTerm.length > 0 || activeTab === 'rating')}
                anchorEl={anchorRef.current}
                placement="bottom-start"
                transition
                style={{ zIndex: 1300, width: anchorRef.current?.clientWidth }}
            >
                {({ TransitionProps }) => (
                    <Fade {...TransitionProps} timeout={200}>
                        <Paper elevation={8} sx={{ mt: 1, overflow: 'hidden' }}>
                            <ClickAwayListener onClickAway={() => setOpen(false)}>
                                <Box>
                                    <Tabs
                                        value={activeTab}
                                        onChange={handleTabChange}
                                        variant="fullWidth"
                                        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
                                    >
                                        <Tab
                                            icon={<Tooltip title={`${t('search:tabs.positive', 'Positive')} (${stats.positive})`}><PositiveIcon /></Tooltip>}
                                            value="positive"
                                            sx={{ minHeight: 40, py: 1, color: activeTab === 'positive' ? 'success.main' : 'text.secondary' }}
                                        />
                                        <Tab
                                            icon={<Tooltip title={`${t('search:tabs.auto', 'Auto')} (${stats.auto})`}><AutoIcon /></Tooltip>}
                                            value="auto"
                                            sx={{ minHeight: 40, py: 1, color: activeTab === 'auto' ? 'info.main' : 'text.secondary' }}
                                        />
                                        <Tab
                                            icon={<Tooltip title={`${t('search:tabs.negative', 'Negative')} (${stats.negative})`}><NegativeIcon /></Tooltip>}
                                            value="negative"
                                            sx={{ minHeight: 40, py: 1, color: activeTab === 'negative' ? 'error.main' : 'text.secondary' }}
                                        />
                                        <Tab
                                            icon={<Tooltip title={`${t('search:tabs.rating', 'Rating')}`}><RatingIcon /></Tooltip>}
                                            value="rating"
                                            sx={{ minHeight: 40, py: 1, color: activeTab === 'rating' ? 'warning.main' : 'text.secondary' }}
                                        />
                                    </Tabs>

                                    {loading ? (
                                        <Box sx={{ p: 2, textAlign: 'center' }}>
                                            <CircularProgress size={24} />
                                        </Box>
                                    ) : (
                                        <List sx={{ maxHeight: 400, overflow: 'auto', py: 0 }}>
                                            {suggestions.map((option) => (
                                                <ListItemButton
                                                    key={`${option.type}-${option.id}`}
                                                    onClick={() => handleSelectTag(option)}
                                                    sx={{
                                                        py: 0.5,
                                                        '&:hover': {
                                                            bgcolor: 'action.hover'
                                                        }
                                                    }}
                                                >
                                                    <ListItemText
                                                        primary={
                                                            <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <Typography
                                                                    variant="body2"
                                                                    component="span"
                                                                    sx={{
                                                                        fontWeight: 'bold',
                                                                        color: getTagColor(option)
                                                                    }}
                                                                >
                                                                    {option.prompt}
                                                                </Typography>
                                                                {option.type === 'rating' ? (
                                                                    <Typography variant="caption" color="text.secondary">
                                                                        {option.min_score}~{option.max_score || '∞'}
                                                                    </Typography>
                                                                ) : (
                                                                    <Typography variant="caption" color="text.secondary">
                                                                        {option.usage_count > 0 ? `${option.usage_count}` : ''}
                                                                    </Typography>
                                                                )}
                                                            </Box>
                                                        }
                                                        secondary={
                                                            option.synonyms && option.synonyms.length > 0 ? (
                                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                                    → {option.synonyms.join(', ')}
                                                                </Typography>
                                                            ) : null
                                                        }
                                                    />
                                                </ListItemButton>
                                            ))}
                                            {suggestions.length === 0 && (
                                                <Box sx={{ p: 2, textAlign: 'center' }}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {t('search:noResults', 'No tags found')}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </List>
                                    )}

                                    <Box sx={{
                                        p: 1,
                                        bgcolor: 'background.default',
                                        borderTop: 1,
                                        borderColor: 'divider',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1
                                    }}>
                                        <Typography variant="caption" color="text.secondary">
                                            {t('search:tip.select', 'Select to add tag')}
                                        </Typography>
                                    </Box>
                                </Box>
                            </ClickAwayListener>
                        </Paper>
                    </Fade>
                )}
            </Popper>
        </Box>
    );
};

export default SearchAutoComplete;
