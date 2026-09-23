/* Studio Square — Supabase connection (frontend).

   Only the PUBLISHABLE key belongs here. It is meant to be public: what it
   can do is limited by the Row Level Security rules in the database —
   customers can only create an order and upload into that order's folder;
   reading, changing and deleting orders needs the admin's own login.

   Never put a service_role / secret key or any password in this file.

   Loaded by index.html, admin.html and the service worker (sw.js), so it
   works in both a page and a worker. */
(function (g) {
  g.SS_SUPABASE = {
    url: 'https://puyolmpmuafgmdssxada.supabase.co',
    key: 'sb_publishable_UNESITE_VAS_KLJUC'
  };
  if (/UNESITE/.test(g.SS_SUPABASE.key) && g.console) {
    console.error('supabase.js: unesite Supabase Publishable key (sb_publishable_…).');
  }
})(typeof self !== 'undefined' ? self : window);
