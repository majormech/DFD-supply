const state = {
  items: [],
  stations: [],
  recentTransactions: [],
  activeScanTarget: null,
  activeScanFormat: null,
  stream: null,
  detector: null,
  scanTimer: null,
};

const els = {
  addItemForm: document.querySelector('#add-item-form'),
  issueForm: document.querySelector('#issue-form'),
  restockForm: document.querySelector('#restock-form'),
  issueStation: document.querySelector('#issue-station'),
  issueItem: document.querySelector('#issue-item'),
  restockItem: document.querySelector('#restock-item'),
  inventoryTable: document.querySelector('#inventory-table'),
  transactionList: document.querySelector('#transaction-list'),
  totalItemCount: document.querySelector('#total-item-count'),
  totalStockCount: document.querySelector('#total-stock-count'),
  toast: document.querySelector('#toast'),
  scannerDialog: document.querySelector('#scanner-dialog'),
  scannerVideo: document.querySelector('#scanner-video'),
  scannerStatus: document.querySelector('#scanner-status'),
  manualScanInput: document.querySelector('#manual-scan-input'),
  manualScanSubmit: document.querySelector('#manual-scan-submit'),
  scanAddBarcodeBtn: document.querySelector('#scan-add-barcode-btn'),
  scanAddQrBtn: document.querySelector('#scan-add-qr-btn'),
  scanIssueBtn: document.querySelector('#scan-issue-btn'),
  scanRestockBtn: document.querySelector('#scan-restock-btn'),
};

function describeScanTarget(target) {
  if (target === 'issue') return 'issue stock';
  if (target === 'restock') return 'restock inventory';
  if (target === 'add-barcode') return 'save a barcode for the new item';
  if (target === 'add-qr') return 'save a QR code for the new item';
  return 'scan a code';
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.background = isError ? '#c13737' : '#142033';
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove('show'), 2600);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function itemOptionsMarkup(items) {
  const options = ['<option value="">Select an item</option>'];
  for (const item of items) {
    options.push(`<option value="${item.id}">${item.name} · ${item.sku} · ${item.total_quantity} in stock</option>`);
  }
  return options.join('');
}

function stationOptionsMarkup(stations) {
  return ['<option value="">Select a station</option>', ...stations.map((station) => `<option value="${station.id}">${station.name}</option>`)].join('');
}

