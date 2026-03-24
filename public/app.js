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

function showTimedPopup(message, durationMs = 5000) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  overlay.innerHTML = `
    <div class="scanner-modal__card">
      <h3>Success</h3>
      <p>${message}</p>
      <div class="scanner-modal__actions">
        <button type="button" data-action="ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('[data-action="ok"]')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  window.setTimeout(close, durationMs);
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
       ? `<ul>${requestedItems.map((item) => `<li>${escapeHtml(item.name)}: <strong>${escapeHtml(item.quantity)}</strong></li>`).join('')}</ul>`
    : '<p class="helper">No inventory items listed.</p>';

  return `
    ${requestedSummary}
    ${request.other_items ? `<p><strong>Other items:</strong> ${escapeHtml(request.other_items)}</p>` : ''}
    <p class="helper">Requested by ${escapeHtml(request.requester_name)} · ${new Date(request.created_at).toLocaleString()}</p>
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

function setupInventoryCodeScanner(form, config) {
  if (!form) return;
  const codeInput = form.querySelector('input[name="code"]');
  if (!codeInput) return;

  const barcodeButton = form.querySelector(config.barcodeButtonSelector);
  const qrButton = form.querySelector(config.qrButtonSelector);
  if (!barcodeButton || !qrButton) return;

  if (barcodeButton.dataset.scanReady !== 'true') {
    attachScannerButton(codeInput, barcodeButton, config.barcodeSuccess);
    barcodeButton.dataset.scanReady = 'true';
  }

  if (qrButton.dataset.scanReady !== 'true') {
    attachScannerButton(codeInput, qrButton, config.qrSuccess);
    qrButton.dataset.scanReady = 'true';
  }
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
    ? state.items.map((item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.sku}</td>
        <td>${item.total_quantity}</td>
        <td>${currency(item.unit_cost)}</td>
        <td>
        <button
            type="button"
            class="success"
            data-action="modify-item"
            data-item-id="${item.id}"
          >Modify</button>
          <button
            type="button"
            class="danger"
            data-action="delete-item"
            data-item-id="${item.id}"
            data-item-name="${escapeHtml(item.name)}"
          >Delete</button>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">No inventory items yet.</td></tr>';

  table.querySelectorAll('[data-action="delete-item"]').forEach((button) => {
    button.addEventListener('click', () => {
      openDeletePrompt(button.dataset.itemId, button.dataset.itemName).catch((error) => showToast(error.message, true));
    });
  });

  table.querySelectorAll('[data-action="modify-item"]').forEach((button) => {
    button.addEventListener('click', () => {
      openModifyPrompt(button.dataset.itemId).catch((error) => showToast(error.message, true));
    });
  });

  const stationList = document.querySelector('#station-status-list');
    if (!stationList) return;
  const requestsByStation = state.stationRequests.reduce((acc, request) => {
    if (!acc[request.station_id]) acc[request.station_id] = [];
    acc[request.station_id].push(request);
    return acc;
  }, {});

  stationList.innerHTML = state.stations.map((station) => {
    const requests = requestsByStation[station.id] || [];
    const hasOpenRequest = requests.length > 0;
    return `
     <article class="station-status ${hasOpenRequest ? 'station-status--open' : 'station-status--clear'}" data-station-id="${station.id}">
        <button type="button" class="station-status__toggle" data-action="toggle-station" aria-expanded="false">
          <div class="station-status__header">
            <strong>${escapeHtml(station.name)}</strong>
            <span>${hasOpenRequest ? `${requests.length} pending request${requests.length === 1 ? '' : 's'}` : 'No pending requests'}</span>
          </div>
        </button>
        <div class="station-status__panel hidden">
          ${hasOpenRequest
            ? `<div class="station-status__requests">${requests.map((request) => `<div class="station-status__request">${requestDetails(request)}</div>`).join('')}</div>`
            : '<p class="helper">No current pending request details for this station.</p>'}
        </div>
      </article>
    `;
  }).join('');
  
  stationList.querySelectorAll('[data-action="toggle-station"]').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = button.parentElement?.querySelector('.station-status__panel');
      if (!panel) return;
      const isHidden = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !isHidden);
      button.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });
  });
  
  const shoppingListPanel = document.querySelector('#shopping-list-panel');
  const shoppingListContent = document.querySelector('#shopping-list-content');
  if (!shoppingListPanel || !shoppingListContent) return;

  const lowStockItems = state.items.filter((item) => item.total_quantity < item.low_stock_level);
  shoppingListPanel.classList.toggle('shopping-list--alert', lowStockItems.length > 0);
  shoppingListPanel.classList.toggle('shopping-list--clear', lowStockItems.length === 0);

  shoppingListContent.innerHTML = lowStockItems.length
    ? `
      <ul class="shopping-list__items">
        ${lowStockItems.map((item) => `
          <li class="shopping-list__item">
            <strong>${escapeHtml(item.name)}</strong>
            <span>Current stock: ${item.total_quantity} (minimum: ${item.low_stock_level})</span>
          </li>
        `).join('')}
      </ul>
    `
    : '<p class="helper">Nothing to purchase right now. All inventory is at or above minimum levels.</p>';
}

