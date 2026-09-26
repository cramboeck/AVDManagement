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
export * from './security-provider.js';
export * from './remediation-provider.js';
export * from './group-provider.js';
export * from './mail-provider.js';
export * from './mailbox-provider.js';
export * from './hunting-provider.js';
export * from './vm-provider.js';
export * from './policy-provider.js';
export * from './app-provider.js';
export * from './remote-support-provider.js';
export * from './sharepoint-provider.js';
