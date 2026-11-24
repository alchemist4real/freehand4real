// freehand4real - Widget Controller (Fist Scrolling, Active Gesture Indicator, Monochrome UI)
(() => {
  // Elements
  const widgetPanel = document.getElementById('widget-panel');
  const minBubble = document.getElementById('min-bubble');
  const btnMin = document.getElementById('btn-min');
  const btnMax = document.getElementById('btn-max');
  const btnClose = document.getElementById('btn-close');
  const btnBubbleClose = document.getElementById('btn-bubble-close');
  const btnCam = document.getElementById('btn-cam');
  const btnCursor = document.getElementById('btn-cursor');
  const btnSound = document.getElementById('btn-sound');
  const dragHandle = document.getElementById('drag-handle');
  const webcam = document.getElementById('webcam');
  const canvas = document.getElementById('overlay-canvas');
  const ctx = canvas.getContext('2d');
  const camIdle = document.getElementById('cam-idle');
  const idleMsg = document.getElementById('idle-msg');
  const activeBadge = document.getElementById('active-gesture-badge');
  const badgeText = document.getElementById('badge-text');
  const keys = document.querySelectorAll('.key');

  // State
  let cameraActive = false;
  let airCursorActive = true;
  let soundActive = true;
  let handLandmarker = null;
  let animFrameId = null;

  let lastActionTime = 0;
  let lastScrollTime = 0;
  let lastPinchTime = 0;
  let lastVideoTime = -1;

  // Stability Filter
  let candidateGesture = null;
  let candidateStartTime = 0;
  let currentConfirmedGesture = 'Standby';

  const GESTURE_HOLD_REQUIRED_MS = 110;
  const ACTION_COOLDOWN_MS = 450;
  const SCROLL_COOLDOWN_MS = 75;
  const PINCH_COOLDOWN_MS = 380;

  // Audio Blips
  let audioCtx = null;
  function playTone(freq, duration = 0.06) {
    if (!soundActive) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  const TONES = {
    PRESS_A: 440,
    PRESS_B: 494,
    PRESS_C: 523,
    PRESS_D: 587,
    PRESS_E: 659,
    ARROW_LEFT: 350,
    ARROW_RIGHT: 700,
    SCROLL_UP: 850,
    SCROLL_DOWN: 280,
    CLICK: 600
  };

  /* ------------------------------------------------------------- */
  /* Actions & Indicator Update                                    */
  /* ------------------------------------------------------------- */
  function triggerAction(actionName, label = actionName) {
    const btn = document.querySelector(`[data-action="${actionName}"]`);
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 180);
    }

    if (TONES[actionName]) playTone(TONES[actionName]);
    updateActiveIndicator(label, true);

    // 1. Post to host page
    window.parent.postMessage({
      type: 'GESTURE_ACTION',
      action: actionName
    }, '*');

    // 2. Broadcast to active tab
    chrome.runtime.sendMessage({
      action: 'EXECUTE_ON_ACTIVE_TAB',
      gestureAction: actionName
    }).catch(() => {});
  }

  let badgeTimer = null;
  function updateActiveIndicator(text, highlight = false) {
    badgeText.textContent = text;
    if (highlight) {
      activeBadge.classList.add('active-highlight');
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        activeBadge.classList.remove('active-highlight');
        badgeText.textContent = cameraActive ? (currentConfirmedGesture || 'Tracking...') : 'Standby';
      }, 700);
    }
  }

  keys.forEach(k => {
    k.addEventListener('click', () => {
      triggerAction(k.dataset.action, k.innerText.trim());
    });
  });

  // Window Controls
  btnMin.addEventListener('click', () => {
    widgetPanel.style.display = 'none';
    minBubble.style.display = 'flex';
    window.parent.postMessage({ type: 'WIDGET_MINIMIZE', minimized: true }, '*');
  });

  btnMax.addEventListener('click', () => {
    widgetPanel.style.display = 'flex';
    minBubble.style.display = 'none';
    window.parent.postMessage({ type: 'WIDGET_MINIMIZE', minimized: false }, '*');
  });

  function closeFloating() {
    widgetPanel.style.display = 'none';
    minBubble.style.display = 'none';
    window.parent.postMessage({ type: 'WIDGET_CLOSE' }, '*');
    chrome.storage.local.set({ floatingVisible: false });
  }

  if (btnClose) btnClose.addEventListener('click', closeFloating);
  if (btnBubbleClose) btnBubbleClose.addEventListener('click', closeFloating);

  // Restore view if floating is re-enabled from popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.floatingVisible && changes.floatingVisible.newValue) {
      widgetPanel.style.display = 'flex';
      minBubble.style.display = 'none';
    }
  });

  dragHandle.addEventListener('mousedown', (e) => {
    window.parent.postMessage({
      type: 'START_DRAG_WIDGET',
      screenX: e.screenX,
      screenY: e.screenY
    }, '*');
  });

  btnSound.addEventListener('click', () => {
    soundActive = !soundActive;
    btnSound.classList.toggle('active', soundActive);
    chrome.storage.local.set({ soundEnabled: soundActive });
  });

  btnCursor.addEventListener('click', () => {
    airCursorActive = !airCursorActive;
    btnCursor.classList.toggle('active', airCursorActive);
    chrome.storage.local.set({ airCursorEnabled: airCursorActive });
  });

  /* ------------------------------------------------------------- */
  /* MediaPipe Tasks Vision Initializer                            */
  /* ------------------------------------------------------------- */
  async function loadHandLandmarker() {
    if (handLandmarker) return handLandmarker;
    if (typeof Vision === 'undefined') return null;

    updateActiveIndicator('Loading AI...', false);
    try {
      const wasmPath = chrome.runtime.getURL('lib/wasm');
      const modelPath = chrome.runtime.getURL('lib/hand_landmarker.task');

      const vision = await Vision.FilesetResolver.forVisionTasks(wasmPath);
      const options = {
        baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1
      };

      try {
        handLandmarker = await Vision.HandLandmarker.createFromOptions(vision, options);
      } catch (gpuErr) {
        options.baseOptions.delegate = 'CPU';
        handLandmarker = await Vision.HandLandmarker.createFromOptions(vision, options);
      }

      console.log('[freehand4real] HandLandmarker ready.');
      updateActiveIndicator('Ready', false);
      return handLandmarker;
    } catch (err) {
      console.error('[freehand4real] Error loading HandLandmarker:', err);
      updateActiveIndicator('Load Error', true);
      return null;
    }
  }

  async function toggleCam() {
    if (cameraActive) {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (webcam.srcObject) {
        webcam.srcObject.getTracks().forEach(t => t.stop());
        webcam.srcObject = null;
      }
      cameraActive = false;
      btnCam.classList.remove('active');
      camIdle.classList.remove('hidden');
      idleMsg.textContent = 'Click Cam icon to start';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      updateActiveIndicator('Standby', false);
    } else {
      try {
        updateActiveIndicator('Starting Cam...', false);
        idleMsg.textContent = 'Starting camera...';

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, frameRate: { ideal: 30 } }
        });

        webcam.srcObject = stream;
        await webcam.play();

        canvas.width = webcam.videoWidth || 320;
        canvas.height = webcam.videoHeight || 240;

        cameraActive = true;
        btnCam.classList.add('active');
        camIdle.classList.add('hidden');

        await loadHandLandmarker();
        updateActiveIndicator('Tracking...', false);

        startPredictLoop();
      } catch (err) {
        cameraActive = false;
        btnCam.classList.remove('active');
        camIdle.classList.remove('hidden');
        idleMsg.innerHTML = 'Camera access needed.<br><a id="lnk-allow" style="color:#000;text-decoration:underline;cursor:pointer;">Click to allow camera</a>';

        const lnk = document.getElementById('lnk-allow');
        if (lnk) {
          lnk.onclick = () => {
            chrome.runtime.sendMessage({ action: 'OPEN_PERMISSION_TAB' });
          };
        }
        chrome.runtime.sendMessage({ action: 'OPEN_PERMISSION_TAB' });
      }
    }
  }

  btnCam.addEventListener('click', toggleCam);

  function startPredictLoop() {
    async function predict() {
      if (!cameraActive) return;

      if (webcam.currentTime !== lastVideoTime && handLandmarker) {
        lastVideoTime = webcam.currentTime;
        const startTimeMs = performance.now();
        const results = handLandmarker.detectForVideo(webcam, startTimeMs);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (results && results.landmarks && results.landmarks.length > 0) {
          const lm = results.landmarks[0];
          drawSkeleton(lm);
          currentConfirmedGesture = processPoseWithStability(lm);
          drawHudBanner(currentConfirmedGesture);
        }
      }

      animFrameId = requestAnimationFrame(predict);
    }
    animFrameId = requestAnimationFrame(predict);
  }

  function drawSkeleton(lm) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#000000';

    const pairs = [
      [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],[0,17]
    ];

    ctx.beginPath();
    for (const [i, j] of pairs) {
      ctx.moveTo(lm[i].x * canvas.width, lm[i].y * canvas.height);
      ctx.lineTo(lm[j].x * canvas.width, lm[j].y * canvas.height);
    }
    ctx.stroke();

    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function drawHudBanner(text) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(8, 8, canvas.width - 16, 24);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(8, 8, canvas.width - 16, 24);

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 12.5px "Times New Roman"';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, 24);
    ctx.restore();
  }

  /* ------------------------------------------------------------- */
  /* Gesture Engine with Fist Scrolling                            */
  /* ------------------------------------------------------------- */
  function processPoseWithStability(lm) {
    const raw = detectRawPose(lm);
    const now = Date.now();

    // Stability filter
    if (raw.type === candidateGesture) {
      if (now - candidateStartTime > GESTURE_HOLD_REQUIRED_MS) {
        if (raw.action && now - lastActionTime > ACTION_COOLDOWN_MS) {
          lastActionTime = now;
          triggerAction(raw.action, raw.label);
        }
      }
    } else {
      candidateGesture = raw.type;
      candidateStartTime = now;
    }

    return raw.label || raw.type;
  }

  function detectRawPose(lm) {
    const now = Date.now();
    const wrist = lm[0];

    // Check extended fingers (rotation invariant)
    function isExt(tipIdx, pipIdx, mcpIdx) {
      const dTip = Math.hypot(lm[tipIdx].x - wrist.x, lm[tipIdx].y - wrist.y);
      const dPip = Math.hypot(lm[pipIdx].x - wrist.x, lm[pipIdx].y - wrist.y);
      const dMcp = Math.hypot(lm[mcpIdx].x - wrist.x, lm[mcpIdx].y - wrist.y);
      return dTip > dPip * 1.06 && dTip > dMcp * 1.12;
    }

    const isIdx = isExt(8, 6, 5);
    const isMid = isExt(12, 10, 9);
    const isRing = isExt(16, 14, 13);
    const isPinky = isExt(20, 18, 17);

    // Thumb extension
    const dThumbTip = Math.hypot(lm[4].x - lm[17].x, lm[4].y - lm[17].y);
    const dThumbIp = Math.hypot(lm[3].x - lm[17].x, lm[3].y - lm[17].y);
    const isThumb = dThumbTip > dThumbIp * 1.25;

    let count = 0;
    if (isIdx) count++;
    if (isMid) count++;
    if (isRing) count++;
    if (isPinky) count++;
    if (isThumb) count++;

    // 1. FIST SCROLLING (TANGAN MENGGENGGAM)
    // A fist has all 4 main fingers folded
    const isFist = !isIdx && !isMid && !isRing && !isPinky;
    if (isFist) {
      const fistY = (wrist.y + lm[9].y) / 2;
      if (now - lastScrollTime > SCROLL_COOLDOWN_MS) {
        if (fistY < 0.52) {
          // Fist raised slightly -> Scroll Up
          lastScrollTime = now;
          triggerAction('SCROLL_UP', 'Fist: Scroll Up');
          return { type: 'SCROLL_UP', label: 'Fist: Scroll Up' };
        } else if (fistY > 0.62) {
          // Fist lowered deliberately -> Scroll Down
          lastScrollTime = now;
          triggerAction('SCROLL_DOWN', 'Fist: Scroll Down');
          return { type: 'SCROLL_DOWN', label: 'Fist: Scroll Down' };
        } else {
          return { type: 'FIST_IDLE', label: 'Fist: Ready to Scroll' };
        }
      }
    }

    // 2. Air Cursor Tracking (follows Index finger)
    if (airCursorActive && isIdx) {
      const normX = 1 - lm[8].x;
      const normY = lm[8].y;
      window.parent.postMessage({ type: 'AIR_CURSOR_MOVE', normX, normY }, '*');
      chrome.runtime.sendMessage({ action: 'BROADCAST_GESTURE', type: 'AIR_CURSOR_MOVE', normX, normY }).catch(() => {});

      // Pinch Detection (Thumb tip to Index tip)
      const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
      if (pinchDist < 0.05) {
        if (now - lastPinchTime > PINCH_COOLDOWN_MS) {
          lastPinchTime = now;
          playTone(TONES.CLICK, 0.05);
          triggerAction('CLICK', 'Pinch Click');
          window.parent.postMessage({ type: 'AIR_CURSOR_CLICK' }, '*');
          chrome.runtime.sendMessage({ action: 'BROADCAST_GESTURE', type: 'AIR_CURSOR_CLICK' }).catch(() => {});
          return { type: 'PINCH', label: 'Pinch Click' };
        }
        return { type: 'PINCH', label: 'Pinching' };
      }
    }

    // 3. Horizontal Nav (Point Left / Right)
    if (isIdx && !isMid && !isRing && !isPinky) {
      const dx = lm[8].x - lm[5].x;
      const dy = lm[8].y - lm[5].y;
      if (Math.abs(dx) > Math.abs(dy) * 1.25) {
        if (dx > 0.09) {
          return { type: 'ARROW_LEFT', action: 'ARROW_LEFT', label: 'Left Arrow' };
        } else if (dx < -0.09) {
          return { type: 'ARROW_RIGHT', action: 'ARROW_RIGHT', label: 'Right Arrow' };
        }
      }
    }

    // 4. Natural Finger Count: A, B, C, D, E
    if (count === 1 && isIdx) {
      return { type: 'KEY_A', action: 'PRESS_A', label: 'Key A (1 Finger)' };
    } else if (count === 2 && isIdx && isMid) {
      return { type: 'KEY_B', action: 'PRESS_B', label: 'Key B (2 Fingers)' };
    } else if (count === 3 && isIdx && isMid && (isRing || isThumb)) {
      return { type: 'KEY_C', action: 'PRESS_C', label: 'Key C (3 Fingers)' };
    } else if (count === 4 && isIdx && isMid && isRing && isPinky) {
      return { type: 'KEY_D', action: 'PRESS_D', label: 'Key D (4 Fingers)' };
    } else if (count === 5) {
      return { type: 'KEY_E', action: 'PRESS_E', label: 'Key E (5 Fingers)' };
    }

    return { type: 'IDLE', label: count > 0 ? `${count} Fingers` : 'Tracking...' };
  }
})();
