/* Studio Square — customer-side backend on Supabase.
   Replaces gas.js. Same interface, so index.html is unchanged:

     window.SS_BACKEND.submitOrder(order, photos, onProgress) -> order id
     window.SS_BACKEND.orderStatus(id, phone)                 -> { ok, status }

   Flow:
     1. rpc create_order     -> order row (status "upload"), returns its id
     2. Storage upload       -> every JPG straight from the browser to
                                photos/<ORDER_ID>/<0001-name.jpg>, raw bytes,
                                a few at a time, with retries
     3. rpc finalize_order   -> the database checks that every file really is
                                in Storage, writes order_photos (copies per
                                photo) and only then moves the order to "novo"

   Each photo is stored once. The number of copies is data in
   order_photos.copies, never extra files.

   Uses supabase.js (URL + publishable key) and nothing else. */
(function () {
  var CFG = window.SS_SUPABASE || {};
  var URL_ = String(CFG.url || '').replace(/\/+$/, '');
  var KEY = CFG.key || '';

  /* Four uploads in flight: fast on Wi-Fi and 4G, and a 100+ photo order
     never opens more than four connections at once. */
  var CONCURRENCY = 4;
  var TRIES = 6;
  var UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

  /* Resume state per submitted photo list. "Pokušaj ponovo" passes the same
     list again, so a retry continues the SAME order and only sends the photos
     that are not in Storage yet — it never opens a second order. */
  var resume = window.WeakMap ? new WeakMap() : null;

  function headers(extra) {
    /* The publishable key goes in the apikey header only; it is not a JWT,
       so it must not be sent as "Authorization: Bearer". */
    return Object.assign({ apikey: KEY }, extra || {});
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function readError(res) {
    var txt = '';
    try { txt = await res.text(); } catch (e) {}
    try { var j = JSON.parse(txt); return j.message || j.error || j.msg || txt; } catch (e) { return txt || ('HTTP ' + res.status); }
  }

  async function rpc(name, body) {
    var res = await fetch(URL_ + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      var err = new Error(name + ': ' + (await readError(res)));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function transient(status) {
    return status === 0 || status === 408 || status === 429 || status >= 500;
  }

  function safeName(name, i) {
    var clean = String(name || 'photo.jpg')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    clean = clean.replace(/\.[a-zA-Z0-9]+$/, '') + '.jpg';
    return String(i + 1).padStart(4, '0') + '-' + clean;
  }

  function objectUrl(path) {
    return URL_ + '/storage/v1/object/photos/' + path.split('/').map(encodeURIComponent).join('/');
  }

  /* One photo, raw bytes. A retry after a lost reply can find the file
     already there ("Duplicate") — that counts as success, no second copy. */
  function waitOnline(maxMs) {
    if (navigator.onLine !== false) return Promise.resolve();
    return new Promise(function (ok) {
      var t = setTimeout(done, maxMs);
      function done() { clearTimeout(t); window.removeEventListener('online', done); ok(); }
      window.addEventListener('online', done);
    });
  }

  function explain(status, msg) {
    if (status === 403 || /row-level security|unauthorized|not allowed/i.test(msg))
      return 'Storage je odbio upload (dozvola) — ' + msg;
    if (status === 413 || /too large|exceeded|maximum allowed size/i.test(msg))
      return 'Fotografija je veća od dozvoljene veličine u Storage-u — ' + msg;
    if (/mime|content type/i.test(msg))
      return 'Storage ne prihvata ovaj tip fajla — ' + msg;
    return msg;
  }

  /* One photo, retried until it is really in Storage. A file that is already
     there ("Duplicate") counts as success, so a retry never stores it twice. */
  async function uploadOne(path, file) {
    var last;
    for (var attempt = 0; attempt < TRIES; attempt++) {
      await waitOnline(60000);
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, UPLOAD_TIMEOUT_MS) : null;
      try {
        var res = await fetch(objectUrl(path), {
          method: 'POST',
          headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': '3600' }),
          body: file,
          signal: ctl ? ctl.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (res.ok) return;
        var msg = await readError(res);
        if (res.status === 409 || /duplicate|already exists/i.test(msg)) return;
        last = new Error('upload ' + path + ': ' + res.status + ' ' + explain(res.status, msg));
        last.fatal = !transient(res.status);
        if (last.fatal) throw last;
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (err && err.fatal) throw err;
        if (!last || err !== last) last = new Error('upload ' + path + ': ' + ((err && err.name === 'AbortError') ? 'isteklo vreme' : (err && err.message) || err));
      }
      console.warn('SS_BACKEND: ponovni pokušaj', attempt + 1, 'za', path, '—', last && last.message);
      await wait(Math.min(20000, 1000 * Math.pow(2, attempt)));
    }
    throw last;
  }

  /* Runs tasks with a fixed number in flight; the first hard failure stops
     new tasks from starting, and the error is passed on — never swallowed. */
  async function pool(count, limit, task) {
    var next = 0, failed = null;
    async function worker() {
      while (next < count && !failed) {
        var i = next++;
        try { await task(i); } catch (e) { if (!failed) failed = e; }
      }
    }
    var running = [];
    for (var w = 0; w < Math.min(limit, count); w++) running.push(worker());
    await Promise.all(running);
    if (failed) throw failed;
  }

  async function submitOrder(order, photos, onProgress) {
    if (!URL_ || !KEY || /UNESITE/.test(KEY)) throw new Error('Supabase nije podešen (supabase.js).');
    var t0 = Date.now();
    var st = (resume && resume.get(photos)) || { id: null, sent: {} };
    if (resume) resume.set(photos, st);

    if (!st.id) {
    var created = await rpc('create_order', {
      p: {
        full_name: order.full_name,
        phone: order.phone,
        address: order.address || '',
        note: order.note || '',
        format: order.photo_format,
        quantity: order.photo_quantity,
        total_price: order.total_price,
        photo_count: photos.length
      }
    });
    if (!created || created.id == null) throw new Error('create_order nije vratio broj porudžbine');
    st.id = String(created.id);
    }
    var id = st.id;

    var items = photos.map(function (p, i) {
      return { file_path: id + '/' + safeName(p.name, i), file_name: p.name, copies: p.qty || 1 };
    });

    var todo = [];
    for (var k = 0; k < photos.length; k++) if (!st.sent[k]) todo.push(k);
    var done = photos.length - todo.length;
    if (onProgress) onProgress(done, photos.length);

    try {
      await pool(todo.length, CONCURRENCY, async function (n) {
        var i = todo[n];
        if (!photos[i] || !photos[i].file || !photos[i].file.size) {
          var bad = new Error('fotografija ' + (i + 1) + ' (' + (photos[i] && photos[i].name) + ') nije dostupna za slanje');
          bad.fatal = true;
          throw bad;
        }
        await uploadOne(items[i].file_path, photos[i].file);
        st.sent[i] = true;
        done++;
        if (onProgress) onProgress(done, photos.length);
      });
    } catch (e) {
      console.error('SS_BACKEND: upload nije uspeo — porudžbina', id, '| poslato',
        Object.keys(st.sent).length, 'od', photos.length, '|', e && e.message);
      throw e;
    }

    var sentCount = Object.keys(st.sent).length;
    if (sentCount !== photos.length) {
      throw new Error('Poslato je ' + sentCount + ' od ' + photos.length + ' fotografija — porudžbina nije završena.');
    }

    try {
      await rpc('finalize_order', { p_order_id: id, p_items: items });
    } catch (e) {
      /* A reply lost on the way back: if the order already moved on, the
         finalize did go through. */
      var chk = null;
      try { chk = await orderStatus(id, order.phone); } catch (e2) {}
      if (!(chk && chk.ok && chk.status && chk.status !== 'upload')) {
        console.error('SS_BACKEND: finalize nije uspeo — porudžbina', id, '|', e && e.message);
        throw e;
      }
    }

    if (resume) resume.delete(photos);
    console.info('SS_BACKEND: porudžbina', id, '—', photos.length, 'fotografija za',
      Math.round((Date.now() - t0) / 1000), 's');
    return id;
  }

  async function orderStatus(id, phone) {
    return rpc('order_status', { p_id: String(id), p_phone: String(phone || '') });
  }

  window.SS_BACKEND = { submitOrder: submitOrder, orderStatus: orderStatus, endpoint: URL_ };
})();
