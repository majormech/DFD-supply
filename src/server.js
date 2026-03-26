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

async function getSettings(db) {
  const row = await db.prepare('SELECT supply_officer_email, admin_emails FROM admin_settings WHERE id = 1').first();
  return row || { supply_officer_email: '', admin_emails: '' };
}

function parseBarcodes(body) {
  const candidateValues = [body?.barcodes ?? '', body?.barcode ?? ''];
  const splitValues = candidateValues
    .flatMap((value) => String(value || '').split(/[\n,]/g))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(splitValues)];
}

function generateSku(body) {
  const provided = String(body?.sku || '').trim();
  if (provided) return provided;
  const qrPart = String(body?.qrCode || '').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);
  const namePart = String(body?.name || '').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  const stamp = Date.now().toString().slice(-6);
  return `${(namePart || 'ITEM')}-${(qrPart || 'QR')}-${stamp}`;
}

function buildQrImageUrl(qrCode) {
  const value = String(qrCode || '').trim();
  if (!value) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(value)}`;
}

export async function bootstrapData(db) {
  const [stationsRes, itemsRes, txRes, stationRequestsRes, settings] = await Promise.all([
    db.prepare('SELECT id, name, code FROM stations ORDER BY id').all(),
    db.prepare(`
      SELECT
        i.id,
        i.name,
        i.sku,
        i.barcode,
        i.qr_code,
        i.description,
        i.qr_image_url,
        i.unit_cost,
        i.low_stock_level,
        i.total_quantity,
        i.updated_at,
        COALESCE((
          SELECT json_group_array(json_object(
            'stationId', s.id,
            'stationName', s.name,
            'quantity', COALESCE(si.quantity, 0)
            ))
          FROM station_inventory si
          JOIN stations s ON s.id = si.station_id
          WHERE si.item_id = i.id
        ), '[]') AS station_breakdown,
        COALESCE((
          SELECT json_group_array(ib.barcode)
          FROM item_barcodes ib
          WHERE ib.item_id = i.id
          ORDER BY ib.id
        ), '[]') AS barcodes_json
      FROM items i
      WHERE i.deleted_at IS NULL
      ORDER BY i.name COLLATE NOCASE ASC
    `).all(),
    db.prepare(`
      SELECT
        t.id,
        t.quantity_delta,
        t.action_type,
        t.source,
        t.note,
        t.performed_by,
        t.created_at,
        i.name AS item_name,
        i.sku AS item_sku,
        s.name AS station_name
      FROM stock_transactions t
      JOIN items i ON i.id = t.item_id
      LEFT JOIN stations s ON s.id = t.station_id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 25
    `).all(),
     db.prepare(`
      SELECT
        sr.id,
        sr.station_id,
        sr.requester_name,
        sr.requested_items_json,
        sr.other_items,
        sr.modified_by,
        sr.modification_reason,
        sr.modified_at,
        sr.canceled_by,
        sr.cancel_reason,
        sr.canceled_at,
        sr.completed_by,
        sr.completed_at,
        sr.created_at,
        s.name AS station_name,
        s.code AS station_code
      FROM station_requests sr
      JOIN stations s ON s.id = sr.station_id
      ORDER BY sr.created_at DESC, sr.id DESC
    `).all(),
    getSettings(db),
  ]);

   const stationRequests = stationRequestsRes.results.map((request) => ({
    ...request,
    requested_items: JSON.parse(request.requested_items_json || '[]'),
  }));

  return {
    stations: stationsRes.results,
    items: itemsRes.results.map((item) => ({
      ...item,
      station_breakdown: JSON.parse(item.station_breakdown).filter(Boolean),
         barcodes: JSON.parse(item.barcodes_json || '[]').filter(Boolean),
    })),
    recentTransactions: txRes.results,
    stationRequests,
    settings,
  };
}

async function resolveItem(db, { itemId, code }) {
  if (itemId) {
    const found = await db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').bind(itemId).first();
    return found || null;
  }
  if (!code) return null;
  return db.prepare(`
    SELECT *
    FROM items
  WHERE (barcode = ? OR qr_code = ? OR sku = ?
      OR id IN (SELECT item_id FROM item_barcodes WHERE barcode = ?))
      AND deleted_at IS NULL
    LIMIT 1
  `).bind(code, code, code, code).first();
}

async function ensureStationRow(db, stationId, itemId) {
  await db.prepare(`
    INSERT INTO station_inventory (station_id, item_id, quantity)
    VALUES (?, ?, 0)
    ON CONFLICT(station_id, item_id) DO NOTHING
  `).bind(stationId, itemId).run();
}

export async function addItem(request, env) {
  const body = await parseBody(request);
  if (!body?.name || !body?.qrCode) return badRequest('name and qrCode are required');
  const barcodes = parseBarcodes(body);
  const skipBarcodeCapture = String(body?.skipBarcodeCapture || 'true') === 'true';
  if (!skipBarcodeCapture && !barcodes.length) {
    return badRequest('Provide at least one barcode or enable skip barcode scan.');
  }
  const primaryBarcode = barcodes[0] || '';
  const qty = Number.parseInt(body.totalQuantity ?? 0, 10);
  const unitCost = body.unitCost === '' || body.unitCost == null ? 0 : Number.parseFloat(body.unitCost);
  const lowStockLevel = Number.parseInt(body.lowStockLevel ?? 0, 10);
  const performedBy = String(body.performedBy || '').trim();
  const performedAtRaw = String(body.performedAt || '').trim();
  const performedAt = performedAtRaw ? performedAtRaw.replace('T', ' ') : null;
  const sku = generateSku(body);
  const qrImageUrl = buildQrImageUrl(body.qrCode);
  if (Number.isNaN(qty) || qty < 0) return badRequest('totalQuantity must be a positive number or 0');
  if (Number.isNaN(unitCost) || unitCost < 0) return badRequest('unitCost must be a positive number or 0');
  if (Number.isNaN(lowStockLevel) || lowStockLevel < 0) return badRequest('lowStockLevel must be a positive number or 0');
  if (!performedBy) return badRequest('performedBy is required');
  
  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO items (name, sku, barcode, qr_code, qr_image_url, description, unit_cost, low_stock_level, total_quantity, updated_at)
      VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, CURRENT_TIMESTAMP)
      RETURNING *
    `).bind(body.name.trim(), sku, primaryBarcode, body.qrCode ?? '', qrImageUrl ?? '', body.description ?? '', unitCost, lowStockLevel, qty).first();

    const operations = [];
    
    if (barcodes.length) {
     operations.push(...barcodes.map((barcode) => env.DB.prepare(`
        INSERT INTO item_barcodes (item_id, barcode)
        VALUES (?, ?)
      `).bind(inserted.id, barcode)));
    }

    operations.push(env.DB.prepare(`
      INSERT INTO stock_transactions (item_id, station_id, quantity_delta, action_type, source, note, performed_by, created_at)
      VALUES (?, NULL, ?, 'restock', 'manual', NULLIF(?, ''), ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP))
    `).bind(inserted.id, qty, body.note ?? '', performedBy, performedAt || ''));

    if (operations.length) {
      await env.DB.batch(operations);
    }

    return json({ item: { ...inserted, barcodes } }, { status: 201 });
  } catch (error) {
    return badRequest(error.message.includes('UNIQUE') ? 'Item SKU, each barcode, and QR code must be unique.' : error.message);
  }
}

