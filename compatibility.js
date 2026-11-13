/* KF Production: early browser compatibility gate. Keep this file ES5-only. */
(function () {
  var path = window.location.pathname || '';
  if (/\/legacy\//i.test(path)) return;

  var supportedSyntax = true;
  try {
    new Function('return (async function(){var o={a:1};return o?.a;});');
    new RegExp(String.fromCharCode(92) + 'p{L}', 'u');
  } catch (syntaxError) {
    supportedSyntax = false;
  }

  var missingCore = !window.Promise || !window.fetch || !window.URLSearchParams ||
    !Array.from || !Object.keys || !Object.values ||
    !String.prototype.includes || !String.prototype.padStart ||
    !Element.prototype.closest || !Element.prototype.classList ||
    !supportedSyntax;

  if (!missingCore) return;

  var file = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
  var known = {
    'index.html': 'index.html',
    'detail.html': 'detail.html',
    'player.html': 'player.html',
    'account.html': 'account.html',
    'about.html': 'about.html',
    'admin.html': 'admin.html'
  };
  if (!known[file]) file = 'index.html';
  var root = path.substring(0, path.lastIndexOf('/') + 1);
  var target = root + 'legacy/' + known[file] + window.location.search + window.location.hash;
  window.location.replace(target);
})();
