const path = require('path');
const { loadEnvConfig } = require('@next/env');

// Next.js liest .env-Dateien nur aus dem App-Verzeichnis. Wir nutzen eine
// gemeinsame .env.local im Monorepo-Root fuer API und Web.
loadEnvConfig(path.resolve(__dirname, '../..'), process.env.NODE_ENV !== 'production');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@zerostress/types'],
};

module.exports = nextConfig;