async function openDeletePrompt(itemId, itemName) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  overlay.innerHTML = `
    <div class="scanner-modal__card">
      <h3>Delete Inventory Item</h3>
      <p>You are deleting: <strong>${escapeHtml(itemName)}</strong></p>
      <label>Name or department employee number
        <input type="text" name="employeeOrDepartment" placeholder="e.g. 12345 or Supply Dept" required />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="confirmDelete" />
        I understand this item will be removed from active inventory.
      </label>
      <div class="scanner-modal__actions">
        <button type="button" class="ghost" data-action="cancel">Cancel</button>
        <button type="button" data-action="submit" disabled>Submit deletion</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const identityInput = overlay.querySelector('input[name="employeeOrDepartment"]');
  const confirmCheckbox = overlay.querySelector('input[name="confirmDelete"]');
  const submitButton = overlay.querySelector('[data-action="submit"]');

  confirmCheckbox.addEventListener('change', () => {
    submitButton.disabled = !confirmCheckbox.checked;
  });

  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  submitButton.addEventListener('click', async () => {
    const employeeOrDepartment = identityInput.value.trim();
  if (!employeeOrDepartment) {
      showToast('Enter a name or department employee number.', true);
      return;
    }

    try {
      await fetchJson('/api/items/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId,
          performedBy: employeeOrDepartment,
          employeeOrDepartment,
          confirmed: confirmCheckbox.checked,
        }),
      });
      close();
      await loadBootstrap();
      renderMain();
      showTimedPopup('Item has been deleted/removed from the inventory system.', 5000);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function buildChangeSummary(originalItem, nextItem) {
  const changes = [];
  const pushChange = (label, from, to) => {
    if (String(from ?? '') === String(to ?? '')) return;
    changes.push({ label, from: String(from ?? '—') || '—', to: String(to ?? '—') || '—' });
  };

  pushChange('Item name', originalItem.name, nextItem.name);
  pushChange('SKU', originalItem.sku, nextItem.sku);
  pushChange('QR code', originalItem.qr_code, nextItem.qrCode);
  pushChange('Barcodes', (originalItem.barcodes || []).join(', '), nextItem.barcodes.join(', '));
  pushChange('Minimum par/restock level', originalItem.low_stock_level, nextItem.lowStockLevel);
  pushChange('Current stock level', originalItem.total_quantity, nextItem.totalQuantity);
  pushChange('Unit cost', Number(originalItem.unit_cost || 0).toFixed(2), Number(nextItem.unitCost || 0).toFixed(2));

  return changes;
}

async function openModifyPrompt(itemId) {
  const item = state.items.find((entry) => Number(entry.id) === Number(itemId));
  if (!item) {
    showToast('Unable to find the selected item.', true);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  overlay.innerHTML = `
    <div class="scanner-modal__card">
      <h3>Modify Item</h3>
      <p class="helper">Review and edit item details below.</p>
      <label>Item name
        <input type="text" name="name" value="${escapeHtml(item.name)}" required />
      </label>
      <label>SKU
        <input type="text" name="sku" value="${escapeHtml(item.sku)}" required />
      </label>
      <label>Item QR code
        <input type="text" name="qrCode" value="${escapeHtml(item.qr_code || '')}" required />
      </label>
      <label>Barcodes (comma separated list)
        <input type="text" name="barcodes" value="${escapeHtml((item.barcodes || []).join(', '))}" />
      </label>
      <label>Minimum par/restock level
        <input type="number" min="0" step="1" name="lowStockLevel" value="${item.low_stock_level}" required />
      </label>
      <label>Current stock level
        <input type="number" min="0" step="1" name="totalQuantity" value="${item.total_quantity}" required />
      </label>
      <label>Unit cost
        <input type="number" min="0" step="0.01" name="unitCost" value="${item.unit_cost}" required />
      </label>
      <label>Description
        <input type="text" name="description" value="${escapeHtml(item.description || '')}" />
      </label>
      <label>Edited by
        <input type="text" name="performedBy" value="Main Page User" required />
      </label>
      <div class="modify-summary hidden" data-role="summary"></div>
      <div class="scanner-modal__actions">
        <button type="button" class="danger" data-action="cancel">Cancel edit</button>
        <button type="button" class="success" data-action="submit">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const submitButton = overlay.querySelector('[data-action="submit"]');
  const summaryNode = overlay.querySelector('[data-role="summary"]');
  let preparedPayload = null;

  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  submitButton.addEventListener('click', async () => {
    const payload = Object.fromEntries(
      [...overlay.querySelectorAll('input[name]')].map((input) => [input.name, input.value])
    );
    const nextItem = {
      ...payload,
      barcodes: String(payload.barcodes || '').split(',').map((value) => value.trim()).filter(Boolean),
      lowStockLevel: Number.parseInt(payload.lowStockLevel, 10),
      totalQuantity: Number.parseInt(payload.totalQuantity, 10),
      unitCost: Number.parseFloat(payload.unitCost),
    };

    if (!nextItem.name || !nextItem.sku || !nextItem.qrCode || !nextItem.performedBy) {
      showToast('Name, SKU, QR code, and Edited by are required.', true);
      return;
    }
    if ([nextItem.lowStockLevel, nextItem.totalQuantity].some((value) => Number.isNaN(value) || value < 0)) {
      showToast('Stock levels must be 0 or greater.', true);
      return;
    }
    if (Number.isNaN(nextItem.unitCost) || nextItem.unitCost < 0) {
      showToast('Unit cost must be 0 or greater.', true);
      return;
    }

    if (!preparedPayload) {
      const changes = buildChangeSummary(item, nextItem);
      if (!changes.length) {
        showToast('No changes detected for this item.', true);
        return;
      }

      summaryNode.classList.remove('hidden');
      summaryNode.innerHTML = `
        <h4>Summary of changes</h4>
        <ul>
          ${changes.map((change) => `<li><strong>${escapeHtml(change.label)}:</strong> ${escapeHtml(change.from)} → ${escapeHtml(change.to)}</li>`).join('')}
        </ul>
        <p class="helper">Click submit again to confirm and save these changes.</p>
      `;
      submitButton.textContent = 'Submit again to confirm';
      preparedPayload = nextItem;
      return;
    }

    try {
      await fetchJson('/api/items', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          name: preparedPayload.name,
          sku: preparedPayload.sku,
          qrCode: preparedPayload.qrCode,
          barcodes: preparedPayload.barcodes.join(', '),
          lowStockLevel: preparedPayload.lowStockLevel,
          totalQuantity: preparedPayload.totalQuantity,
          unitCost: preparedPayload.unitCost,
          description: preparedPayload.description,
          performedBy: preparedPayload.performedBy,
        }),
      });
      close();
      await loadBootstrap();
      renderMain();
      showTimedPopup('Item changes have been saved.', 5000);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function renderInventoryPage() {
  renderRecentTransactions();
}

