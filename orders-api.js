/* Studio Square — orders data source for admin.html, on Supabase.

   Same window.SS_ORDERS interface as before, so admin.html is unchanged.

   Login: Supabase Auth, email + password. The admin page only asks for the
   password; the email of the admin account comes from the database
   (rpc admin_email), so neither is written in this file. After login the
   account is checked against public.admins — any other account is refused.

   Orders come from "orders" with their "order_photos" in the same request.
   Photos are read from the private "photos" bucket through short-lived
   signed URLs, all signed in one call; nothing is loaded into memory until
   the page actually shows or downloads a photo.

   order = { id, created_at, full_name, phone, address, note,
             photo_format, quantity, photo_count, copies_total, total_price,
             status: "novo" | "priprema" | "gotovo", spec, folder_url }      */
(function () {
  var CFG = window.SS_SUPABASE || {};
  var URL_ = String(CFG.url || '').replace(/\/+$/, '');
  var KEY = CFG.key || '';
  var POLL_MS = 15000;
  var SESSION = 'ss-admin-session';
  var EMAIL = 'ss-admin-email';
  var SIGN_SECONDS = 60 * 60;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch (e) { return null; }
  }
  function writeSession(s) {
    try {
      if (s) localStorage.setItem(SESSION, JSON.stringify(s));
      else localStorage.removeItem(SESSION);
    } catch (e) {
      throw new Error('Pregledač blokira localStorage — isključite privatni režim ili blokadu kolačića.');
    }
  }
  function fromAuth(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
  }

  async function readError(res) {
    var txt = '';
    try { txt = await res.text(); } catch (e) {}
    try { var j = JSON.parse(txt); return j.message || j.error_description || j.msg || j.error || txt; }
    catch (e) { return txt || ('HTTP ' + res.status); }
  }

  async function auth(path, body) {
    var res = await fetch(URL_ + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var msg = await readError(res);
      var err = new Error(/invalid login|invalid_grant/i.test(msg) ? 'Pogrešna lozinka' : msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* A valid access token, refreshed shortly before it runs out. */
  var refreshing = null;
  async function accessToken() {
    var s = readSession();
    if (!s) throw new Error('unauthorized');
    if (Date.now() < s.expires_at - 60000) return s.access_token;
    if (!refreshing) {
      refreshing = auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
        .then(function (d) { writeSession(fromAuth(d)); return d.access_token; })
        .catch(function () { writeSession(null); throw new Error('unauthorized'); })
        .finally(function () { refreshing = null; });
    }
    return refreshing;
  }

  /* Authenticated call; a 401 once triggers a refresh and one retry. */
  async function api(path, init, retried) {
    var tok = await accessToken();
    var opts = Object.assign({}, init || {});
    opts.headers = Object.assign({ apikey: KEY, Authorization: 'Bearer ' + tok }, opts.headers || {});
    var res = await fetch(URL_ + path, opts);
    if (res.status === 401 && !retried) {
      var s = readSession();
      if (s) { s.expires_at = 0; writeSession(s); }
      return api(path, init, true);
    }
    if (res.status === 401) { writeSession(null); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error(await readError(res));
    return res;
  }

  async function adminEmail() {
    try { var cached = localStorage.getItem(EMAIL); if (cached) return cached; } catch (e) {}
    var res = await fetch(URL_ + '/rest/v1/rpc/admin_email', {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!res.ok) throw new Error(await readError(res));
    var email = await res.json();
    if (!email) throw new Error('Admin nalog nije podešen u bazi (public.admins).');
    try { localStorage.setItem(EMAIL, email); } catch (e) {}
    return email;
  }

  async function login(password) {
    if (!URL_ || !KEY || /UNESITE/.test(KEY)) throw new Error('Supabase nije podešen (supabase.js).');
    var email = await adminEmail();
    var data;
    try {
      data = await auth('token?grant_type=password', { email: email, password: password });
    } catch (e) {
      /* the admin account may have changed — look the email up again once */
      try { localStorage.removeItem(EMAIL); } catch (x) {}
      var fresh = await adminEmail();
      if (fresh === email) throw e;
      data = await auth('token?grant_type=password', { email: fresh, password: password });
    }
    writeSession(fromAuth(data));

    /* Admin check and the first list in parallel: one round trip of waiting. */
    var both = await Promise.all([
      api('/rest/v1/rpc/is_admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json(); }),
      fetchOrders()
    ]);
    if (both[0] !== true) {
      writeSession(null);
      throw new Error('Ovaj nalog nema pristup adminu.');
    }
    preloaded = both[1];
    return { ok: true, orders: both[1] };
  }

  function logout() {
    var s = readSession();
    writeSession(null);
    if (s && s.access_token) {
      fetch(URL_ + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } })
        .catch(function () {});
    }
  }

  /* ---- orders ---- */

  var byId = {};

  function toOrder(r) {
    var photos = (r.order_photos || []).slice().sort(function (a, b) {
      return a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0;
    });
    var spec = photos.map(function (p) { return Number(p.copies) || 1; });
    var sum = spec.reduce(function (a, b) { return a + b; }, 0);
    var o = {
      id: String(r.id),
      created_at: r.created_at,
      full_name: r.full_name || '',
      phone: r.phone || '',
      address: r.address || '',
      note: r.note || '',
      photo_format: r.format || '',
      quantity: Number(r.quantity) || 0,
      photo_count: Number(r.photo_count) || photos.length,
      copies_total: Number(r.copies_total) || Number(r.quantity) || sum,
      total_price: Number(r.total_price) || 0,
      status: r.status || 'novo',
      spec: spec,
      folder_url: ''
    };
    byId[o.id] = { order: o, photos: photos };
    return o;
  }

  async function fetchOrders() {
    var res = await api('/rest/v1/orders?select=*,order_photos(id,file_path,file_name,copies)' +
      '&status=neq.upload&order=created_at.desc');
    return (await res.json()).map(toOrder);
  }

  var preloaded = null;
  async function list() {
    if (preloaded) { var first = preloaded; preloaded = null; return first; }
    return fetchOrders();
  }

  /* ---- photos: signed URLs from the private bucket ---- */

  var photoCache = {};
  var photoLoading = {};

  function listPhotos(order) {
    var hit = photoCache[order.id];
    if (hit && Date.now() < hit.until) return Promise.resolve(hit.list);
    if (!photoLoading[order.id]) {
      photoLoading[order.id] = loadPhotos(order).finally(function () { delete photoLoading[order.id]; });
    }
    return photoLoading[order.id];
  }

  async function photoRows(id) {
    if (byId[id] && byId[id].photos.length) return byId[id].photos;
    var res = await api('/rest/v1/order_photos?select=id,file_path,file_name,copies&order_id=eq.' +
      encodeURIComponent(id) + '&order=file_path.asc');
    return res.json();
  }

  async function loadPhotos(order) {
    var rows = await photoRows(order.id);
    if (!rows.length) { photoCache[order.id] = { list: [], until: Date.now() + 30000 }; return []; }

    /* every photo of the order signed in one request */
    var res = await api('/storage/v1/object/sign/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths: rows.map(function (r) { return r.file_path; }) })
    });
    var signed = await res.json();
    var urlByPath = {};
    (signed || []).forEach(function (s) {
      var u = s.signedURL || s.signedUrl;
      if (u) urlByPath[s.path] = /^https?:/.test(u) ? u : URL_ + '/storage/v1' + u;
    });

    var out = rows.map(function (r) {
      return {
        name: r.file_name || r.file_path.split('/').pop(),
        copies: Number(r.copies) || 1,
        fileId: r.file_path,
        url: urlByPath[r.file_path] || ''
      };
    }).filter(function (p) { return p.url; });

    photoCache[order.id] = { list: out, until: Date.now() + (SIGN_SECONDS - 300) * 1000 };
    return out;
  }

  async function setStatus(id, status) {
    await api('/rest/v1/orders?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: status })
    });
    return { ok: true };
  }

  /* Deletes the photos in Storage, their rows, then the order. */
  async function remove(id) {
    var rows = await photoRows(id);
    var paths = rows.map(function (r) { return r.file_path; });
    for (var i = 0; i < paths.length; i += 100) {
      await api('/storage/v1/object/photos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths.slice(i, i + 100) })
      });
    }
    await api('/rest/v1/order_photos?order_id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await api('/rest/v1/orders?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    delete byId[id];
    delete photoCache[id];
    return { ok: true };
  }

  /* The customer's app picks up "gotovo" by itself (backend.js / sw.js);
     here the admin just sees the same notice locally. */
  async function notifyReady(order) {
    var title = 'Studio Square';
    var body = '📸 Vaše fotografije su gotove! Porudžbina #' + order.id + ' je spremna za preuzimanje.';
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
    endpoint: URL_ + '/auth/v1/health',
    login: login, logout: logout,
    isAuthed: function () { return !!readSession(); },
    list: list, listPhotos: listPhotos, setStatus: setStatus,
    remove: remove, notifyReady: notifyReady,
    pollMs: POLL_MS, isMock: false
  };
})();
