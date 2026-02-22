import { useState, useEffect, useCallback } from 'react';

export type ViewMode = 'masonry' | 'grid';
export type ImageSize = 'small' | 'medium' | 'large';

export interface ImageListSettings {
    viewMode: ViewMode;
    gridColumns: number;
    imageSize: ImageSize;
    activeScrollMode: 'infinite' | 'pagination';
    pageSize: number;
    fitToScreen?: boolean; // New option for single column view
}

const DEFAULT_SETTINGS: ImageListSettings = {
    viewMode: 'masonry',
    gridColumns: 4,
    imageSize: 'medium',
    activeScrollMode: 'infinite',
    pageSize: 50,
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
                // Ensure default values for new properties
                return { ...DEFAULT_SETTINGS, ...parsed[contextId] };
            }
        } catch (error) {
            console.error('Failed to load image list settings:', error);
        }
        return DEFAULT_SETTINGS;
    };

    // Event name for syncing settings across hooks
    const EVENT_NAME = 'image_list_settings_changed';

    const [settings, setSettings] = useState<ImageListSettings>(loadSettings);

    // Persist settings and notify others whenever they change
    const updateSettings = useCallback((newSettings: ImageListSettings) => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const allSettings = stored ? JSON.parse(stored) : {};

            allSettings[contextId] = newSettings;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(allSettings));

            // Notify other instances
            window.dispatchEvent(new CustomEvent(EVENT_NAME, {
                detail: { contextId, settings: newSettings }
            }));

            setSettings(newSettings);
        } catch (error) {
            console.error('Failed to save image list settings:', error);
        }
    }, [contextId]);

    // Reload settings when contextId changes
    useEffect(() => {
        setSettings(loadSettings());
    }, [contextId]);

    // Listen for changes from other instances
    useEffect(() => {
        const handleSettingsChange = (event: Event) => {
            const customEvent = event as CustomEvent;
            if (customEvent.detail.contextId === contextId) {
                // Only update if the settings are actually different to avoid loops/unnecessary renders
                setSettings(prev => {
                    const newSettings = customEvent.detail.settings;
                    if (JSON.stringify(prev) !== JSON.stringify(newSettings)) {
                        return newSettings;
                    }
                    return prev;
                });
            }
        };

        window.addEventListener(EVENT_NAME, handleSettingsChange);
        return () => {
            window.removeEventListener(EVENT_NAME, handleSettingsChange);
        };
    }, [contextId]);

    const setViewMode = useCallback((mode: ViewMode) => {
        updateSettings({ ...settings, viewMode: mode });
    }, [settings, updateSettings]);

    const setGridColumns = useCallback((columns: number) => {
        updateSettings({ ...settings, gridColumns: columns });
    }, [settings, updateSettings]);

    const setImageSize = useCallback((size: ImageSize) => {
        updateSettings({ ...settings, imageSize: size });
    }, [settings, updateSettings]);

    const setActiveScrollMode = useCallback((mode: 'infinite' | 'pagination') => {
        updateSettings({ ...settings, activeScrollMode: mode });
    }, [settings, updateSettings]);

    const setPageSize = useCallback((size: number) => {
        updateSettings({ ...settings, pageSize: size });
    }, [settings, updateSettings]);

    const setFitToScreen = useCallback((fit: boolean) => {
        updateSettings({ ...settings, fitToScreen: fit });
    }, [settings, updateSettings]);

    return {
        settings,
        setViewMode,
        setGridColumns,
        setImageSize,
        setActiveScrollMode,
        setPageSize,
        setFitToScreen,
    };
};