function renderIssuePage() {
  const stationList = document.querySelector('#issue-station-list');
  if (!stationList) return;
  const requestsByStation = state.stationRequests.reduce((acc, request) => {
    if (!acc[request.station_id]) acc[request.station_id] = [];
    acc[request.station_id].push(request);
    return acc;
  }, {});

  stationList.innerHTML = state.stations.map((station) => {
    const requests = requestsByStation[station.id] || [];
    const hasOpenRequest = requests.length > 0;
    const flattenedItems = requests.flatMap((request) => Array.isArray(request.requested_items) ? request.requested_items : []);
    const requestItems = flattenedItems.length
      ? `<ul class="issue-request-list">${flattenedItems.map((item) => `<li>${escapeHtml(item.name)}: <strong>${escapeHtml(item.quantity)}</strong></li>`).join('')}</ul>`
      : '<p class="helper">No inventory items are currently requested.</p>';

    return `
      <article class="issue-station-listing ${hasOpenRequest ? 'issue-station-listing--open' : 'issue-station-listing--clear'}" data-station-id="${station.id}">
        <div class="issue-station-listing__header">
          <button type="button" class="issue-station-listing__toggle" data-action="toggle-station-issue" aria-expanded="false">
            <strong>${escapeHtml(station.name)}</strong> · ${hasOpenRequest ? `${requests.length} active request${requests.length === 1 ? '' : 's'}` : 'No active requests'}
          </button>
          <div class="issue-station-listing__actions">
                   <button type="button" data-action="open-issue-items" data-station-id="${station.id}">Issue items</button>
          </div>
        </div>
        <div class="issue-station-listing__panel hidden">
          ${requestItems}
        </div>
      </article>
    `;
  }).join('');
  
  renderRecentTransactions();
}

function renderRestockPage() {
  renderRecentTransactions();
}

