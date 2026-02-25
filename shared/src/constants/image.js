"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGINATION = exports.CACHE_CONTROL = exports.IMAGE_PROCESSING = void 0;
exports.IMAGE_PROCESSING = {
    THUMBNAIL_SIZE: 1080,
    MAX_FILE_SIZE_MB: 50,
    MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
    WEBP_QUALITY: 95,
};
exports.CACHE_CONTROL = {
    IMAGES: 'public, max-age=31536000, immutable',
    MAX_AGE: '1y',
};
exports.PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 25,
    GROUP_IMAGES_LIMIT: 20,
    MAX_LIMIT: 100,
};
//# sourceMappingURL=image.js.map