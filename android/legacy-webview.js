'use strict';
// Android-only compatibility for Chromium WebView 83.
// Element.replaceChildren() was introduced in Chromium 86. Without this,
// app.js throws before its first fresh authorization request, leaving the
// packaged HTML's initial "videos are on their way" message indefinitely.
// Only patch the missing method; leave modern WebViews unchanged.
(function () {
  if (typeof Element === 'undefined' ||
      typeof Element.prototype.replaceChildren === 'function') return;
  Element.prototype.replaceChildren = function (...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  };
})();
