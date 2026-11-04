/* Minimal XHR helper (ES5, callbacks). Fetch API support on the STB runtime is TBD (AI Guide §5.2 / R4),
   so everything goes through XMLHttpRequest. */
(function (QV) {
  'use strict';
  function request(method, url, body, cb, timeoutMs) {
    var xhr = new XMLHttpRequest(), done = false;
    function finish(err, data) { if (done) return; done = true; cb(err, data, xhr.status); }
    try {
      xhr.open(method, url, true);
      xhr.timeout = timeoutMs || 12000;
      if (body !== null && body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var text = xhr.responseText, data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (xhr.status >= 200 && xhr.status < 300) finish(null, data);
        else finish(new Error('HTTP ' + xhr.status), data);
      };
      xhr.ontimeout = function () { finish(new Error('timeout')); };
      xhr.onerror = function () { finish(new Error('network')); };
      xhr.send(body === null || body === undefined ? null : JSON.stringify(body));
    } catch (e) { finish(e); }
    return xhr;
  }
  QV.http = {
    get: function (url, cb) { return request('GET', url, null, cb); },
    post: function (url, body, cb) { return request('POST', url, body, cb); },
    patch: function (url, body, cb) { return request('PATCH', url, body, cb); }
  };
})(window.QV = window.QV || {});
