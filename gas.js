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
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxgAz_RFMiEQjebRM87C6Bm7L6RnAINVsyC_mM8D-vRoGJ1Q_gq4UPzAnU4ui-PQJNZ5A/exec';
  var RETRIES = 2;
  var CONCURRENCY = 3;

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
      catch (e) { last = e; await new Promise(function (r) { setTimeout(r, 600 * (attempt + 1)); }); }
    }
    throw last;
  }

  function safeName(name, i) {
    var clean = String(name || 'photo.jpg')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    if (!/\.jpe?g$/i.test(clean)) clean += '.jpg';
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

    var next = 0, done = 0;
    async function worker() {
      while (next < photos.length) {
        var i = next++;
        var p = photos[i];
        var b64 = await toBase64(p.file);
        await postRetry({
          action: 'photo', id: id, folderId: folderId, index: i,
          name: safeName(p.name, i), mime: 'image/jpeg', data: b64
        });
        done++;
        if (onProgress) onProgress(done, photos.length);
      }
    }
    var running = [];
    for (var w = 0; w < Math.min(CONCURRENCY, photos.length); w++) running.push(worker());
    await Promise.all(running);

    await postRetry({
      action: 'finalize', id: id, folderId: folderId, count: photos.length,
      spec: photos.map(function (p) { return p.qty || 1; })
    });
    return id;
  }

  window.SS_BACKEND = { submitOrder: submitOrder, endpoint: ENDPOINT };
})();
