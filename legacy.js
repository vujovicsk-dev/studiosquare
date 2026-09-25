/* Old-Android safety net (ES5 only — this file must parse everywhere).

   1. Chrome / WebView older than ~80 cannot parse the app runtime (it uses
      ?. and ??). There we show a plain page instead of a blank white one:
      shop contact details on the order page, an update notice on the admin.
   2. For Chrome 80–87 it quietly fills in what those versions lack, so the
      page looks and works the same as on a current phone:
        - Promise.prototype.finally (used by the admin data layer)
        - flexbox "gap" (Chrome < 84 ignores it; spacing is rebuilt with
          margins on exactly the elements that use it)
      Current browsers skip all of this after one feature test. */
(function () {
  /* ---------- 1. can the runtime run at all? ---------- */
  var ok = true;
  try {
    /* jshint evil:true */
    new Function('var a={b:1};return a?.b ?? 0;')();
  } catch (e) {
    ok = false;
  }

  if (!ok) {
    window.__studioSquareLegacy = true;
    var isAdmin = /admin/i.test(location.pathname);

    var html = isAdmin
      ? '<div style="min-height:100vh;background:#e6f7f7;font-family:Georgia,serif;color:#15262a;padding:48px 22px;text-align:center">' +
          '<div style="font-size:24px;margin:0 0 14px">Studio Square — admin</div>' +
          '<div style="font-size:16px;line-height:1.6;max-width:420px;margin:0 auto">' +
            'Admin stranica zahteva noviji pregledač. Ažurirajte Google Chrome sa Play Store-a ' +
            'ili otvorite admin na računaru.' +
          '</div>' +
        '</div>'
      : '<div style="min-height:100vh;background:#e6f7f7;font-family:Georgia,serif;color:#15262a;' +
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

    var render = function () { if (document.body) document.body.innerHTML = html; };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, false);
    return;
  }

  /* ---------- 2a. Promise.prototype.finally (Chrome < 63) ---------- */
  if (window.Promise && !Promise.prototype['finally']) {
    Promise.prototype['finally'] = function (fn) {
      var P = this.constructor || Promise;
      return this.then(
        function (v) { return P.resolve(fn()).then(function () { return v; }); },
        function (e) { return P.resolve(fn()).then(function () { throw e; }); }
      );
    };
  }

  /* ---------- 2b. flexbox gap (Chrome < 84) ---------- */
  function flexGapWorks() {
    var box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    box.appendChild(document.createElement('div'));
    box.appendChild(document.createElement('div'));
    document.body.appendChild(box);
    var works = box.scrollHeight === 1;
    document.body.removeChild(box);
    return works;
  }

  function px(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  /* Rebuild the spacing of one flex container with margins. Only the
     containers that declare a gap are touched. */
  function patch(el) {
    var cs = getComputedStyle(el);
    if (cs.display.indexOf('flex') === -1) return;
    var rg = px(el.style.rowGap || cs.rowGap);
    var cg = px(el.style.columnGap || cs.columnGap);
    if (!rg && !cg) return;

    var column = cs.flexDirection.indexOf('column') === 0;
    var wrap = cs.flexWrap !== 'nowrap';
    var kids = el.children;
    var first = true;

    if (wrap && !column) {
      /* wrapped rows: a negative margin on the container absorbs the edge */
      el.style.marginRight = (px(el.dataset.ssMr || cs.marginRight) - cg) + 'px';
      el.style.marginBottom = (px(el.dataset.ssMb || cs.marginBottom) - rg) + 'px';
      if (el.dataset.ssMr === undefined) { el.dataset.ssMr = cs.marginRight; el.dataset.ssMb = cs.marginBottom; }
    }

    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (getComputedStyle(k).position === 'absolute' || getComputedStyle(k).display === 'none') continue;
      if (wrap && !column) {
        k.style.marginRight = cg + 'px';
        k.style.marginBottom = rg + 'px';
      } else if (column) {
        k.style.marginTop = first ? '' : rg + 'px';
      } else {
        k.style.marginLeft = first ? '' : cg + 'px';
      }
      first = false;
    }
  }

  function patchAll() {
    var list = document.querySelectorAll('[style*="gap"]');
    for (var i = 0; i < list.length; i++) patch(list[i]);
  }

  function startGapPolyfill() {
    if (flexGapWorks()) return;
    var queued = false;
    var run = function () { queued = false; patchAll(); };
    var queue = function () { if (!queued) { queued = true; requestAnimationFrame(run); } };
    queue();
    if (window.MutationObserver) {
      new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }
    window.addEventListener('resize', queue, false);
  }

  if (document.body) startGapPolyfill();
  else document.addEventListener('DOMContentLoaded', startGapPolyfill, false);
})();
