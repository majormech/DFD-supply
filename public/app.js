const page = document.body.dataset.page;

const state = {
  items: [],
  stations: [],
  stationRequests: [],
  recentTransactions: [],
};

const toast = document.querySelector('#toast');

function showToast(message, isError = false) {
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? '#c13737' : '#142033';
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3000);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formToPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function itemOptions(items) {
  return ['<option value="">Select an item</option>', ...items.map((item) => `<option value="${item.id}">${item.name} (${item.sku})</option>`)].join('');
}

async function loadBootstrap() {
  const data = await fetchJson('/api/bootstrap');
  state.items = data.items;
  state.stations = data.stations;
  state.stationRequests = data.stationRequests || [];
  state.recentTransactions = data.recentTransactions;
  return data;
}

function requestDetails(request) {
  const requestedItems = Array.isArray(request.requested_items) ? request.requested_items : [];
  const requestedSummary = requestedItems.length
    ? `<ul>${requestedItems.map((item) => `<li>${item.name}: <strong>${item.quantity}</strong></li>`).join('')}</ul>`
    : '<p class="helper">No inventory items listed.</p>';

  return `
    ${requestedSummary}
    ${request.other_items ? `<p><strong>Other items:</strong> ${request.other_items}</p>` : ''}
    <p class="helper">Requested by ${request.requester_name} · ${new Date(request.created_at).toLocaleString()}</p>
  `;
}

