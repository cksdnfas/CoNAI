import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import {
  danbooruReleaseDirectory,
  danbooruReleaseManifestPath,
  readInstalledDanbooruRelease,
  type InstalledDanbooruRelease,
} from './dbResolver';

const RELEASE_API = 'https://api.github.com/repos/cksdnfas/danbooru-db-viewer/releases/latest';
const ASSET_PREFIX = 'https://github.com/cksdnfas/danbooru-db-viewer/releases/download/';
const MAX_BYTES = 2 * 1024 ** 3;
const CACHE_MS = 60 * 60 * 1000;

interface Release {
  version: string;
  size: number;
  sha256: string;
  url: string;
}

interface InstallJob {
  phase: 'idle' | 'checking' | 'downloading' | 'validating' | 'completed' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
}

async function publishFile(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (error) {
      // Windows virus scanners/readers can briefly prevent an otherwise atomic rename.
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await delay(100 * (attempt + 1));
    }
  }
}

// Preparing these queries verifies the columns and indexes used by browsing and grouping.
function validateDatabase(filePath: string): void {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Downloaded database is damaged.');
    const columns: Record<string, string> = {
      tags: 'id, name, normalized_name, display_name, post_count, category_code, category_name, is_deprecated',
      artists: 'tag_id, name, normalized_name, post_count',
      characters: 'tag_id, name, normalized_name, post_count',
      copyrights: 'tag_id, name, normalized_name, post_count',
      tag_translations: 'tag_id, locale, translated_name',
      taxonomy_nodes: 'id, node_key, node_type, title, description, direct_member_tag_count, member_tag_count',
      taxonomy_node_translations: 'node_key, locale, translated_title',
      character_copyright_links: 'character_tag_id, copyright_tag_id, confidence, is_primary',
      character_related_tags: 'character_tag_id, related_tag_id, score',
      taxonomy_tag_memberships: 'taxonomy_node_id, tag_id',
    };
    for (const [table, fields] of Object.entries(columns)) db.prepare(`SELECT ${fields} FROM ${table} LIMIT 0`).all();
    for (const index of ['idx_tags_name', 'idx_tags_normalized_name']) {
      db.prepare(`SELECT id FROM tags INDEXED BY ${index} LIMIT 0`).all();
    }
    db.prepare('SELECT tag_id FROM taxonomy_tag_memberships INDEXED BY idx_taxonomy_tag_memberships_tag LIMIT 0').all();
  } finally {
    db.close();
  }
}

class DanbooruReleaseInstaller {
  private latest: Release | null = null;
  private checkedAt = 0;
  private releaseRequest: Promise<Release> | null = null;
  private releaseError: string | null = null;
  private running: Promise<void> | null = null;
  private job: InstallJob = { phase: 'idle', downloadedBytes: 0, totalBytes: 0, error: null };

