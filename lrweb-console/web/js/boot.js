// Runs before first paint (classic script, no modules) so the theme never flashes.
try {
  var t = localStorage.getItem('lrweb.theme') || 'auto';
  var dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  var fx = localStorage.getItem('lrweb.fx');
  if (fx === 'lite' || fx === 'full') document.documentElement.dataset.fx = fx;
} catch (e) { /* storage blocked: keep defaults */ }