export async function updateItem(request, env) {
  const body = await parseBody(request);
  const itemId = Number.parseInt(body?.itemId, 10);
  if (!Number.isInteger(itemId) || itemId <= 0) return badRequest('itemId is required');

  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').bind(itemId).first();
  if (!item) return badRequest('Item not found', 404);

  const name = String(body?.name || '').trim();
  const sku = String(body?.sku || '').trim();
  const qrCode = String(body?.qrCode || '').trim();
  const qrImageUrl = buildQrImageUrl(qrCode);
  const description = String(body?.description || '').trim();
  const performedBy = String(body?.performedBy || 'Main Page Edit').trim() || 'Main Page Edit';
  const barcodes = parseBarcodes(body);
  const primaryBarcode = barcodes[0] || '';

  const totalQuantity = Number.parseInt(body?.totalQuantity, 10);
  const lowStockLevel = Number.parseInt(body?.lowStockLevel, 10);
  const unitCost = Number.parseFloat(body?.unitCost);

  if (!name) return badRequest('name is required');
  if (!sku) return badRequest('sku is required');
  if (!qrCode) return badRequest('qrCode is required');
  if (Number.isNaN(totalQuantity) || totalQuantity < 0) return badRequest('totalQuantity must be a positive number or 0');
  if (Number.isNaN(lowStockLevel) || lowStockLevel < 0) return badRequest('lowStockLevel must be a positive number or 0');
  if (Number.isNaN(unitCost) || unitCost < 0) return badRequest('unitCost must be a positive number or 0');

  const quantityDelta = totalQuantity - Number.parseInt(item.total_quantity || 0, 10);

  try {
    const operations = [
      env.DB.prepare(`
        UPDATE items
        SET name = ?,
            sku = ?,
            qr_code = ?,
            barcode = NULLIF(?, ''),
            qr_image_url = NULLIF(?, ''),
            description = NULLIF(?, ''),
            unit_cost = ?,
            low_stock_level = ?,
            total_quantity = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
     `).bind(name, sku, qrCode, qrImageUrl ?? '', primaryBarcode, description, unitCost, lowStockLevel, totalQuantity, itemId),
      env.DB.prepare('DELETE FROM item_barcodes WHERE item_id = ?').bind(itemId),
      ...barcodes.map((barcode) => env.DB.prepare(`
        INSERT INTO item_barcodes (item_id, barcode)
        VALUES (?, ?)
      `).bind(itemId, barcode)),
    ];

    if (quantityDelta !== 0) {
      operations.push(env.DB.prepare(`
        INSERT INTO stock_transactions (item_id, station_id, quantity_delta, action_type, source, note, performed_by, created_at)
        VALUES (?, NULL, ?, 'adjustment', 'manual', ?, ?, CURRENT_TIMESTAMP)
      `).bind(itemId, quantityDelta, 'Quantity changed from item modify popup.', performedBy));
    }

    await env.DB.batch(operations);
  } catch (error) {
    return badRequest(error.message.includes('UNIQUE') ? 'Item SKU, each barcode, and QR code must be unique.' : error.message);
  }

  const updatedItem = await env.DB.prepare(`
    SELECT
      i.*,
      COALESCE((
        SELECT json_group_array(ib.barcode)
        FROM item_barcodes ib
        WHERE ib.item_id = i.id
        ORDER BY ib.id
      ), '[]') AS barcodes_json
    FROM items i
    WHERE i.id = ?
  `).bind(itemId).first();

  return json({
    ok: true,
    item: {
      ...updatedItem,
      barcodes: JSON.parse(updatedItem?.barcodes_json || '[]').filter(Boolean),
    },
  });
}

