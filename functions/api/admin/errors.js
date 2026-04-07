import { getErrorLogs } from '../../../src/server.js';

export async function onRequestGet(context) {
  return getErrorLogs(context.request, context.env);
}
