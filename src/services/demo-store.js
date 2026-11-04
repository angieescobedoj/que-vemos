/* Demo store: shares localStorage with index.html?demo=1 so the whole flow (TV + several "phones" as browser
   tabs) can be rehearsed on one computer without Firebase or TMDB. Same interface as firestoreStore.
   localStorage support on the STB is TBD (R4) — this store is for desktop rehearsal only, never for the box. */
(function (QV) {
  'use strict';
  var K = function (c) { return 'qv-demo-' + c; };
  function read(c) { try { return JSON.parse(localStorage.getItem(K(c))); } catch (e) { return null; } }
  var bc = null; try { bc = window.BroadcastChannel ? new BroadcastChannel('qv-demo') : null; } catch (e) { bc = null; }
  function write(c, v) {
    try { localStorage.setItem(K(c), JSON.stringify(v)); } catch (e) { /* ignore */ }
    if (bc) { try { bc.postMessage(c); } catch (e2) { /* ignore */ } } /* nudges the phone tabs (they listen on this channel) */
  }
  function later(fn) { setTimeout(fn, 30); }
  function toArray(players) { var out = []; for (var id in players) if (players.hasOwnProperty(id)) { var p = players[id]; p.id = id; out.push(p); } return out; }
  QV.demoStore = {
    getRoom: function (c, cb) { later(function () { var s = read(c); cb(null, s ? s.room : null); }); },
    createRoom: function (c, d, cb) { write(c, { room: d, players: {} }); later(function () { cb(null); }); },
    updateRoom: function (c, d, cb) { var s = read(c); if (s) { for (var k in d) if (d.hasOwnProperty(k)) s.room[k] = d[k]; write(c, s); } later(function () { cb(null); }); },
    updatePlayer: function (c, pid, d, cb) { var s = read(c); if (s && s.players[pid]) { for (var k in d) if (d.hasOwnProperty(k)) s.players[pid][k] = d[k]; write(c, s); } later(function () { cb(null); }); },
    listPlayers: function (c, cb) { later(function () { var s = read(c); cb(null, s ? toArray(s.players) : []); }); },
    resetRound: function (c, ids, d, cb) {
      var s = read(c); if (!s) return later(function () { cb(null); });
      for (var i = 0; i < ids.length; i++) { var p = s.players[ids[i]]; if (p) { p.ready = false; p.done = false; p.likes = []; p.passes = []; p.idx = 0; } }
      for (var k in d) if (d.hasOwnProperty(k)) s.room[k] = d[k];
      write(c, s); later(function () { cb(null); });
    }
  };
})(window.QV = window.QV || {});
