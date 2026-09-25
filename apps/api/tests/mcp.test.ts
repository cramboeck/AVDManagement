/**
 * MCP-Router: Protokollrahmen ohne Datenbank (initialize, tools/list, Fehlerpfade)
 */

import { describe, it, expect, beforeAll } from 'vitest';

process.env.DEV_AUTH_BYPASS = 'false';

describe('mcp router', () => {
  let app: import('hono').Hono;

  beforeAll(async () => {
    app = (await import('../src/routes/mcp.js')).mcpRouter;
  });

  it('requires authentication before anything else', async () => {
    const get = await app.request('/', { method: 'GET' });
    expect(get.status).toBe(401);
    const post = await app.request('/', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }), headers: { 'content-type': 'application/json' } });
    expect(post.status).toBe(401);
  });
});