export async function adjustInventory(request, env) {
  const body = await parseBody(request);
  const qty = Number.parseInt(body?.quantity, 10);
  if (Number.isNaN(qty) || qty <= 0) return badRequest('quantity must be greater than 0');

  const item = await resolveItem(env.DB, { itemId: body.itemId, code: body.code?.trim() });
  if (!item) return badRequest('Item not found', 404);

  const stationId = body.stationId ? Number.parseInt(body.stationId, 10) : null;
  const mode = body.mode;
  const performedBy = (body.performedBy || '').trim();
  if (!['restock', 'issue'].includes(mode)) return badRequest('mode must be restock or issue');
  if (mode === 'issue' && !stationId) return badRequest('stationId is required when issuing inventory');
  if (!performedBy) return badRequest('performedBy is required');

   const unitCost = body.unitCost === '' || body.unitCost == null ? null : Number.parseFloat(body.unitCost);
  if (unitCost !== null && (Number.isNaN(unitCost) || unitCost < 0)) {
    return badRequest('unitCost must be a positive number or 0');
  }

  const performedAtRaw = String(body.performedAt || '').trim();
  const performedAt = performedAtRaw ? performedAtRaw.replace('T', ' ') : null;

  const newBarcode = String(body.newBarcode || '').trim();
  const skipBarcodeCapture = String(body.skipBarcodeCapture || 'true') === 'true';

  const delta = mode === 'restock' ? qty : -qty;

  if (item.total_quantity + delta < 0) {
    return badRequest(`Not enough inventory for ${item.name}.`, 409);
  }

  if (stationId) {
    await ensureStationRow(env.DB, stationId, item.id);
  }

  try {
    const operations = [
      env.DB.prepare(`
        UPDATE items
        SET total_quantity = total_quantity + ?,
            unit_cost = COALESCE(?, unit_cost),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
     `).bind(delta, unitCost, item.id),
      ...(stationId
        ? [env.DB.prepare(`
            UPDATE station_inventory
            SET quantity = quantity + ?
            WHERE station_id = ? AND item_id = ?
          `).bind(Math.abs(delta), stationId, item.id)]
        : []),
      env.DB.prepare(`
        INSERT INTO stock_transactions (item_id, station_id, quantity_delta, action_type, source, note, performed_by, created_at)
        VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP))
      `).bind(
        item.id,
        stationId,
        delta,
        mode,
        body.source === 'scan' ? 'scan' : 'manual',
        body.note ?? '',
        performedBy,
        performedAt || ''
      ),
     ];

    if (mode === 'restock' && !skipBarcodeCapture && newBarcode) {
      operations.push(env.DB.prepare(`
        INSERT INTO item_barcodes (item_id, barcode)
        VALUES (?, ?)
        ON CONFLICT(barcode) DO NOTHING
      `).bind(item.id, newBarcode));
      operations.push(env.DB.prepare(`
        UPDATE items
        SET barcode = COALESCE(barcode, ?)
        WHERE id = ?
      `).bind(newBarcode, item.id));
    }

    await env.DB.batch(operations);
  } catch (error) {
    return badRequest(error.message.includes('UNIQUE') ? 'Barcode already belongs to another item.' : error.message, 500);
  }

  const updatedItem = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(item.id).first();

  return json({
    ok: true,
    item: updatedItem,
    previousTotalQuantity: item.total_quantity,
    newTotalQuantity: updatedItem?.total_quantity,
  });
}

