import {
  addItem,
  adjustInventory,
  badRequest,
  bootstrapData,
  createStationRequest,
  completeStationRequests,
  cancelStationRequest,
  issueStationRequestItems,
  deleteItem,
  getErrorLogs,
  getAdminSettings,
  getAnalytics,
  json,
  lookupScan,
  recordApiError,
  updateItem,
  modifyStationRequest,
  updateAdminSettings,
} from './server.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const route = async () => {
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
        return json(await bootstrapData(env.DB));
      }

      if (url.pathname === '/api/analytics' && request.method === 'GET') {
        return getAnalytics(request, env);
      }

      if (url.pathname === '/api/items' && request.method === 'POST') {
        return addItem(request, env);
      }

      if (url.pathname === '/api/items' && request.method === 'PUT') {
        return updateItem(request, env);
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
 
      if (url.pathname === '/api/requests/issue-items' && request.method === 'POST') {
        return issueStationRequestItems(request, env);
      }
    
      if (url.pathname === '/api/requests/cancel' && request.method === 'POST') {
        return cancelStationRequest(request, env);
      }

      if (url.pathname === '/api/requests/modify' && request.method === 'POST') {
        return modifyStationRequest(request, env);
      }
    
      if (url.pathname === '/api/admin/settings' && request.method === 'GET') {
        return getAdminSettings(request, env);
      }

      if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
        return updateAdminSettings(request, env);
      }

      if (url.pathname === '/api/admin/errors' && request.method === 'GET') {
        return getErrorLogs(request, env);
      }

      if (url.pathname.startsWith('/api/')) {
        return badRequest('Route not found', 404);
      }

      return env.ASSETS.fetch(request);
    };

    try {
      const response = await route();
      if (url.pathname.startsWith('/api/') && !response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        ctx?.waitUntil(recordApiError(env, request, {
          source: 'worker',
          status: response.status,
          message: data?.error || data?.message || response.statusText || 'Request failed',
        }));
      }
      return response;
    } catch (error) {
      ctx?.waitUntil(recordApiError(env, request, {
        source: 'worker',
        status: 500,
        error,
      }));
      throw error;
    }
  },
};