async function scanCodeWithCamera(title = 'Scan barcode or QR code') {
  if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera scanning is not supported on this device. Type the code manually instead.');
  }

  const detector = new window.BarcodeDetector({
    formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar'],
  });

  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  overlay.innerHTML = `
    <div class="scanner-modal__card">
      <h3>${title}</h3>
      <p class="helper">Point your camera at a barcode or QR code.</p>
      <video autoplay playsinline muted></video>
      <div class="scanner-modal__actions">
        <button type="button" data-action="manual" class="secondary">Type code</button>
        <button type="button" data-action="cancel" class="ghost">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const video = overlay.querySelector('video');
  const manualButton = overlay.querySelector('[data-action="manual"]');
  const cancelButton = overlay.querySelector('[data-action="cancel"]');

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  video.srcObject = stream;

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    overlay.remove();
  };

  return new Promise((resolve, reject) => {
    const cancel = () => {
      stop();
      reject(new Error('Scan cancelled.'));
    };

    manualButton.addEventListener('click', () => {
      const typed = window.prompt('Enter barcode or QR code');
      if (!typed) return;
      stop();
      resolve(typed.trim());
    });

    cancelButton.addEventListener('click', cancel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cancel();
    });

    const tick = async () => {
      if (stopped) return;
      try {
        const barcodes = await detector.detect(video);
        const match = barcodes.find((entry) => entry.rawValue)?.rawValue?.trim();
        if (match) {
          stop();
          resolve(match);
          return;
        }
      } catch {
        // Ignore transient detector errors while camera is warming up.
      }
      window.setTimeout(tick, 220);
    };

    tick();
  });
}

function appendCodeToInput(input, code) {
  const current = input.value.split(',').map((value) => value.trim()).filter(Boolean);
  if (!current.includes(code)) current.push(code);
  input.value = current.join(', ');
}

function attachScannerButton(input, button, successMessage, append = false) {
  button.addEventListener('click', async () => {
    try {
      const code = await scanCodeWithCamera();
      if (append) {
        appendCodeToInput(input, code);
      } else {
        input.value = code;
      }
      showToast(successMessage);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function setupAddItemScanFields(form) {
  if (!form) return;
  const fields = [
    { name: 'barcodes', label: 'Scan barcode', success: 'Barcode added.', append: true },
    { name: 'qrCode', label: 'Scan QR code', success: 'QR code captured.' },
  ];

  fields.forEach((entry) => {
    const input = form.querySelector(`input[name="${entry.name}"]`);
    if (!input || input.dataset.scanReady === 'true') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'input-with-action';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = entry.label;
    wrapper.appendChild(button);

    attachScannerButton(input, button, entry.success, Boolean(entry.append));
    input.dataset.scanReady = 'true';
  });
}

function renderMain() {
  document.querySelector('#total-item-count').textContent = `${state.items.length} items`;
  document.querySelector('#total-stock-count').textContent = `${state.items.reduce((sum, item) => sum + item.total_quantity, 0)} total units`;
  const table = document.querySelector('#inventory-table');
  table.innerHTML = state.items.length
    ? state.items.map((item) => `<tr><td>${item.name}</td><td>${item.sku}</td><td>${item.total_quantity}</td><td>${currency(item.unit_cost)}</td></tr>`).join('')
    : '<tr><td colspan="4">No inventory items yet.</td></tr>';

  const stationList = document.querySelector('#station-status-list');
  const requestsByStation = state.stationRequests.reduce((acc, request) => {
    if (!acc[request.station_id]) acc[request.station_id] = [];
    acc[request.station_id].push(request);
    return acc;
  }, {});

  stationList.innerHTML = state.stations.map((station) => {
    const requests = requestsByStation[station.id] || [];
    const hasOpenRequest = requests.length > 0;
    return `
      <article class="station-status ${hasOpenRequest ? 'station-status--open' : 'station-status--clear'}">
        <div class="station-status__header">
          <strong>${station.name}</strong>
          <span>${hasOpenRequest ? `${requests.length} open request${requests.length === 1 ? '' : 's'}` : 'No open requests'}</span>
        </div>
        ${hasOpenRequest ? `
          <details>
            <summary>View requests</summary>
            <div class="station-status__requests">
              ${requests.map((request) => `<div class="station-status__request">${requestDetails(request)}</div>`).join('')}
            </div>
          </details>
        ` : ''}
      </article>
    `;
  }).join('');
}

function renderInventoryPage() {
  document.querySelector('#issue-item').innerHTML = itemOptions(state.items);
  document.querySelector('#restock-item').innerHTML = itemOptions(state.items);
  document.querySelector('#issue-station').innerHTML = ['<option value="">Select a station</option>', ...state.stations.map((station) => `<option value="${station.id}">${station.name}</option>`)].join('');

  const txList = document.querySelector('#transaction-list');
  txList.innerHTML = state.recentTransactions.length
    ? state.recentTransactions.map((txn) => `
      <article class="txn">
        <strong>${txn.item_name} (${txn.item_sku})</strong>
        <div>${txn.quantity_delta >= 0 ? '+' : ''}${txn.quantity_delta} · ${txn.action_type} · ${txn.station_name || 'Main inventory'}</div>
        <div class="helper">${new Date(txn.created_at).toLocaleString()} · Changed by: ${txn.performed_by || 'Unknown'} · Source: ${txn.source}</div>
        ${txn.note ? `<div>${txn.note}</div>` : ''}
      </article>
    `).join('')
    : '<p class="helper">No changes yet.</p>';
}

async function wireInventoryForms() {
  const addForm = document.querySelector('#add-item-form');
  const issueForm = document.querySelector('#issue-form');
  const restockForm = document.querySelector('#restock-form');

  setupAddItemScanFields(addForm);

  addForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await fetchJson('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(formToPayload(addForm)),
      });
      addForm.reset();
      await loadBootstrap();
      renderInventoryPage();
      showToast('Item added.');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  for (const [form, mode] of [[issueForm, 'issue'], [restockForm, 'restock']]) {
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = formToPayload(form);
      payload.mode = mode;
      payload.source = payload.code ? 'scan' : 'manual';
      if (!payload.itemId) delete payload.itemId;
      if (!payload.code) delete payload.code;
      try {
        await fetchJson('/api/inventory/adjust', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        form.reset();
        await loadBootstrap();
        renderInventoryPage();
        showToast(mode === 'issue' ? 'Inventory issued.' : 'Inventory restocked.');
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }
}

function renderAnalytics(data) {
  const byItem = document.querySelector('#by-item');
  byItem.innerHTML = data.byItem.length
    ? data.byItem.map((row) => `<tr><td>${row.name} (${row.sku})</td><td>${row.used_qty || 0}</td><td>${currency(row.used_cost)}</td></tr>`).join('')
    : '<tr><td colspan="3">No usage in selected period.</td></tr>';

  const byStation = document.querySelector('#by-station');
  byStation.innerHTML = data.byStation.length
    ? data.byStation.map((row) => `<tr><td>${row.station_name}</td><td>${row.used_qty || 0}</td><td>${currency(row.used_cost)}</td></tr>`).join('')
    : '<tr><td colspan="3">No station usage in selected period.</td></tr>';

  const trend = document.querySelector('#trend-bars');
  const maxCost = Math.max(1, ...data.trend.map((row) => Number(row.used_cost || 0)));
  trend.innerHTML = data.trend.length
    ? data.trend.map((row) => {
      const width = Math.max(2, Math.round((Number(row.used_cost || 0) / maxCost) * 100));
      return `<div class="trend-row"><span>${row.day}</span><div class="trend-bar"><i style="width:${width}%"></i></div><strong>${currency(row.used_cost)}</strong></div>`;
    }).join('')
    : '<p class="helper">No trend data in selected period.</p>';
}

async function wireSearchPage() {
  const select = document.querySelector('#days-select');
  const load = async () => {
    const data = await fetchJson(`/api/analytics?days=${encodeURIComponent(select.value)}`);
    renderAnalytics(data);
  };
  select.addEventListener('change', () => load().catch((error) => showToast(error.message, true)));
  await load();
}

function findItemByCode(code) {
  const normalized = code.trim().toLowerCase();
  return state.items.find((item) => {
    const barcodes = Array.isArray(item.barcodes) ? item.barcodes : [item.barcode];
    return [item.sku, item.qr_code, ...barcodes].some((value) => String(value || '').trim().toLowerCase() === normalized);
  });
}

function applyScannedRequestItem(code, itemSelects, qtyInputs) {
  const item = findItemByCode(code);
  if (!item) {
    showToast('No matching inventory item for that code.', true);
    return;
  }

  const existingIndex = itemSelects.findIndex((select) => String(select.value) === String(item.id));
  if (existingIndex >= 0) {
    const qtyInput = qtyInputs[existingIndex];
    qtyInput.value = String(Math.max(0, Number.parseInt(qtyInput.value || '0', 10)) + 1);
    showToast(`Added 1 more ${item.name} to this request.`);
    return;
  }

  const emptyIndex = itemSelects.findIndex((select) => !select.value);
  if (emptyIndex < 0) {
    showToast('All request item slots are already in use.', true);
    return;
  }

  itemSelects[emptyIndex].value = String(item.id);
  qtyInputs[emptyIndex].value = String(Math.max(1, Number.parseInt(qtyInputs[emptyIndex].value || '0', 10)));
  showToast(`${item.name} added to request.`);
}

function setupRequestScanner(form, itemSelects, qtyInputs) {
  if (!form || form.querySelector('.scan-request-tools')) return;

  const tools = document.createElement('section');
  tools.className = 'scan-request-tools stack compact';
  tools.innerHTML = `
    <h3>Scan item code</h3>
    <p class="helper">Scan a barcode/QR code or paste a code to auto-fill request items.</p>
    <div class="scan-request-tools__row">
      <label>Code
        <input type="text" name="scanCodeInput" placeholder="Scan or type code" />
      </label>
      <div class="scan-request-tools__actions">
        <button type="button" data-action="apply">Use code</button>
        <button type="button" data-action="camera" class="secondary">Scan with camera</button>
      </div>
    </div>
  `;

  form.insertBefore(tools, form.children[2] || null);

  const codeInput = tools.querySelector('input[name="scanCodeInput"]');
  const applyButton = tools.querySelector('[data-action="apply"]');
  const cameraButton = tools.querySelector('[data-action="camera"]');

  applyButton.addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (!code) {
      showToast('Enter or scan a code first.', true);
      return;
    }
    applyScannedRequestItem(code, itemSelects, qtyInputs);
    codeInput.value = '';
  });

  cameraButton.addEventListener('click', async () => {
    try {
      const code = await scanCodeWithCamera('Scan item for request');
      codeInput.value = code;
      applyScannedRequestItem(code, itemSelects, qtyInputs);
      codeInput.value = '';
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function wireRequestPage() {
  const form = document.querySelector('#request-form');
  const itemSelects = [...document.querySelectorAll('.request-item')];
 const qtyInputs = [1, 2, 3].map((index) => form?.querySelector(`input[name="qty${index}"]`)).filter(Boolean);
  itemSelects.forEach((el) => {
    el.innerHTML = itemOptions(state.items);
  });

 setupRequestScanner(form, itemSelects, qtyInputs);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = formToPayload(form);
    const items = [1, 2, 3].map((i) => {
      const id = raw[`item${i}`];
      const qty = raw[`qty${i}`];
      const item = state.items.find((entry) => String(entry.id) === String(id));
      return item ? { name: item.name, quantity: qty } : null;
    }).filter(Boolean);

    try {
      await fetchJson('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stationCode: raw.stationCode,
          requesterName: raw.requesterName,
          otherItems: raw.otherItems,
          items,
        }),
      });
      form.reset();
      showToast('Request submitted to supply officer.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function wireAdminPage() {
  const form = document.querySelector('#admin-settings-form');
  const keyInput = document.querySelector('#admin-key');

  const headers = () => ({ ...(keyInput.value ? { 'x-admin-key': keyInput.value } : {}) });

  async function loadSettings() {
    const settings = await fetchJson('/api/admin/settings', { headers: headers() });
    form.querySelector('input[name="supplyOfficerEmail"]').value = settings.supply_officer_email || '';
    form.querySelector('input[name="adminEmails"]').value = settings.admin_emails || '';
  }

  keyInput?.addEventListener('change', () => loadSettings().catch((error) => showToast(error.message, true)));

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = formToPayload(form);
      await fetchJson('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers() },
        body: JSON.stringify(payload),
      });
      showToast('Admin settings saved.');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  await loadSettings();
}

(async function init() {
  try {
    await loadBootstrap();
    if (page === 'main') renderMain();
    if (page === 'inventory') {
      renderInventoryPage();
      await wireInventoryForms();
    }
    if (page === 'search') await wireSearchPage();
    if (page === 'request') await wireRequestPage();
    if (page === 'admin') await wireAdminPage();
  } catch (error) {
    showToast(error.message, true);
  }
})();
