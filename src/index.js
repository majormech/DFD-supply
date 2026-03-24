import {
  addItem,
  adjustInventory,
  badRequest,
  bootstrapData,
  createStationRequest,
  completeStationRequests,
  deleteItem,
  getAdminSettings,
  getAnalytics,
  json,
  lookupScan,
  updateAdminSettings,
} from './server.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      return json(await bootstrapData(env.DB));
    }

    if (url.pathname === '/api/analytics' && request.method === 'GET') {
      return getAnalytics(request, env);
    }

    if (url.pathname === '/api/items' && request.method === 'POST') {
      return addItem(request, env);
    }

     if (url.pathname === '/api/items/delete' && request.method === 'POST') {
      return deleteItem(request, env);
    }
    
    if (url.pathname === '/api/inventory/adjust' && request.method === 'POST') {
      return adjustInventory(request, env);
    }

    if (url.pathname === '/api/scan' && request.method === 'GET') {
      return lookupScan(request, env);
    }

    if (url.pathname === '/api/requests' && request.method === 'POST') {
      return createStationRequest(request, env);
    }

    if (url.pathname === '/api/requests/complete' && request.method === 'POST') {
      return completeStationRequests(request, env);
    }
    
    if (url.pathname === '/api/admin/settings' && request.method === 'GET') {
      return getAdminSettings(request, env);
    }

    if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
      return updateAdminSettings(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return badRequest('Route not found', 404);
    }

    return env.ASSETS.fetch(request);
  },
};
