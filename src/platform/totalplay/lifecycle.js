/* Totalplay platform adapter — application lifecycle (AI Guide §11, §26) + rule R6.
   Standby/wakeup arrive as injected "false keycodes" on the DHTML key handler.
   BACK/MENU at root level: isolated, EMPTY handlers. The STB handles exit natively; a page that also
   tries to close itself can hang the browser or reboot the box (R6, validated on real hardware). */
(function (TP) {
  'use strict';
  var STANDBY = 0x7000001B, WAKEUP = 0x7000001C;
  var listeners = { standby: [], wakeup: [] };

  function on(evt, fn) { if (listeners[evt]) listeners[evt].push(fn); }
  function emit(evt) { for (var i = 0; i < listeners[evt].length; i++) { try { listeners[evt][i](); } catch (e) { /* keep going */ } } }

  /* Returns true when the event was a platform lifecycle event (so the app ignores it as a key). */
  function handlePlatformEvent(event) {
    var code = event.keyCode || event.which;
    if (code === STANDBY) { emit('standby'); return true; }
    if (code === WAKEUP) { emit('wakeup'); return true; }
    return false;
  }

  /* R6 — root-level BACK / MENU / EXIT: no exit logic of our own. Ready to be wired to the official
     Totalplay exit API the day it is confirmed. Do NOT add window.close(), history.back() or GOTO_HOMEPAGE here. */
  /* ?return=<url>: when a launcher (e.g. Lab UX) opens this app, root BACK goes back to it.
     Only allowlisted hosts, so the page can't be used as an open redirect. Without ?return= it stays empty (R6).
     This navigates to the launcher's URL; it never closes the browser or calls an exit API. */
  var RETURN_OK = /^https:\/\/stteccimm\.org\//;
  function getReturnUrl() {
    var m = /[?&]return=([^&#]*)/.exec(location.search), url;
    if (!m) return '';
    try { url = decodeURIComponent(m[1]); } catch (e) { return ''; }
    return RETURN_OK.test(url) ? url : '';
  }
  /* '&return=…' to append when navigating between pages of the app, or '' */
  function returnQuery() { var url = getReturnUrl(); return url ? '&return=' + encodeURIComponent(url) : ''; }

  function handleRootBack(event) {
    if (event && event.preventDefault) event.preventDefault();
    var url = getReturnUrl();
    if (url) location.href = url;
  }
  function handleMenu(event) { if (event && event.preventDefault) event.preventDefault(); }

  function getPowerState() {
    if (!(TP.device && TP.device.hasTotalplayRuntime())) return 'WAKEUP';
    try { return window.sagem.Get('STB', 'POWER_STATE'); } catch (e) { return 'WAKEUP'; }
  }

  TP.lifecycle = { STANDBY: STANDBY, WAKEUP: WAKEUP, on: on, handlePlatformEvent: handlePlatformEvent,
    handleRootBack: handleRootBack, handleMenu: handleMenu, getPowerState: getPowerState, returnQuery: returnQuery };
})(window.TP = window.TP || {});
