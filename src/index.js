const json = (data, init = {}) => new Response(JSON.stringify(data), {
  ...init,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    ...(init.headers || {}),
  },
});

const badRequest = (message, status = 400) => json({ error: message }, { status });

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function bootstrapData(db) {
  const [stationsRes, itemsRes, txRes] = await Promise.all([
    db.prepare('SELECT id, name, code FROM stations ORDER BY id').all(),
    db.prepare(`
      SELECT
        i.id,
        i.name,
        i.sku,
        i.barcode,
        i.qr_code,
        i.description,
        i.total_quantity,
        i.updated_at,
        COALESCE(json_group_array(
          CASE WHEN s.id IS NOT NULL THEN json_object(
            'stationId', s.id,
            'stationName', s.name,
            'quantity', COALESCE(si.quantity, 0)
          ) END
        ), '[]') AS station_breakdown
      FROM items i
      LEFT JOIN station_inventory si ON si.item_id = i.id
      LEFT JOIN stations s ON s.id = si.station_id
      GROUP BY i.id
      ORDER BY i.name COLLATE NOCASE ASC
    `).all(),
    db.prepare(`
      SELECT
        t.id,
        t.quantity_delta,
        t.action_type,
        t.source,
        t.note,
        t.created_at,
        i.name AS item_name,
        i.sku AS item_sku,
        s.name AS station_name
      FROM stock_transactions t
      JOIN items i ON i.id = t.item_id
      LEFT JOIN stations s ON s.id = t.station_id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 12
    `).all(),
  ]);

  return {
    stations: stationsRes.results,
    items: itemsRes.results.map((item) => ({
      ...item,
      station_breakdown: JSON.parse(item.station_breakdown).filter(Boolean),
    })),
    recentTransactions: txRes.results,
  };
}

async function resolveItem(db, { itemId, code }) {
  if (itemId) {
    const found = await db.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
    return found || null;
  }
  if (!code) return null;
  return db.prepare('SELECT * FROM items WHERE barcode = ? OR qr_code = ? OR sku = ?').bind(code, code, code).first();
}

async function ensureStationRow(db, stationId, itemId) {
  await db.prepare(`
    INSERT INTO station_inventory (station_id, item_id, quantity)
    VALUES (?, ?, 0)
    ON CONFLICT(station_id, item_id) DO NOTHING
  `).bind(stationId, itemId).run();
}

async function addItem(request, env) {
  const body = await parseBody(request);
  if (!body?.name || !body?.sku) return badRequest('name and sku are required');
  const qty = Number.parseInt(body.totalQuantity ?? 0, 10);
  if (Number.isNaN(qty) || qty < 0) return badRequest('totalQuantity must be a positive number or 0');

  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO items (name, sku, barcode, qr_code, description, total_quantity, updated_at)
      VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, CURRENT_TIMESTAMP)
      RETURNING *
    `).bind(body.name.trim(), body.sku.trim(), body.barcode ?? '', body.qrCode ?? '', body.description ?? '', qty).first();

    return json({ item: inserted }, { status: 201 });
  } catch (error) {
    return badRequest(error.message.includes('UNIQUE') ? 'Item SKU / barcode / QR code must be unique.' : error.message);
  }
}

async function adjustInventory(request, env) {
  const body = await parseBody(request);
  const qty = Number.parseInt(body?.quantity, 10);
  if (Number.isNaN(qty) || qty <= 0) return badRequest('quantity must be greater than 0');

  const item = await resolveItem(env.DB, { itemId: body.itemId, code: body.code?.trim() });
  if (!item) return badRequest('Item not found', 404);

  const stationId = body.stationId ? Number.parseInt(body.stationId, 10) : null;
  const mode = body.mode;
  if (!['restock', 'issue'].includes(mode)) return badRequest('mode must be restock or issue');
  if (mode === 'issue' && !stationId) return badRequest('stationId is required when issuing inventory');

  const delta = mode === 'restock' ? qty : -qty;

  if (item.total_quantity + delta < 0) {
    return badRequest(`Not enough inventory for ${item.name}.`, 409);
  }

  if (stationId) {
    await ensureStationRow(env.DB, stationId, item.id);
  }

  try {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE items
        SET total_quantity = total_quantity + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(delta, item.id),
      ...(stationId
        ? [env.DB.prepare(`
            UPDATE station_inventory
            SET quantity = quantity + ?
            WHERE station_id = ? AND item_id = ?
          `).bind(Math.abs(delta), stationId, item.id)]
        : []),
      env.DB.prepare(`
        INSERT INTO stock_transactions (item_id, station_id, quantity_delta, action_type, source, note)
        VALUES (?, ?, ?, ?, ?, NULLIF(?, ''))
      `).bind(
        item.id,
        stationId,
        delta,
        mode,
        body.source === 'scan' ? 'scan' : 'manual',
        body.note ?? ''
      ),
    ]);
  } catch (error) {
    return badRequest(error.message, 500);
  }

  return json({ ok: true });
}

async function lookupScan(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code')?.trim();
  if (!code) return badRequest('code query parameter is required');

  const item = await resolveItem(env.DB, { code });
  if (!item) return badRequest('No item matches that code.', 404);
  return json({ item });
}

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
