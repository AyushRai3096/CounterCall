'use strict';

const UNCONFIRMED_TIMEOUT_MS = 15000;

const els = {
  connectionDot: document.getElementById('connection-dot'),
  restaurantSelect: document.getElementById('restaurant-select'),
  orderNumber: document.getElementById('order-number'),
  itemSearch: document.getElementById('item-search'),
  itemResults: document.getElementById('item-results'),
  sizeOptions: document.getElementById('size-options'),
  qtyValue: document.getElementById('qty-value'),
  qtyMinus: document.getElementById('qty-minus'),
  qtyPlus: document.getElementById('qty-plus'),
  itemNote: document.getElementById('item-note'),
  addItemBtn: document.getElementById('add-item-btn'),
  cartList: document.getElementById('cart-list'),
  submitOrderBtn: document.getElementById('submit-order-btn'),
  ordersList: document.getElementById('orders-list'),
};

// { restaurants: ["Name", ...], items: [{ id, name }, ...] } — loaded
// from menu.json, which is the only thing that needs editing when the
// menu (items OR the list of restaurants) changes. No code change needed.
let restaurantNames = [];
let menuItems = [];
let selectedRestaurant = null;
let selectedMenuItem = null;
let selectedSize = null;
let qty = 1;
// Items added to the order being built: [{ name, size, qty, note }]
let cart = [];
// orderId -> { orderId, restaurant, orderNumber, items, status, message, sentAt, timeoutId }
const orders = new Map();

// crypto.randomUUID() only exists in secure contexts (https:// or
// localhost). Accessing the PWA over plain http://<lan-ip> from a phone
// is not a secure context, so it's undefined there — fall back to a
// Math.random-based id. Not cryptographically random, but this is just
// an identifier for routing, not a security token.
function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getDeviceId() {
  const key = 'countercall_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

// ---------- Restaurant + menu ----------
// Restaurants and items are independent of each other: the item catalog
// is shared across every restaurant, not tagged per-restaurant. The
// restaurant field is just which of the two brands this order is for.

async function loadMenu() {
  try {
    const res = await fetch('menu.json', { cache: 'no-store' });
    const data = await res.json();
    restaurantNames = Array.isArray(data.restaurants) ? data.restaurants : [];
    menuItems = Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    console.warn('Could not load menu.json — typed item names will still work.', err);
    restaurantNames = [];
    menuItems = [];
  }
  populateRestaurantOptions();
}

function populateRestaurantOptions() {
  els.restaurantSelect.innerHTML = '';

  if (restaurantNames.length === 0) {
    // No menu loaded at all — don't gate submission on a restaurant
    // choice that has nothing to choose from.
    els.restaurantSelect.disabled = true;
    selectedRestaurant = null;
    return;
  }

  els.restaurantSelect.disabled = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select restaurant --';
  els.restaurantSelect.appendChild(placeholder);

  for (const name of restaurantNames) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    els.restaurantSelect.appendChild(opt);
  }
}

els.restaurantSelect.addEventListener('change', () => {
  selectedRestaurant = els.restaurantSelect.value || null;
  updateSubmitButtonState();
});
els.orderNumber.addEventListener('input', updateSubmitButtonState);

// The item field never blocks on a menu match — whatever is typed is used
// as the item name. The dropdown is just a type-ahead convenience on top.
// Every item is half/full, so there's no per-item size list to track.
const SIZES = ['half', 'full'];

function renderItemResults(query) {
  const q = query.trim().toLowerCase();
  els.itemResults.innerHTML = '';

  if (!q) {
    els.itemResults.hidden = true;
    return;
  }

  const matches = menuItems.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 20);

  if (matches.length === 0) {
    els.itemResults.hidden = true;
    return;
  }

  for (const item of matches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.name;
    btn.addEventListener('click', () => selectMenuItem(item));
    els.itemResults.appendChild(btn);
  }
  els.itemResults.hidden = false;
}

function selectMenuItem(item) {
  selectedMenuItem = item;
  els.itemSearch.value = item.name;
  els.itemResults.hidden = true;
  updateSubmitButtonState();
}

