/* Totalplay platform adapter — launching third-party apps (Netflix, Prime Video, Max…).

   STATUS: TBD / BLOCKED — DO NOT IMPLEMENT FROM ASSUMPTIONS.
   Nothing in TOTALPLAY_WEBAPP_AI_GUIDE_DRAFT_v0.1 documents an API for a Web App to hand control to a
   third-party app. TP_STB_AppIntegration_V6 says the TP Portal "manages grant/receive control to/from
   3rd Party Apps", i.e. the launch lives in the Portal, not in the Web App. The only documented navigation
   primitive is sagem.Set("BROWSER","GOTO_URL") which loads a web page in the browser, NOT an app.

   This module is the single place the real launch will be wired when Totalplay confirms the API.
   Until then, open() returns false and the UI shows a simulated confirmation screen (agreed for the demo). */
(function (TP) {
  'use strict';
  /* Canonical provider ids as TMDB names them in MX, with the deep-link *shape* we would pass to the
     Portal once the API exists. Kept as data so the UI never hard-codes provider knowledge. */
  var PROVIDERS = {
    'Netflix':            { key: 'netflix',  label: 'Netflix' },
    'Amazon Prime Video': { key: 'prime',    label: 'Prime Video' },
    'Prime Video':        { key: 'prime',    label: 'Prime Video' },
    'Max':                { key: 'max',      label: 'Max' },
    'HBO Max':            { key: 'max',      label: 'Max' },
    'Disney Plus':        { key: 'disney',   label: 'Disney+' },
    'Apple TV Plus':      { key: 'appletv',  label: 'Apple TV+' },
    'Apple TV':           { key: 'appletv',  label: 'Apple TV+' },
    'ViX':                { key: 'vix',      label: 'ViX' },
    'Paramount Plus':     { key: 'paramount',label: 'Paramount+' },
    'Claro video':        { key: 'claro',    label: 'Claro video' },
    'Mercado Play':       { key: 'mercado',  label: 'Mercado Play' },
    'Crunchyroll':        { key: 'crunchy',  label: 'Crunchyroll' },
    'Totalplay':          { key: 'totalplay',label: 'Totalplay' }
  };
  function describe(providerName) {
    return PROVIDERS[providerName] || { key: 'other', label: providerName };
  }
  /* open(providerName, movie) -> boolean (true only when a real launch was dispatched). */
  function open(providerName, movie) {
    var p = describe(providerName);
    if (TP.debug) TP.debug.log('apps.open requested: ' + p.key + ' / tmdb:' + (movie && movie.id) + ' — launch API TBD, not dispatched');
    /* TBD: when Totalplay documents the launch API, dispatch it here and return true. */
    return false;
  }
  TP.apps = { open: open, describe: describe, isLaunchSupported: function () { return false; } };
})(window.TP = window.TP || {});
