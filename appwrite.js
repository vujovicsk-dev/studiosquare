/* Studio Square — Appwrite (REST only, no SDK).
   Exposes window.SS_APPWRITE.submitOrder(order, photos, onProgress).

   Photos are uploaded first, then the order row is created with the file
   references in the `photos` column, so a row never points at files that
   failed to upload. */
(function () {
  var ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
  var PROJECT_ID = '6aaed68c00140f1f7549';
  var BUCKET_ID = 'photos';

  var DATABASE_ID = '6aaed81a0000eee9a811';
  var TABLE_ID = '6aaed82e0018acf49477';

  var CONCURRENCY = 4;

  function headers(extra) {
    var h = { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-Response-Format': '1.4.0' };
    for (var k in extra) h[k] = extra[k];
    return h;
  }

  function safeName(name, i) {
    var clean = String(name || 'photo.jpg')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    if (!/\.jpe?g$/i.test(clean)) clean += '.jpg';
    return String(i + 1).padStart(4, '0') + '-' + clean;
  }

  async function uploadOne(photo, i) {
    var fileName = safeName(photo.name, i);
    var body = new FormData();
    body.append('fileId', 'unique()');
    body.append('file', photo.file, fileName);

    var res = await fetch(ENDPOINT + '/storage/buckets/' + BUCKET_ID + '/files', {
      method: 'POST',
      headers: headers(),   /* no Content-Type: the browser sets the multipart boundary */
      body: body
    });
    if (!res.ok) throw new Error('upload failed (' + fileName + '): ' + res.status + ' ' + (await res.text()));
    var file = await res.json();
    return { id: file.$id, name: fileName };
  }

  /* Fixed number of uploads at a time, so 100+ photos do not open
     100+ sockets at once on a phone. */
  async function uploadAll(photos, onProgress) {
    var rows = new Array(photos.length);
    var next = 0, done = 0;
    async function worker() {
      while (next < photos.length) {
        var i = next++;
        rows[i] = await uploadOne(photos[i], i);
        done++;
        if (onProgress) onProgress(done, photos.length);
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, photos.length); w++) workers.push(worker());
    await Promise.all(workers);
    return rows;
  }

  async function createOrder(data) {
    var res = await fetch(ENDPOINT + '/databases/' + DATABASE_ID + '/collections/' + TABLE_ID + '/documents', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ documentId: 'unique()', data: data })
    });
    if (!res.ok) throw new Error('order insert failed: ' + res.status + ' ' + (await res.text()));
    return res.json();
  }

  async function submitOrder(order, photos, onProgress) {
    var files = photos.length ? await uploadAll(photos, onProgress) : [];

    var data = {};
    for (var k in order) data[k] = order[k];
    /* `photos` column: file id + stored name for each upload, as JSON text */
    data.photos = JSON.stringify(files);

    var doc = await createOrder(data);
    return doc.$id;
  }

  window.SS_APPWRITE = { submitOrder: submitOrder, endpoint: ENDPOINT, bucket: BUCKET_ID };
})();
