/* Studio Square — orders data source for admin.html.

   Backed by the Google Apps Script web app (Sheets + private Drive). The
   admin password is never in this file: it is posted to the script, which
   checks it against a script property and returns a token. The token lives
   in localStorage and is sent with every later request.

     POST { action:"login", password }        -> { ok, token }
     GET  ?action=list&token=…                -> { orders: [ …order ] }
     GET  ?action=photos&id=…&token=…         -> { photos: [ { name, url, copies } ] }
     POST { action:"status", id, status, token }
     POST { action:"delete", id, token }      also trashes the Drive folder
     POST { action:"notify", id, title, body, token }

   order = { id, created_at (ISO), full_name, phone, address, note,
             photo_format, photo_count (distinct photos),
             copies_total (sum of per-photo copies), total_price,
             status: "novo" | "priprema" | "gotovo", spec, folder_url }      */
(function () {
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycby2EHvqj9bgwzAS94HstBHSFWyynRdle8XhLm9XPMJMxilnCJxaIY61Cmro8GHqbpQzIQ/exec';
  var POLL_MS = 15000;
  var KEY = 'ss-admin-token';

  function token() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  /* Apps Script answers authorization and runtime problems with an HTML page,
     not JSON, so parse defensively and report what actually came back. */
  async function parse(res, what) {
    var txt = await res.text();
    if (!res.ok) throw new Error(what + ': server ' + res.status);
    var data;
    try { data = JSON.parse(txt); }
    catch (e) {
      console.error('SS_ORDERS ' + what + ' — odgovor nije JSON:', txt.slice(0, 400));
      throw new Error(what + ': server nije vratio JSON (verovatno Apps Script nije autorizovan — otvorite skriptu i pokrenite je jednom ručno).');
    }
    if (!data.ok) throw new Error(data.error || (what + ': greška na serveru'));
    return data;
  }

  /* Apps Script answers every call with a redirect to a one-time result URL
     on googleusercontent.com. When two calls overlap (a poll and a click),
     or the result URL is fetched a moment late, Google returns 404 for it
     even though the script itself ran fine. Those are safe to repeat: every
     admin action here is idempotent (list, photos, status, delete, notify). */
  async function fetchRetry(url, init) {
    var res;
    for (var attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url, Object.assign({ cache: 'no-store' }, init || {}));
      if (res.status !== 404 && res.status < 500) return res;
      await new Promise(function (r) { setTimeout(r, 400 * (attempt + 1)); });
    }
    return res;
  }

  async function post(payload) {
    var body = Object.assign({ token: token() }, payload);
    var res = await fetchRetry(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return parse(res, payload.action);
  }

  async function get(params) {
    var qs = Object.keys(params).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    /* a per-call nonce keeps each GET's result URL distinct */
    var res = await fetchRetry(ENDPOINT + '?' + qs + '&token=' + encodeURIComponent(token()) + '&_=' + Date.now());
    return parse(res, params.action);
  }

  async function login(password) {
    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'login', password: password })
    });
    var data = await parse(res, 'login');
    if (!data.token) throw new Error('Server nije vratio token — ponovo deploy-ujte Apps Script.');
    try { localStorage.setItem(KEY, data.token); }
    catch (e) { throw new Error('Pregledač blokira localStorage — isključite privatni režim ili blokadu kolačića.'); }
    if (!token()) throw new Error('Token nije sačuvan u pregledaču.');
    /* The login reply already carries the first page of orders, so the admin
       opens on one round trip instead of two. */
    if (data.orders) preloaded = data.orders;
    console.info('SS_ORDERS: prijava uspešna, token dužine', data.token.length);
    return { ok: true, orders: data.orders || null };
  }

  function logout() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  var preloaded = null;

  /* TEMP diagnostics — remove once photos show correctly. */
  function logOrders(src, orders, dbg) {
    console.groupCollapsed('SS_ORDERS [' + src + '] ' + (orders || []).length + ' porudžbina');
    if (dbg) console.info('sheet:', dbg.sheet, '| kolone:', dbg.columns);
    (orders || []).forEach(function (x) {
      console.info('order', x.id, '| folder:', x.folder_id || '(prazno)',
        '| fotografija:', x.photo_count, '| komada:', x.copies_total, '| spec:', x.spec);
    });
    console.groupEnd();
  }

  async function list() {
    if (preloaded) { var first = preloaded; preloaded = null; logOrders('login', first); return first; }
    var data = await get({ action: 'list' });
    logOrders('list', data.orders, data._debug);
    return data.orders || [];
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }

  /* Lists the order's folder, then pulls each photo on its own call (four at
     a time). Each photo becomes a local blob: URL, so the thumbnails, the
     single downloads and the ZIP all use the real JPG from Drive. */
  var photoCache = {};
  async function listPhotos(order) {
    if (photoCache[order.id]) return photoCache[order.id];
    var data = await get({ action: 'photos', id: order.id });
    console.info('SS_ORDERS photos | order:', data.orderId || order.id, '| Drive folder:', data.folderId,
      '| fajlova:', data.filesFound, '| komada:', data.copiesTotal, '| odgovor:', data);
    var items = data.photos || [];
    var out = new Array(items.length), next = 0;

    async function worker() {
      while (next < items.length) {
        var i = next++, p = items[i];
        var f = await get({ action: 'file', id: order.id, fileId: p.fileId });
        out[i] = {
          name: p.name,
          copies: p.copies || 1,
          fileId: p.fileId,
          url: URL.createObjectURL(b64ToBlob(f.data, f.mime))
        };
      }
    }
    var running = [];
    for (var w = 0; w < Math.min(4, items.length); w++) running.push(worker());
    await Promise.all(running);

    console.info('SS_ORDERS: porudžbina', order.id, '— fotografija na Drive-u:', out.length);
    photoCache[order.id] = out;
    return out;
  }

  async function setStatus(id, status) {
    return post({ action: 'status', id: id, status: status });
  }

  async function remove(id) {
    return post({ action: 'delete', id: id });
  }

  /* Tells the shop's backend the order is done, and shows the browser
     notification locally so the wording can be checked on the spot. */
  async function notifyReady(order) {
    var title = 'Studio Square';
    var body = '📸 Vaše fotografije su gotove! Porudžbina #' + order.id + ' je spremna za preuzimanje.';

    try { await post({ action: 'notify', id: order.id, title: title, body: body }); }
    catch (e) { console.error('notify:', e); }

    if (!('Notification' in window)) return { shown: false, body: body };
    var perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return { shown: false, body: body };

    var opts = { body: body, icon: './icon-192.png', badge: './icon-192.png', tag: 'order-' + order.id };
    try {
      var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) await reg.showNotification(title, opts);
      else new Notification(title, opts);
      return { shown: true, body: body };
    } catch (e) {
      console.error('notify:', e);
      return { shown: false, body: body };
    }
  }

  window.SS_ORDERS = {
    endpoint: ENDPOINT,
    login: login, logout: logout,
    isAuthed: function () { return !!token(); },
    list: list, listPhotos: listPhotos, setStatus: setStatus,
    remove: remove, notifyReady: notifyReady,
    pollMs: POLL_MS, isMock: false
  };
})();
