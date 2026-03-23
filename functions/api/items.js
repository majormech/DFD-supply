import { addItem } from '../../src/server.js';

export async function onRequestPost(context) {
  return addItem(context.request, context.env);
}