export async function lookupScan(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code')?.trim();
  if (!code) return badRequest('code query parameter is required');

  const item = await resolveItem(env.DB, { code });
  if (!item) return badRequest('No item matches that code.', 404);
  return json({ item });
}

export async function getAnalytics(request, env) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') || '30', 10), 7), 365);
const stationId = Number.parseInt(url.searchParams.get('stationId') || '', 10);
  const itemId = Number.parseInt(url.searchParams.get('itemId') || '', 10);
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const startDate = (url.searchParams.get('startDate') || '').trim();
  const endDate = (url.searchParams.get('endDate') || '').trim();
  const hasDateRange = Boolean(startDate || endDate);
  const lookbackDays = `-${days} days`;

  const [byItem, byStation, trend, transactions] = await Promise.all([
    env.DB.prepare(`
      SELECT i.name, i.sku,
        SUM(CASE WHEN t.quantity_delta < 0 THEN ABS(t.quantity_delta) ELSE 0 END) AS used_qty,
        ROUND(SUM(CASE WHEN t.quantity_delta < 0 THEN ABS(t.quantity_delta) * i.unit_cost ELSE 0 END), 2) AS used_cost
       FROM stock_transactions t
      JOIN items i ON i.id = t.item_id
      LEFT JOIN stations s ON s.id = t.station_id
      WHERE t.quantity_delta < 0
        AND (
          (? = 0 AND date(t.created_at) >= date('now', ?))
          OR (? = 1 AND (? = '' OR date(t.created_at) >= date(?)) AND (? = '' OR date(t.created_at) <= date(?)))
        )
        AND (? = 0 OR t.station_id = ?)
        AND (? = 0 OR i.id = ?)
        AND (? = '' OR lower(i.name) LIKE ? OR lower(i.sku) LIKE ? OR lower(COALESCE(s.name, '')) LIKE ?)
      GROUP BY i.id
      ORDER BY used_qty DESC, i.name COLLATE NOCASE ASC
    `).bind(
      hasDateRange ? 1 : 0,
      lookbackDays,
      hasDateRange ? 1 : 0,
      startDate,
      startDate,
      endDate,
      endDate,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      search,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    ).all(),
    env.DB.prepare(`
      SELECT COALESCE(s.name, 'Unassigned') AS station_name,
        SUM(CASE WHEN t.quantity_delta < 0 THEN ABS(t.quantity_delta) ELSE 0 END) AS used_qty,
        ROUND(SUM(CASE WHEN t.quantity_delta < 0 THEN ABS(t.quantity_delta) * i.unit_cost ELSE 0 END), 2) AS used_cost
      FROM stock_transactions t
      JOIN items i ON i.id = t.item_id
      LEFT JOIN stations s ON s.id = t.station_id
      WHERE t.quantity_delta < 0
        AND (
          (? = 0 AND date(t.created_at) >= date('now', ?))
          OR (? = 1 AND (? = '' OR date(t.created_at) >= date(?)) AND (? = '' OR date(t.created_at) <= date(?)))
        )
        AND (? = 0 OR t.station_id = ?)
        AND (? = 0 OR i.id = ?)
        AND (? = '' OR lower(i.name) LIKE ? OR lower(i.sku) LIKE ? OR lower(COALESCE(s.name, '')) LIKE ?)
      GROUP BY s.id
      ORDER BY used_cost DESC
    `).bind(
      hasDateRange ? 1 : 0,
      lookbackDays,
      hasDateRange ? 1 : 0,
      startDate,
      startDate,
      endDate,
      endDate,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      search,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    ).all(),
    env.DB.prepare(`
      SELECT date(t.created_at) AS day,
        SUM(CASE WHEN t.quantity_delta < 0 THEN ABS(t.quantity_delta) ELSE 0 END) AS used_qty,
        ROUND(SUM(CASE WHEN t.quantity_delta < 0 THEN ABS(t.quantity_delta) * i.unit_cost ELSE 0 END), 2) AS used_cost
      FROM stock_transactions t
      JOIN items i ON i.id = t.item_id
       LEFT JOIN stations s ON s.id = t.station_id
      WHERE t.quantity_delta < 0
        AND (
          (? = 0 AND date(t.created_at) >= date('now', ?))
          OR (? = 1 AND (? = '' OR date(t.created_at) >= date(?)) AND (? = '' OR date(t.created_at) <= date(?)))
        )
        AND (? = 0 OR t.station_id = ?)
        AND (? = 0 OR i.id = ?)
        AND (? = '' OR lower(i.name) LIKE ? OR lower(i.sku) LIKE ? OR lower(COALESCE(s.name, '')) LIKE ?)
      GROUP BY date(t.created_at)
      ORDER BY day ASC
    `).bind(
      hasDateRange ? 1 : 0,
      lookbackDays,
      hasDateRange ? 1 : 0,
      startDate,
      startDate,
      endDate,
      endDate,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      search,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    ).all(),
    env.DB.prepare(`
      SELECT
        t.created_at,
        COALESCE(s.name, 'Unassigned') AS station_name,
        i.name AS item_name,
        i.sku AS item_sku,
        ABS(t.quantity_delta) AS used_qty,
        ROUND(i.unit_cost, 2) AS unit_cost,
        ROUND(ABS(t.quantity_delta) * i.unit_cost, 2) AS used_cost,
        t.performed_by,
        t.source
      FROM stock_transactions t
      JOIN items i ON i.id = t.item_id
      LEFT JOIN stations s ON s.id = t.station_id
      WHERE t.quantity_delta < 0
        AND (
          (? = 0 AND date(t.created_at) >= date('now', ?))
          OR (? = 1 AND (? = '' OR date(t.created_at) >= date(?)) AND (? = '' OR date(t.created_at) <= date(?)))
        )
        AND (? = 0 OR t.station_id = ?)
        AND (? = 0 OR i.id = ?)
        AND (? = '' OR lower(i.name) LIKE ? OR lower(i.sku) LIKE ? OR lower(COALESCE(s.name, '')) LIKE ?)
      ORDER BY t.created_at DESC, t.id DESC
    `).bind(
      hasDateRange ? 1 : 0,
      lookbackDays,
      hasDateRange ? 1 : 0,
      startDate,
      startDate,
      endDate,
      endDate,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(stationId) && stationId > 0 ? stationId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
      search,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    ).all(),
  ]);

  return json({
    byItem: byItem.results,
    byStation: byStation.results,
    trend: trend.results,
    transactions: transactions.results,
    days,
    filters: {
      stationId: Number.isInteger(stationId) && stationId > 0 ? stationId : null,
      itemId: Number.isInteger(itemId) && itemId > 0 ? itemId : null,
      search,
      startDate: startDate || null,
      endDate: endDate || null,
      mode: hasDateRange ? 'date-range' : 'days',
    },
  });
}

