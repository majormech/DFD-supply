import { recordApiError } from '../src/server.js';

async function errorMessageFromResponse(response) {
  const data = await response.clone().json().catch(() => ({}));
  return data?.error || data?.message || response.statusText || 'Request failed';
}

export async function onRequest(context) {
  try {
    const response = await context.next();
    const url = new URL(context.request.url);
    if (url.pathname.startsWith('/api/') && !response.ok) {
      context.waitUntil(recordApiError(context.env, context.request, {
        source: 'pages-function',
        status: response.status,
        message: await errorMessageFromResponse(response),
      }));
    }
    return response;
  } catch (error) {
    context.waitUntil(recordApiError(context.env, context.request, {
      source: 'pages-function',
      status: 500,
      error,
    }));
    throw error;
  }
}
