(function () {
  'use strict';

  var stage   = document.getElementById('stage');
  var slides  = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var counter = document.getElementById('counter');
  var progress= document.getElementById('progress');
  var notesEl = document.getElementById('notes-text');
  var ovgrid  = document.getElementById('ovgrid');
  var hint    = document.getElementById('hint');
  var total   = slides.length;
  var idx     = 0;
  var idleTimer = null;

  counter.innerHTML = '<span class="cur">01</span> / ' + pad(total);

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ── Fit the fixed 1920×1080 stage into the viewport. Never stack. ── */
  function fit() {
    var availH = document.body.classList.contains('presenter')
      ? window.innerHeight * 0.78
      : window.innerHeight;
    var s = Math.min(window.innerWidth / 1920, availH / 1080);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
    stage.style.top = document.body.classList.contains('presenter')
      ? (availH / 2) + 'px' : '50%';
  }

  function show(n) {
    idx = Math.max(0, Math.min(total - 1, n));
    slides.forEach(function (s, i) { s.classList.toggle('is-active', i === idx); });
    counter.innerHTML = '<span class="cur">' + pad(idx + 1) + '</span> / ' + pad(total);
    progress.style.width = ((idx + 1) / total * 100) + '%';
    var aside = slides[idx].querySelector('.speaker-notes');
    notesEl.innerHTML = aside ? aside.innerHTML : '';
    Array.prototype.forEach.call(ovgrid.children, function (c, i) {
      c.setAttribute('aria-current', i === idx ? 'true' : 'false');
    });
    if (location.hash !== '#' + (idx + 1)) {
      history.replaceState(null, '', '#' + (idx + 1));
    }
  }

  function next() { show(idx + 1); }
  function prev() { show(idx - 1); }

  /* ── Overview grid ── */
  slides.forEach(function (s, i) {
    var b = document.createElement('button');
    b.className = 'ovcell';
    b.type = 'button';
    b.innerHTML = '<span class="ovn">' + pad(i + 1) + '</span>' +
                  '<span class="ovt">' + (s.getAttribute('data-title') || '') + '</span>';
    b.addEventListener('click', function () {
      document.body.classList.remove('overview');
      show(i);
    });
    ovgrid.appendChild(b);
  });

  /* ── Presenter mode: one key, one mode ── */
  function armIdle() {
    document.body.classList.remove('idle');
    if (idleTimer) clearTimeout(idleTimer);
    if (!document.body.classList.contains('presenter')) return;
    idleTimer = setTimeout(function () { document.body.classList.add('idle'); }, 2000);
  }
  document.addEventListener('mousemove', armIdle);

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (document.body.classList.contains('overview')) {
      if (k === 'Escape') { document.body.classList.remove('overview'); e.preventDefault(); }
      return;
    }
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Spacebar') {
      e.preventDefault(); next();
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault(); prev();
    } else if (k === 'Home') { e.preventDefault(); show(0); }
    else if (k === 'End') { e.preventDefault(); show(total - 1); }
    else if (k === 'Escape') { e.preventDefault(); document.body.classList.add('overview'); }
    else if (k === 'p' || k === 'P') {
      e.preventDefault();
      document.body.classList.toggle('presenter');
      fit(); armIdle();
    }
    else if (k === 'c' || k === 'C') {
      e.preventDefault(); document.body.classList.toggle('debug-contrast');
    }
    else if (/^[0-9]$/.test(k)) {
      e.preventDefault(); show(k === '0' ? 9 : parseInt(k, 10) - 1);
    }
    if (hint && !hint.hidden) { hint.style.opacity = '0'; setTimeout(function(){ hint.hidden = true; }, 400); }
  });

  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', function () {
    var n = parseInt(location.hash.slice(1), 10);
    if (!isNaN(n)) show(n - 1);
  });

  var start = parseInt(location.hash.slice(1), 10);
  fit();
  show(isNaN(start) ? 0 : start - 1);
  setTimeout(function () {
    if (hint && !hint.hidden) { hint.style.opacity = '0'; setTimeout(function(){ hint.hidden = true; }, 400); }
  }, 6000);
})();
