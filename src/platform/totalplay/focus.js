/* Totalplay platform adapter — reusable FocusManager (AI Guide §7, §8; Prompt Library #2).
   Spatial D-pad navigation over [data-focusable] elements using getBoundingClientRect(), so it keeps
   working when lists reorder or the layout is fluid. No page component hard-codes focus logic.

   Scope: an optional container (e.g. an open modal) limits candidates so focus never escapes it.
   Mouse/touch are a progressive-enhancement layer (R5) guarded by matchMedia('(hover: hover) and (pointer: fine)'). */
(function (TP) {
  'use strict';
  var FOCUS_CLASS = 'is-focused';
  var current = null, scope = null, onActivate = null;

  function visible(el) {
    if (!el || el.getAttribute('aria-disabled') === 'true' || el.disabled) return false;
    var n = el;
    while (n && n !== document.body) { if (n.hidden || n.style.display === 'none') return false; n = n.parentNode; }
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function candidates() {
    var root = scope || document, list = root.querySelectorAll('[data-focusable]'), out = [];
    for (var i = 0; i < list.length; i++) if (visible(list[i])) out.push(list[i]);
    return out;
  }
  function center(r) { return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }

  /* Pick the best candidate in a direction: must lie in that direction, prefer small orthogonal offset. */
  function pick(dir) {
    var list = candidates(), cur = current, best = null, bestScore = Infinity;
    if (!cur || !visible(cur)) return list[0] || null;
    var cr = cur.getBoundingClientRect(), cc = center(cr);
    for (var i = 0; i < list.length; i++) {
      var el = list[i]; if (el === cur) continue;
      var r = el.getBoundingClientRect(), c = center(r), dx = c.x - cc.x, dy = c.y - cc.y, primary, secondary;
      if (dir === 'left')  { if (r.right  > cr.left  + 1) continue; primary = -dx; secondary = Math.abs(dy); }
      if (dir === 'right') { if (r.left   < cr.right - 1) continue; primary = dx;  secondary = Math.abs(dy); }
      if (dir === 'up')    { if (r.bottom > cr.top   + 1) continue; primary = -dy; secondary = Math.abs(dx); }
      if (dir === 'down')  { if (r.top    < cr.bottom - 1) continue; primary = dy;  secondary = Math.abs(dx); }
      if (primary < 0) continue;
      /* Overlap on the orthogonal axis counts a lot: a row's button straight below beats a far diagonal one. */
      var horizontal = (dir === 'left' || dir === 'right');
      var overlap = horizontal
        ? Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top))
        : Math.max(0, Math.min(r.right, cr.right) - Math.max(r.left, cr.left));
      /* LEFT/RIGHT stay on the same row: a far-away button above/below is never a horizontal neighbor. */
      if (horizontal && overlap <= 0) continue;
      var score = primary + secondary * (overlap > 0 ? 0.6 : 2.5);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  /* Keep the focused element inside its nearest scrollable ancestor (manual math; old runtimes lack scrollIntoView options). */
  function reveal(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      var oy = window.getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
        var pr = p.getBoundingClientRect(), r = el.getBoundingClientRect(), margin = Math.round(pr.height * 0.12);
        if (r.top < pr.top + margin) p.scrollTop -= (pr.top + margin - r.top);
        else if (r.bottom > pr.bottom - margin) p.scrollTop += (r.bottom - (pr.bottom - margin));
        return;
      }
      p = p.parentNode;
    }
  }

  function setFocus(el) {
    if (current && current !== el) current.classList.remove(FOCUS_CLASS);
    current = el || null;
    if (current) {
      current.classList.add(FOCUS_CLASS);
      reveal(current);
      try { current.focus({ preventScroll: true }); } catch (e) { try { current.focus(); } catch (e2) { /* ignore */ } }
    }
  }
  function move(dir) { var next = pick(dir); if (next) setFocus(next); return !!next; }
  function activate() {
    if (!current || !visible(current)) return false;
    if (onActivate) onActivate(current);
    return true;
  }
  /* Call after any re-render: if focus is gone/hidden, land on the first meaningful element (§7 rule 10). */
  function ensure(preferredSelector) {
    if (current && visible(current) && (!scope || scope.contains(current))) { reveal(current); return; }
    var root = scope || document, pref = preferredSelector ? root.querySelector(preferredSelector) : null;
    setFocus(pref && visible(pref) ? pref : (candidates()[0] || null));
  }
  function setScope(container, preferredSelector) { scope = container || null; ensure(preferredSelector); }

  /* Progressive enhancement: pointer devices get hover-to-focus and click-to-activate. */
  function closestFocusable(node) {
    while (node && node !== document) { if (node.getAttribute && node.hasAttribute('data-focusable')) return node; node = node.parentNode; }
    return null;
  }
  function enablePointer() {
    var mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
    if (!mq || !mq.matches) return;
    document.addEventListener('mousemove', function (e) {
      var el = closestFocusable(e.target);
      if (el && el !== current && visible(el) && (!scope || scope.contains(el))) setFocus(el);
    });
    document.addEventListener('click', function (e) {
      var el = closestFocusable(e.target);
      if (el && visible(el) && (!scope || scope.contains(el))) { setFocus(el); activate(); }
    });
  }

  TP.focus = { setFocus: setFocus, move: move, activate: activate, ensure: ensure, setScope: setScope,
    current: function () { return current; }, onActivate: function (fn) { onActivate = fn; }, enablePointer: enablePointer };
})(window.TP = window.TP || {});
