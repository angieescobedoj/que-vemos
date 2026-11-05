/* Firestore over the REST API with polling (no SDK, no ES modules, no WebSocket — all TBD on the STB, R4).
   Same project, same documents as the phone game (index.html): rooms/{code} and rooms/{code}/players/{pid},
   so the phones keep using the realtime SDK while the TV reads the same data every couple of seconds. */
(function (QV) {
  'use strict';
  var CFG = { projectId: 'match-de-peliculas', apiKey: 'AIzaSyBCyeQBD8MjYf6QQjOnkxkHA7nYNIOzeoQ' };
  var BASE = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/(default)/documents';

  /* --- value encoding (JS <-> Firestore REST) --- */
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return (v % 1 === 0 && Math.abs(v) < 9007199254740991) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Object.prototype.toString.call(v) === '[object Array]') { var a = []; for (var i = 0; i < v.length; i++) a.push(enc(v[i])); return { arrayValue: { values: a } }; }
    var f = {}; for (var k in v) if (v.hasOwnProperty(k)) f[k] = enc(v[k]);
    return { mapValue: { fields: f } };
  }
  function dec(v) {
    if (!v) return null;
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) { var out = [], vals = v.arrayValue.values || []; for (var i = 0; i < vals.length; i++) out.push(dec(vals[i])); return out; }
    if ('mapValue' in v) return decFields(v.mapValue.fields || {});
    return null;
  }
  function decFields(fields) { var o = {}; for (var k in fields) if (fields.hasOwnProperty(k)) o[k] = dec(fields[k]); return o; }
  function encFields(obj) { var f = {}; for (var k in obj) if (obj.hasOwnProperty(k)) f[k] = enc(obj[k]); return f; }
  function docId(name) { return name.substring(name.lastIndexOf('/') + 1); }
  function key(extra) { return '?key=' + CFG.apiKey + (extra || ''); }

  var store = {
    getRoom: function (code, cb) {
      QV.http.get(BASE + '/rooms/' + code + key(), function (err, data, status) {
        if (status === 404) return cb(null, null);
        if (err) return cb(err);
        cb(null, decFields(data.fields || {}));
      });
    },
    createRoom: function (code, data, cb) {
      QV.http.post(BASE + '/rooms' + key('&documentId=' + code), { fields: encFields(data) }, function (err) { cb(err || null); });
    },
    updateRoom: function (code, patch, cb) {
      var mask = ''; for (var k in patch) if (patch.hasOwnProperty(k)) mask += '&updateMask.fieldPaths=' + encodeURIComponent(k);
      QV.http.patch(BASE + '/rooms/' + code + key(mask), { fields: encFields(patch) }, function (err) { cb(err || null); });
    },
    updatePlayer: function (code, pid, patch, cb) {
      var mask = ''; for (var k in patch) if (patch.hasOwnProperty(k)) mask += '&updateMask.fieldPaths=' + encodeURIComponent(k);
      QV.http.patch(BASE + '/rooms/' + code + '/players/' + pid + key(mask), { fields: encFields(patch) }, function (err) { cb(err || null); });
    },
    listPlayers: function (code, cb) {
      QV.http.get(BASE + '/rooms/' + code + '/players' + key('&pageSize=200'), function (err, data) {
        if (err) return cb(err);
        var docs = (data && data.documents) || [], out = [];
        for (var i = 0; i < docs.length; i++) { var p = decFields(docs[i].fields || {}); p.id = docId(docs[i].name); out.push(p); }
        cb(null, out);
      });
    },
    /* Reset every player then the room (the room status flips last so phones only re-render once). */
    resetRound: function (code, playerIds, roomPatch, cb) {
      var i = 0;
      (function next() {
        if (i >= playerIds.length) return store.updateRoom(code, roomPatch, cb);
        store.updatePlayer(code, playerIds[i++], { ready: false, done: false, likes: [], passes: [], idx: 0 }, function (err) { if (err) return cb(err); next(); });
      })();
    }
  };
  QV.firestoreStore = store;
})(window.QV = window.QV || {});
