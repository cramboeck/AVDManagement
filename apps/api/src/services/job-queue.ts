/**
 * Job-Queue der API
 *
 * Handler-Registrierung und Worker-Start passieren genau einmal beim
 * API-Start, nicht erst beim ersten Aufruf einer Route.
 */

import { Redis } from 'ioredis';
import { JobQueue, registerIdentityJobs, registerAvdJobs, registerDeviceJobs, registerScriptJobs, registerAvdScriptJobs, registerAppJobs, registerTempAdminJobs, registerGroupJobs, registerAppPublishJobs, registerMailboxJobs, registerWingetJobs, registerExchangeJobs, registerVmJobs } from '@zerostress/core';
import { mailboxOperations } from './mailboxes.js';
import { exchangeOperations } from './exchange.js';
import { DrizzleJobStore } from './job-store.js';
import { DrizzleAuditLogger } from './audit-logger.js';
import { getIdentityProvider, getAvdProvider, getDeviceProvider, getRemediationProvider, getAppProvider, getGroupProvider, getVmProvider } from './microsoft-clients.js';
import { estimateVmCost } from './azure-prices.js';
import { getResultSealer } from './result-crypto.js';
import { publishOperations } from './publishing.js';

// Freigaben verfallen nach der Preview-Gueltigkeit (5 Min) plus Puffer
const PENDING_APPROVAL_TTL_MS = 10 * 60 * 1000;
const ACTIVE_JOB_TTL_MS = 2 * 60 * 60 * 1000;
// Versiegelte, personenbezogene Ergebnisse werden nach 30 Tagen geloescht
const SEALED_RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

let jobQueue: JobQueue | null = null;
let jobStore: DrizzleJobStore | null = null;

export function getJobQueue(): JobQueue {
  if (!jobQueue) {
    // maxRetriesPerRequest=null verlangt BullMQ fuer blockierende Worker-Verbindungen
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    redis.on('error', (error: Error) => {
      console.error('Redis connection error:', error.message);
    });

    registerIdentityJobs(getIdentityProvider());
    registerAvdJobs(getAvdProvider());
    registerDeviceJobs(getDeviceProvider());
    const sealer = getResultSealer();
    registerScriptJobs(getRemediationProvider(), { sealer });
    registerAvdScriptJobs(getAvdProvider(), { sealer });
    registerAppJobs(getAppProvider());
    registerTempAdminJobs(getRemediationProvider());
    registerWingetJobs(getRemediationProvider());
    registerGroupJobs(getGroupProvider());
    registerAppPublishJobs(publishOperations);
    registerMailboxJobs(mailboxOperations);
    registerExchangeJobs(exchangeOperations);
    const vmProvider = getVmProvider();
    registerVmJobs({
      getVm: (ctx, id) => vmProvider.getVm(ctx, id),
      startVm: (ctx, id) => vmProvider.startVm(ctx, id),
      stopVm: (ctx, id) => vmProvider.stopVm(ctx, id),
      restartVm: (ctx, id) => vmProvider.restartVm(ctx, id),
      resizeVm: (ctx, id, size) => vmProvider.resizeVm(ctx, id, size),
      ensureResourceGroup: (ctx, sub, name, location, tags) => vmProvider.ensureResourceGroup(ctx, sub, name, location, tags),
      validateDeployment: (ctx, sub, rg, name, template, parameters) => vmProvider.validateDeployment(ctx, sub, rg, name, template, parameters),
      deploy: (ctx, sub, rg, name, template, parameters) => vmProvider.deploy(ctx, sub, rg, name, template, parameters),
      estimateCost: (size, location, os) => estimateVmCost(size, location, os),
      seal: async (payload) => {
        if (!sealer) throw new Error('RESULT_ENCRYPTION_KEY ist nicht gesetzt; ohne Schluessel kann das Passwort nicht versiegelt abgelegt werden');
        return sealer.seal(payload);
      },
    });

    jobStore = new DrizzleJobStore();
    jobQueue = new JobQueue({ redis }, jobStore, new DrizzleAuditLogger());
    jobQueue.startWorker();

    const sweep = setInterval(() => {
      const store = jobStore;
      if (!store) return;
      Promise.all([
        store.cancelExpiredPending(new Date(Date.now() - PENDING_APPROVAL_TTL_MS)),
        store.failStaleActive(new Date(Date.now() - ACTIVE_JOB_TTL_MS)),
        store.purgeSealedResults(new Date(Date.now() - SEALED_RESULT_RETENTION_MS)),
      ])
        .then(([cancelled, failed, purged]) => {
          if (cancelled > 0) console.log(`Cancelled ${cancelled} expired pending job(s)`);
          if (failed > 0) console.log(`Marked ${failed} stale job(s) as failed`);
          if (purged > 0) console.log(`Purged ${purged} sealed result(s) past retention`);
        })
        .catch((error: Error) => console.error('Job sweep failed:', error.message));
    }, SWEEP_INTERVAL_MS);
    sweep.unref();
  }
  return jobQueue;
}

export function getJobHealth(): { redis: string; worker: boolean } {
  if (!jobQueue) {
    return { redis: 'not-started', worker: false };
  }
  const health = jobQueue.getHealth();
  return { redis: health.redisStatus, worker: health.workerRunning };
}
