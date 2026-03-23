import { addItem, adjustInventory, badRequest, bootstrapData, json, lookupScan } from './server.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      return json(await bootstrapData(env.DB));
    }

    if (url.pathname === '/api/items' && request.method === 'POST') {
      return addItem(request, env);
    }

    if (url.pathname === '/api/inventory/adjust' && request.method === 'POST') {
      return adjustInventory(request, env);
    }

    if (url.pathname === '/api/scan' && request.method === 'GET') {
      return lookupScan(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return badRequest('Route not found', 404);
    }

    return env.ASSETS.fetch(request);
  },
};
