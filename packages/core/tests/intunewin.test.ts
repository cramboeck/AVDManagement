/**
 * Tests fuer den .intunewin-Leser mit einem selbst gebauten ZIP
 */

import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { listZipEntries, readZipEntry, openIntuneWin, parseDetectionXml } from '../src/apps/intunewin.js';

// Minimaler ZIP-Schreiber fuer den Test (store oder deflate, kein ZIP64)
function buildZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.deflate ? 8 : 0;
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuffer, eocd]);
}

const detectionXml = `<?xml version="1.0" encoding="utf-8"?>
<ApplicationInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" ToolVersion="1.8.6.0">
  <Name>Setup</Name>
  <UnencryptedContentSize>123456</UnencryptedContentSize>
  <FileName>IntunePackage.intunewin</FileName>
  <SetupFile>Invoke-AppDeployToolkit.ps1</SetupFile>
  <EncryptionInfo>
    <EncryptionKey>a2V5</EncryptionKey>
    <MacKey>bWFj</MacKey>
    <InitializationVector>aXY=</InitializationVector>
    <Mac>bWFjdmFsdWU=</Mac>
    <ProfileIdentifier>ProfileVersion1</ProfileIdentifier>
    <FileDigest>ZGlnZXN0</FileDigest>
    <FileDigestAlgorithm>SHA256</FileDigestAlgorithm>
  </EncryptionInfo>
</ApplicationInfo>`;

describe('intunewin reader', () => {
  it('lists and extracts stored and deflated entries', () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'b.txt', data: Buffer.from('world '.repeat(100)), deflate: true },
    ]);
    const entries = listZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(readZipEntry(zip, entries[0]).toString()).toBe('hello');
    expect(readZipEntry(zip, entries[1]).toString()).toBe('world '.repeat(100));
  });

  it('opens an .intunewin and returns metadata and payload', () => {
    const payload = Buffer.from('encrypted-bytes'.repeat(50));
    const zip = buildZip([
      { name: 'IntuneWinPackage/Metadata/Detection.xml', data: Buffer.from(detectionXml), deflate: true },
      { name: 'IntuneWinPackage/Contents/IntunePackage.intunewin', data: payload },
    ]);
    const opened = openIntuneWin(zip);
    expect(opened.metadata).toMatchObject({ setupFile: 'Invoke-AppDeployToolkit.ps1', unencryptedContentSize: 123456, encryptionInfo: { encryptionKey: 'a2V5', fileDigestAlgorithm: 'SHA256' } });
    expect(opened.payload.equals(payload)).toBe(true);
  });

  it('rejects files that are not packages', () => {
    expect(() => openIntuneWin(Buffer.from('not a zip at all'))).toThrow(/Not a ZIP/);
    expect(() => openIntuneWin(buildZip([{ name: 'x.txt', data: Buffer.from('x') }]))).toThrow(/Not an .intunewin/);
    expect(() => parseDetectionXml('<ApplicationInfo></ApplicationInfo>')).toThrow(/FileName/);
  });
});
