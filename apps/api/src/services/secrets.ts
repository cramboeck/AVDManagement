/**
 * Secrets: Umgebung zuerst, sonst Azure Key Vault ueber Managed Identity
 *
 * Mit KEY_VAULT_URL laedt die API beim Start alle bekannten Secrets, die in
 * der Umgebung fehlen, aus dem Vault in process.env (Name mit Bindestrich
 * statt Unterstrich: ENTRA-CLIENT-SECRET). So bleiben die Konsumenten
 * unveraendert und in Produktion steht kein Secret in einer Datei.
 *
 * App-Anmeldung an Entra: Zertifikat vor Client-Secret. Das Zertifikat kommt
 * als PEM (Schluessel plus Zertifikat) aus ENTRA_CLIENT_CERTIFICATE_PEM,
 * ENTRA_CLIENT_CERTIFICATE_PATH oder dem Vault-Secret
 * ENTRA-CLIENT-CERTIFICATE-PEM.
 */

import { createHash, createPrivateKey, randomUUID, X509Certificate, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';

// Secrets, die aus dem Vault geladen werden, wenn sie in der Umgebung fehlen
export const VAULT_SECRETS = [
  'ENTRA_CLIENT_SECRET',
  'ENTRA_CLIENT_CERTIFICATE_PEM',
  'JWT_SECRET',
  'RESULT_ENCRYPTION_KEY',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'NVD_API_KEY',
  'TEAMVIEWER_API_TOKEN',
  'WORKER_TOKEN',
] as const;

export function vaultSecretName(envName: string): string {
  return envName.replace(/_/g, '-');
}

export interface SecretLoadReport {
  source: 'env' | 'key-vault';
  loaded: string[];
  missing: string[];
}

/**
 * Fehlende Secrets aus dem Key Vault nachladen. Ohne KEY_VAULT_URL passiert
 * nichts. Ein nicht vorhandenes Secret ist kein Fehler (optional), ein
 * Zugriffsfehler auf den Vault schon.
 */
export async function loadSecrets(): Promise<SecretLoadReport> {
  const vaultUrl = process.env.KEY_VAULT_URL;
  if (!vaultUrl) return { source: 'env', loaded: [], missing: [] };
  const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([import('@azure/keyvault-secrets'), import('@azure/identity')]);
  const client = new SecretClient(vaultUrl, new DefaultAzureCredential());
  const loaded: string[] = [];
  const missing: string[] = [];
  for (const name of VAULT_SECRETS) {
    if (process.env[name]) continue;
    try {
      const secret = await client.getSecret(vaultSecretName(name));
      if (secret.value) {
        process.env[name] = secret.value;
        loaded.push(name);
      } else {
        missing.push(name);
      }
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404) {
        missing.push(name);
        continue;
      }
      throw new Error(`Key Vault ${vaultUrl}: ${name} konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { source: 'key-vault', loaded, missing };
}

export interface ClientCertificate {
  privateKey: KeyObject;
  privateKeyPem: string;
  // SHA-1 (hex) fuer x5t und MSAL, SHA-256 (hex) fuer neuere Konfigurationen
  thumbprintSha1: string;
  thumbprintSha256: string;
  notAfter: string;
}

export type ClientCredential = { kind: 'certificate'; certificate: ClientCertificate } | { kind: 'secret'; clientSecret: string };

/** Zertifikat plus Schluessel aus einem PEM-Text lesen. */
export function parseClientCertificate(pem: string): ClientCertificate {
  const certMatch = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  const keyMatch = pem.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/);
  if (!certMatch || !keyMatch) throw new Error('Client certificate PEM must contain a CERTIFICATE and a PRIVATE KEY block');
  const cert = new X509Certificate(certMatch[0]);
  const privateKey = createPrivateKey(keyMatch[0]);
  return {
    privateKey,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    thumbprintSha1: createHash('sha1').update(cert.raw).digest('hex'),
    thumbprintSha256: createHash('sha256').update(cert.raw).digest('hex'),
    notAfter: new Date(cert.validTo).toISOString(),
  };
}

let cachedCredential: ClientCredential | null = null;

/** Anmeldedaten der App-Registrierung: Zertifikat, sonst Client-Secret. */
export function clientCredential(): ClientCredential {
  if (cachedCredential) return cachedCredential;
  let pem = process.env.ENTRA_CLIENT_CERTIFICATE_PEM;
  if (!pem && process.env.ENTRA_CLIENT_CERTIFICATE_PATH) pem = readFileSync(process.env.ENTRA_CLIENT_CERTIFICATE_PATH, 'utf8');
  if (pem) {
    const certificate = parseClientCertificate(pem);
    if (new Date(certificate.notAfter).getTime() < Date.now()) throw new Error(`Client certificate expired on ${certificate.notAfter}`);
    cachedCredential = { kind: 'certificate', certificate };
    return cachedCredential;
  }
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  if (!clientSecret) throw new Error('No client credential: set ENTRA_CLIENT_CERTIFICATE_PEM/PATH or ENTRA_CLIENT_SECRET (or provide them via KEY_VAULT_URL)');
  cachedCredential = { kind: 'secret', clientSecret };
  return cachedCredential;
}

export function hasClientCredential(): boolean {
  return Boolean(process.env.ENTRA_CLIENT_CERTIFICATE_PEM || process.env.ENTRA_CLIENT_CERTIFICATE_PATH || process.env.ENTRA_CLIENT_SECRET);
}

/**
 * client_assertion (RFC 7523) fuer den Token-Endpunkt: RS256, x5t mit dem
 * SHA-1-Thumbprint, zehn Minuten gueltig.
 */
export async function buildClientAssertion(clientId: string, tokenEndpoint: string, certificate: Pick<ClientCertificate, 'privateKey' | 'thumbprintSha1'>, now = new Date()): Promise<string> {
  const x5t = Buffer.from(certificate.thumbprintSha1, 'hex').toString('base64url');
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', x5t })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(tokenEndpoint)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setNotBefore(iat)
    .setExpirationTime(iat + 10 * 60)
    .sign(certificate.privateKey);
}

/** Formular-Parameter fuer den Token-Endpunkt je nach Anmeldedaten. */
export async function clientAuthParams(clientId: string, tokenEndpoint: string): Promise<Record<string, string>> {
  const credential = clientCredential();
  if (credential.kind === 'secret') return { client_secret: credential.clientSecret };
  return {
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: await buildClientAssertion(clientId, tokenEndpoint, credential.certificate),
  };
}
