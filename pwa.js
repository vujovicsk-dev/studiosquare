// PWA bootstrap: registers the service worker and shows a small "Instaliraj"
// button in the top-right corner. Clicking it opens a short instruction dialog.
(function () {
  if (window.__ssPwaInit) return;
  window.__ssPwaInit = true;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
    });
  }

  var deferred = null;
  var btn, backdrop;

  function standalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function build() {
    if (btn || document.getElementById('pwa-install-btn')) {
      btn = btn || document.getElementById('pwa-install-btn');
      return;
    }
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pwa-install-btn';
    btn.textContent = 'Instaliraj';
    btn.setAttribute('aria-label', 'Instaliraj Studio Square aplikaciju');
    btn.style.cssText = [
      'position:fixed', 'top:12px', 'right:96px', 'z-index:9998',
      'border:1px solid #48D1CC', 'border-radius:999px', 'padding:8px 14px', 'cursor:pointer',
      'font-family:"Lora",Georgia,serif', 'font-size:13px', 'font-weight:700',
      'background:#48D1CC', 'color:#08454a', 'box-shadow:0 4px 12px rgba(8,69,74,.16)'
    ].join(';');
    btn.addEventListener('click', onClick);
    var row = document.getElementById('top-actions');
    if (row) {
      btn.style.position = 'static';
      btn.style.top = btn.style.right = 'auto';
      row.insertBefore(btn, row.firstChild);
    } else {
      document.body.appendChild(btn);
    }
  }

  function closeDialog() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }

  function openDialog(title, steps, showInstall) {
    closeDialog();
    backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999', 'background:rgba(8,69,74,.38)',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
      'font-family:Figtree,system-ui,sans-serif'
    ].join(';');
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeDialog(); });

    var box = document.createElement('div');
    box.style.cssText = [
      'max-width:380px', 'width:100%', 'background:#fff', 'border-radius:24px',
      'padding:26px 24px', 'box-shadow:0 18px 44px rgba(8,69,74,.28)', 'text-align:left'
    ].join(';');

    var h = document.createElement('h2');
    h.textContent = title;
    h.style.cssText = 'margin:0 0 12px;font-family:Caprasimo,Figtree,system-ui,sans-serif;font-size:22px;color:#0a6b6b;line-height:1.2';
    box.appendChild(h);

    var ol = document.createElement('ol');
    ol.style.cssText = 'margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px;font-size:15px;line-height:1.5;color:#3d5a5e';
    steps.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      ol.appendChild(li);
    });
    box.appendChild(ol);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:20px';

    if (showInstall) {
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'Instaliraj';
      ok.style.cssText = 'flex:1;border:0;border-radius:999px;padding:13px 18px;font:700 15px/1 Figtree,system-ui,sans-serif;background:#48D1CC;color:#08454a;cursor:pointer';
      ok.addEventListener('click', runPrompt);
      row.appendChild(ok);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = showInstall ? 'Otkaži' : 'U redu';
    close.style.cssText = 'flex:1;border:2px solid #c9eded;border-radius:999px;padding:11px 18px;font:600 15px/1 Figtree,system-ui,sans-serif;background:#fff;color:#0a6b6b;cursor:pointer';
    close.addEventListener('click', closeDialog);
    row.appendChild(close);

    box.appendChild(row);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  }

  function runPrompt() {
    closeDialog();
    if (!deferred) return;
    deferred.prompt();
    var choice = deferred.userChoice;
    deferred = null;
    if (choice && choice.then) {
      choice.then(function (res) {
        if (res && res.outcome === 'accepted' && btn) btn.style.display = 'none';
      });
    }
  }

  function onClick() {
    if (deferred) {
      openDialog('Instaliraj aplikaciju', [
        'Kliknite na dugme „Instaliraj“ ispod.',
        'Potvrdite instalaciju u prozoru koji otvori browser.',
        'Aplikacija se pojavljuje na početnom ekranu i radi kao zasebna aplikacija.'
      ], true);
      return;
    }
    if (isIOS()) {
      openDialog('Dodaj na početni ekran', [
        'Dodirnite dugme za deljenje na dnu Safarija.',
        'Izaberite „Dodaj na početni ekran“ (Add to Home Screen).',
        'Potvrdite sa „Dodaj“ — ikonica se pojavljuje na početnom ekranu.'
      ], false);
      return;
    }
    openDialog('Instaliraj aplikaciju', [
      'Otvorite meni browsera (tri tačke gore desno).',
      'Izaberite „Instaliraj aplikaciju“ ili „Dodaj na početni ekran“.',
      'Potvrdite — aplikacija se pojavljuje među vašim aplikacijama.'
    ], false);
  }

  function start() {
    if (standalone()) return;
    build();
    // the row is rendered by JS, so re-home the button once it exists
    var tries = 0;
    var iv = setInterval(function () {
      var row = document.getElementById('top-actions');
      if (row && btn && btn.parentNode !== row) {
        btn.style.position = 'static';
        btn.style.top = btn.style.right = 'auto';
        row.insertBefore(btn, row.firstChild);
      }
      if ((row && btn && btn.parentNode === row) || ++tries > 40) clearInterval(iv);
    }, 400);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    start();
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    closeDialog();
    if (btn) btn.style.display = 'none';
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
