/* Studio Square — orders data source for admin.html.

   Everything the admin page needs goes through window.SS_ORDERS. Right now it
   is backed by mock data in memory. To move to Google Apps Script later,
   set ENDPOINT to the deployed web-app URL — the four functions below already
   speak the shape the Apps Script should return, so no admin code changes:

     GET  ENDPOINT?action=list                  -> { orders: [ ...order ] }
     GET  ENDPOINT?action=photos&id=<orderId>   -> { photos: [ { name, url, copies } ] }
       copies = how many prints of THAT photo were ordered; the order's
       copies_total is their sum. One order = one format for all its photos.
     POST ENDPOINT { action:"status", id, status }  -> { ok:true }
     POST ENDPOINT { action:"notify", id, title, body } -> { ok:true }
     POST ENDPOINT { action:"delete", id }          -> { ok:true }
       The Apps Script side of "delete" must also remove that order's Drive
       folder and its Sheets row — the admin only asks, it does not delete.

   order = { id, created_at (ISO), full_name, phone, address, note,
             photo_format, photo_count (distinct photos),
             copies_total (sum of per-photo copies), total_price,
             status: "novo" | "priprema" | "gotovo",
             folder_url (Drive link, optional) }                             */
(function () {
  var ENDPOINT = '';           /* '' = mock mode */
  var POLL_MS = 8000;

  /* spec = copies ordered for each distinct photo, in order. */
  function build(o, spec, unit) {
    o.spec = spec;
    o.photo_count = spec.length;
    o.copies_total = spec.reduce(function (n, c) { return n + c; }, 0);
    o.total_price = o.copies_total * unit;
    return o;
  }

  var MOCK = [
    build({ id: '4193', created_at: iso(-14), full_name: 'Milica Jovanović', phone: '+381 64 221 8890',
      address: '', note: 'Mat papir, hvala.', photo_format: '10 × 15 cm', status: 'novo', folder_url: '' },
      [4, 2, 1, 3, 1, 2], 45),
    build({ id: '4192', created_at: iso(-51), full_name: 'Nikola Perić', phone: '+381 60 455 1207',
      address: 'Danila Kiša 14, Novi Sad', note: '', photo_format: '13 × 18 cm', status: 'priprema', folder_url: '' },
      [1, 1, 2, 1], 60),
    build({ id: '4191', created_at: iso(-96), full_name: 'Ana Stanković', phone: '+381 63 908 4412',
      address: '', note: 'Molim bez belih ivica.', photo_format: '9 × 13 cm', status: 'priprema', folder_url: '' },
      [2, 2, 2, 2, 4, 1, 1, 6], 30),
    build({ id: '4176', created_at: iso(-78 * 1440), full_name: 'Vladimir Đurić', phone: '+381 64 771 3320',
      address: 'Futoška 61, Novi Sad', note: '', photo_format: '13 × 18 cm', status: 'gotovo', folder_url: '' },
      [3, 3, 2, 1, 1], 60),
    build({ id: '4175', created_at: iso(-84 * 1440), full_name: 'Katarina Mitrović', phone: '+381 61 552 9043',
      address: '', note: '', photo_format: '10 × 15 cm', status: 'gotovo', folder_url: '' },
      [1, 1, 1, 2, 2, 5], 45),
    build({ id: '4190', created_at: iso(-42 * 1440), full_name: 'Jovan Ristić', phone: '+381 62 334 7781',
      address: 'Bulevar Oslobođenja 102, Novi Sad', note: '', photo_format: '20 × 30 cm', status: 'gotovo', folder_url: '' },
      [1, 1, 2], 250),
    build({ id: '4189', created_at: iso(-47 * 1440), full_name: 'Teodora Lukić', phone: '+381 65 110 2298',
      address: '', note: '', photo_format: '10 × 15 cm', status: 'gotovo', folder_url: '' },
      [3, 3, 3, 1], 45)
  ];

  var NAMES = ['Marko Ilić', 'Sofija Marković', 'Dušan Kovač', 'Iva Radovanović', 'Petar Nikolić'];
  var FORMATS = [['9 × 13 cm', 30], ['10 × 15 cm', 45], ['13 × 18 cm', 60], ['15 × 21 cm', 90]];
  var nextId = 4194;

  function iso(minutesAgo) { return new Date(Date.now() + minutesAgo * 60000).toISOString(); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* Test helper: fabricates an order so the alert and sound can be tried out.
     Delete this together with the mock block once the backend is live. */
  function addMockOrder() {
    var fmt = pick(FORMATS);
    var spec = [];
    var n = 3 + Math.floor(Math.random() * 6);
    for (var i = 0; i < n; i++) spec.push(1 + Math.floor(Math.random() * 4));
    MOCK.unshift(build({
      id: String(nextId++), created_at: new Date().toISOString(), full_name: pick(NAMES),
      phone: '+381 6' + Math.floor(Math.random() * 9) + ' ' + (100 + Math.floor(Math.random() * 899)) + ' ' + (1000 + Math.floor(Math.random() * 8999)),
      address: '', note: '', photo_format: fmt[0], status: 'novo', folder_url: ''
    }, spec, fmt[1]));
  }

  async function list() {
    if (!ENDPOINT) return MOCK.map(function (o) { return Object.assign({}, o); });
    var res = await fetch(ENDPOINT + '?action=list', { method: 'GET' });
    if (!res.ok) throw new Error('list failed: ' + res.status);
    var data = await res.json();
    return data.orders || [];
  }

  async function setStatus(id, status) {
    if (!ENDPOINT) {
      for (var i = 0; i < MOCK.length; i++) if (MOCK[i].id === id) MOCK[i].status = status;
      return { ok: true };
    }
    var res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'status', id: id, status: status })
    });
    if (!res.ok) throw new Error('status failed: ' + res.status);
    return res.json();
  }

  /* Notifies the customer their order is ready. In mock mode this shows the
     notification locally so the wording and permissions can be verified;
     with a backend it also asks the server to push/SMS the customer. */
  async function notifyReady(order) {
    var title = 'Studio Square';
    var body = '📸 Vaše fotografije su gotove! Porudžbina #' + order.id + ' je spremna za preuzimanje.';

    if (ENDPOINT) {
      try {
        await fetch(ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'notify', id: order.id, title: title, body: body })
        });
      } catch (e) { console.error('notify:', e); }
    }

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

  /* Photos of one order. Mock mode draws placeholder JPEGs in the browser;
     with a backend this returns the Drive file links for that order's folder. */
  var mockPhotoCache = {};

  function mockPhoto(order, i) {
    var c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    var x = c.getContext('2d');
    var hue = (i * 47 + Number(order.id)) % 360;
    var g = x.createLinearGradient(0, 0, 900, 600);
    g.addColorStop(0, 'hsl(' + hue + ',52%,72%)');
    g.addColorStop(1, 'hsl(' + ((hue + 48) % 360) + ',46%,52%)');
    x.fillStyle = g; x.fillRect(0, 0, 900, 600);
    x.fillStyle = 'rgba(255,255,255,.88)';
    x.font = 'bold 120px Georgia, serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(i + 1), 450, 300);
    x.font = '34px system-ui, sans-serif';
    x.fillText('test fotografija', 450, 400);
    return c.toDataURL('image/jpeg', 0.82);
  }

  async function listPhotos(order) {
    if (ENDPOINT) {
      var res = await fetch(ENDPOINT + '?action=photos&id=' + encodeURIComponent(order.id));
      if (!res.ok) throw new Error('photos failed: ' + res.status);
      var data = await res.json();
      return data.photos || [];
    }
    if (!mockPhotoCache[order.id]) {
      var spec = order.spec || [];
      var out = [];
      for (var i = 0; i < spec.length; i++) {
        out.push({
          name: String(i + 1).padStart(4, '0') + '-IMG_' + (2000 + i) + '.jpg',
          url: mockPhoto(order, i),
          copies: spec[i]
        });
      }
      mockPhotoCache[order.id] = out;
    }
    return mockPhotoCache[order.id];
  }

  async function remove(id) {
    if (!ENDPOINT) {
      for (var i = MOCK.length - 1; i >= 0; i--) if (MOCK[i].id === id) MOCK.splice(i, 1);
      delete mockPhotoCache[id];
      return { ok: true };
    }
    var res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'delete', id: id })
    });
    if (!res.ok) throw new Error('delete failed: ' + res.status);
    return res.json();
  }

  window.SS_ORDERS = {
    listPhotos: listPhotos,
    remove: remove,
    list: list, setStatus: setStatus, notifyReady: notifyReady,
    addMockOrder: addMockOrder, pollMs: POLL_MS, isMock: !ENDPOINT
  };
})();
