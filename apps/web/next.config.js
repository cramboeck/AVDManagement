const path = require('path');
const { loadEnvConfig } = require('@next/env');

// Next.js liest .env-Dateien nur aus dem App-Verzeichnis. Wir nutzen eine
// gemeinsame .env.local im Monorepo-Root fuer API und Web.
loadEnvConfig(path.resolve(__dirname, '../..'), process.env.NODE_ENV !== 'production');

const isProduction = process.env.NODE_ENV === 'production';

function apiOrigin() {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').origin;
  } catch {
    return 'http://localhost:3001';
  }
}

// Content-Security-Policy: nur eigene Skripte und Styles, Verbindungen nur zur API.
// Next braucht im Dev-Modus unsafe-eval (Hot Reload) und fuer Inline-Bootstrap unsafe-inline.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin()} https://login.microsoftonline.com${isProduction ? '' : ' ws: wss:'}`,
  "frame-ancestors 'none'",
  "form-action 'self' https://login.microsoftonline.com",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@zerostress/types'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
