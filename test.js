// test.js - Full Interactive Playground with Direct Gesture Execution & Form Selection
document.addEventListener('DOMContentLoaded', () => {
  const kA = document.getElementById('k-A');
  const kB = document.getElementById('k-B');
  const kC = document.getElementById('k-C');
  const kD = document.getElementById('k-D');
  const kE = document.getElementById('k-E');
  const kLeft = document.getElementById('k-Left');
  const kRight = document.getElementById('k-Right');
  const kUp = document.getElementById('k-Up');
  const kDown = document.getElementById('k-Down');

  const btnStartCam = document.getElementById('btn-start-test-cam');
  const camStatus = document.getElementById('cam-status');
  const diagStatus = document.getElementById('diag-status');
  const videoContainer = document.getElementById('test-video-container');
  const webcam = document.getElementById('test-webcam');
  const canvas = document.getElementById('test-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  let testLandmarker = null;
  let testAnimId = null;
  let isTestingCam = false;

  let lastActionTime = 0;
  let lastScrollTime = 0;
  let lastPinchTime = 0;
  let lastVideoTime = -1;
  let prevPalmY = 0.5;

  let candidateGesture = null;
  let candidateStartTime = 0;
  let currentConfirmedGesture = 'Standby';

  const GESTURE_HOLD_REQUIRED_MS = 120;
  const ACTION_COOLDOWN_MS = 450;
  const SCROLL_COOLDOWN_MS = 80;
  const PINCH_COOLDOWN_MS = 380;

  // Air Cursor Element
  let airCursor = document.getElementById('test-air-cursor');
  if (!airCursor) {
    airCursor = document.createElement('div');
    airCursor.id = 'test-air-cursor';
    airCursor.style.cssText = `
      position: fixed; width: 22px; height: 22px; border-radius: 50%;
      background: #ffffff; border: 2px solid #000000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3); pointer-events: none;
      z-index: 999999; transform: translate(-50%, -50%); display: none;
      transition: width 0.12s, height 0.12s, background 0.12s;
    `;
    document.body.appendChild(airCursor);
  }

  let curX = window.innerWidth / 2;
  let curY = window.innerHeight / 2;

  function updateAirCursor(normX, normY) {
    const targetX = normX * window.innerWidth;
    const targetY = normY * window.innerHeight;
    curX += (targetX - curX) * 0.5;
    curY += (targetY - curY) * 0.5;

    airCursor.style.left = `${curX}px`;
    airCursor.style.top = `${curY}px`;
    airCursor.style.display = 'block';
  }

  function triggerPinchClick() {
    airCursor.style.background = '#000000';
    airCursor.style.width = '12px';
    airCursor.style.height = '12px';
    setTimeout(() => {
      airCursor.style.background = '#ffffff';
      airCursor.style.width = '22px';
      airCursor.style.height = '22px';
    }, 200);

    const el = document.elementFromPoint(curX, curY);
    if (el) {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
        el.dispatchEvent(new MouseEvent(evtType, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: curX,
          clientY: curY
        }));
      });
      if (typeof el.focus === 'function') el.focus();
    }
  }

  /* ------------------------------------------------------------- */
  /* Direct Camera & MediaPipe Initialization                      */
  /* ------------------------------------------------------------- */
  async function startDiagnosticCamera() {
    diagStatus.textContent = 'Requesting camera permission...';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 260, frameRate: { ideal: 30 } }
      });

      chrome.storage.local.set({ cameraPermissionGranted: true });

      webcam.srcObject = stream;
      await webcam.play();

      videoContainer.style.display = 'block';
      camStatus.textContent = 'Camera: Active';
      camStatus.style.background = '#ecfdf5';
      camStatus.style.color = '#065f46';
      diagStatus.textContent = 'Loading MediaPipe Tasks Vision...';

      canvas.width = webcam.videoWidth || 480;
      canvas.height = webcam.videoHeight || 260;

      const wasmPath = chrome.runtime.getURL('lib/wasm');
      const modelPath = chrome.runtime.getURL('lib/hand_landmarker.task');

      const vision = await Vision.FilesetResolver.forVisionTasks(wasmPath);
      const options = {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 1
      };

      try {
        testLandmarker = await Vision.HandLandmarker.createFromOptions(vision, options);
      } catch (gpuErr) {
        options.baseOptions.delegate = 'CPU';
        testLandmarker = await Vision.HandLandmarker.createFromOptions(vision, options);
      }

      diagStatus.textContent = '✓ MediaPipe Active. Move hands & fingers naturally!';
      btnStartCam.textContent = '■ Stop Camera';
      isTestingCam = true;

      function loop() {
        if (!isTestingCam) return;
        if (webcam.currentTime !== lastVideoTime && testLandmarker) {
          lastVideoTime = webcam.currentTime;
          const results = testLandmarker.detectForVideo(webcam, performance.now());
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results && results.landmarks && results.landmarks.length > 0) {
            const lm = results.landmarks[0];
            drawSkeleton(lm);
            currentConfirmedGesture = processPoseWithStability(lm);
            drawHudBanner(currentConfirmedGesture);
          }
        }
        testAnimId = requestAnimationFrame(loop);
      }
      testAnimId = requestAnimationFrame(loop);

    } catch (err) {
      diagStatus.textContent = 'Error: ' + err.message;
      camStatus.textContent = 'Camera: Blocked';
      camStatus.style.background = '#fef2f2';
      camStatus.style.color = '#991b1b';
    }
  }

  function drawSkeleton(lm) {
    if (!ctx) return;
    ctx.lineWidth = 2.5;
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
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function drawHudBanner(text) {
    if (!ctx) return;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(10, 10, canvas.width - 20, 30);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(10, 10, canvas.width - 20, 30);

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px "Times New Roman"';
    ctx.textAlign = 'center';
    ctx.fillText('Detected Gesture: ' + text, canvas.width / 2, 30);
    ctx.restore();
  }

  /* ------------------------------------------------------------- */
  /* Gesture Mapping & Direct Action Execution                     */
  /* ------------------------------------------------------------- */
  function executeGestureAction(action, label) {
    switch(action) {
      case 'PRESS_A':
        flash(kA);
        dispatchKey('a', 'KeyA', 65);
        selectQuizOption('A');
        break;
      case 'PRESS_B':
        flash(kB);
        dispatchKey('b', 'KeyB', 66);
        selectQuizOption('B');
        break;
      case 'PRESS_C':
        flash(kC);
        dispatchKey('c', 'KeyC', 67);
        selectQuizOption('C');
        break;
      case 'PRESS_D':
        flash(kD);
        dispatchKey('d', 'KeyD', 68);
        selectQuizOption('D');
        break;
      case 'PRESS_E':
        flash(kE);
        dispatchKey('e', 'KeyE', 69);
        selectQuizOption('E');
        break;
      case 'ARROW_LEFT':
        flash(kLeft);
        dispatchKey('ArrowLeft', 'ArrowLeft', 37);
        btnPrev.click();
        break;
      case 'ARROW_RIGHT':
        flash(kRight);
        dispatchKey('ArrowRight', 'ArrowRight', 39);
        btnNext.click();
        break;
      case 'SCROLL_UP':
        flash(kUp);
        window.scrollBy({ top: -260, behavior: 'smooth' });
        break;
      case 'SCROLL_DOWN':
        flash(kDown);
        window.scrollBy({ top: 260, behavior: 'smooth' });
        break;
    }
  }

  function dispatchKey(key, code, keyCode) {
    const props = { key, code, keyCode, which: keyCode, bubbles: true, composed: true, view: window };
    window.dispatchEvent(new KeyboardEvent('keydown', props));
    window.dispatchEvent(new KeyboardEvent('keyup', props));
  }

  function selectQuizOption(letter) {
    const radio = document.querySelector(`input[name="opt_choice"][value="${letter}"]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      const parent = radio.closest('.opt-item');
      if (parent) {
        document.querySelectorAll('.opt-item').forEach(x => x.classList.remove('selected'));
        parent.classList.add('selected');
      }
      const qStatus = document.getElementById('q-status');
      if (qStatus) qStatus.textContent = `Selected: [ ${letter} ]`;
    }
  }

  function processPoseWithStability(lm) {
    const raw = detectRawPose(lm);
    const now = Date.now();

    if (raw.type === candidateGesture) {
      if (now - candidateStartTime > GESTURE_HOLD_REQUIRED_MS) {
        if (raw.action && now - lastActionTime > ACTION_COOLDOWN_MS) {
          lastActionTime = now;
          executeGestureAction(raw.action, raw.label);
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
    const isFist = !isIdx && !isMid && !isRing && !isPinky;
    if (isFist) {
      const fistY = (wrist.y + lm[9].y) / 2;
      if (now - lastScrollTime > SCROLL_COOLDOWN_MS) {
        if (fistY < 0.52) {
          lastScrollTime = now;
          executeGestureAction('SCROLL_UP', 'Fist: Scroll Up');
          return { type: 'SCROLL_UP', label: 'Fist: Scroll Up' };
        } else if (fistY > 0.62) {
          lastScrollTime = now;
          executeGestureAction('SCROLL_DOWN', 'Fist: Scroll Down');
          return { type: 'SCROLL_DOWN', label: 'Fist: Scroll Down' };
        } else {
          return { type: 'FIST_IDLE', label: 'Fist: Ready to Scroll' };
        }
      }
    }

    // 2. Air Cursor Tracking (follows Index finger)
    if (isIdx) {
      const normX = 1 - lm[8].x;
      const normY = lm[8].y;
      updateAirCursor(normX, normY);

      // Pinch Click
      const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
      if (pinchDist < 0.05) {
        if (now - lastPinchTime > PINCH_COOLDOWN_MS) {
          lastPinchTime = now;
          triggerPinchClick();
          return { type: 'PINCH', label: 'Pinch Click' };
        }
        return { type: 'PINCH', label: 'Pinching' };
      }
    }

    // Horizontal Nav
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

    // Natural Finger Count: A, B, C, D, E
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

  btnStartCam.addEventListener('click', () => {
    if (isTestingCam) {
      if (testAnimId) cancelAnimationFrame(testAnimId);
      if (webcam.srcObject) {
        webcam.srcObject.getTracks().forEach(t => t.stop());
        webcam.srcObject = null;
      }
      isTestingCam = false;
      airCursor.style.display = 'none';
      btnStartCam.textContent = '▶ Start Camera & Load MediaPipe';
      videoContainer.style.display = 'none';
      camStatus.textContent = 'Camera: Offline';
      camStatus.style.background = '#f9fafb';
      camStatus.style.color = '#111827';
      diagStatus.textContent = 'Camera stopped.';
    } else {
      startDiagnosticCamera();
    }
  });

  // Target Clicks
  const clickCounter = document.getElementById('click-counter');
  let clicks = 0;
  document.querySelectorAll('.target-btn').forEach(b => {
    b.addEventListener('click', () => {
      clicks++;
      clickCounter.textContent = `Clicks: ${clicks}`;
      b.style.transform = 'scale(0.95)';
      setTimeout(() => b.style.transform = 'none', 150);
    });
  });

  function flash(el) {
    if (!el) return;
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 250);
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key ? e.key.toLowerCase() : '';
    if (k === 'a') flash(kA);
    else if (k === 'b') flash(kB);
    else if (k === 'c') flash(kC);
    else if (k === 'd') flash(kD);
    else if (k === 'e') flash(kE);
    else if (e.code === 'ArrowLeft') {
      flash(kLeft);
      btnPrev.click();
    } else if (e.code === 'ArrowRight') {
      flash(kRight);
      btnNext.click();
    }
  });

  const scrollPct = document.getElementById('scroll-pct');
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const curY = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.round((curY / max) * 100) : 0;
    scrollPct.textContent = `Scroll: ${p}%`;

    if (Math.abs(curY - lastY) > 20) {
      if (curY < lastY) flash(kUp);
      else flash(kDown);
      lastY = curY;
    }
  }, { passive: true });

  // Quiz
  const questions = [
    { q: '1. What is the current capital of Indonesia?', opts: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang'] },
    { q: '2. Which planet is known as the Red Planet?', opts: ['Venus', 'Mars', 'Jupiter', 'Saturn', 'Mercury'] },
    { q: '3. What is 7 multiplied by 8?', opts: ['48', '54', '56', '64', '72'] },
    { q: '4. Which gas is most abundant in Earth atmosphere?', opts: ['Oxygen', 'Carbon Dioxide', 'Argon', 'Nitrogen', 'Hydrogen'] },
    { q: '5. Who discovered the theory of general relativity?', opts: ['Newton', 'Tesla', 'Galileo', 'Curie', 'Einstein'] }
  ];

  let qIdx = 0;
  const qNum = document.getElementById('q-num');
  const qText = document.getElementById('q-text');
  const qOptions = document.getElementById('q-options');
  const qStatus = document.getElementById('q-status');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');

  function renderQ(i) {
    const item = questions[i];
    qNum.textContent = i + 1;
    qText.textContent = item.q;
    qOptions.innerHTML = '';
    qStatus.textContent = 'Select option A, B, C, D, or E';

    const letters = ['A', 'B', 'C', 'D', 'E'];
    letters.forEach((l, idx) => {
      const label = document.createElement('label');
      label.className = 'opt-item';
      label.innerHTML = `
        <input type="radio" name="opt_choice" value="${l}">
        <b>${l}.</b> <span>${item.opts[idx]}</span>
      `;
      label.querySelector('input').addEventListener('change', () => {
        document.querySelectorAll('.opt-item').forEach(x => x.classList.remove('selected'));
        label.classList.add('selected');
        qStatus.textContent = `Selected: [ ${l} ]`;
      });
      qOptions.appendChild(label);
    });
  }

  renderQ(qIdx);

  btnPrev.addEventListener('click', () => {
    if (qIdx > 0) {
      qIdx--;
      renderQ(qIdx);
    }
  });

  btnNext.addEventListener('click', () => {
    if (qIdx < questions.length - 1) {
      qIdx++;
      renderQ(qIdx);
    }
  });
});
