declare global {
  interface ElectronBridge {
    platform: NodeJS.Platform;
    backendOrigin?: string;
    publicBaseUrl?: string;
    runtimeBasePath?: string;
    port?: string;
    nodeEnv?: string;
  }

  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export {};
