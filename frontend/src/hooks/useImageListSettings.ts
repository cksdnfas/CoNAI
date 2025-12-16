import { useState, useEffect, useCallback } from 'react';

export type ViewMode = 'masonry' | 'grid';
export type ImageSize = 'small' | 'medium' | 'large';

export interface ImageListSettings {
    viewMode: ViewMode;
    gridColumns: number;
    imageSize: ImageSize;
    activeScrollMode: 'infinite' | 'pagination';
    fitToScreen?: boolean; // New option for single column view
}

const DEFAULT_SETTINGS: ImageListSettings = {
    viewMode: 'masonry',
    gridColumns: 4,
    imageSize: 'medium',
    activeScrollMode: 'infinite',
    fitToScreen: false,
};

const STORAGE_KEY = 'image-manager-list-settings';

export const useImageListSettings = (contextId: string) => {
    // Load initial settings from localStorage
    const loadSettings = (): ImageListSettings => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...DEFAULT_SETTINGS, ...parsed[contextId] };
            }
        } catch (error) {
            console.error('Failed to load image list settings:', error);
        }
        return DEFAULT_SETTINGS;
    };

    const [settings, setSettings] = useState<ImageListSettings>(loadSettings);

    // Persist settings whenever they change
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const allSettings = stored ? JSON.parse(stored) : {};

            allSettings[contextId] = settings;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(allSettings));
        } catch (error) {
            console.error('Failed to save image list settings:', error);
        }
    }, [contextId, settings]);

    const setViewMode = useCallback((mode: ViewMode) => {
        setSettings(prev => ({ ...prev, viewMode: mode }));
    }, []);

    const setGridColumns = useCallback((columns: number) => {
        setSettings(prev => ({ ...prev, gridColumns: columns }));
    }, []);

    const setImageSize = useCallback((size: ImageSize) => {
        setSettings(prev => ({ ...prev, imageSize: size }));
    }, []);

    const setActiveScrollMode = useCallback((mode: 'infinite' | 'pagination') => {
        setSettings(prev => ({ ...prev, activeScrollMode: mode }));
    }, []);

    const setFitToScreen = useCallback((fit: boolean) => {
        setSettings(prev => ({ ...prev, fitToScreen: fit }));
    }, []);

    return {
        settings,
        setViewMode,
        setGridColumns,
        setImageSize,
        setActiveScrollMode,
        setFitToScreen,
    };
};
