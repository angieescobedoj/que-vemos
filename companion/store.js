/* Companion · almacenamiento compartido entre TV y celulares. ES5.
   Real: mismo Firebase del juego (rooms/{code} + rooms/{code}/players/{pid}) vía REST con polling (R4).
   Demo (?demo=1): localStorage del mismo navegador, para ensayar con la TV y "celulares" en pestañas. */
(function (CP, QV) {
  'use strict';
  var DEMO = /[?&]demo(=|&|$)/.test(location.search);

  /* Una llave por documento (la sala la escribe solo la TV; cada jugador solo su celular), para que las pestañas
     no se pisen entre sí: localStorage entre pestañas es eventualmente consistente. */
  var RK = function (c) { return 'cp-demo-' + c + '-room'; };
  var PK = function (c, pid) { return 'cp-demo-' + c + '-p-' + pid; };
  function read(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function later(fn) { setTimeout(fn, 20); }
  function merge(dst, src) { for (var k in src) if (src.hasOwnProperty(k)) dst[k] = src[k]; return dst; }

  var demo = {
    getRoom: function (c, cb) { later(function () { cb(null, read(RK(c))); }); },
    createRoom: function (c, d, cb) { write(RK(c), d); later(function () { cb(null); }); },
    updateRoom: function (c, d, cb) { var r = read(RK(c)); if (r) write(RK(c), merge(r, d)); later(function () { cb(null); }); },
    updatePlayer: function (c, pid, d, cb) { write(PK(c, pid), merge(read(PK(c, pid)) || {}, d)); later(function () { cb(null); }); },
    listPlayers: function (c, cb) {
      later(function () {
        var out = [], pre = 'cp-demo-' + c + '-p-';
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(pre) === 0) { var p = read(k); if (p) { p.id = k.substring(pre.length); out.push(p); } }
          }
        } catch (e) { /* ignore */ }
        cb(null, out);
      });
    }
  };

  CP.DEMO = DEMO;
  CP.store = DEMO ? demo : QV.firestoreStore;
})(window.CP = window.CP || {}, window.QV = window.QV || {});