function renderSizeOptions() {
  els.sizeOptions.innerHTML = '';

  for (const size of SIZES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'radio';
    btn.textContent = size === 'half' ? 'Half' : 'Full';
    btn.setAttribute('aria-checked', String(size === selectedSize));
    btn.addEventListener('click', () => {
      selectedSize = size;
      renderSizeOptions();
      updateSubmitButtonState();
    });
    els.sizeOptions.appendChild(btn);
  }
}

// The entry form currently holds a complete item (name typed + size chosen).
function entryReady() {
  return !!(els.itemSearch.value.trim() && selectedSize);
}

function updateSubmitButtonState() {
  // Restaurant and order number belong to the whole order, not to each item.
  const restaurantOk = restaurantNames.length === 0 || (!!selectedRestaurant && !!els.orderNumber.value.trim());
  els.addItemBtn.disabled = !entryReady();
  // A complete entry that hasn't been added yet is sent along with the cart.
  els.submitOrderBtn.disabled = !(restaurantOk && (cart.length > 0 || entryReady()));
}

els.itemSearch.addEventListener('input', () => {
  selectedMenuItem = null;
  updateSubmitButtonState();
  renderItemResults(els.itemSearch.value);
});

document.addEventListener('click', (e) => {
  if (!els.itemResults.contains(e.target) && e.target !== els.itemSearch) {
    els.itemResults.hidden = true;
  }
});

// ---------- Quantity stepper ----------

function renderQty() {
  els.qtyValue.textContent = String(qty);
  els.qtyMinus.disabled = qty <= 1;
}

els.qtyMinus.addEventListener('click', () => {
  if (qty > 1) qty -= 1;
  renderQty();
});
els.qtyPlus.addEventListener('click', () => {
  qty += 1;
  renderQty();
});

// Turns whatever is in the entry form into an item and clears the form for the next one.
function takeEntry() {
  const item = {
    name: els.itemSearch.value.trim(),
    size: selectedSize,
    qty,
    note: els.itemNote.value.trim() || undefined,
  };
  selectedMenuItem = null;
  selectedSize = null;
  qty = 1;
  els.itemSearch.value = '';
  els.itemNote.value = '';
  els.itemResults.hidden = true;
  renderSizeOptions();
  renderQty();
  return item;
}

els.addItemBtn.addEventListener('click', () => {
  if (!entryReady()) return;
  cart.push(takeEntry());
  renderCart();
  updateSubmitButtonState();
});

