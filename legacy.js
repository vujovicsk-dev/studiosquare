/* Old-Android safety net (ES5 only).
   The app runtime uses modern JS syntax (?. and ??). Android WebView / Chrome
   older than ~80 throws a SyntaxError while parsing it, which leaves a blank
   white page. Here we feature-test that syntax up front and, when it is
   missing, render a plain contact page instead of nothing. */
(function () {
  var ok = true;
  try {
    /* jshint evil:true */
    new Function('var a={b:1};return a?.b ?? 0;')();
  } catch (e) {
    ok = false;
  }
  if (ok) return;

  window.__studioSquareLegacy = true;

  var html =
    '<div style="min-height:100vh;background:#e6f7f7;font-family:Georgia,serif;color:#15262a;' +
    'display:block;padding:36px 20px;text-align:center">' +
      '<img src="./icon-512.png" alt="Studio Square" style="width:200px;max-width:70%;height:auto;margin:0 auto 22px;display:block">' +
      '<div style="font-size:26px;margin:0 0 14px">Studio Square</div>' +
      '<div style="font-size:16px;line-height:1.6;margin:0 auto 26px;max-width:420px">' +
        'Vaš pregledač je stariji i ne može da pokrene formu za naručivanje. ' +
        'Ažurirajte Chrome sa Play Store-a, ili nas kontaktirajte direktno — porudžbinu ' +
        'primamo i telefonom.' +
      '</div>' +
      '<div style="font-size:16px;line-height:1.9">' +
        '<div><a href="tel:+381616644503" style="color:#0a6b6b;font-size:22px;text-decoration:none">+381 61 66 44 503</a></div>' +
        '<div>Bulevar Slobodana Jovanovica 3a, Novi Sad</div>' +
        '<div>Radno vreme</div>' +
        '<div>Ponedeljak - Petak 09-20h</div>' +
        '<div>Subota 09-14h</div>' +
        '<div style="margin-top:14px"><a href="https://www.instagram.com/studiosquare.ns/" style="color:#0a6b6b">studiosquare.ns</a></div>' +
      '</div>' +
    '</div>';

  function render() {
    if (document.body) document.body.innerHTML = html;
  }
  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render, false);
})();
