/**
 * Job-Queue der API
 *
 * Handler-Registrierung und Worker-Start passieren genau einmal beim
 * API-Start, nicht erst beim ersten Aufruf einer Route.
 */

import { Redis } from 'ioredis';
import { JobQueue, registerIdentityJobs, registerAvdJobs } from '@zerostress/core';
import { DrizzleJobStore } from './job-store.js';
import { DrizzleAuditLogger } from './audit-logger.js';
import { getIdentityProvider, getAvdProvider } from './microsoft-clients.js';

let jobQueue: JobQueue | null = null;

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

    jobQueue = new JobQueue({ redis }, new DrizzleJobStore(), new DrizzleAuditLogger());
    jobQueue.startWorker();
  }
  return jobQueue;
}
