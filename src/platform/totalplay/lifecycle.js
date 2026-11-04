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

  /* R6 — root-level BACK / MENU / EXIT: intentionally empty. Ready to be wired to the official
     Totalplay exit API the day it is confirmed. Do NOT add window.close(), history.back() or GOTO_HOMEPAGE here. */
  function handleRootBack(event) { if (event && event.preventDefault) event.preventDefault(); }
  function handleMenu(event) { if (event && event.preventDefault) event.preventDefault(); }

  function getPowerState() {
    if (!(TP.device && TP.device.hasTotalplayRuntime())) return 'WAKEUP';
    try { return window.sagem.Get('STB', 'POWER_STATE'); } catch (e) { return 'WAKEUP'; }
  }

  TP.lifecycle = { STANDBY: STANDBY, WAKEUP: WAKEUP, on: on, handlePlatformEvent: handlePlatformEvent,
    handleRootBack: handleRootBack, handleMenu: handleMenu, getPowerState: getPowerState };
})(window.TP = window.TP || {});
