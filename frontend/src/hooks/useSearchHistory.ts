import { useState, useEffect, useCallback } from 'react';
import type { SearchToken } from '../components/SearchBar/SimpleSearchTab';

export interface SearchHistoryItem {
    id: string;
    timestamp: number;
    text: string;
    tokens: SearchToken[];
}

const MAX_HISTORY_ITEMS = 10;
const HISTORY_KEY = 'search_history_v1';

export const useSearchHistory = () => {
    const [history, setHistory] = useState<SearchHistoryItem[]>([]);

    // Load history on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(HISTORY_KEY);
            if (saved) {
                setHistory(JSON.parse(saved));
            }
        } catch (e) {
            console.error('Failed to load search history', e);
        }
    }, []);

    const addHistoryItem = useCallback((text: string, tokens: SearchToken[]) => {
        // Don't save empty searches
        if (!text.trim() && tokens.length === 0) return;

        setHistory(prev => {
            // Remove duplicates (same text and same tokens)
            const filtered = prev.filter(item => {
                const sameText = item.text === text;
                const sameTokens = JSON.stringify(item.tokens) === JSON.stringify(tokens);
                return !(sameText && sameTokens);
            });

            const newItem: SearchHistoryItem = {
                id: Date.now().toString(),
                timestamp: Date.now(),
                text,
                tokens
            };

            const newHistory = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);

            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
            } catch (e) {
                console.error('Failed to save search history', e);
            }

            return newHistory;
        });
    }, []);

    const removeHistoryItem = useCallback((id: string) => {
        setHistory(prev => {
            const newHistory = prev.filter(item => item.id !== id);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
            return newHistory;
        });
    }, []);

    const clearHistory = useCallback(() => {
        setHistory([]);
        localStorage.removeItem(HISTORY_KEY);
    }, []);

    return {
        history,
        addHistoryItem,
        removeHistoryItem,
        clearHistory
    };
};