function isAuthorizedAdmin(request, env) {
  const configuredKey = env.ADMIN_KEY;
  if (!configuredKey) return true;
  return request.headers.get('x-admin-key') === configuredKey;
}

export async function getAdminSettings(request, env) {
  if (!isAuthorizedAdmin(request, env)) return badRequest('Unauthorized', 401);
  return json(await getSettings(env.DB));
}

export async function updateAdminSettings(request, env) {
  if (!isAuthorizedAdmin(request, env)) return badRequest('Unauthorized', 401);
  const body = await parseBody(request);
  const supplyOfficerEmail = (body?.supplyOfficerEmail || '').trim();
  const adminEmails = (body?.adminEmails || '').trim();

  await env.DB.prepare(`
    INSERT INTO admin_settings (id, supply_officer_email, admin_emails, updated_at)
    VALUES (1, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      supply_officer_email = excluded.supply_officer_email,
      admin_emails = excluded.admin_emails,
      updated_at = CURRENT_TIMESTAMP
  `).bind(supplyOfficerEmail, adminEmails).run();

  return json({ ok: true });
}

async function sendRequestEmail(env, to, subject, text) {
  if (!to || !env.RESEND_API_KEY || !env.SUPPLY_FROM_EMAIL) return { sent: false };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.SUPPLY_FROM_EMAIL,
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Email provider rejected request: ${message}`);
  }

  return { sent: true };
}

export async function createStationRequest(request, env) {
  const body = await parseBody(request);
  const stationCode = (body?.stationCode || '').trim();
  const requesterName = (body?.requesterName || '').trim();
  const otherItems = (body?.otherItems || '').trim();
  const requestedItems = Array.isArray(body?.items)
    ? body.items
        .map((entry) => ({ name: (entry.name || '').trim(), quantity: Number.parseInt(entry.quantity || 0, 10) }))
        .filter((entry) => entry.name && entry.quantity > 0)
    : [];

  if (!stationCode) return badRequest('stationCode is required');
  if (!requesterName) return badRequest('requesterName is required');
  if (!requestedItems.length && !otherItems) return badRequest('Provide at least one inventory request or other item notes.');

  const station = await env.DB.prepare('SELECT id, name, code FROM stations WHERE code = ?').bind(stationCode).first();
  if (!station) return badRequest('Invalid station', 404);

  await env.DB.prepare(`
    INSERT INTO station_requests (station_id, requester_name, requested_items_json, other_items)
    VALUES (?, ?, ?, NULLIF(?, ''))
  `).bind(station.id, requesterName, JSON.stringify(requestedItems), otherItems).run();

  const settings = await getSettings(env.DB);
  const lines = requestedItems.map((item) => `- ${item.name}: ${item.quantity}`).join('\n');
  const message = [
    `Station request submitted by ${requesterName}.`,
    `Station: ${station.name} (${station.code})`,
    '',
    'Requested inventory:',
    lines || '- None listed',
    '',
    `Other items: ${otherItems || 'None'}`,
    `Submitted at: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    await sendRequestEmail(env, settings.supply_officer_email, `Supply request: ${station.name}`, message);
  } catch (error) {
    return badRequest(error.message, 502);
  }

  return json({ ok: true, emailed: Boolean(settings.supply_officer_email && env.RESEND_API_KEY && env.SUPPLY_FROM_EMAIL) }, { status: 201 });
}

