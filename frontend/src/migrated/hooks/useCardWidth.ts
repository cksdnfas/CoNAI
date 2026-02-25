import { useState, useEffect, useRef } from 'react';

export const useCardWidth = (breakpoint: number = 220) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isSmall, setIsSmall] = useState(false);

    useEffect(() => {
        if (!ref.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setIsSmall(entry.contentRect.width < breakpoint);
            }
        });

        observer.observe(ref.current);

        return () => {
            observer.disconnect();
        };
    }, [breakpoint]);

    return { ref, isSmall };
};
