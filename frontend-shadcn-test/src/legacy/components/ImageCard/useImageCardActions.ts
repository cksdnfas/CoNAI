import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBackendOrigin } from '../../utils/backend';
import type { ImageRecord } from '../../types/image';

export const useImageCardActions = (
    image: ImageRecord,
    onDelete?: (compositeHash: string) => void
) => {
    const { t } = useTranslation(['common']);
    const [toastOpen, setToastOpen] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const backendOrigin = getBackendOrigin();

    const handleDownload = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const link = document.createElement('a');

        // Phase 1: composite_hash가 없으면 경로 기반 다운로드
        if (image.is_processing || !image.composite_hash) {
            link.href = `${backendOrigin}/api/images/by-path/${encodeURIComponent(image.original_file_path || '')}`;
        } else {
            link.href = `${backendOrigin}/api/images/${image.composite_hash}/download/original`;
        }

        link.download = image.original_file_path || `image_${image.composite_hash?.substring(0, 8) || 'unknown'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [backendOrigin, image.is_processing, image.composite_hash, image.original_file_path]);

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const isVideo = image.mime_type?.startsWith('video/');
        const confirmMessage = isVideo
            ? t('common:imageCard.confirmDelete.video')
            : t('common:imageCard.confirmDelete.image');

        if (onDelete && image.composite_hash && window.confirm(confirmMessage)) {
            onDelete(image.composite_hash);
        }
    }, [onDelete, image.composite_hash, image.mime_type, t]);

    const handleCopy = useCallback((text: string, label: string) => async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(text);
            setToastMessage(`${label} copied!`);
            setToastOpen(true);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, []);

    const closeToast = useCallback(() => {
        setToastOpen(false);
    }, []);

    return {
        handleDownload,
        handleDelete,
        handleCopy,
        toastOpen,
        toastMessage,
        closeToast
    };
};
