/* Totalplay platform adapter — remote control key map (AI Guide §6, §25).
   normalizeKey() turns a keydown event into a logical action name or null. */
(function (TP) {
  'use strict';
  var KEYS = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13,
    BACK: 461,     // OMI_KEY_BACK — in-app "one level back"; root behavior isolated in lifecycle.js (R6)
    EXIT: 27,      // OMI_KEY_ESCAPE — handled natively by the STB, never by us (R6)
    CANCEL: 3,
    PLAY: 415,
    MENU: 462,     // OMI_KEY_MENU — handled natively (R6)
    INFO: 457
  };
  /* Desktop-testing aliases, active ONLY outside the STB runtime so they never fight the real remote. */
  var DESKTOP_ALIASES = { 8: 'BACK', 27: 'BACK' };

  function normalizeKey(event) {
    var code = event.keyCode || event.which;
    for (var name in KEYS) if (KEYS.hasOwnProperty(name) && KEYS[name] === code) return name;
    if (!(TP.device && TP.device.hasTotalplayRuntime()) && DESKTOP_ALIASES[code]) return DESKTOP_ALIASES[code];
    return null;
  }
  TP.keys = { KEYS: KEYS, normalizeKey: normalizeKey };
})(window.TP = window.TP || {});
