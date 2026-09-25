/**
 * .intunewin lesen
 *
 * Eine .intunewin-Datei ist ein ZIP mit IntuneWinPackage/Metadata/Detection.xml
 * (Verschluesselungsinfo, Groessen) und IntuneWinPackage/Contents/IntunePackage.intunewin
 * (die verschluesselte Nutzlast, die zu Intune hochgeladen wird). Node bringt
 * keinen ZIP-Leser mit; dieser hier liest das zentrale Verzeichnis und
 * entpackt Eintraege mit inflateRaw. Kein ZIP64, was fuer Intune-Pakete
 * unter 4 GB reicht.
 */

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function listZipEntries(buffer: Buffer): ZipEntry[] {
  // End of central directory: von hinten suchen (Kommentar bis 64 KB)
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end of central directory)');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset === 0xffffffff || centralSize === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  const entries: ZipEntry[] = [];
  let pos = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw new Error('Corrupt central directory');
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    entries.push({ name, compressedSize, uncompressedSize, method, localHeaderOffset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const pos = entry.localHeaderOffset;
  if (buffer.readUInt32LE(pos) !== LOCAL_SIGNATURE) throw new Error(`Corrupt local header for ${entry.name}`);
  const nameLength = buffer.readUInt16LE(pos + 26);
  const extraLength = buffer.readUInt16LE(pos + 28);
  const start = pos + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

export interface IntuneWinMetadata {
  fileName: string;
  setupFile: string;
  unencryptedContentSize: number;
  encryptionInfo: {
    encryptionKey: string;
    macKey: string;
    initializationVector: string;
    mac: string;
    profileIdentifier: string;
    fileDigest: string;
    fileDigestAlgorithm: string;
  };
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match ? match[1] : null;
}

export function parseDetectionXml(xml: string): IntuneWinMetadata {
  const required = (name: string): string => {
    const value = tag(xml, name);
    if (value === null || value === '') throw new Error(`Detection.xml lacks <${name}>`);
    return value;
  };
  return {
    fileName: required('FileName'),
    setupFile: required('SetupFile'),
    unencryptedContentSize: Number(required('UnencryptedContentSize')),
    encryptionInfo: {
      encryptionKey: required('EncryptionKey'),
      macKey: required('MacKey'),
      initializationVector: required('InitializationVector'),
      mac: required('Mac'),
      profileIdentifier: tag(xml, 'ProfileIdentifier') ?? 'ProfileVersion1',
      fileDigest: required('FileDigest'),
      fileDigestAlgorithm: tag(xml, 'FileDigestAlgorithm') ?? 'SHA256',
    },
  };
}

export interface OpenedIntuneWin {
  metadata: IntuneWinMetadata;
  // Die verschluesselte Nutzlast, wie sie in den Blob geht
  payload: Buffer;
}

/**
 * Metadaten und verschluesselte Nutzlast aus einer .intunewin-Datei.
 */
export function openIntuneWin(buffer: Buffer): OpenedIntuneWin {
  const entries = listZipEntries(buffer);
  const detection = entries.find((e) => /Metadata\/Detection\.xml$/i.test(e.name));
  const payload = entries.find((e) => /Contents\/IntunePackage\.intunewin$/i.test(e.name));
  if (!detection || !payload) throw new Error('Not an .intunewin package (Detection.xml or IntunePackage.intunewin missing)');
  return { metadata: parseDetectionXml(readZipEntry(buffer, detection).toString('utf8')), payload: readZipEntry(buffer, payload) };
}
