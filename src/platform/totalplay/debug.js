/* Totalplay platform adapter — debug logging (AI Guide §14, §16).
   Serial log only when the STB runtime is present; console.log elsewhere. Never required by the app flow. */
(function (TP) {
  'use strict';
  TP.debug = {
    log: function (msg) {
      var text = '[que-vemos-tv] ' + msg;
      if (TP.device && TP.device.hasTotalplayRuntime()) {
        try { window.sagem.Set('LOG', text); } catch (e) { /* no-op */ }
      } else if (window.console && console.log) {
        console.log(text);
      }
    }
  };
})(window.TP = window.TP || {});
