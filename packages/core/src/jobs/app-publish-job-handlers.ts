/**
 * Job apps.publish: ein Paket aus dem Katalog in einem Tenant als Intune-App anlegen
 *
 * Win32: Graph-Objekt anlegen, Inhalt hochladen, Version festschreiben.
 * winget: nur das Graph-Objekt. Der Job legt keine Zuweisung an; das
 * bleibt der bewusste zweite Schritt unter Apps. Fortschritt und Fehler
 * landen im Deployment-Datensatz je Tenant.
 */

import type { AppManifest, AppPackage, DeploymentStatus } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { buildWin32LobAppPayload, buildWinGetAppPayload, effectiveDetectionRules, installCommandLine, packageDisplayName, uninstallCommandLine } from '../apps/manifest.js';
import { openIntuneWin } from '../apps/intunewin.js';
import type { ProviderContext } from '../providers/resource-provider.js';

export interface PublishOperations {
  loadPackage(mspId: string, packageId: string): Promise<{ pkg: AppPackage; artifact: Buffer | null; detectionPrefix: string } | null>;
  publishWin32(ctx: ProviderContext, payload: Record<string, unknown>, opened: ReturnType<typeof openIntuneWin>, onProgress?: (step: string) => void): Promise<{ appId: string; contentVersion: string }>;
  publishWinGet(ctx: ProviderContext, payload: Record<string, unknown>): Promise<{ appId: string }>;
  recordDeployment(mspId: string, packageId: string, tenantId: string, patch: { status: DeploymentStatus; intuneAppId?: string | null; contentVersion?: string | null; error?: string | null; jobId?: string | null; publishedAt?: Date | null }): Promise<void>;
  existingDeployment(packageId: string, tenantId: string): Promise<{ status: string; intuneAppId: string | null } | null>;
}

export interface PublishPayload {
  packageId: string;
  packageName: string;
  tenantName: string;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

function describeManifest(m: AppManifest, prefix: string): Record<string, unknown> {
  return {
    displayName: packageDisplayName(m),
    type: m.installerType === 'store' ? 'winGetApp' : 'win32LobApp',
    ...(m.installerType === 'store'
      ? { packageIdentifier: m.wingetPackageIdentifier }
      : {
          install: installCommandLine(m),
          uninstall: uninstallCommandLine(m),
          detection: effectiveDetectionRules(m, prefix).map((r) => (r.type === 'registry' ? `Registry ${r.keyPath}${r.valueName ? `\\${r.valueName}` : ''}` : r.type === 'msi' ? `MSI ${r.productCode}` : r.type === 'file' ? `Datei ${r.path}\\${r.fileOrFolderName}` : 'Skript')),
          context: m.installContext,
          restart: m.restartBehavior,
        }),
  };
}

export function registerAppPublishJobs(ops: PublishOperations): void {
  registerJob(
    {
      type: 'apps.publish',
      displayName: 'Paket in Tenant veroeffentlichen',
      maxRetries: 0,
      timeoutSeconds: 1800,
      concurrencyPerTenant: 1,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as PublishPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      const loaded = await ops.loadPackage(ctx.mspId, payload.packageId);
      if (!loaded) return failure('PACKAGE_NOT_FOUND', 'Paket nicht gefunden');
      const { pkg, artifact, detectionPrefix } = loaded;
      const m = pkg.manifest;

      const existing = await ops.existingDeployment(payload.packageId, ctx.tenantId);
      if (existing?.status === 'published' && existing.intuneAppId) {
        return { success: true, data: { packageId: payload.packageId, intuneAppId: existing.intuneAppId, changed: false, note: 'bereits veroeffentlicht' } };
      }

      await ops.recordDeployment(ctx.mspId, payload.packageId, ctx.tenantId, { status: 'publishing', jobId: ctx.jobId, error: null });
      try {
        if (m.installerType === 'store') {
          const result = await ops.publishWinGet(providerCtx, buildWinGetAppPayload(m));
          await ops.recordDeployment(ctx.mspId, payload.packageId, ctx.tenantId, { status: 'published', intuneAppId: result.appId, contentVersion: null, publishedAt: new Date(), error: null });
          return { success: true, data: { packageId: payload.packageId, intuneAppId: result.appId, changed: true, type: 'winGetApp' } };
        }
        if (pkg.status !== 'ready' || !pkg.artifact || !artifact) {
          throw new Error('Paket hat kein fertiges .intunewin; erst bauen oder hochladen');
        }
        const opened = openIntuneWin(artifact);
        const graphPayload = buildWin32LobAppPayload(m, pkg.artifact, detectionPrefix);
        const steps: string[] = [];
        const result = await ops.publishWin32(providerCtx, graphPayload, opened, (step) => steps.push(step));
        await ops.recordDeployment(ctx.mspId, payload.packageId, ctx.tenantId, { status: 'published', intuneAppId: result.appId, contentVersion: result.contentVersion, publishedAt: new Date(), error: null });
        return { success: true, data: { packageId: payload.packageId, intuneAppId: result.appId, contentVersion: result.contentVersion, changed: true, type: 'win32LobApp', sizeEncrypted: opened.payload.length, steps } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ops.recordDeployment(ctx.mspId, payload.packageId, ctx.tenantId, { status: 'failed', error: message });
        return failure('PUBLISH_FAILED', message);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as PublishPayload;
      const loaded = await ops.loadPackage(ctx.mspId, payload.packageId);
      if (!loaded) throw new Error('Paket nicht gefunden');
      const { pkg, detectionPrefix } = loaded;
      const m = pkg.manifest;
      const existing = await ops.existingDeployment(payload.packageId, ctx.tenantId);
      const warnings: string[] = [];
      if (existing?.status === 'published') warnings.push('In diesem Tenant bereits veroeffentlicht; der Job aendert nichts.');
      if (m.installerType !== 'store' && (pkg.status !== 'ready' || !pkg.artifact)) warnings.push('Kein fertiges .intunewin vorhanden; der Job wird fehlschlagen. Erst bauen oder hochladen.');
      if (m.installerType === 'store') warnings.push('Intune laedt die Software aus dem Microsoft Store; die Version folgt dem Store. Nur fuer Store-Produkt-Ids, nicht fuer Community-Pakete.');
      if (m.installerType === 'winget' && m.sourceInstaller) warnings.push(`Installer stammt aus dem winget-Katalog (${m.sourceInstaller.packageIdentifier} ${m.sourceInstaller.version}); das Paket wird als normale Win32-App mit eigener Erkennung angelegt.`);
      warnings.push('Die App wird angelegt, aber niemandem zugewiesen. Zuweisung als eigener Schritt unter Apps.');
      return {
        changes: [
          {
            objectType: 'app',
            objectId: payload.packageId,
            objectDisplayName: `${packageDisplayName(m)} in ${payload.tenantName}`,
            action: 'create',
            before: existing ? { deployment: existing.status } : {},
            after: { ...describeManifest(m, detectionPrefix), artifact: pkg.artifact ? `${pkg.artifact.fileName} (${Math.round(pkg.artifact.sizeBytes / 1024 / 1024)} MB, SHA-256 ${pkg.artifact.sha256.slice(0, 12)})` : null },
          },
        ],
        warnings,
        estimatedDurationSeconds: m.installerType === 'store' ? 10 : Math.max(60, Math.round((pkg.artifact?.sizeBytes ?? 0) / (2 * 1024 * 1024))),
      };
    }
  );
}
