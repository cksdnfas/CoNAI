"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBitrate = exports.formatDuration = exports.truncateFilename = exports.formatDate = exports.formatFileSize = void 0;
const formatFileSize = (bytes) => {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
exports.formatFileSize = formatFileSize;
const formatDate = (dateString, locale = 'ko-KR') => {
    return new Date(dateString).toLocaleString(locale);
};
exports.formatDate = formatDate;
const truncateFilename = (filename, maxLength = 40) => {
    if (filename.length <= maxLength)
        return filename;
    const ext = filename.split('.').pop();
    if (!ext)
        return filename.substring(0, maxLength) + '...';
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const truncatedName = nameWithoutExt.substring(0, maxLength - ext.length - 4) + '...';
    return `${truncatedName}.${ext}`;
};
exports.truncateFilename = truncateFilename;
const formatDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${String(secs).padStart(2, '0')}`;
};
exports.formatDuration = formatDuration;
const formatBitrate = (bitrate) => {
    return `${(bitrate / 1000000).toFixed(2)} Mbps`;
};
exports.formatBitrate = formatBitrate;
//# sourceMappingURL=formatters.js.map