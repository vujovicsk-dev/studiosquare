/* TEMP: version marker — remove once uploads are confirmed working. */
console.info('SS_BACKEND gas.js v105 učitan');
/* Studio Square — Google Apps Script backend (customer side).
   Exposes window.SS_BACKEND.submitOrder(order, photos, onProgress).

   Flow, in this order, so a Sheets row never points at a folder that failed:
     1. action=create   -> Sheets row + private Drive folder for the order
     2. action=photo    -> one JPG per request (base64), repeated
     3. action=finalize -> marks the row complete, returns the order id

   Requests use text/plain so the browser sends no CORS preflight (Apps Script
   web apps do not answer OPTIONS). The endpoint holds no secret: it only
   accepts new orders. Reading orders requires the admin token. */
(function () {
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycby2EHvqj9bgwzAS94HstBHSFWyynRdle8XhLm9XPMJMxilnCJxaIY61Cmro8GHqbpQzIQ/exec';
  var RETRIES = 2;
  var CONCURRENCY = 6;
  /* Several photos travel in one request. Each Apps Script call carries a
     fixed start-up cost of a second or more, so fewer, fuller requests are
     the biggest speed-up available. Batches stay well under the 50 MB limit. */
  var BATCH_BYTES = 8 * 1024 * 1024;
  var BATCH_MAX = 6;
  var batching = true;

  function post(payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('server ' + res.status);
      return res.text();
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); }
      catch (e) { throw new Error('neispravan odgovor servera'); }
      if (!data.ok) throw new Error(data.error || 'greška na serveru');
      return data;
    });
  }

  /* One retry pass per photo: phone uploads drop connections often enough
     that a single failure should not lose a 100-photo order. */
  async function postRetry(payload) {
    var last;
    for (var attempt = 0; attempt <= RETRIES; attempt++) {
      try { return await post(payload); }
      catch (e) {
        last = e;
        /* a definite "no" from the script will not change on retry */
        if (/unknown action|unauthorized/i.test(String(e.message))) throw e;
        console.warn('SS_BACKEND:', payload.action, 'pokušaj', attempt + 1, 'nije uspeo —', e.message);
        await new Promise(function (r) { setTimeout(r, 600 * (attempt + 1)); });
      }
    }
    throw last;
  }

  function safeName(name, i) {
    var clean = String(name || 'photo.jpg')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    /* Everything is JPEG by the time it gets here, so the stored name always
       ends in .jpg — no "foto.heic.jpg" leftovers. */
    clean = clean.replace(/\.[a-zA-Z0-9]+$/, '') + '.jpg';
    return String(i + 1).padStart(4, '0') + '-' + clean;
  }

  function toBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.onerror = function () { reject(new Error('čitanje fajla nije uspelo')); };
      r.readAsDataURL(file);
    });
  }

  /* A few uploads in flight at once — roughly three times faster than one at
     a time on a phone, while still bounded so a 100-photo order does not open
     a hundred sockets. The sheet is written once, at finalize. */
  async function submitOrder(order, photos, onProgress) {
    var created = await postRetry({ action: 'create', order: order });
    var id = created.id;
    var folderId = created.folderId;

    /* Group photos into batches by size. */
    var batches = [], cur = [], curBytes = 0;
    photos.forEach(function (p, i) {
      var sz = (p.file && p.file.size) || 0;
      if (cur.length && (cur.length >= BATCH_MAX || curBytes + sz > BATCH_BYTES)) {
        batches.push(cur); cur = []; curBytes = 0;
      }
      cur.push(i); curBytes += sz;
    });
    if (cur.length) batches.push(cur);

    var next = 0, done = 0;

    async function sendOne(i) {
      var p = photos[i];
      await postRetry({
        action: 'photo', id: id, folderId: folderId, index: i,
        name: safeName(p.name, i), mime: 'image/jpeg', data: await toBase64(p.file)
      });
    }

    async function sendBatch(idx) {
      if (batching && idx.length > 1) {
        var items = [];
        for (var k = 0; k < idx.length; k++) {
          var p = photos[idx[k]];
          items.push({ index: idx[k], name: safeName(p.name, idx[k]), mime: 'image/jpeg', data: await toBase64(p.file) });
        }
        try {
          await postRetry({ action: 'photos', id: id, folderId: folderId, items: items });
          return;
        } catch (e) {
          /* An older backend without the batch action: fall back to single
             photos for the rest of the order. */
          /* A backend deployed before the batch action existed answers
             "unknown action" — or "unauthorized", because the unknown POST
             falls through to the admin check. Either way: switch to one
             photo per request for the rest of the order. */
          if (/unknown action|unauthorized/i.test(String(e.message))) {
            console.warn('SS_BACKEND: paketno slanje nije dostupno na serveru, šaljem pojedinačno.', e.message);
            batching = false;
          } else throw e;
        }
      }
      for (var m = 0; m < idx.length; m++) await sendOne(idx[m]);
    }

    async function worker() {
      while (next < batches.length) {
        var b = batches[next++];
        await sendBatch(b);
        done += b.length;
        if (onProgress) onProgress(done, photos.length);
      }
    }
    var running = [];
    for (var w = 0; w < Math.min(CONCURRENCY, batches.length); w++) running.push(worker());
    try {
      await Promise.all(running);
    } catch (e) {
      console.error('SS_BACKEND: upload fotografija nije uspeo — porudžbina', id, '|', e && e.message, e);
      throw e;
    }
    console.info('SS_BACKEND: uploadovano', done, 'od', photos.length, 'fotografija — porudžbina', id);

    await postRetry({
      action: 'finalize', id: id, folderId: folderId, count: photos.length,
      spec: photos.map(function (p) { return p.qty || 1; })
    });
    return id;
  }

  /* The customer's own order status — id + phone, no token needed. */
  async function orderStatus(id, phone) {
    var u = ENDPOINT + '?action=orderstatus&id=' + encodeURIComponent(id) +
            '&phone=' + encodeURIComponent(phone);
    var r = await fetch(u);
    return await r.json();
  }

  /* TEMP: tells which Code.gs is actually live. An up-to-date backend
     answers "orderstatus" with "nepoznata porudžbina"; an old one says
     "unauthorized" because it does not know that action. */
  fetch(ENDPOINT + '?action=orderstatus&id=0&phone=0', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.error === 'unauthorized') console.warn('SS_BACKEND: objavljeni Code.gs je STARA verzija (nema orderstatus / paketno slanje / file).');
      else console.info('SS_BACKEND: objavljeni Code.gs je nova verzija.');
    }).catch(function () {});

  window.SS_BACKEND = { submitOrder: submitOrder, orderStatus: orderStatus, endpoint: ENDPOINT };
})();
