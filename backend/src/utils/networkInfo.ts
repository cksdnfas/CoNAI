import { networkInterfaces } from 'os';

export interface NetworkInfo {
  localUrl: string;
  networkUrls: string[];
  externalUrl: string | null;
  qrCodeData: string;
}

/**
 * Get all local IP addresses
 */
export function getLocalIPs(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;

    for (const net of nets) {
      // Skip internal (loopback) and non-IPv4 addresses
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
      if (net.family === familyV4Value && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

/**
 * Get external IP address using public API
 */
export async function getExternalIP(): Promise<string | null> {
  const services = [
    'https://api.ipify.org?format=json',
    'https://api.my-ip.io/ip.json',
    'https://ipinfo.io/json'
  ];

  for (const service of services) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(service, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json() as Record<string, unknown>;

      // Different services use different field names
      const ip = (data.ip || data.IP || data.query) as string | undefined;

      if (ip && typeof ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        return ip;
      }
    } catch (error) {
      // Try next service
      continue;
    }
  }

  return null;
}

/**
 * Generate network information for display
 */
export async function getNetworkInfo(
  protocol: 'http' | 'https',
  port: number | string,
  includeExternal = false
): Promise<NetworkInfo> {
  const localIPs = getLocalIPs();
  const localUrl = `${protocol}://localhost:${port}`;
  const networkUrls = localIPs.map(ip => `${protocol}://${ip}:${port}`);

  let externalUrl: string | null = null;

  if (includeExternal) {
    try {
      const externalIP = await getExternalIP();
      if (externalIP) {
        externalUrl = `${protocol}://${externalIP}:${port}`;
      }
    } catch (error) {
      // External IP detection failed, continue without it
    }
  }

  // Use the first network URL for QR code, or localhost if none available
  const qrCodeData = networkUrls[0] || localUrl;

  return {
    localUrl,
    networkUrls,
    externalUrl,
    qrCodeData
  };
}

/**
 * Format network information for console display
 */
export function formatNetworkInfo(info: NetworkInfo): string[] {
  const lines: string[] = [];

  lines.push(`🏠 Local:    ${info.localUrl}`);

  if (info.networkUrls.length > 0) {
    info.networkUrls.forEach((url, index) => {
      const label = index === 0 ? '🌐 Network:' : '          ';
      lines.push(`${label}  ${url}`);
    });
  }

  if (info.externalUrl) {
    lines.push(`🌍 External: ${info.externalUrl} (requires port forwarding)`);
  }

  return lines;
}

/**
 * Generate simple ASCII QR code for terminal (optional)
 */
export function generateSimpleQR(url: string): string {
  // For now, just return the URL
  // In the future, could integrate a QR code library like 'qrcode-terminal'
  return url;
}
