/**
 * Studio Square — Google Apps Script backend.
 * Paste this whole file into the Apps Script project, then Deploy → New
 * deployment → Web app, "Execute as: Me", "Who has access: Anyone".
 *
 * Script properties to set (Project Settings → Script properties):
 *   ADMIN_PASSWORD  the admin page password (never lives in the site's code)
 *   SHEET_ID        id of the Google Sheet holding the orders
 *   ROOT_FOLDER_ID  id of the private Drive folder "Studio Square"
 *
 * The Drive folder stays private: it is never shared, and the admin page
 * reads photos through this script using a token, not through public links.
 */

var P = PropertiesService.getScriptProperties();
var SHEET_NAME = 'Porudžbine';
var HEADERS = ['id', 'created_at', 'full_name', 'phone', 'address', 'note',
  'photo_format', 'photo_count', 'copies_total', 'total_price',
  'status', 'folder_id', 'spec'];

/* ---------- helpers ---------- */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet() {
  var ss = SpreadsheetApp.openById(P.getProperty('SHEET_ID'));
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function rootFolder() {
  return DriveApp.getFolderById(P.getProperty('ROOT_FOLDER_ID'));
}

/* Token = HMAC of the password, so the password itself never travels back
   to the browser and the token can be verified without storing sessions. */
function makeToken() {
  var raw = Utilities.computeHmacSha256Signature(
    'ss-admin', P.getProperty('ADMIN_PASSWORD') || '');
  return Utilities.base64EncodeWebSafe(raw);
}

function requireAdmin(token) {
  if (!token || token !== makeToken()) throw new Error('unauthorized');
}

function rows() {
  var sh = sheet();
  if (sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues();
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    HEADERS.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
}

function findRow(id) {
  var all = rows();
  for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
  return null;
}

function toOrder(r) {
  var spec = [];
  try { spec = JSON.parse(r.spec || '[]'); } catch (e) {}
  return {
    id: String(r.id),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    full_name: r.full_name, phone: r.phone, address: r.address, note: r.note,
    photo_format: r.photo_format,
    photo_count: Number(r.photo_count) || spec.length,
    copies_total: Number(r.copies_total) || 0,
    total_price: Number(r.total_price) || 0,
    status: r.status || 'novo',
    spec: spec,
    folder_url: r.folder_id ? 'https://drive.google.com/drive/folders/' + r.folder_id : ''
  };
}

/* ---------- customer side (no token) ---------- */

function createOrder(order) {
  var sh = sheet();
  var id = String(4000 + sh.getLastRow());
  var folder = rootFolder().createFolder(id + ' — ' + (order.full_name || 'porudžbina'));
  sh.appendRow([id, new Date(), order.full_name || '', order.phone || '',
    order.address || '', order.note || '', order.photo_format || '',
    Number(order.photo_count) || 0, Number(order.photo_quantity) || 0,
    Number(order.total_price) || 0, 'novo', folder.getId(), '[]']);
  return { ok: true, id: id, folderId: folder.getId() };
}

/* Writes the file only. It deliberately does NOT touch the sheet: reading
   and rewriting the sheet once per photo is what made 100-photo orders
   crawl. The copies per photo arrive in one go at finalize. */
function savePhoto(p) {
  var blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', p.name);
  DriveApp.getFolderById(p.folderId).createFile(blob);
  return { ok: true };
}

/* One sheet write for the whole order: how many distinct photos, how many
   prints in total, and the copies per photo. */
function finalizeOrder(d) {
  var r = findRow(d.id);
  if (!r) return { ok: false, error: 'porudžbina nije pronađena' };

  var spec = Array.isArray(d.spec) ? d.spec.map(function (n) { return Number(n) || 1; }) : [];
  var copies = spec.reduce(function (a, b) { return a + b; }, 0);

  var sh = sheet();
  sh.getRange(r._row, HEADERS.indexOf('photo_count') + 1).setValue(spec.length || Number(d.count) || 0);
  if (copies) sh.getRange(r._row, HEADERS.indexOf('copies_total') + 1).setValue(copies);
  sh.getRange(r._row, HEADERS.indexOf('spec') + 1).setValue(JSON.stringify(spec));

  return { ok: true, id: String(d.id) };
}

/* ---------- admin side (token required) ---------- */

function listOrders() {
  return { ok: true, orders: rows().map(toOrder).reverse() };
}

function listPhotos(id) {
  var r = findRow(id);
  if (!r || !r.folder_id) return { ok: true, photos: [] };
  var spec = [];
  try { spec = JSON.parse(r.spec || '[]'); } catch (e) {}

  var out = [];
  var it = DriveApp.getFolderById(r.folder_id).getFiles();
  while (it.hasNext()) {
    var f = it.next();
    out.push({ name: f.getName(), id: f.getId() });
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });

  return {
    ok: true,
    photos: out.map(function (f, i) {
      var blob = DriveApp.getFileById(f.id).getBlob();
      return {
        name: f.name,
        copies: spec[i] || 1,
        /* inline data: the Drive folder stays private, nothing is shared */
        url: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes())
      };
    })
  };
}

function setStatus(d) {
  var r = findRow(d.id);
  if (r) sheet().getRange(r._row, HEADERS.indexOf('status') + 1).setValue(d.status);
  return { ok: true };
}

function removeOrder(id) {
  var r = findRow(id);
  if (!r) return { ok: true };
  if (r.folder_id) {
    try { DriveApp.getFolderById(r.folder_id).setTrashed(true); } catch (e) {}
  }
  sheet().deleteRow(r._row);
  return { ok: true };
}

/* Customer notice when the order is marked done. Apps Script cannot send a
   browser push, so it emails the shop a ready-to-send line; swap in an SMS
   provider here if you want the text message to go out automatically. */
function notifyCustomer(d) {
  var r = findRow(d.id);
  if (r && r.phone) {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: 'Porudžbina #' + d.id + ' je gotova',
      body: 'Kupac: ' + r.full_name + '\nTelefon: ' + r.phone + '\n\n' + (d.body || '')
    });
  }
  return { ok: true };
}

/* ---------- routing ---------- */

function doGet(e) {
  try {
    var a = (e.parameter.action || '').toLowerCase();
    if (a === 'ping') return json({ ok: true });
    requireAdmin(e.parameter.token);
    if (a === 'list') return json(listOrders());
    if (a === 'photos') return json(listPhotos(e.parameter.id));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var a = (d.action || '').toLowerCase();

    if (a === 'create') return json(createOrder(d.order || {}));
    if (a === 'photo') return json(savePhoto(d));
    if (a === 'finalize') return json(finalizeOrder(d));

    if (a === 'login') {
      if (String(d.password || '') !== String(P.getProperty('ADMIN_PASSWORD') || ''))
        return json({ ok: false, error: 'Pogrešna lozinka' });
      var first = { ok: true, token: makeToken() };
      try { first.orders = listOrders().orders; } catch (e) {}
      return json(first);
    }

    requireAdmin(d.token);
    if (a === 'status') return json(setStatus(d));
    if (a === 'delete') return json(removeOrder(d.id));
    if (a === 'notify') return json(notifyCustomer(d));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}
