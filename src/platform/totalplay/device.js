/* Totalplay platform adapter — device identification (AI Guide §9, §10, §24).
   Only platform modules may touch window.sagem. UI code uses TP.device.* */
(function (TP) {
  'use strict';
  function hasRuntime() { return typeof window !== 'undefined' && typeof window.sagem !== 'undefined'; }
  function get() {
    if (!hasRuntime()) return null;
    try { return window.sagem.Get.apply(window.sagem, arguments); } catch (e) { return null; }
  }
  /* Development mock (§24): used only when the app runs outside the STB browser. */
  var mock = {
    model: 'DESKTOP-MOCK', productId: 'mock', softwareVersion: '0.0.0', serial: 'mock-serial', mac: '00:00:00:00:00:00',
    resolution: (window.screen && window.screen.width ? window.screen.width + 'x' + window.screen.height : '1920x1080') + 'P'
  };
  TP.device = {
    hasTotalplayRuntime: hasRuntime,
    getModel: function () { return hasRuntime() ? get('WEBSERVICE', 'USER_AGENT') : mock.model; },
    getProductId: function () { return hasRuntime() ? get('INFO', 'PRODUCT_ID') : mock.productId; },
    getSoftwareVersion: function () { return hasRuntime() ? get('INFO', 'SOFTWARE_VERSION') : mock.softwareVersion; },
    getSerialNumber: function () { return hasRuntime() ? get('INFO', 'SERIAL_NUMBER') : mock.serial; },
    getMacAddress: function () { return hasRuntime() ? get('NETWORK', 'MAC') : mock.mac; },
    /* §10 — read-only diagnostics, never a DRM substitute */
    getHdmiResolution: function () { return hasRuntime() ? get('STB', 'HDMI', 'RESOLUTION') : mock.resolution; },
    getHdcpStatus: function () { return hasRuntime() ? get('STB', 'HDMI', 'HDCP') : '-1'; },
    getHdcpVersion: function () { return hasRuntime() ? get('STB', 'HDMI', 'HDCP_VERSION') : 'No HDCP'; }
  };
})(window.TP = window.TP || {});
