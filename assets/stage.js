/* stage.js — the Cut-Out Stage engine, mountable anywhere.
   mountStage(root, {manifest, key, tray:true, inspector:true}) builds the markup (ids the Dailies scenario clicks:
   #tray #stage #capture #play #fps #frames #reset #export #clearFrame #onion #tags #more) and returns an API:
     add(cid, o) · load(scene) · scene() · reset() · capture() · goto(i) · play() · stop() · setFps(n) · fill(n)
     onChange(fn) · lib() · ready (Promise)
   Model: KEYS are the poses you captured by hand (start, end, …). FRAMES are what plays: one second of pictures made from
   the keys at the current fps — 2 at 2 fps, 24 at 24 — remade automatically whenever the fps changes, even mid-play.
   Positions are fractions of the paper (x, y, w) so a scene survives any paper size. */
(function (global) {
  function mountStage(root, opts) {
    opts = Object.assign({ manifest: '../assets/cutouts/manifest.json', assetBase: '../assets/cutouts/', key: 'vfs.stage.v2', tray: true, inspector: true, slots: 8, seconds: 1, look: 'color' }, opts || {});
    var ROLES = { WHERE: 'where', WHO: 'who', WHAT: 'what' }, RATES = [2, 6, 12, 24];
    root.classList.add('lab'); if (!opts.tray) root.classList.add('no-tray'); if (!opts.inspector) root.classList.add('no-insp');
    root.innerHTML =
      (opts.tray ? '<aside class="tray" id="tray"></aside>' : '') +
      '<div id="stageWrap">' +
        '<div id="stage" class="paper"><div class="empty">empty paper — add a WHERE from the tray</div></div>' +
        '<div class="transport">' +
          '<button class="btn volt" id="capture" title="save this pose (C)">Capture</button>' +
          '<button class="btn" id="play" title="space">&#9654; Play</button>' +
          '<span class="fps" id="fps">' + RATES.map(function (r) { return '<button data-fps="' + r + '"' + (r === 2 ? ' class="on"' : '') + '>' + r + '</button>'; }).join('') + '<span class="fpsUnit">fps</span></span>' +
          '<span class="hint" id="fpsNote"></span>' +
        '</div>' +
        '<div class="transport2">' +
          '<button class="btn small" id="look">Look: colour</button><button class="btn small" id="onion">Onion skin: on</button><button class="btn small" id="tags">Tags: on</button>' +
          '<span class="sp"></span>' +
          '<button class="btn small" id="clearFrame">Undo capture</button><button class="btn small" id="export">Copy JSON</button><button class="btn small danger" id="reset">Reset</button>' +
        '</div>' +
        '<div class="frames" id="frames"></div>' +
        '<textarea id="json" readonly></textarea>' +
      '</div>' +
      (opts.inspector ?
        '<aside class="insp" id="insp"><h4>Piece</h4>' +
        '<div id="selNone" class="rs-faint">Click a piece on the paper.</div>' +
        '<div id="selBox" style="display:none">' +
          '<label>Role <b id="selRole"></b></label>' +
          '<label>Size <input type="range" id="selW" min="6" max="90" step="1"></label>' +
          '<label>Tilt <input type="range" id="selR" min="-45" max="45" step="1"></label>' +
          '<div class="row"><button class="btn" id="flip">Flip</button><button class="btn" id="front">Front</button><button class="btn" id="back">Back</button><button class="btn danger" id="del">Remove</button></div>' +
        '</div>' +
        '<p class="keys">drag &middot; wheel tilts &middot; <span class="kbd">shift</span>+wheel sizes &middot; <span class="kbd">C</span> capture &middot; <span class="kbd">space</span> play</p>' +
        '</aside>' : '');

    var $ = function (s) { return root.querySelector(s); };
    var stage = $('#stage'), tray = $('#tray'), framesEl = $('#frames');
    var lib = [], els = [], keys = [], frames = [], cur = 0, sel = null, fps = 2, onion = true, tags = true, look = opts.look, playing = null, playT0 = 0, listeners = [];
    var uid = function () { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); };
    function emit() { listeners.forEach(function (fn) { try { fn(api.scene()); } catch (e) {} }); }
    function save() { try { localStorage.setItem(opts.key, JSON.stringify({ els: els, keys: keys, frames: frames, cur: cur, fps: fps, onion: onion, tags: tags, look: look })); } catch (e) {} emit(); }
    function load() { try { var s = JSON.parse(localStorage.getItem(opts.key) || 'null'); if (s) { els = s.els || []; keys = s.keys || []; frames = s.frames || []; cur = s.cur || 0; fps = s.fps || 2; onion = s.onion !== false; tags = s.tags !== false; if (s.look) look = s.look; } } catch (e) {} if (keys.length >= 2) fill(fps); else pad(); }
    function pad() { while (frames.length < opts.slots) frames.push(null); }
    function topZ() { return els.reduce(function (m, o) { return Math.max(m, o.z); }, 0); }
    function find(id) { return els.find(function (x) { return x.id === id; }); }
    function asset(c) { return opts.assetBase + ((look === 'color' && c.color) || c.webp || c.file); }

    // ---- tray ----
    function buildTray() {
      if (!tray) return;
      var order = ['WHERE', 'WHO', 'WHAT']; tray.innerHTML = '';
      order.forEach(function (role) {
        var h = document.createElement('h4'); h.textContent = role; tray.appendChild(h);
        lib.filter(function (c) { return c.role === role; }).forEach(function (c) {
          var b = document.createElement('button'); b.innerHTML = '<img src="' + asset(c) + '" alt=""><span>' + c.caption + '</span>';
          b.addEventListener('click', function () { api.add(c.id); }); tray.appendChild(b);
        });
      });
    }
    // ---- render ----
    function render() {
      stage.querySelectorAll('.scrap,.tag,.empty').forEach(function (n) { n.remove(); });
      if (!els.length) { var em = document.createElement('div'); em.className = 'empty'; em.textContent = 'empty paper — add a WHERE from the tray'; stage.appendChild(em); }
      var prev = (onion && !playing && cur > 0) ? frames[cur - 1] : null;
      els.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (e) {
        var c = lib.find(function (x) { return x.id === e.cid; }); if (!c) return;
        if (prev && prev[e.id]) stage.appendChild(scrapNode(e, c, prev[e.id], true));
        stage.appendChild(scrapNode(e, c, e, false));
      });
      updateInsp();
    }
    function scrapNode(e, c, t, ghost) {
      var f = document.createElement('figure'); f.className = 'scrap' + (ghost ? ' is-ghost' : '') + (t.flip ? ' is-flip' : '') + (!ghost && sel === e.id && !playing ? ' is-sel' : '');
      f.dataset.id = e.id; f.dataset.role = e.role; f.style.width = (t.w * 100) + '%'; f.style.left = (t.x * 100) + '%'; f.style.top = (t.y * 100) + '%'; f.style.transform = 'translate(-50%,-50%) rotate(' + t.rot + 'deg)'; f.style.zIndex = e.z + 1;
      f.innerHTML = '<img src="' + asset(c) + '" alt="' + c.caption + '" draggable="false">';
      if (tags && !ghost) { var tg = document.createElement('span'); tg.className = 'tag ' + ROLES[e.role]; tg.textContent = e.role; f.appendChild(tg); }
      if (!ghost && sel === e.id && !playing) { var h = document.createElement('span'); h.className = 'grip'; h.title = 'drag to resize'; f.appendChild(h); }
      return f;
    }
    // ---- select / drag / wheel ----
    var drag = null, resize = null;
    stage.addEventListener('pointerdown', function (ev) {
      var grip = ev.target.closest('.grip');
      if (grip) { var ge = find(grip.parentNode.dataset.id); if (ge) { var gr = stage.getBoundingClientRect(); resize = { e: ge, cx: gr.left + ge.x * gr.width, cy: gr.top + ge.y * gr.height, w0: ge.w, d0: Math.hypot(ev.clientX - (gr.left + ge.x * gr.width), ev.clientY - (gr.top + ge.y * gr.height)) || 1 }; try { stage.setPointerCapture(ev.pointerId); } catch (err) {} ev.preventDefault(); ev.stopPropagation(); return; } }
      var f = ev.target.closest('.scrap'); if (!f || f.classList.contains('is-ghost')) { sel = null; render(); return; }
      if (playing) stop();
      var e = find(f.dataset.id); sel = e.id; render();
      var r = stage.getBoundingClientRect(); drag = { e: e, dx: ev.clientX - r.left - e.x * r.width, dy: ev.clientY - r.top - e.y * r.height };
      try { stage.setPointerCapture(ev.pointerId); } catch (err) {} ev.preventDefault();
    });
    stage.addEventListener('pointermove', function (ev) {
      if (resize) { var d = Math.hypot(ev.clientX - resize.cx, ev.clientY - resize.cy); resize.e.w = Math.min(0.95, Math.max(0.05, resize.w0 * d / resize.d0)); render(); return; }
      if (!drag) return; var r = stage.getBoundingClientRect(); drag.e.x = Math.min(1.1, Math.max(-0.1, (ev.clientX - r.left - drag.dx) / r.width)); drag.e.y = Math.min(1.1, Math.max(-0.1, (ev.clientY - r.top - drag.dy) / r.height)); render(); });
    function endDrag() { if (drag || resize) { drag = null; resize = null; save(); } }
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('wheel', function (ev) { var e = find(sel); if (!e) return; ev.preventDefault();
      if (ev.shiftKey) e.w = Math.min(0.95, Math.max(0.05, e.w * (ev.deltaY < 0 ? 1.06 : 0.94))); else e.rot = Math.max(-90, Math.min(90, e.rot + (ev.deltaY < 0 ? -2 : 2)));
      render(); save(); }, { passive: false });
    // ---- inspector ----
    function updateInsp() { var box = $('#selBox'), none = $('#selNone'); if (!box) return; var e = find(sel); box.style.display = e ? 'block' : 'none'; none.style.display = e ? 'none' : 'block'; if (!e) return;
      $('#selRole').textContent = e.role; $('#selW').value = Math.round(e.w * 100); $('#selR').value = Math.round(e.rot); }
    if (opts.inspector) {
      $('#selW').addEventListener('input', function () { var e = find(sel); if (e) { e.w = this.value / 100; render(); save(); } });
      $('#selR').addEventListener('input', function () { var e = find(sel); if (e) { e.rot = +this.value; render(); save(); } });
      $('#flip').addEventListener('click', function () { var e = find(sel); if (e) { e.flip = !e.flip; render(); save(); } });
      $('#front').addEventListener('click', function () { var e = find(sel); if (e) { e.z = topZ() + 1; render(); save(); } });
      $('#back').addEventListener('click', function () { var e = find(sel); if (e) { e.z = 0; els.forEach(function (o) { if (o !== e) o.z += 1; }); render(); save(); } });
      $('#del').addEventListener('click', removeSel);
    }
    function removeSel() { if (!sel) return; var id = sel; els = els.filter(function (x) { return x.id !== id; }); keys.forEach(function (k) { delete k[id]; }); frames = frames.map(function (fr) { if (fr) delete fr[id]; return fr; }); sel = null; render(); renderFrames(); save(); }
    // ---- keys · frames · fill ----
    function snapshot() { var s = {}; els.forEach(function (e) { s[e.id] = { x: e.x, y: e.y, w: e.w, rot: e.rot, flip: e.flip }; }); return s; }
    function apply(s) { if (!s) return; els.forEach(function (e) { var t = s[e.id]; if (t) { e.x = t.x; e.y = t.y; e.w = t.w; e.rot = t.rot; e.flip = t.flip; } }); }
    function lerp(a, b, f) { return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, rot: a.rot + (b.rot - a.rot) * f, flip: f < 0.5 ? a.flip : b.flip }; }
    function capture() { var s = snapshot(); keys.push(s); if (keys.length >= 2) { fill(fps); } else { frames = []; pad(); frames[0] = s; cur = 0; } render(); renderFrames(); syncButtons(); save(); }
    function fill(rate) {
      // one second of pictures between the captured keys, at `rate` per second — the whole lesson in one function
      if (keys.length < 2) return false;
      var total = Math.max(2, Math.round(rate * opts.seconds)), segs = keys.length - 1, out = [];
      for (var i = 0; i < total; i++) { var t = (i / (total - 1)) * segs, k = Math.min(segs - 1, Math.floor(t)), f = t - k, a = keys[k], b = keys[k + 1], fr = {};
        els.forEach(function (e) { var p = a[e.id], q = b[e.id]; if (p && q) fr[e.id] = lerp(p, q, f); else if (p || q) fr[e.id] = Object.assign({}, p || q); }); out.push(fr); }
      frames = out; cur = Math.min(cur, frames.length - 1); return true;
    }
    function goto(i) { if (playing) stop(); cur = i; if (frames[i]) apply(frames[i]); render(); renderFrames(); save(); }
    function renderFrames() {
      framesEl.innerHTML = ''; var n = frames.length; framesEl.style.gridTemplateColumns = 'repeat(' + n + ',minmax(0,1fr))'; framesEl.classList.toggle('dense', n > 12);
      for (var i = 0; i < n; i++) (function (i) { var d = document.createElement('div'); d.className = 'frame' + (frames[i] ? ' has' : '') + (i === cur ? ' cur' : ''); d.innerHTML = (n <= 12 ? '<span class="n">' + (i + 1) + '</span>' : '') + thumb(frames[i]); d.addEventListener('click', function () { goto(i); }); framesEl.appendChild(d); })(i);
    }
    function thumb(s) { if (!s) return ''; var out = '<svg viewBox="0 0 160 90" preserveAspectRatio="none">'; els.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (e) { var t = s[e.id]; if (!t) return; var w = t.w * 160, h = w * (e.role === 'WHERE' ? 0.56 : e.role === 'WHAT' ? 1.2 : 1.9); var col = e.role === 'WHERE' ? '#1f6f6b' : e.role === 'WHO' ? '#d92b2b' : '#e9b13a'; out += '<rect x="' + (t.x * 160 - w / 2) + '" y="' + (t.y * 90 - h / 2) + '" width="' + w + '" height="' + h + '" fill="' + col + '" opacity=".8" transform="rotate(' + t.rot + ' ' + (t.x * 160) + ' ' + (t.y * 90) + ')"/>'; }); return out + '</svg>'; }
    $('#capture').addEventListener('click', capture);
    $('#clearFrame').addEventListener('click', function () { if (keys.length) keys.pop(); if (keys.length >= 2) fill(fps); else { frames = []; pad(); if (keys[0]) frames[0] = keys[0]; } cur = 0; render(); renderFrames(); syncButtons(); save(); closeMore(); });
    $('#reset').addEventListener('click', function () { if (!confirm('Clear the paper?')) return; api.reset(); closeMore(); });
    // ---- play (holds each picture 1/fps; switching fps mid-play refills and keeps going) ----
    var playBtn = $('#play');
    function playable() { return frames.filter(Boolean); }
    function play() { if (playing) { stop(); return; } if (keys.length >= 2) fill(fps); var idx = playable(); if (idx.length < 2) { alert('Capture where it starts and where it ends first.'); return; }
      playBtn.innerHTML = '&#9632; Stop'; playT0 = performance.now(); renderFrames(); loop(); }
    // time-based, so the interval only sets granularity — and setTimeout keeps ticking in a background tab where rAF would pause
    function loop() { playing = setTimeout(function () { var now = performance.now(); var list = playable(); if (list.length < 2) { stop(); return; }
      var i = Math.floor(((now - playT0) / 1000) * fps) % list.length; var fi = frames.indexOf(list[i]);
      if (fi !== cur) { cur = fi; apply(frames[cur]); render(); var cards = framesEl.children; for (var j = 0; j < cards.length; j++) cards[j].classList.toggle('playing', j === cur); }
      loop(); }, Math.max(8, Math.min(40, 500 / fps))); }
    function stop() { if (playing) { clearTimeout(playing); playing = null; } playBtn.innerHTML = '&#9654; Play'; framesEl.querySelectorAll('.frame').forEach(function (d) { d.classList.remove('playing'); }); if (frames[cur]) apply(frames[cur]); render(); renderFrames(); }
    playBtn.addEventListener('click', play);
    function setFps(n) { fps = n; if (keys.length >= 2) { fill(fps); if (playing) { playT0 = performance.now(); } apply(frames[cur] || frames[0]); render(); renderFrames(); } syncButtons(); save(); }
    $('#fps').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; setFps(+b.dataset.fps); });
    $('#look').addEventListener('click', function () { look = look === 'color' ? 'newsprint' : 'color'; syncButtons(); buildTray(); render(); save(); closeMore(); });
    $('#onion').addEventListener('click', function () { onion = !onion; syncButtons(); render(); save(); });
    $('#tags').addEventListener('click', function () { tags = !tags; syncButtons(); render(); save(); });
    function closeMore() {}
    function syncButtons() { root.querySelectorAll('#fps button').forEach(function (b) { b.classList.toggle('on', +b.dataset.fps === fps); });
      $('#look').textContent = 'Look: ' + (look === 'color' ? 'colour' : 'newsprint'); $('#onion').textContent = 'Onion skin: ' + (onion ? 'on' : 'off'); $('#tags').textContent = 'Tags: ' + (tags ? 'on' : 'off');
      var pics = Math.round(fps * opts.seconds); var hasKeys = keys.length >= 2;
      $('#fpsNote').innerHTML = '<i>' + (hasKeys ? '&#9654;' : '&#10003;') + '</i>' + (hasKeys ? '<b>' + pics + '</b> pictures a second &middot; tap a rate while it plays' : 'capture start &middot; move &middot; capture end'); }
    $('#export').addEventListener('click', function () { var ta = $('#json'); ta.value = JSON.stringify(api.scene()); ta.style.display = 'block'; ta.select(); try { navigator.clipboard.writeText(ta.value).catch(function () {}); } catch (e) {} closeMore(); });
    document.addEventListener('keydown', function (ev) { if (/input|textarea|select/i.test(ev.target.tagName)) return;
      if (ev.key === 'c' || ev.key === 'C') capture(); else if (ev.key === ' ') { ev.preventDefault(); play(); } else if (ev.key === 'ArrowRight') goto(Math.min(frames.length - 1, cur + 1)); else if (ev.key === 'ArrowLeft') goto(Math.max(0, cur - 1)); else if (ev.key === 'Delete' || ev.key === 'Backspace') removeSel(); else if (/^[1-4]$/.test(ev.key)) setFps(RATES[+ev.key - 1]); });
    window.addEventListener('resize', render);

    // ---- the API ----
    var api = {
      add: function (cid, o) { var c = lib.find(function (x) { return x.id === cid; }); if (!c) return null; o = o || {}; var isWhere = c.role === 'WHERE';
        var e = { id: uid(), cid: c.id, role: c.role, x: o.x != null ? o.x : (isWhere ? 0.5 : 0.35 + Math.random() * 0.3), y: o.y != null ? o.y : (isWhere ? 0.5 : 0.55), w: o.w != null ? o.w : (isWhere ? 0.72 : (c.role === 'WHO' ? 0.16 : 0.14)), rot: o.rot != null ? o.rot : (isWhere ? -1.5 : Math.random() * 8 - 4), flip: !!o.flip, z: isWhere ? 0 : topZ() + 1 };
        els.push(e); sel = e.id; render(); save(); return e.id; },
      load: function (scene) { stop(); els = []; keys = []; frames = []; sel = null; cur = 0;
        var ids = {}; (scene.elements || []).forEach(function (s) { var c = lib.find(function (x) { return x.id === s.cid; }); if (!c) return; var e = { id: s.id || uid(), cid: c.id, role: c.role, x: s.x, y: s.y, w: s.w, rot: s.rot || 0, flip: !!s.flip, z: s.z != null ? s.z : (c.role === 'WHERE' ? 0 : topZ() + 1) }; ids[s.key || e.id] = e.id; els.push(e); });
        (scene.keys || scene.frames || []).forEach(function (fr) { if (!fr) return; var out = {}; Object.keys(fr).forEach(function (k) { var id = ids[k] || k; var base = find(id); if (!base) return; out[id] = Object.assign({ x: base.x, y: base.y, w: base.w, rot: base.rot, flip: base.flip }, fr[k]); }); els.forEach(function (e) { if (!out[e.id]) out[e.id] = { x: e.x, y: e.y, w: e.w, rot: e.rot, flip: e.flip }; }); keys.push(out); });
        if (scene.fps) fps = scene.fps; if (keys.length >= 2) fill(fps); else { pad(); if (keys[0]) frames[0] = keys[0]; }
        if (frames[0]) apply(frames[0]); syncButtons(); render(); renderFrames(); save(); },
      scene: function () { return { fps: fps, seconds: opts.seconds, elements: els.map(function (e) { var c = lib.find(function (x) { return x.id === e.cid; }); return { id: e.id, cid: e.cid, role: e.role, asset: c ? c.file : null, x: e.x, y: e.y, w: e.w, rot: e.rot, flip: e.flip, z: e.z }; }), keys: keys, frames: frames }; },
      reset: function () { stop(); els = []; keys = []; frames = []; pad(); cur = 0; sel = null; syncButtons(); render(); renderFrames(); save(); },
      capture: capture, goto: goto, play: play, stop: stop, setFps: setFps, fill: function (n) { var ok = fill(n || fps); if (ok) { render(); renderFrames(); save(); } return ok; },
      onChange: function (fn) { listeners.push(fn); }, lib: function () { return lib.slice(); }
    };
    api.ready = fetch(opts.manifest).then(function (r) { return r.json(); }).then(function (m) { lib = m; buildTray(); load(); render(); renderFrames(); syncButtons(); return api; })
      .catch(function () { if (tray) tray.innerHTML = '<p class="rs-faint">manifest.json not found — run scripts/make_cutouts.py</p>'; return api; });
    return api;
  }
  global.mountStage = mountStage;
})(window);