function renderCart() {
  els.cartList.innerHTML = '';

  if (cart.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = 'No items added yet.';
    els.cartList.appendChild(li);
    return;
  }

  cart.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'cart-item';

    const info = document.createElement('div');
    info.className = 'order-item-info';
    const name = document.createElement('span');
    name.className = 'order-item-name';
    name.textContent = `${item.qty}x ${item.name} (${item.size})`;
    info.appendChild(name);
    if (item.note) {
      const note = document.createElement('span');
      note.className = 'order-item-meta';
      note.textContent = item.note;
      info.appendChild(note);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove ${item.name}`);
    removeBtn.addEventListener('click', () => {
      cart.splice(index, 1);
      renderCart();
      updateSubmitButtonState();
    });

    li.append(info, removeBtn);
    els.cartList.appendChild(li);
  });
}

// ---------- Order submission + status tracking ----------

els.submitOrderBtn.addEventListener('click', () => {
  // Include a complete item still sitting in the form, so forgetting to tap
  // "Add item" for the last one doesn't drop it.
  const items = [...cart];
  if (entryReady()) items.push(takeEntry());
  if (items.length === 0) return;
  cart = [];

  const orderId = generateId();
  const order = {
    orderId,
    restaurant: selectedRestaurant || undefined,
    orderNumber: els.orderNumber.value.trim() || undefined,
    items,
    createdAt: new Date().toISOString(),
  };

  const record = { orderId, restaurant: selectedRestaurant, orderNumber: order.orderNumber, items, status: 'sent', sentAt: Date.now() };
  record.timeoutId = setTimeout(() => flagUnconfirmed(orderId), UNCONFIRMED_TIMEOUT_MS);
  orders.set(orderId, record);

  // Rendering the order and resetting the form must happen even if the
  // relay connection is down or socket.io failed to load — the 15s
  // "not confirmed" warning is what's supposed to surface that problem,
  // not a silently-inert Send button.
  if (socket) {
    try {
      socket.emit('order:submit', order);
    } catch (err) {
      console.error('Failed to send order:', err);
    }
  } else {
    console.error('No relay connection available — order kept locally only.');
  }

  // A new order needs its own number; the restaurant stays selected.
  els.orderNumber.value = '';
  renderCart();
  updateSubmitButtonState();
  renderOrders();
});

function flagUnconfirmed(orderId) {
  const record = orders.get(orderId);
  if (!record || record.status !== 'sent') return; // already advanced past 'sent'
  record.unconfirmed = true;
  renderOrders();
}

function updateOrderStatus(orderId, status, message) {
  const record = orders.get(orderId);
  if (!record) return;
  clearTimeout(record.timeoutId);
  record.status = status;
  record.message = message;
  record.unconfirmed = false;
  renderOrders();
}

function renderOrders() {
  els.ordersList.innerHTML = '';

  const list = Array.from(orders.values()).sort((a, b) => b.sentAt - a.sentAt);
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = 'Nothing sent yet.';
    els.ordersList.appendChild(li);
    return;
  }

  for (const record of list) {
    const li = document.createElement('li');
    li.className = 'order-item';

    const info = document.createElement('div');
    info.className = 'order-item-info';
    const name = document.createElement('span');
    name.className = 'order-item-name';
    const restaurantPrefix = (record.restaurant ? `[${record.restaurant}] ` : '') + (record.orderNumber ? `#${record.orderNumber} ` : '');
    name.textContent = restaurantPrefix + record.items.map((i) => `${i.qty}x ${i.name} (${i.size})`).join(', ');
    const meta = document.createElement('span');
    meta.className = 'order-item-meta';
    meta.textContent = record.items.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`).join(' · ') || '—';
    info.append(name, meta);

    if (record.unconfirmed) {
      const warn = document.createElement('div');
      warn.className = 'warning-banner';
      warn.textContent = '⚠️ Not confirmed — call manager';
      info.appendChild(warn);
    } else if (record.status === 'error') {
      const warn = document.createElement('div');
      warn.className = 'warning-banner';
      warn.textContent = record.message || 'Printing failed — call manager';
      info.appendChild(warn);
    }

    const pill = document.createElement('span');
    pill.className = `status-pill status-${record.status}`;
    pill.textContent = statusLabel(record.status);

    li.append(info, pill);
    els.ordersList.appendChild(li);
  }
}

function statusLabel(status) {
  switch (status) {
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered to counter';
    case 'printed': return 'Printed';
    case 'error': return 'Needs attention';
    default: return status;
  }
}

// ---------- Init ----------
// Runs first and unconditionally, so the form/orders list/steppers all
// work even if the socket connection below fails to set up at all (e.g.
// the local socket.io script didn't load).

loadMenu();
renderQty();
renderSizeOptions();
renderCart();
renderOrders();

// ---------- Socket connection ----------

let socket = null;
try {
  const deviceId = getDeviceId();
  socket = io(window.COUNTERCALL_CONFIG.relayUrl, {
    query: { role: 'pwa', deviceId },
  });

  socket.on('connect', () => {
    els.connectionDot.classList.remove('dot-offline');
    els.connectionDot.classList.add('dot-online');
  });
  socket.on('disconnect', () => {
    els.connectionDot.classList.remove('dot-online');
    els.connectionDot.classList.add('dot-offline');
  });
  socket.on('order:delivered', ({ orderId }) => updateOrderStatus(orderId, 'delivered'));
  socket.on('order:printed', ({ orderId }) => updateOrderStatus(orderId, 'printed'));
  socket.on('order:error', ({ orderId, message }) => updateOrderStatus(orderId, 'error', message));
} catch (err) {
  console.error('Could not set up relay connection — check that vendor/socket.io.min.js loaded and config.js has the right relayUrl.', err);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