export async function completeStationRequests(request, env) {
  const body = await parseBody(request);
  const completedBy = String(body?.completedBy || '').trim();
  const stationId = body?.stationId ? Number.parseInt(body.stationId, 10) : null;
  const stationCode = String(body?.stationCode || '').trim();
  const requestIds = Array.isArray(body?.requestIds)
    ? body.requestIds.map((value) => Number.parseInt(value, 10)).filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (!completedBy) return badRequest('completedBy is required');

  let resolvedStationId = stationId;
  if (!resolvedStationId && stationCode) {
    const station = await env.DB.prepare('SELECT id FROM stations WHERE code = ?').bind(stationCode).first();
    if (!station) return badRequest('Invalid station', 404);
    resolvedStationId = Number(station.id);
  }

  if (!resolvedStationId && !requestIds.length) return badRequest('stationId, stationCode, or requestIds is required');

  if (requestIds.length) {
    const placeholders = requestIds.map(() => '?').join(', ');
    await env.DB.prepare(`
      UPDATE station_requests
      SET completed_by = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders}) AND completed_at IS NULL AND canceled_at IS NULL
    `).bind(completedBy, ...requestIds).run();
    return json({ ok: true, completedBy, requestIds });
  }

  await env.DB.prepare(`
    UPDATE station_requests
    SET completed_by = ?, completed_at = CURRENT_TIMESTAMP
    WHERE station_id = ? AND completed_at IS NULL AND canceled_at IS NULL
  `).bind(completedBy, resolvedStationId).run();

  return json({ ok: true, stationId: resolvedStationId, completedBy });
}

