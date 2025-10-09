const { contextBridge } = require('electron');

const DEFAULT_BACKEND_ORIGIN = 'http://localhost:1566';

// Frontend에서 사용할 API 노출 (필요시)
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  backendOrigin: process.env.BACKEND_ORIGIN || process.env.PUBLIC_BASE_URL || DEFAULT_BACKEND_ORIGIN,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN,
  runtimeBasePath: process.env.RUNTIME_BASE_PATH,
  port: process.env.PORT || '1566',
  nodeEnv: process.env.NODE_ENV || 'production'
});
