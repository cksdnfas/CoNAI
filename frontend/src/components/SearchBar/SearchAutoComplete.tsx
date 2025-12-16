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
    Block as NegativeIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import apiClient from '../../services/api/apiClient';

export interface PromptSearchResult {
    id: number;
    prompt: string;
    usage_count: number;
    group_id: number | null;
    synonyms: string[];
    type: 'positive' | 'negative' | 'auto';
}

interface SearchAutoCompleteProps {
    value: string;
    onChange: (value: string) => void;
    onSelectTag?: (tag: PromptSearchResult) => void;
    onKeyPress?: (event: React.KeyboardEvent) => void;
    placeholder?: string;
    autoFocus?: boolean;
}

type TabType = 'positive' | 'auto' | 'negative';

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
    }>({ positive: 0, auto: 0, negative: 0 });

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
        if (!currentTerm && !open) return;

        const fetchSuggestions = async () => {
            setLoading(true);
            try {
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

                    // Also fetch counts for all types if term is present, to update tab badges
                    // This might be expensive on every keystroke, optimize if needed
                    // specific API for just counts would be better or getting counts in one go
                    // For now, we simulate counts or use total from response if possible
                    // The search API returns total for the requested type.

                    // TODO: Ideally we want counts for ALL tabs to show (9) (12) (0).
                    // We can make parallel requests or add a 'counts_only' endpoint.
                    // For now, let's just update the current tab's count from response
                    setStats(prev => ({
                        ...prev,
                        [activeTab]: response.data.pagination.total
                    }));

                    // If we want accurate counts for other tabs, we need to fetch them too
                    // Let's do it only if term is long enough to avoid spamming
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
    }, [currentTerm, activeTab]);

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
            // (Logic from previous implementation if needed, but we encourage using onSelectTag)
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

    const getTagColor = (type: string) => {
        switch (type) {
            case 'positive': return theme.palette.success.main; // Greenish
            case 'negative': return theme.palette.error.main;   // Reddish
            case 'auto': return theme.palette.info.main;        // Blueish (or generic)
            default: return theme.palette.text.primary;
        }
    };

    // Danbooru Colors reference (approximate)
    // General: Blue (#0075f8)
    // Character: Green (#00ab2c)
    // Copyright: Purple (#a800aa)
    // Artist: Red (#c00004)
    // Meta: Orange (#fd9200)

    // We have Positive (User defined?), Automatic (Detected?), Negative
    // Let's stick to:
    // Positive: Green or Blue
    // Automatic: Orange or Purple (distinct)
    // Negative: Red

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
                open={open && (suggestions.length > 0 || currentTerm.length > 0)}
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
                                                                        color: getTagColor(option.type)
                                                                    }}
                                                                >
                                                                    {option.prompt}
                                                                </Typography>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {option.usage_count > 0 ? `${option.usage_count}` : ''}
                                                                </Typography>
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
