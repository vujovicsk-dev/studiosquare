/* Minimal ZIP writer (store method, no compression) — window.SS_ZIP.make(files).
   files: [{ name, blob }] -> Promise<Blob>. Store-only keeps this small and is
   fine for JPEGs, which are already compressed. */
(function () {
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function w(view, off, val, bytes) {
    for (var i = 0; i < bytes; i++) view.setUint8(off + i, (val >>> (i * 8)) & 0xFF);
  }

  async function make(files) {
    var now = new Date();
    var parts = [], central = [], offset = 0;

    for (var i = 0; i < files.length; i++) {
      var name = new TextEncoder().encode(files[i].name);
      var data = new Uint8Array(await files[i].blob.arrayBuffer());
      var crc = crc32(data);

      var local = new DataView(new ArrayBuffer(30 + name.length));
      w(local, 0, 0x04034b50, 4); w(local, 4, 20, 2); w(local, 6, 0, 2); w(local, 8, 0, 2);
      w(local, 10, dosTime(now), 2); w(local, 12, dosDate(now), 2);
      w(local, 14, crc, 4); w(local, 18, data.length, 4); w(local, 22, data.length, 4);
      w(local, 26, name.length, 2); w(local, 28, 0, 2);
      var localBytes = new Uint8Array(local.buffer);
      localBytes.set(name, 30);
      parts.push(localBytes, data);

      var cen = new DataView(new ArrayBuffer(46 + name.length));
      w(cen, 0, 0x02014b50, 4); w(cen, 4, 20, 2); w(cen, 6, 20, 2); w(cen, 8, 0, 2); w(cen, 10, 0, 2);
      w(cen, 12, dosTime(now), 2); w(cen, 14, dosDate(now), 2);
      w(cen, 16, crc, 4); w(cen, 20, data.length, 4); w(cen, 24, data.length, 4);
      w(cen, 28, name.length, 2); w(cen, 30, 0, 2); w(cen, 32, 0, 2); w(cen, 34, 0, 2);
      w(cen, 36, 0, 2); w(cen, 38, 0, 4); w(cen, 42, offset, 4);
      var cenBytes = new Uint8Array(cen.buffer);
      cenBytes.set(name, 46);
      central.push(cenBytes);

      offset += localBytes.length + data.length;
    }

    var cenSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    w(end, 0, 0x06054b50, 4); w(end, 4, 0, 2); w(end, 6, 0, 2);
    w(end, 8, files.length, 2); w(end, 10, files.length, 2);
    w(end, 12, cenSize, 4); w(end, 16, offset, 4); w(end, 20, 0, 2);

    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  window.SS_ZIP = { make: make, save: save };
})();
