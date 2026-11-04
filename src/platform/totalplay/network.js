/* Totalplay platform adapter — connectivity (AI Guide §12). Polling only; no false-keycode events. */
(function (TP) {
  'use strict';
  function has() { return TP.device && TP.device.hasTotalplayRuntime(); }
  TP.network = {
    /* "No link" | "Link OK 100M Full Duplex" | "unknown" on the STB; "unknown" elsewhere. */
    getEthernetStatus: function () {
      if (!has()) return 'unknown';
      try { return window.sagem.Get('INFO', 'ETHERNET'); } catch (e) { return 'unknown'; }
    },
    /* Timeout returns -1 on the STB. Outside the runtime we cannot ping; report -1 (unknown). */
    ping: function (host) {
      if (!has()) return -1;
      try { return window.sagem.Get('NETWORK', 'PING', host); } catch (e) { return -1; }
    },
    /* Best-effort "are we online?" for the UI banner. The app's own HTTP polling is the real signal. */
    isLinkDown: function () { return has() && TP.network.getEthernetStatus() === 'No link'; }
  };
})(window.TP = window.TP || {});
