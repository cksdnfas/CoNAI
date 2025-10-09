import fs from 'fs';
import path from 'path';
import selfsigned from 'selfsigned';
import type https from 'https';
import { runtimePaths } from '../config/runtimePaths';

const isIp = (value: string): boolean => /^(\d{1,3}\.){3}\d{1,3}$/.test(value);

const parseAltNameList = (raw?: string | null): string[] => {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const buildAltNameObjects = (values: string[]): Array<{ type: 2 | 7; value: string }> => {
  const unique = new Map<string, { type: 2 | 7; value: string }>();

  for (const value of values) {
    const type = isIp(value) ? 7 : 2;
    unique.set(value, { type, value });
  }

  return Array.from(unique.values());
};

export type HttpsOptions = https.ServerOptions & { generatedCertPath?: string; generatedKeyPath?: string };

export function prepareHttpsOptions(): HttpsOptions | null {
  const certPath = process.env.SSL_CERT_FILE;
  const keyPath = process.env.SSL_KEY_FILE;
  const allowSelfSigned = (process.env.ENABLE_SELF_SIGNED_TLS || 'true').toLowerCase() !== 'false';

  if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
  }

  if (!allowSelfSigned) {
    console.warn('⚠️ HTTPS requested but no certificate provided. Set SSL_CERT_FILE and SSL_KEY_FILE. Falling back to HTTP.');
    return null;
  }

  const hostCandidates = [
    process.env.SSL_CERT_DOMAIN,
    process.env.BACKEND_HOST,
    process.env.PUBLIC_BASE_URL?.replace(/^https?:\/\//i, ''),
    process.env.BACKEND_ORIGIN?.replace(/^https?:\/\//i, ''),
    'localhost',
  ]
    .filter((value): value is string => !!value && value.trim().length > 0)
    .map((value) => value.split(':')[0]);

  const configuredAltNames = parseAltNameList(process.env.SSL_ALT_NAMES);
  const altNames = buildAltNameObjects([...hostCandidates, ...configuredAltNames]);

  const certDir = path.join(runtimePaths.basePath, 'certs');
  const certFile = path.join(certDir, 'selfsigned.cert.pem');
  const keyFile = path.join(certDir, 'selfsigned.key.pem');

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const shouldRegenerate =
    process.env.REGENERATE_SELF_SIGNED === 'true' || !fs.existsSync(certFile) || !fs.existsSync(keyFile);

  if (shouldRegenerate) {
    const attrs = [
      {
        name: 'commonName',
        value: hostCandidates[0] || 'ComfyUI-Image-Manager',
      },
    ];

    const extensions = altNames.length
      ? [
          {
            name: 'subjectAltName',
            altNames,
          },
        ]
      : undefined;

    const pems = selfsigned.generate(attrs, {
      algorithm: 'sha256',
      days: Number(process.env.SELF_SIGNED_DAYS || 365),
      keySize: 2048,
      extensions,
    });

    fs.writeFileSync(certFile, pems.cert, { encoding: 'utf-8', mode: 0o600 });
    fs.writeFileSync(keyFile, pems.private, { encoding: 'utf-8', mode: 0o600 });

    console.log('🔒 Generated new self-signed certificate:', certFile);
  }

  return {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile),
    generatedCertPath: certFile,
    generatedKeyPath: keyFile,
  };
}