function renderRecentTransactions() {
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

async function wireInventoryPage() {
  const addForm = document.querySelector('#add-item-form');
if (!addForm) return;

  setupAddItemScanFields(addForm);

  const qrInput = addForm.querySelector('#add-item-qr');
  const barcodeInput = addForm.querySelector('#add-item-barcodes');
  const skipBarcodeInput = addForm.querySelector('#add-item-skip-barcode');
  const dateTimeInput = addForm.querySelector('#add-item-datetime');
  const performedByInput = addForm.querySelector('#add-item-performed-by');
  const unitCostInput = addForm.querySelector('#add-item-unit-cost');
  const reviewSection = addForm.querySelector('#add-item-review');
  const reviewContent = addForm.querySelector('#add-item-review-content');
  const previewButton = addForm.querySelector('#add-item-preview');
  const submitButton = addForm.querySelector('#add-item-submit');
  const reviewConfirmInput = addForm.querySelector('#add-item-review-confirm');
  const nameInput = addForm.querySelector('#add-item-name');

  const syncBarcodeState = () => {
    const disabled = skipBarcodeInput.checked;
    barcodeInput.disabled = disabled;
    const barcodeScanButton = barcodeInput.parentElement?.querySelector('button');
    if (barcodeScanButton) barcodeScanButton.disabled = disabled;
    if (disabled) barcodeInput.value = '';
  };

  const lastPerformerKey = 'add-item:lastPerformer';
  const draftKey = (qrCode) => `add-item:lastCost:${String(qrCode || '').trim().toLowerCase()}`;

  const resetReviewState = () => {
    reviewSection.classList.add('hidden');
    reviewConfirmInput.checked = false;
    submitButton.disabled = true;
  };

  const buildReviewHtml = () => {
    const values = formToPayload(addForm);
    return `
      <div><strong>QR code:</strong> ${values.qrCode || '—'}</div>
      <div><strong>Barcode(s):</strong> ${skipBarcodeInput.checked ? 'Skipped' : (values.barcodes || '—')}</div>
      <div><strong>Item name:</strong> ${values.name || '—'}</div>
      <div><strong>Quantity:</strong> ${values.totalQuantity || '—'}</div>
      <div><strong>Low stock level:</strong> ${values.lowStockLevel || '—'}</div>
      <div><strong>Unit cost:</strong> ${values.unitCost ? currency(values.unitCost) : 'Not provided'}</div>
      <div><strong>Date/time:</strong> ${values.performedAt || '—'}</div>
      <div><strong>Completed by:</strong> ${values.performedBy || '—'}</div>
      <div><strong>Notes:</strong> ${values.note || 'None'}</div>
    `;
  };

  dateTimeInput.value = formatDateTimeLocal();
  performedByInput.value = window.localStorage.getItem(lastPerformerKey) || '';
  syncBarcodeState();
  skipBarcodeInput.addEventListener('change', () => {
    syncBarcodeState();
    resetReviewState();
  });
  reviewConfirmInput.addEventListener('change', () => {
    submitButton.disabled = !reviewConfirmInput.checked;
  });

  [qrInput, barcodeInput, unitCostInput, performedByInput, nameInput].forEach((input) => {
    input?.addEventListener('input', resetReviewState);
  });

  qrInput?.addEventListener('change', () => {
    const rememberedCost = window.localStorage.getItem(draftKey(qrInput.value));
    if (rememberedCost != null) unitCostInput.value = rememberedCost;
  });

  previewButton?.addEventListener('click', () => {
    if (!addForm.reportValidity()) return;
    reviewContent.innerHTML = buildReviewHtml();
    reviewSection.classList.remove('hidden');
  });

  addForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!reviewConfirmInput.checked) {
      showToast('Review and confirm the summary before submitting.', true);
      return;
    }

    const payload = formToPayload(addForm);
    payload.skipBarcodeCapture = skipBarcodeInput.checked ? 'true' : 'false';
    try {
      await fetchJson('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (payload.performedBy) window.localStorage.setItem(lastPerformerKey, payload.performedBy);
      if (payload.qrCode && payload.unitCost !== '') window.localStorage.setItem(draftKey(payload.qrCode), payload.unitCost);
      addForm.reset();
      dateTimeInput.value = formatDateTimeLocal();
      performedByInput.value = window.localStorage.getItem(lastPerformerKey) || '';
      skipBarcodeInput.checked = true;
      syncBarcodeState();
      resetReviewState();
      await loadBootstrap();
      renderInventoryPage();
      showTimedPopup('Item has been added and saved to the inventory system.', 5000);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function buildRequestedItemsForStation(stationId) {
  const requests = state.stationRequests.filter((request) => Number(request.station_id) === Number(stationId));
  const totals = new Map();
  requests.forEach((request) => {
    const requestedItems = Array.isArray(request.requested_items) ? request.requested_items : [];
    requestedItems.forEach((entry) => {
      const name = String(entry.name || '').trim();
      const quantity = Math.max(0, Number.parseInt(entry.quantity || 0, 10));
      if (!name || quantity <= 0) return;
      const key = name.toLowerCase();
      const existing = totals.get(key) || { name, requestedQuantity: 0 };
      existing.requestedQuantity += quantity;
      totals.set(key, existing);
    });
  });
 
  return [...totals.values()].map((entry) => {
    const inventoryItem = state.items.find((item) => item.name.trim().toLowerCase() === entry.name.trim().toLowerCase());
    return {
      ...entry,
      itemId: inventoryItem?.id || null,
      available: Number.parseInt(inventoryItem?.total_quantity || 0, 10),
      itemName: inventoryItem?.name || entry.name,
    };
  });
}

function openIssueItemsModal(stationId) {
  const station = state.stations.find((entry) => Number(entry.id) === Number(stationId));
  if (!station) {
    showToast('Unable to find station for issuing items.', true);
    return;
  }
  
 const requestedItems = buildRequestedItemsForStation(stationId);
  const issueEntries = requestedItems
    .filter((item) => item.itemId && item.available > 0)
    .map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      available: item.available,
      issueQuantity: Math.min(Math.max(1, item.requestedQuantity), item.available),
      code: '',
      source: 'request',
    }));

  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  const lastIssuerKey = 'issue:lastIssuerIdentity';
  const rememberedIdentity = window.localStorage.getItem(lastIssuerKey) || '';

  overlay.innerHTML = `
    <div class="scanner-modal__card">
      <h3>Issue items · ${escapeHtml(station.name)}</h3>
      <label>Name or employee number
        <input type="text" name="issuedBy" value="${escapeHtml(rememberedIdentity)}" required />
      </label>
        <p class="helper">If no request is active, scan an item QR code or barcode to start issuing items.</p>
      <div data-role="issueItems" class="stack compact"></div>
      <div class="inline-actions">
        <button type="button" data-action="scan-item" class="secondary">Scan item QR or barcode</button>
        <button type="button" data-action="add-another-item">Add another item</button>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" name="confirmedPulled" />
         I acknowledge these items are being pulled from inventory and the quantities are correct.
      </label>
      <div data-role="issueSummary" class="restock-followup hidden"></div>
      <div data-role="cancelConfirm" class="hidden restock-followup stack compact">
        <p>Are you sure you want to cancel issuing these items?</p>
        <div class="inline-actions">
          <button type="button" data-action="confirm-cancel" class="danger">Yes cancel issue items</button>
          <button type="button" data-action="go-back" class="request-success">Go back to continue issuing items</button>
        </div>
      </div>
      <div class="scanner-modal__actions">
        <button type="button" class="danger" data-action="cancel">Cancel</button>
        <button type="button" data-action="submit" class="request-success" disabled>Submit</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const submitButton = overlay.querySelector('[data-action="submit"]');
  const confirmPulled = overlay.querySelector('input[name="confirmedPulled"]');
  const identityInput = overlay.querySelector('input[name="issuedBy"]');
const issueItemsEl = overlay.querySelector('[data-role="issueItems"]');
  const cancelConfirm = overlay.querySelector('[data-role="cancelConfirm"]');
  const issueSummary = overlay.querySelector('[data-role="issueSummary"]');
  const scanItemButton = overlay.querySelector('[data-action="scan-item"]');
  const addAnotherButton = overlay.querySelector('[data-action="add-another-item"]');

  const renderIssueItems = () => {
    issueItemsEl.innerHTML = issueEntries.length
      ? issueEntries.map((item, index) => `
        <div class="issue-row issue-row--entry" data-index="${index}">
          <div>
            <strong>${escapeHtml(item.itemName)}</strong>
            ${item.source === 'request' ? '<div class="helper">Loaded from request queue</div>' : ''}
            ${item.code ? `<div class="helper">Scanned code: ${escapeHtml(item.code)}</div>` : ''}
          </div>
          <label>Quantity to issue
            <input type="number" min="1" max="${Math.max(1, item.available)}" value="${item.issueQuantity}" data-field="issueQty" />
          </label>
          <div class="helper">In stock: ${item.available}</div>
        </div>
      `).join('')
      : '<p class="helper">No items selected yet. Scan an item QR code or barcode to begin issuing.</p>';
  };

  const refreshSubmitState = () => {
    const canSubmit = Boolean(confirmPulled.checked && issueEntries.length);
    submitButton.disabled = !canSubmit;
  };

  const addItemByCode = async (code, mode = 'scan') => {
    const trimmed = String(code || '').trim();
    if (!trimmed) {
      showToast('Item code is required.', true);
      return;
    }
    const localItem = findItemByCode(trimmed);
    let matchedItem = localItem;
    if (!matchedItem) {
      const data = await fetchJson(`/api/scan?code=${encodeURIComponent(trimmed)}`);
      matchedItem = data.item;
    }
    if (!matchedItem) {
      showToast('No matching inventory item for that code.', true);
      return;
    }
    const available = Number.parseInt(matchedItem.total_quantity || 0, 10);
    if (available <= 0) {
      showToast(`${matchedItem.name} is out of stock and cannot be issued.`, true);
      return;
    }
    const existing = issueEntries.find((entry) => Number(entry.itemId) === Number(matchedItem.id));
    if (existing) {
      existing.code = trimmed;
      existing.source = existing.source || mode;
      showToast(`${matchedItem.name} is already in the issue list.`);
    } else {
      issueEntries.push({
        itemId: matchedItem.id,
        itemName: matchedItem.name,
        available,
        issueQuantity: 1,
        code: trimmed,
        source: mode,
      });
      showToast(`${matchedItem.name} added to issue list.`);
    }
    renderIssueItems();
    refreshSubmitState();
  };

  const promptToAddItem = async (allowCamera = true) => {
    try {
      let code = '';
      if (allowCamera) {
        code = await scanCodeWithCamera('Scan item QR code or barcode');
      } else {
        code = window.prompt('Enter item QR code or barcode') || '';
      }
      await addItemByCode(code, allowCamera ? 'scan' : 'manual');
    } catch (error) {
      showToast(error.message, true);
    }
  };

  renderIssueItems();
  refreshSubmitState();
  if (!issueEntries.length) {
    showToast('No active request found. Scan an item to start issuing inventory.');
  }

  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    cancelConfirm.classList.remove('hidden');
  });
  overlay.querySelector('[data-action="go-back"]')?.addEventListener('click', () => {
    cancelConfirm.classList.add('hidden');
  });
  overlay.querySelector('[data-action="confirm-cancel"]')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

scanItemButton?.addEventListener('click', () => {
    promptToAddItem(true);
  });
  addAnotherButton?.addEventListener('click', () => {
    promptToAddItem(true);
  });

  issueItemsEl.addEventListener('input', (event) => {
    const qtyInput = event.target.closest('[data-field="issueQty"]');
    if (!qtyInput) return;
    const row = qtyInput.closest('.issue-row');
    const index = Number.parseInt(row?.dataset.index || '-1', 10);
    const entry = issueEntries[index];
    if (!entry) return;
    const qty = Number.parseInt(qtyInput.value || '0', 10);
    entry.issueQuantity = Number.isInteger(qty) ? qty : 0;
  });

  confirmPulled?.addEventListener('change', () => {
    refreshSubmitState();
  });

  submitButton?.addEventListener('click', async () => {
    const issuedBy = identityInput.value.trim();
    if (!issuedBy) {
      showToast('Enter a name or employee number.', true);
      return;
    }

     if (!issueEntries.length) {
      showToast('Add at least one item before submitting.', true);
      return;
    }

    const overLimit = issueEntries.find((item) => item.issueQuantity <= 0 || item.issueQuantity > item.available);
    if (overLimit) {
      showToast(`Issue quantity for ${overLimit.itemName} must be between 1 and ${overLimit.available}.`, true);
      return;
    }

    const summaryLines = issueEntries.map((item) => `${item.itemName}: issue ${item.issueQuantity}, new inventory level ${item.available - item.issueQuantity}`);
    issueSummary.classList.remove('hidden');
    issueSummary.innerHTML = `<strong>Issue summary</strong><ul>${summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
    const summary = summaryLines.join('\n');
    const shouldSubmit = window.confirm(`Issue summary for ${station.name}:\n\n${summary}\n\nSubmit and save these changes?`);
    if (!shouldSubmit) return;

    try {
     for (const item of issueEntries) {
        if (!item.itemId) continue;
        await fetchJson('/api/inventory/adjust', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'issue',
            source: 'manual',
            stationId: station.id,
            itemId: item.itemId,
            quantity: item.issueQuantity,
            performedBy: issuedBy,
            note: `Issued from station request queue for ${station.name}.`,
          }),
        });
      }
      await fetchJson('/api/requests/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stationId: station.id,
          completedBy: issuedBy,
        }),
      });
    
      window.localStorage.setItem(lastIssuerKey, issuedBy);
      close();
      await loadBootstrap();
      renderIssuePage();
      showTimedPopup('Station items have been submitted and saved.', 5000);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function wireIssueForm() {
  const stationList = document.querySelector('#issue-station-list');
  if (!stationList) return;

  stationList.addEventListener('click', (event) => {
    const toggleButton = event.target.closest('[data-action="toggle-station-issue"]');
    if (toggleButton) {
      const wrapper = toggleButton.closest('.issue-station-listing');
      const panel = wrapper?.querySelector('.issue-station-listing__panel');
      if (!panel) return;
      const isHidden = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !isHidden);
      toggleButton.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      return;
    }

    const issueButton = event.target.closest('[data-action="open-issue-items"]');
    if (issueButton?.dataset.stationId) {
      openIssueItemsModal(issueButton.dataset.stationId);
    }
  });
}