export async function cancelStationRequest(request, env) {
  const body = await parseBody(request);
  const requestId = Number.parseInt(body?.requestId, 10);
  const canceledBy = String(body?.canceledBy || '').trim();
  const cancelReason = String(body?.cancelReason || '').trim();

  if (!Number.isInteger(requestId) || requestId <= 0) return badRequest('requestId is required');
  if (!canceledBy) return badRequest('canceledBy is required');
  if (!cancelReason) return badRequest('cancelReason is required');

  const existing = await env.DB.prepare(`
    SELECT id, completed_at, canceled_at
    FROM station_requests
    WHERE id = ?
  `).bind(requestId).first();
  if (!existing) return badRequest('Request not found', 404);
  if (existing.canceled_at) return badRequest('Request is already canceled');
  if (existing.completed_at) return badRequest('Completed requests cannot be canceled');

  await env.DB.prepare(`
    UPDATE station_requests
    SET canceled_by = ?,
        cancel_reason = ?,
        canceled_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(canceledBy, cancelReason, requestId).run();

  return json({ ok: true, requestId, canceledBy });
}

export async function modifyStationRequest(request, env) {
  const body = await parseBody(request);
  const requestId = Number.parseInt(body?.requestId, 10);
  const modifiedBy = String(body?.modifiedBy || '').trim();
  const modificationReason = String(body?.modificationReason || '').trim();
  const requestedItems = Array.isArray(body?.items)
    ? body.items
      .map((entry) => ({ name: (entry.name || '').trim(), quantity: Number.parseInt(entry.quantity || 0, 10) }))
      .filter((entry) => entry.name && entry.quantity > 0)
    : [];

  if (!Number.isInteger(requestId) || requestId <= 0) return badRequest('requestId is required');
  if (!modifiedBy) return badRequest('modifiedBy is required');
  if (!modificationReason) return badRequest('modificationReason is required');
  if (!requestedItems.length) return badRequest('Provide at least one inventory item.');

  const existing = await env.DB.prepare(`
    SELECT id, completed_at, canceled_at
    FROM station_requests
    WHERE id = ?
  `).bind(requestId).first();
  if (!existing) return badRequest('Request not found', 404);
  if (existing.canceled_at) return badRequest('Canceled requests cannot be modified');
  if (existing.completed_at) return badRequest('Completed requests cannot be modified');

  await env.DB.prepare(`
    UPDATE station_requests
    SET requested_items_json = ?,
        modified_by = ?,
        modification_reason = ?,
        modified_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(JSON.stringify(requestedItems), modifiedBy, modificationReason, requestId).run();

  return json({ ok: true, requestId, modifiedBy });
}

export async function deleteItem(request, env) {
  const body = await parseBody(request);
  const itemId = Number.parseInt(body?.itemId, 10);
  const employeeOrDepartment = String(body?.employeeOrDepartment || '').trim();
  const performedBy = String(body?.performedBy || employeeOrDepartment).trim();
  const confirmed = String(body?.confirmed || '').toLowerCase() === 'true';

  if (!Number.isInteger(itemId) || itemId <= 0) return badRequest('itemId is required');
  if (!performedBy) return badRequest('performedBy is required');
  if (!employeeOrDepartment) return badRequest('employeeOrDepartment is required');
  if (!confirmed) return badRequest('Confirmation checkbox must be checked');

  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').bind(itemId).first();
  if (!item) return badRequest('Item not found', 404);

  const note = `Item deleted from active inventory by ${performedBy} (${employeeOrDepartment}).`;
  const txDelta = -Math.max(0, Number.parseInt(item.total_quantity || 0, 10));

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO stock_transactions (item_id, station_id, quantity_delta, action_type, source, note, performed_by, created_at)
      VALUES (?, NULL, ?, 'adjustment', 'manual', ?, ?, CURRENT_TIMESTAMP)
    `).bind(item.id, txDelta, note, performedBy),
    env.DB.prepare(`
      UPDATE items
      SET total_quantity = 0,
          deleted_at = CURRENT_TIMESTAMP,
          deleted_by = ?,
          deleted_by_identifier = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(performedBy, employeeOrDepartment, item.id),
  ]);

  return json({ ok: true, itemId: item.id, deletedAt: new Date().toISOString() });
}

export { badRequest, json };
