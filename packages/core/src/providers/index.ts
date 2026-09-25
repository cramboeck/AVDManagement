/**
 * Provider-Abstraktion
 *
 * Jede Microsoft-API liegt hinter einem ResourceProvider-Interface.
 * Die UI kennt Graph niemals direkt.
 */

export * from './resource-provider.js';
export * from './graph-client.js';
export * from './arm-client.js';
export * from './identity-provider.js';
export * from './avd-provider.js';
export * from './device-provider.js';
