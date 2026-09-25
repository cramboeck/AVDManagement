/**
 * Artefaktspeicher fuer Pakete (.intunewin, Installer)
 *
 * local: Ordner auf der Platte (Entwicklung). azure: Blob Storage in der EU,
 * angesprochen ueber die REST-API mit einem Token der Managed Identity bzw.
 * der Entwickleranmeldung (DefaultAzureCredential). Keine SAS-Schluessel im
 * Repo, keine Verbindungszeichenfolgen in der Umgebung.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DefaultAzureCredential } from '@azure/identity';

export interface StoredObject {
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactStore {
  readonly kind: 'local' | 'azure';
  put(key: string, body: Readable): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._ ()+-]+)+$/;

export function assertSafeKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return key;
}

class HashingTransform extends Transform {
  readonly hash = createHash('sha256');
  size = 0;
  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.hash.update(chunk);
    this.size += chunk.length;
    callback(null, chunk);
  }
}

class LocalArtifactStore implements ArtifactStore {
  readonly kind = 'local' as const;
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    return join(this.root, assertSafeKey(key));
  }

  async put(key: string, body: Readable): Promise<StoredObject> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const hashing = new HashingTransform();
    await pipeline(body, hashing, createWriteStream(target));
    return { sha256: hashing.hash.digest('hex'), sizeBytes: hashing.size };
  }

  async get(key: string): Promise<Readable> {
    const target = this.pathFor(key);
    await stat(target);
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

const BLOCK_SIZE = 4 * 1024 * 1024;
const AZURE_API_VERSION = '2023-11-03';

class AzureBlobArtifactStore implements ArtifactStore {
  readonly kind = 'azure' as const;
  private readonly credential = new DefaultAzureCredential();

  constructor(
    private readonly account: string,
    private readonly container: string
  ) {}

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.credential.getToken('https://storage.azure.com/.default');
    if (!token) throw new Error('No token for Azure Storage');
    return { Authorization: `Bearer ${token.token}`, 'x-ms-version': AZURE_API_VERSION, 'x-ms-date': new Date().toUTCString(), ...extra };
  }

  private url(key: string, query = ''): string {
    const path = assertSafeKey(key)
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/');
    return `https://${this.account}.blob.core.windows.net/${this.container}/${path}${query}`;
  }

  async put(key: string, body: Readable): Promise<StoredObject> {
    const hashing = new HashingTransform();
    const blockIds: string[] = [];
    let buffer: Buffer[] = [];
    let buffered = 0;
    const flush = async () => {
      if (buffered === 0) return;
      const block = Buffer.concat(buffer);
      buffer = [];
      buffered = 0;
      const blockId = Buffer.from(String(blockIds.length).padStart(8, '0')).toString('base64');
      const response = await fetch(this.url(key, `?comp=block&blockid=${encodeURIComponent(blockId)}`), { method: 'PUT', headers: await this.headers({ 'Content-Length': String(block.length) }), body: block });
      if (!response.ok) throw new Error(`Azure block upload failed: ${response.status}`);
      blockIds.push(blockId);
    };
    for await (const chunk of body.pipe(hashing)) {
      buffer.push(chunk as Buffer);
      buffered += (chunk as Buffer).length;
      if (buffered >= BLOCK_SIZE) await flush();
    }
    await flush();
    const list = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join('')}</BlockList>`;
    const commit = await fetch(this.url(key, '?comp=blocklist'), { method: 'PUT', headers: await this.headers({ 'Content-Type': 'application/xml', 'x-ms-blob-content-type': 'application/octet-stream' }), body: list });
    if (!commit.ok) throw new Error(`Azure block list commit failed: ${commit.status}`);
    return { sha256: hashing.hash.digest('hex'), sizeBytes: hashing.size };
  }

  async get(key: string): Promise<Readable> {
    const response = await fetch(this.url(key), { headers: await this.headers() });
    if (!response.ok || !response.body) throw new Error(`Azure blob download failed: ${response.status}`);
    return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(this.url(key), { method: 'DELETE', headers: await this.headers() });
    if (!response.ok && response.status !== 404) throw new Error(`Azure blob delete failed: ${response.status}`);
  }
}

let store: ArtifactStore | null = null;

export function getArtifactStore(): ArtifactStore {
  if (store) return store;
  if (process.env.ARTIFACT_STORE === 'azure') {
    const account = process.env.ARTIFACT_AZURE_ACCOUNT;
    const container = process.env.ARTIFACT_AZURE_CONTAINER ?? 'packages';
    if (!account) throw new Error('ARTIFACT_AZURE_ACCOUNT is required for ARTIFACT_STORE=azure');
    store = new AzureBlobArtifactStore(account, container);
  } else {
    store = new LocalArtifactStore(resolve(process.env.ARTIFACT_STORE_PATH ?? './data/artifacts'));
  }
  return store;
}

// Nur fuer Tests
export function createLocalArtifactStore(root: string): ArtifactStore {
  return new LocalArtifactStore(root);
}