function formatDateTimeLocal(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function restockStorageKey(itemId) {
  return `restock:lastCost:${itemId}`;
}

async function wireRestockForm() {
  const restockForm = document.querySelector('#restock-form');
   if (!restockForm) return;

  const codeInput = restockForm.querySelector('#restock-code');
  const itemIdInput = restockForm.querySelector('#restock-item-id');
  const summary = restockForm.querySelector('#restock-item-summary');
  const currentStockEl = restockForm.querySelector('#restock-current-stock');
  const resultEl = document.querySelector('#restock-result');
  const performedByInput = restockForm.querySelector('#restock-performed-by');
  const dateTimeInput = restockForm.querySelector('#restock-datetime');
  const unitCostInput = restockForm.querySelector('#restock-unit-cost');
  const followup = restockForm.querySelector('#barcode-followup');
  const skipBarcode = restockForm.querySelector('#skip-barcode-capture');
  const newBarcodeInput = restockForm.querySelector('#restock-new-barcode');
  const newBarcodeButton = restockForm.querySelector('#restock-add-barcode');
  const barcodeScanButton = restockForm.querySelector('#restock-scan-barcode');
  const qrScanButton = restockForm.querySelector('#restock-scan-qr');

  let activeItem = null;
  let scannedVia = '';

  const updateItemSummary = (item, sourceCode = '') => {
    if (!item) {
      activeItem = null;
      itemIdInput.value = '';
      currentStockEl.textContent = '—';
      summary.innerHTML = '<h3>Selected item</h3><p class="helper">Scan a code to load item details.</p>';
      followup.classList.add('hidden');
      return;
    }

    activeItem = item;
    itemIdInput.value = String(item.id);
    currentStockEl.textContent = `${item.total_quantity}`;
    summary.innerHTML = `
      <h3>Selected item</h3>
      <div><strong>${item.name}</strong> (${item.sku})</div>
      <div class="helper">Matched by: ${sourceCode || 'code lookup'}</div>
    `;

    const rememberedCost = window.localStorage.getItem(restockStorageKey(item.id));
    unitCostInput.value = rememberedCost ?? String(Number(item.unit_cost || 0) || '');

    const matchedQr = String(sourceCode || '').trim().toLowerCase() === String(item.qr_code || '').trim().toLowerCase();
    if (matchedQr || scannedVia === 'qr') {
      followup.classList.remove('hidden');
    } else {
      followup.classList.add('hidden');
    }
  };

  const lookupByCode = async (code) => {
    const trimmed = (code || '').trim();
    if (!trimmed) {
      updateItemSummary(null);
      return;
    }

    const localItem = findItemByCode(trimmed);
    if (localItem) {
      updateItemSummary(localItem, trimmed);
      return;
    }

    try {
      const data = await fetchJson(`/api/scan?code=${encodeURIComponent(trimmed)}`);
      updateItemSummary(data.item, trimmed);
    } catch {
      updateItemSummary(null);
      showToast('No matching inventory item for that code.', true);
    }
  };

  const runScan = async (mode) => {
    try {
      const code = await scanCodeWithCamera(mode === 'qr' ? 'Scan item QR code' : 'Scan item barcode');
      scannedVia = mode;
      codeInput.value = code;
      await lookupByCode(code);
      showToast('Item code captured and matched.');
    } catch (error) {
      showToast(error.message, true);
    }
  };

  barcodeScanButton?.addEventListener('click', () => runScan('barcode'));
  qrScanButton?.addEventListener('click', () => runScan('qr'));

  codeInput.addEventListener('change', () => {
    scannedVia = '';
    lookupByCode(codeInput.value).catch((error) => showToast(error.message, true));
  });

  skipBarcode.addEventListener('change', () => {
    const disabled = skipBarcode.checked;
    newBarcodeInput.disabled = disabled;
    newBarcodeButton.disabled = disabled;
    if (disabled) newBarcodeInput.value = '';
  });
  skipBarcode.dispatchEvent(new Event('change'));

  newBarcodeButton?.addEventListener('click', async () => {
    if (skipBarcode.checked) return;
    try {
      const newCode = await scanCodeWithCamera('Scan new barcode for this item');
      newBarcodeInput.value = newCode;
      showToast('New barcode captured.');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  dateTimeInput.value = formatDateTimeLocal();
  performedByInput.value = window.localStorage.getItem('restock:lastPerformer') || '';

  restockForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = formToPayload(restockForm);
    payload.mode = 'restock';
    payload.skipBarcodeCapture = skipBarcode.checked ? 'true' : 'false';
    payload.source = payload.code ? 'scan' : 'manual';
    if (!payload.itemId) delete payload.itemId;
    if (!payload.code) delete payload.code;
    try {
      const response = await fetchJson('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (activeItem && payload.unitCost !== '') {
        window.localStorage.setItem(restockStorageKey(activeItem.id), payload.unitCost);
      }
      window.localStorage.setItem('restock:lastPerformer', payload.performedBy || '');

      const previous = response.previousTotalQuantity;
      const current = response.newTotalQuantity;
      resultEl.textContent = Number.isFinite(previous) && Number.isFinite(current)
        ? `Restock complete: ${activeItem?.name || 'Item'} moved from ${previous} to ${current} in stock.`
        : 'Restock complete.';
      
      await loadBootstrap();
      renderRestockPage();
      dateTimeInput.value = formatDateTimeLocal();
      showToast('Inventory restocked.');
      updateItemSummary(response.item || null, codeInput.value);
      currentStockEl.textContent = `${response.newTotalQuantity}`;
    } catch (error) {
      showToast(error.message, true);
    }
  });
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

function renderRecentStationRequests(stationCode) {
  const target = document.querySelector('#recent-requests');
  if (!target) return;
  const station = state.stations.find((entry) => entry.code === stationCode);
  if (!station) return;
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const requests = state.stationRequests
    .filter((request) => Number(request.station_id) === Number(station.id))
    .filter((request) => new Date(request.created_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!requests.length) {
    target.innerHTML = '<p class="helper">No requests for this station in the past 30 days.</p>';
    return;
  }
  
target.innerHTML = requests.map((request) => {
    const completed = Boolean(request.completed_at);
    const items = Array.isArray(request.requested_items) ? request.requested_items : [];
    return `
      <article class="request-history-card ${completed ? 'request-history-card--complete' : 'request-history-card--pending'}">
        <strong>${completed ? 'Completed request' : 'Pending request'}</strong>
        <ul>
          ${items.map((item) => `<li>${escapeHtml(item.name)}: <strong>${escapeHtml(item.quantity)}</strong></li>`).join('')}
        </ul>
        <p class="helper">Requested: ${new Date(request.created_at).toLocaleString()} · by ${escapeHtml(request.requester_name)}</p>
        ${completed
          ? `<p class="helper">Completed: ${new Date(request.completed_at).toLocaleString()} · by ${escapeHtml(request.completed_by || 'Unknown')}</p>`
          : '<p class="helper">Completion: still pending</p>'}
      </article>
    `;
  }).join('');
}

function openRequestItemModal(stationCode) {
  const addedItems = [];
  let activeItem = null;
  let scannedCode = '';
  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  overlay.innerHTML = `
    <div class="scanner-modal__card">
      <h3>Request inventory item</h3>
      <label>Requested by
        <input type="text" name="requesterName" placeholder="Name" required />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="noCode" />
        I do not have the QR code or barcode
      </label>
      <div data-role="scanBlock" class="stack compact">
        <button type="button" class="secondary" data-action="scan">Scan QR or barcode</button>
      </div>
      <label data-role="pickerBlock" class="hidden">Select inventory item
        <select name="manualItem">${itemOptions(state.items)}</select>
      </label>
      <div data-role="itemInfo" class="restock-item-summary hidden"></div>
      <label>Amount requesting
        <input type="number" min="1" value="1" name="requestQty" />
      </label>
      <div class="inline-actions">
        <button type="button" data-action="add">Add item</button>
        <button type="button" data-action="submit" class="secondary">Submit request</button>
      </div>
      <button type="button" data-action="cancel" class="danger">Cancel</button>
      <div data-role="cancelConfirm" class="hidden restock-followup stack compact">
        <p>Canceling request.</p>
        <div class="inline-actions">
          <button type="button" data-action="goBack" class="request-success">Go back to request</button>
          <button type="button" data-action="confirmCancel" class="danger">Yes cancel the request</button>
        </div>
      </div>
      <div data-role="requestItems" class="stack compact"></div>
    </div>
  `;
  document.body.appendChild(overlay);

   const close = () => overlay.remove();
  const requesterInput = overlay.querySelector('input[name="requesterName"]');
  const noCodeInput = overlay.querySelector('input[name="noCode"]');
  const pickerBlock = overlay.querySelector('[data-role="pickerBlock"]');
  const scanBlock = overlay.querySelector('[data-role="scanBlock"]');
  const manualItemSelect = overlay.querySelector('select[name="manualItem"]');
  const itemInfo = overlay.querySelector('[data-role="itemInfo"]');
  const qtyInput = overlay.querySelector('input[name="requestQty"]');
  const requestItemsEl = overlay.querySelector('[data-role="requestItems"]');
  const cancelConfirm = overlay.querySelector('[data-role="cancelConfirm"]');

  const renderAddedItems = () => {
    requestItemsEl.innerHTML = addedItems.length
      ? `<strong>Items in request</strong><ul>${addedItems.map((entry) => `<li>${escapeHtml(entry.name)}: ${entry.quantity}</li>`).join('')}</ul>`
      : '<p class="helper">No items added yet.</p>';
  };

  const updateActiveItemDisplay = () => {
    if (!activeItem) {
      itemInfo.classList.add('hidden');
      itemInfo.innerHTML = '';
      return;
    }
    itemInfo.classList.remove('hidden');
    itemInfo.innerHTML = `
      <strong>${escapeHtml(activeItem.name)}</strong>
      <p class="helper">SKU: ${escapeHtml(activeItem.sku)} · On hand: ${activeItem.total_quantity}</p>
      ${scannedCode ? `<p class="helper">Scanned code: ${escapeHtml(scannedCode)}</p>` : ''}
    `;
  };

  renderAddedItems();

  noCodeInput.addEventListener('change', () => {
    const useDropdown = noCodeInput.checked;
    pickerBlock.classList.toggle('hidden', !useDropdown);
    scanBlock.classList.toggle('hidden', useDropdown);
    activeItem = null;
    scannedCode = '';
    manualItemSelect.value = '';
    updateActiveItemDisplay();
  });

  overlay.querySelector('[data-action="scan"]').addEventListener('click', async () => {
    try {
      scannedCode = await scanCodeWithCamera('Scan request item');
      const response = await fetchJson(`/api/scan?code=${encodeURIComponent(scannedCode)}`);
      activeItem = response.item || null;
      updateActiveItemDisplay();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  manualItemSelect.addEventListener('change', () => {
    activeItem = state.items.find((item) => String(item.id) === String(manualItemSelect.value)) || null;
    scannedCode = '';
    updateActiveItemDisplay();
  });

  overlay.querySelector('[data-action="add"]').addEventListener('click', () => {
    if (!activeItem) {
      showToast('Select or scan an inventory item first.', true);
      return;
    }
    const qty = Number.parseInt(qtyInput.value || '0', 10);
    if (!qty || qty <= 0) {
      showToast('Enter a valid quantity.', true);
      return;
    }
    const existing = addedItems.find((item) => item.name === activeItem.name);
    if (existing) existing.quantity += qty;
    else addedItems.push({ name: activeItem.name, quantity: qty });
    qtyInput.value = '1';
    activeItem = null;
    scannedCode = '';
    manualItemSelect.value = '';
    updateActiveItemDisplay();
    renderAddedItems();
    showToast('Item added to request.');
  });

  overlay.querySelector('[data-action="submit"]').addEventListener('click', async () => {
    const requesterName = requesterInput.value.trim();
    if (!requesterName) {
      showToast('Enter who is sending the request.', true);
      return;
    }
    if (!addedItems.length) {
      showToast('Add at least one item before submitting.', true);
      return;
    }
    try {
      await fetchJson('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stationCode,
          requesterName,
          items: addedItems,
          otherItems: '',
        }),
      });
      close();
      await loadBootstrap();
      renderRecentStationRequests(stationCode);
      showToast('Request submitted to supply officer.');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    cancelConfirm.classList.remove('hidden');
  });
  overlay.querySelector('[data-action="goBack"]').addEventListener('click', () => {
    cancelConfirm.classList.add('hidden');
  });
  overlay.querySelector('[data-action="confirmCancel"]').addEventListener('click', close);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
}

async function wireRequestPage() {
  const stationCode = document.body.dataset.station;
  renderRecentStationRequests(stationCode);
  document.querySelector('#open-request-modal')?.addEventListener('click', () => {
    openRequestItemModal(stationCode);
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
        await wireInventoryPage();
    }
    if (page === 'issue') {
      renderIssuePage();
      await wireIssueForm();
    }
    if (page === 'restock') {
      renderRestockPage();
      await wireRestockForm();
    }
    if (page === 'search') await wireSearchPage();
    if (page === 'request') await wireRequestPage();
    if (page === 'admin') await wireAdminPage();
  } catch (error) {
    showToast(error.message, true);
  }
})();
