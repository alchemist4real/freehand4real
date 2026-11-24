// freehand4real - Content Script (Active Tab Controller & Multi-Platform Option Selector)
(() => {
  if (window.__FREEHAND4REAL_INJECTED__) return;
  window.__FREEHAND4REAL_INJECTED__ = true;

  console.log('[freehand4real] Active Tab Controller Initialized.');

  // Config
  let extensionEnabled = true;
  let floatingVisible = true;
  let airCursorEnabled = true;
  let mouseGestureEnabled = true;
  let autoSelectEnabled = true;
  let soundEnabled = true;

  function updateContainerVisibility() {
    if (typeof container !== 'undefined' && container) {
      container.style.display = (extensionEnabled && floatingVisible) ? 'block' : 'none';
    }
    if (!extensionEnabled && typeof virtualCursor !== 'undefined' && virtualCursor) {
      virtualCursor.classList.remove('active');
    }
  }

  chrome.storage.local.get(['extensionEnabled', 'floatingVisible', 'airCursorEnabled', 'mouseGestureEnabled', 'autoSelectEnabled', 'soundEnabled'], (data) => {
    if (data.extensionEnabled !== undefined) extensionEnabled = data.extensionEnabled;
    if (data.floatingVisible !== undefined) floatingVisible = data.floatingVisible;
    if (data.airCursorEnabled !== undefined) airCursorEnabled = data.airCursorEnabled;
    if (data.mouseGestureEnabled !== undefined) mouseGestureEnabled = data.mouseGestureEnabled;
    if (data.autoSelectEnabled !== undefined) autoSelectEnabled = data.autoSelectEnabled;
    if (data.soundEnabled !== undefined) soundEnabled = data.soundEnabled;
    updateContainerVisibility();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.extensionEnabled !== undefined) extensionEnabled = changes.extensionEnabled.newValue;
    if (changes.floatingVisible !== undefined) floatingVisible = changes.floatingVisible.newValue;
    if (changes.airCursorEnabled !== undefined) airCursorEnabled = changes.airCursorEnabled.newValue;
    if (changes.mouseGestureEnabled !== undefined) mouseGestureEnabled = changes.mouseGestureEnabled.newValue;
    if (changes.autoSelectEnabled !== undefined) autoSelectEnabled = changes.autoSelectEnabled.newValue;
    if (changes.soundEnabled !== undefined) soundEnabled = changes.soundEnabled.newValue;
    updateContainerVisibility();
  });

  /* ------------------------------------------------------------- */
  /* 1. Virtual Air Cursor                                         */
  /* ------------------------------------------------------------- */
  const virtualCursor = document.createElement('div');
  virtualCursor.id = 'gesture-virtual-cursor';
  document.documentElement.appendChild(virtualCursor);

  let curX = window.innerWidth / 2;
  let curY = window.innerHeight / 2;
  let hideTimer = null;

  function updateVirtualCursor(targetX, targetY) {
    if (!extensionEnabled || !airCursorEnabled) {
      virtualCursor.classList.remove('active');
      return;
    }
    curX += (targetX - curX) * 0.5;
    curY += (targetY - curY) * 0.5;

    virtualCursor.style.left = `${curX}px`;
    virtualCursor.style.top = `${curY}px`;
    virtualCursor.classList.add('active');

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      virtualCursor.classList.remove('active');
    }, 1200);
  }

  function triggerAirClick(x, y) {
    if (!extensionEnabled || !airCursorEnabled) return;
    virtualCursor.classList.add('pinching');
    setTimeout(() => virtualCursor.classList.remove('pinching'), 200);

    const ripple = document.createElement('div');
    ripple.className = 'gesture-click-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    document.documentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 350);

    const el = document.elementFromPoint(x, y);
    if (el && !el.closest('#gesture-iframe-container')) {
      const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      events.forEach(evtType => {
        el.dispatchEvent(new MouseEvent(evtType, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y
        }));
      });
      if (typeof el.focus === 'function') el.focus();
    }
  }

  /* ------------------------------------------------------------- */
  /* 2. Floating Widget Injection                                  */
  /* ------------------------------------------------------------- */
  const container = document.createElement('div');
  container.id = 'gesture-iframe-container';

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('widget.html');
  iframe.allow = 'camera; microphone';
  container.appendChild(iframe);
  document.documentElement.appendChild(container);
  updateContainerVisibility();

  let isDragging = false;
  let startX, startY, initLeft, initTop;

  // Listen to messages from internal iframe
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'WIDGET_CLOSE') {
      floatingVisible = false;
      updateContainerVisibility();
      chrome.storage.local.set({ floatingVisible: false });
      showToast('Floating Window Disabled', '✕');
      return;
    } else if (event.data.type === 'WIDGET_MINIMIZE') {
      if (event.data.minimized) {
        container.classList.add('minimized');
      } else {
        container.classList.remove('minimized');
      }
    } else if (event.data.type === 'START_DRAG_WIDGET') {
      isDragging = true;
      startX = event.data.screenX;
      startY = event.data.screenY;
      const rect = container.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
    } else if (event.data.type === 'GESTURE_ACTION') {
      executeAction(event.data.action);
    } else if (event.data.type === 'AIR_CURSOR_MOVE') {
      const scrX = event.data.normX * window.innerWidth;
      const scrY = event.data.normY * window.innerHeight;
      updateVirtualCursor(scrX, scrY);
    } else if (event.data.type === 'AIR_CURSOR_CLICK') {
      triggerAirClick(curX, curY);
    }
  });

  // Listen to messages broadcast from background (Side Panel or active tab controller)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'GESTURE_ACTION') {
      executeAction(msg.action);
    } else if (msg.type === 'AIR_CURSOR_MOVE') {
      updateVirtualCursor(msg.normX * window.innerWidth, msg.normY * window.innerHeight);
    } else if (msg.type === 'AIR_CURSOR_CLICK') {
      triggerAirClick(curX, curY);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - startX;
    const dy = e.screenY - startY;
    container.style.left = `${Math.max(10, Math.min(window.innerWidth - container.offsetWidth - 10, initLeft + dx))}px`;
    container.style.top = `${Math.max(10, Math.min(window.innerHeight - container.offsetHeight - 10, initTop + dy))}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  /* ------------------------------------------------------------- */
  /* 3. Minimal HUD Toast                                          */
  /* ------------------------------------------------------------- */
  const hudToast = document.createElement('div');
  hudToast.id = 'gesture-hud-toast';
  document.documentElement.appendChild(hudToast);
  let toastTimer = null;

  function showToast(text, icon = '•') {
    hudToast.innerHTML = `<span>${icon}</span><span>${text}</span>`;
    hudToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      hudToast.classList.remove('show');
    }, 1100);
  }

  /* ------------------------------------------------------------- */
  /* 4. Bulletproof Form & CBT Auto-Selector                       */
  /* ------------------------------------------------------------- */
  function autoSelectOption(letter) {
    if (!autoSelectEnabled) return false;
    const upper = letter.toUpperCase();
    const indexLetter = upper.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3, E=4

    // Helper to trigger full change on React / Vue / HTML5 inputs
    function forceCheckRadio(radio) {
      try {
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
        if (proto && proto.set) {
          proto.set.call(radio, true);
        } else {
          radio.checked = true;
        }
      } catch (e) {
        radio.checked = true;
      }
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      radio.click();

      // Click parent container or label
      const parentLabel = radio.closest('label, [role="radio"], .option, .choice, .answer');
      if (parentLabel && parentLabel !== radio) {
        parentLabel.click();
      }
    }

    // 1. Direct radio / checkbox inputs matching value or id
    const radios = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    for (const r of radios) {
      const val = (r.value || '').trim().toUpperCase();
      const id = (r.id || '').toUpperCase();
      const aria = (r.getAttribute('aria-label') || '').toUpperCase();

      if (val === upper || val === String(indexLetter) || id.endsWith(upper) || aria.includes(upper)) {
        forceCheckRadio(r);
        return true;
      }
    }

    // 2. Search labels containing "A.", "B.", "(A)", "[A]", "A )"
    const labels = Array.from(document.querySelectorAll('label'));
    const regLabel = new RegExp(`^\\s*\\(?\\[?${upper}[\\.\\)\\:\\]\\s-]`, 'i');
    for (const lbl of labels) {
      const txt = (lbl.innerText || '').trim();
      if (regLabel.test(txt)) {
        lbl.click();
        const child = lbl.querySelector('input');
        if (child) forceCheckRadio(child);
        return true;
      }
    }

    // 3. Modern custom div/span/button radios (Google Forms, Moodle, Quizizz, Canvas)
    const candidates = Array.from(document.querySelectorAll(
      '[role="radio"], [role="option"], [data-value], .docssharedWizToggleLabeledContainer, .appsMaterialWizToggleRadiogroupEl, .option, .choice, .pilihan, .jawaban, button'
    ));

    for (const el of candidates) {
      const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('data-value') || '').trim();
      if (regLabel.test(txt) || txt.toUpperCase() === upper) {
        el.click();
        const child = el.querySelector('input');
        if (child) forceCheckRadio(child);
        return true;
      }
    }

    return false;
  }

  function clickNav(keywords) {
    const btns = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
    for (const btn of btns) {
      const text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  }

  function dispatchKeyEvent(key, code, keyCode) {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    const props = {
      key: key,
      code: code,
      keyCode: keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    };

    target.dispatchEvent(new KeyboardEvent('keydown', props));
    target.dispatchEvent(new KeyboardEvent('keypress', props));
    target.dispatchEvent(new KeyboardEvent('keyup', props));

    if (target !== window) {
      window.dispatchEvent(new KeyboardEvent('keydown', props));
      window.dispatchEvent(new KeyboardEvent('keyup', props));
    }
  }

  function executeAction(action) {
    if (!extensionEnabled) return;
    switch (action) {
      case 'PRESS_A':
        dispatchKeyEvent('a', 'KeyA', 65);
        autoSelectOption('A');
        showToast('Key A Selected', 'A');
        break;
      case 'PRESS_B':
        dispatchKeyEvent('b', 'KeyB', 66);
        autoSelectOption('B');
        showToast('Key B Selected', 'B');
        break;
      case 'PRESS_C':
        dispatchKeyEvent('c', 'KeyC', 67);
        autoSelectOption('C');
        showToast('Key C Selected', 'C');
        break;
      case 'PRESS_D':
        dispatchKeyEvent('d', 'KeyD', 68);
        autoSelectOption('D');
        showToast('Key D Selected', 'D');
        break;
      case 'PRESS_E':
        dispatchKeyEvent('e', 'KeyE', 69);
        autoSelectOption('E');
        showToast('Key E Selected', 'E');
        break;
      case 'ARROW_LEFT':
        dispatchKeyEvent('ArrowLeft', 'ArrowLeft', 37);
        clickNav(['prev', 'previous', 'sebelumnya', 'back', 'kembali', '«', '<']);
        showToast('Arrow Left (Prev)', '◀');
        break;
      case 'ARROW_RIGHT':
        dispatchKeyEvent('ArrowRight', 'ArrowRight', 39);
        clickNav(['next', 'selanjutnya', 'berikutnya', 'lanjut', 'forward', '»', '>']);
        showToast('Arrow Right (Next)', '▶');
        break;
      case 'SCROLL_UP':
        window.scrollBy({ top: -260, behavior: 'smooth' });
        showToast('Scroll Up', '▲');
        break;
      case 'SCROLL_DOWN':
        window.scrollBy({ top: 260, behavior: 'smooth' });
        showToast('Scroll Down', '▼');
        break;
    }
  }

  /* ------------------------------------------------------------- */
  /* 5. Smooth Mouse Gestures (Right-Click Drag)                   */
  /* ------------------------------------------------------------- */
  let isRDown = false;
  let pts = [];
  let canvas = null;
  let ctx = null;
  let moved = false;

  function ensureCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'gesture-trail-canvas';
      document.documentElement.appendChild(canvas);
      ctx = canvas.getContext('2d');
    }
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function clearCanvas() {
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawTrail() {
    if (!ctx || pts.length < 2) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  window.addEventListener('mousedown', (e) => {
    if (!extensionEnabled || !mouseGestureEnabled || e.button !== 2) return;
    isRDown = true;
    moved = false;
    pts = [{ x: e.clientX, y: e.clientY }];
    ensureCanvas();
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (!isRDown) return;
    const pt = { x: e.clientX, y: e.clientY };
    const last = pts[pts.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) > 6) {
      pts.push(pt);
      if (pts.length > 3) moved = true;
      drawTrail();
    }
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !isRDown) return;
    isRDown = false;

    if (moved && pts.length >= 4) {
      const act = analyzeGesture(pts);
      if (act) executeAction(act);
    }
    clearCanvas();
    pts = [];
  }, true);

  window.addEventListener('contextmenu', (e) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
      return false;
    }
  }, true);

  function analyzeGesture(points) {
    const s = points[0];
    const en = points[points.length - 1];
    const dx = en.x - s.x;
    const dy = en.y - s.y;
    if (Math.hypot(dx, dy) < 25) return null;

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (Math.abs(angle) > 150) return 'ARROW_LEFT';
    if (Math.abs(angle) < 30) return 'ARROW_RIGHT';
    if (angle >= -120 && angle <= -60) return 'SCROLL_UP';
    if (angle >= 60 && angle <= 120) return 'SCROLL_DOWN';

    if (angle < -120 && angle >= -160) return 'PRESS_A';
    if (angle > -60 && angle <= -20) return 'PRESS_B';
    if (angle > 120 && angle <= 160) return 'PRESS_C';
    if (angle > 30 && angle <= 70) return 'PRESS_D';
    return 'PRESS_E';
  }
})();