function renderInventory() {
  els.totalItemCount.textContent = `${state.items.length} items`;
  els.totalStockCount.textContent = `${state.items.reduce((sum, item) => sum + item.total_quantity, 0)} total units`;
  els.issueItem.innerHTML = itemOptionsMarkup(state.items);
  els.restockItem.innerHTML = itemOptionsMarkup(state.items);
  els.issueStation.innerHTML = stationOptionsMarkup(state.stations);

  els.inventoryTable.innerHTML = state.items.length
    ? state.items.map((item) => {
        const stations = item.station_breakdown.length
          ? item.station_breakdown
              .filter((entry) => entry.quantity > 0)
              .map((entry) => `<span class="pill">${entry.stationName}: ${entry.quantity}</span>`)
              .join('')
          : '<span class="helper">No station allocations yet.</span>';
        return `
          <tr>
            <td><strong>${item.name}</strong><div class="helper">${item.description || 'No description'}</div></td>
            <td>${item.sku}</td>
            <td>${item.total_quantity}</td>
            <td>${item.barcode || item.qr_code || 'Not assigned'}</td>
            <td><div class="station-pills">${stations}</div></td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="5">No items have been added yet.</td></tr>';
}

function renderTransactions() {
  els.transactionList.innerHTML = state.recentTransactions.length
    ? state.recentTransactions.map((txn) => `
        <article class="txn">
          <strong>${txn.item_name} (${txn.item_sku})</strong>
          <div class="${txn.quantity_delta >= 0 ? 'delta-positive' : 'delta-negative'}">
            ${txn.quantity_delta >= 0 ? '+' : ''}${txn.quantity_delta} · ${txn.action_type} via ${txn.source}
          </div>
          <div class="helper">${txn.station_name || 'Main inventory only'} · ${new Date(txn.created_at).toLocaleString()}</div>
          ${txn.note ? `<div>${txn.note}</div>` : ''}
        </article>`).join('')
    : '<p class="helper">No inventory activity recorded yet.</p>';
}

async function refresh() {
  const data = await fetchJson('/api/bootstrap');
  state.items = data.items;
  state.stations = data.stations;
  state.recentTransactions = data.recentTransactions;
  renderInventory();
  renderTransactions();
}

function formToPayload(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

async function submitAdjustment(form, mode, source = 'manual') {
  const payload = formToPayload(form);
  payload.mode = mode;
  payload.source = source;
  if (!payload.itemId) delete payload.itemId;
  if (!payload.code) delete payload.code;
  await fetchJson('/api/inventory/adjust', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  form.reset();
  await refresh();
  showToast(mode === 'issue' ? 'Inventory issued to station.' : 'Inventory restocked.');
}

async function handleCodeFill(targetForm, code, mode) {
  const lookup = await fetchJson(`/api/scan?code=${encodeURIComponent(code)}`);
  targetForm.querySelector('input[name="code"]').value = code;
  targetForm.querySelector('select[name="itemId"]').value = String(lookup.item.id);
  showToast(`Matched ${lookup.item.name}. Ready to ${mode === 'issue' ? 'issue' : 'restock'}.`);
}

async function createItem(event) {
  event.preventDefault();
  const payload = formToPayload(els.addItemForm);
  await fetchJson('/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  els.addItemForm.reset();
  await refresh();
  showToast('Inventory item created.');
}

async function onIssue(event) {
  event.preventDefault();
  await submitAdjustment(els.issueForm, 'issue', els.issueForm.querySelector('input[name="code"]').value ? 'scan' : 'manual');
}

async function onRestock(event) {
  event.preventDefault();
  await submitAdjustment(els.restockForm, 'restock', els.restockForm.querySelector('input[name="code"]').value ? 'scan' : 'manual');
}

async function startScanning(target) {
  state.activeScanTarget = target;
  state.activeScanFormat = null;
  els.manualScanInput.value = '';
  els.scannerStatus.textContent = `Opening scanner to ${describeScanTarget(target)}...`;
  els.scannerDialog.showModal();

  if (!('BarcodeDetector' in window)) {
    els.scannerStatus.textContent = `BarcodeDetector is not available in this browser. Enter the code manually below to ${describeScanTarget(target)}.`;
    return;
  }

  try {
    state.detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    els.scannerVideo.srcObject = state.stream;
    els.scannerStatus.textContent = `Point the camera at a barcode or QR code to ${describeScanTarget(target)}.`;
    scanLoop();
  } catch (error) {
   els.scannerStatus.textContent = `Camera unavailable: ${error.message}. You can enter the code manually below to ${describeScanTarget(target)}.`;
  }
}

async function scanLoop() {
  if (!state.detector || !els.scannerDialog.open) return;
  try {
    const barcodes = await state.detector.detect(els.scannerVideo);
    if (barcodes[0]?.rawValue) {
      els.manualScanInput.value = barcodes[0].rawValue;
      state.activeScanFormat = barcodes[0].format || null;
      await applyScannedCode();
      return;
    }
  } catch {
    // Continue polling while the video warms up.
  }
  state.scanTimer = window.setTimeout(scanLoop, 500);
}

function stopScanning() {
  if (state.scanTimer) window.clearTimeout(state.scanTimer);
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
  }
  state.scanTimer = null;
  state.stream = null;
  state.detector = null;
  tate.activeScanFormat = null;
  els.scannerVideo.srcObject = null;
  els.scannerStatus.textContent = '';
}

async function applyScannedCode() {
  const code = els.manualScanInput.value.trim();
  if (!code || !state.activeScanTarget) return;
  if ((state.activeScanTarget === 'add-barcode' || state.activeScanTarget === 'add-qr') && state.activeScanFormat) {
    const scannedQr = state.activeScanFormat === 'qr_code';
    if ((state.activeScanTarget === 'add-barcode' && scannedQr) || (state.activeScanTarget === 'add-qr' && !scannedQr)) {
      throw new Error(`Detected a ${scannedQr ? 'QR code' : 'barcode'}. Use the matching save button or enter the value manually.`);
    }
  }
  if (state.activeScanTarget === 'issue' || state.activeScanTarget === 'restock') {
    const targetForm = state.activeScanTarget === 'issue' ? els.issueForm : els.restockForm;
    await handleCodeFill(targetForm, code, state.activeScanTarget);
  } else {
    const fieldName = state.activeScanTarget === 'add-barcode' ? 'barcode' : 'qrCode';
    els.addItemForm.querySelector(`input[name="${fieldName}"]`).value = code;
    showToast(state.activeScanTarget === 'add-barcode' ? 'Barcode saved for the new item.' : 'QR code saved for the new item.');
  }
  els.scannerDialog.close();
  stopScanning();
}

function wireEvents() {
  els.addItemForm.addEventListener('submit', (event) => createItem(event).catch((error) => showToast(error.message, true)));
  els.issueForm.addEventListener('submit', (event) => onIssue(event).catch((error) => showToast(error.message, true)));
  els.restockForm.addEventListener('submit', (event) => onRestock(event).catch((error) => showToast(error.message, true)));
  els.scanAddBarcodeBtn.addEventListener('click', () => startScanning('add-barcode').catch((error) => showToast(error.message, true)));
  els.scanAddQrBtn.addEventListener('click', () => startScanning('add-qr').catch((error) => showToast(error.message, true)));
  els.scanIssueBtn.addEventListener('click', () => startScanning('issue').catch((error) => showToast(error.message, true)));
  els.scanRestockBtn.addEventListener('click', () => startScanning('restock').catch((error) => showToast(error.message, true)));
  els.manualScanSubmit.addEventListener('click', (event) => {
    event.preventDefault();
    applyScannedCode().catch((error) => showToast(error.message, true));
  });
  els.scannerDialog.addEventListener('close', stopScanning);

  for (const form of [els.issueForm, els.restockForm]) {
    form.querySelector('input[name="code"]').addEventListener('change', async (event) => {
      if (!event.target.value.trim()) return;
      const mode = form === els.issueForm ? 'issue' : 'restock';
      try {
        await handleCodeFill(form, event.target.value.trim(), mode);
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }
}

wireEvents();
refresh().catch((error) => showToast(error.message, true));
