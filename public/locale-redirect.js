// Static pages only (landing, legal): if the visitor chose another language
// before, go to that version right away. Runs before the page renders.
// Search engines have no stored choice, so they always get the requested URL.
(function () {
  try {
    var stored = localStorage.getItem('locale');
    var page = document.documentElement.getAttribute('data-static-locale');
    if (!stored || !page || stored === page) return;
    var alt = document.querySelector('link[rel="alternate"][hreflang="' + stored + '"]');
    if (alt) location.replace(alt.getAttribute('href').replace(/^https?:\/\/[^/]+/, '') + location.search + location.hash);
  } catch (e) { /* storage blocked: stay */ }
})();
