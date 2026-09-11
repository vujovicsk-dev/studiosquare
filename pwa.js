// PWA bootstrap: registers the service worker and offers an install button.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    });
  }

  var deferred = null;

  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Instaliraj aplikaciju';
    b.setAttribute('aria-label', 'Instaliraj Studio Square na telefon');
    b.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:18px', 'z-index:9999',
      'border:0', 'border-radius:999px', 'padding:14px 24px', 'font:600 16px/1 system-ui,sans-serif',
      'background:#40E0D0', 'color:#08454a', 'box-shadow:0 10px 26px rgba(8,69,74,.28)', 'cursor:pointer'
    ].join(';');
    b.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice && deferred.userChoice.then(function () {});
      deferred = null;
      b.remove();
    });
    return b;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (document.getElementById('pwa-install-btn')) return;
    var b = makeButton();
    b.id = 'pwa-install-btn';
    document.body.appendChild(b);
  });

  window.addEventListener('appinstalled', function () {
    var b = document.getElementById('pwa-install-btn');
    if (b) b.remove();
  });
})();
