/* Studio Square — Supabase (REST only, no SDK, publishable key).
   Exposes window.SS_SUPABASE.submitOrder(order, photos, onProgress). */
(function () {
  var URL_BASE = 'https://pgwlrsvcoucfeqaozazk.supabase.co';
  var KEY = 'sb_publishable_UGtqTPcyaimECxYkZIw6Ew_CLexlr8V';
  var BUCKET = 'photos';
  var CONCURRENCY = 4;

  /* The key must travel in BOTH headers. "apikey" gets the request past the
     gateway; "Authorization: Bearer" is what PostgREST reads to resolve the
     database role. With apikey alone the request reaches Postgres without a
     resolved role, so an anon-only INSERT policy rejects it with 42501. This
     holds for the new sb_publishable_… keys and for legacy anon JWTs alike. */
  function headers(extra) {
    var h = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    for (var k in extra) h[k] = extra[k];
    return h;
  }

  async function insert(table, rows) {
    var res = await fetch(URL_BASE + '/rest/v1/' + table, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error(table + ' insert failed: ' + res.status + ' ' + (await res.text()));
    return res.json();
  }

  function safeName(name, i) {
    var clean = String(name || 'photo.jpg')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    if (!/\.jpe?g$/i.test(clean)) clean += '.jpg';
    return String(i + 1).padStart(4, '0') + '-' + clean;
  }

  async function uploadOne(orderId, photo, i) {
    var fileName = safeName(photo.name, i);
    var path = orderId + '/' + fileName;
    var res = await fetch(URL_BASE + '/storage/v1/object/' + BUCKET + '/' + encodeURI(path), {
      method: 'POST',
      headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': '3600' }),
      body: photo.file
    });
    if (!res.ok) throw new Error('upload failed (' + fileName + '): ' + res.status + ' ' + (await res.text()));
    return { order_id: orderId, file_path: path, file_name: fileName };
  }

  /* Runs a fixed number of uploads at a time so 100+ photos do not
     open 100+ sockets at once on a phone. */
  async function uploadAll(orderId, photos, onProgress) {
    var rows = new Array(photos.length);
    var next = 0, done = 0;
    async function worker() {
      while (next < photos.length) {
        var i = next++;
        rows[i] = await uploadOne(orderId, photos[i], i);
        done++;
        if (onProgress) onProgress(done, photos.length);
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, photos.length); w++) workers.push(worker());
    await Promise.all(workers);
    return rows;
  }

  async function submitOrder(order, photos, onProgress) {
    var created = await insert('orders', [order]);
    var orderId = created && created[0] && created[0].id;
    if (!orderId) throw new Error('orders insert returned no id');

    if (photos.length) {
      var rows = await uploadAll(orderId, photos, onProgress);
      /* insert photo records in chunks — one huge body can be rejected */
      for (var i = 0; i < rows.length; i += 50) await insert('order_photos', rows.slice(i, i + 50));
    }
    return orderId;
  }

  window.SS_SUPABASE = { submitOrder: submitOrder, url: URL_BASE, bucket: BUCKET };
})();