  private async getLatest(force = false): Promise<Release> {
    if (this.releaseRequest) return this.releaseRequest;
    if (!force && Date.now() - this.checkedAt < CACHE_MS) {
      if (this.releaseError) throw new Error(this.releaseError);
      if (this.latest) return this.latest;
    }
    this.releaseRequest = (async () => {
      const response = await fetch(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CoNAI' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);
      const release = await response.json() as {
        tag_name?: string;
        assets?: Array<{ name: string; size: number; digest?: string; browser_download_url: string }>;
      };
      const assets = release.assets?.filter((asset) => /danbooru.*\.(sqlite|sqlite3|db)$/i.test(asset.name)) ?? [];
      const asset = assets.find((item) => item.name === 'danbooru-taxonomy.release.sqlite')
        ?? (assets.length === 1 ? assets[0] : undefined);
      if (!release.tag_name || !asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BYTES
        || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') || !asset.browser_download_url.startsWith(ASSET_PREFIX)) {
        throw new Error('Latest release has no supported database with a SHA-256 checksum.');
      }
      this.latest = { version: release.tag_name, size: asset.size, sha256: asset.digest!.slice(7), url: asset.browser_download_url };
      this.releaseError = null;
      return this.latest;
    })().catch((error: unknown) => {
      this.releaseError = error instanceof Error ? error.message : 'Release lookup failed.';
      throw error;
    }).finally(() => {
      this.checkedAt = Date.now();
      this.releaseRequest = null;
    });
    return this.releaseRequest;
  }

  async status(refresh = false) {
    const customPath = Boolean(process.env.DANBOORU_SQLITE_PATH?.trim());
    if (!customPath) await this.getLatest(refresh).catch(() => undefined);
    const installed = customPath ? null : readInstalledDanbooruRelease();
    return {
      ...this.job,
      canInstall: !customPath,
      installedVersion: installed?.version ?? null,
      installedRevision: installed?.fileName ?? null,
      latestVersion: this.latest?.version ?? null,
      latestSize: this.latest?.size ?? null,
      updateAvailable: Boolean(this.latest && (!installed || installed.sha256 !== this.latest.sha256 || installed.version !== this.latest.version)),
      releaseError: this.releaseError,
    };
  }

  start(): void {
    if (process.env.DANBOORU_SQLITE_PATH?.trim()) {
      throw Object.assign(new Error('A custom Danbooru database path is configured. Automatic installation is disabled.'), { statusCode: 409 });
    }
    if (this.running) return;
    this.job = { phase: 'checking', downloadedBytes: 0, totalBytes: 0, error: null };
    this.running = this.install().then(() => {
      this.job.phase = 'completed';
    }).catch((error: unknown) => {
      this.job.phase = 'error';
      this.job.error = error instanceof Error ? error.message : 'Database installation failed.';
    }).finally(() => { this.running = null; });
  }

  private async install(): Promise<void> {
    await fs.promises.mkdir(danbooruReleaseDirectory, { recursive: true });
    const lockPath = path.join(danbooruReleaseDirectory, 'install.lock');
    // A crashed download may leave a lock. Downloads time out after 15 minutes.
    try {
      const stat = await fs.promises.stat(lockPath);
      if (Date.now() - stat.mtimeMs > CACHE_MS) await fs.promises.unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const lock = await fs.promises.open(lockPath, 'wx').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new Error('Another database installation is running. Try again later.');
      throw error;
    });
    const id = randomUUID();
    const partialPath = path.join(danbooruReleaseDirectory, `${id}.part`);
    const manifestTemp = path.join(danbooruReleaseDirectory, `${id}.json.part`);
    const finalPath = path.join(danbooruReleaseDirectory, `${id}.sqlite`);
    let published = false;
    try {
      const release = await this.getLatest(true);
      const installed = readInstalledDanbooruRelease();
      if (installed?.sha256 === release.sha256 && installed.version === release.version) {
        return;
      }
      this.job.phase = 'downloading';
      this.job.totalBytes = release.size;
      const signal = AbortSignal.timeout(15 * 60_000);
      const response = await fetch(release.url, { signal });
      if (!response.ok || !response.body) throw new Error(`Database download failed (${response.status}).`);
      const hash = createHash('sha256');
      const progress = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          this.job.downloadedBytes += chunk.length;
          if (this.job.downloadedBytes > release.size) return callback(new Error('Database download exceeds the published size.'));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), progress,
        fs.createWriteStream(partialPath, { flags: 'wx' }), { signal });
      this.job.phase = 'validating';
      if (this.job.downloadedBytes !== release.size || hash.digest('hex') !== release.sha256) {
        throw new Error('Database size or SHA-256 checksum does not match the release.');
      }
      validateDatabase(partialPath);
      const manifest: InstalledDanbooruRelease = { version: release.version, sha256: release.sha256, size: release.size, fileName: `${id}.sqlite` };
      await publishFile(partialPath, finalPath);
      await fs.promises.writeFile(manifestTemp, JSON.stringify(manifest), { flag: 'wx' });
      // Publish only after verification. Existing readers can finish using the previous immutable file.
      await publishFile(manifestTemp, danbooruReleaseManifestPath);
      published = true;
    } finally {
      await Promise.allSettled([
        fs.promises.rm(partialPath, { force: true }),
        fs.promises.rm(manifestTemp, { force: true }),
        ...(!published ? [fs.promises.rm(finalPath, { force: true })] : []),
      ]);
      await lock.close();
      await fs.promises.unlink(lockPath);
    }
  }
}

export const danbooruReleaseInstaller = new DanbooruReleaseInstaller();
