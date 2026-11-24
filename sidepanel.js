// sidepanel.js - Runs continuously in Chrome Side Panel, controlling whichever tab is active!
document.addEventListener('DOMContentLoaded', () => {
  const btnCam = document.getElementById('btn-side-cam');
  const webcam = document.getElementById('side-webcam');
  const canvas = document.getElementById('side-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const statusEl = document.getElementById('side-status');
  const keyBtns = document.querySelectorAll('.key-btn');

  let handLandmarker = null;
  let animId = null;
  let isCamRunning = false;

  let lastActionTime = 0;
  let lastScrollTime = 0;
  let lastPinchTime = 0;
  let lastVideoTime = -1;
  let prevPalmY = 0.5;

  let candidateGesture = null;
  let candidateStartTime = 0;

  function setStatus(text, active = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('active', active);
  }

  function dispatchToActiveTab(actionName, label) {
    setStatus(label || actionName, true);
    setTimeout(() => setStatus('Tracking...', false), 700);

    // Flash UI key
    const btn = document.querySelector(`[data-act="${actionName}"]`);
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 150);
    }

    // Broadcast to active tab
    chrome.runtime.sendMessage({
      action: 'EXECUTE_ON_ACTIVE_TAB',
      gestureAction: actionName
    }).catch(() => {});
  }

  keyBtns.forEach(b => {
    b.addEventListener('click', () => {
      dispatchToActiveTab(b.dataset.act, b.innerText.trim());
    });
  });

  async function startCam() {
    setStatus('Loading Camera...', false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: { ideal: 30 } }
      });
      webcam.srcObject = stream;
      await webcam.play();

      canvas.width = webcam.videoWidth || 320;
      canvas.height = webcam.videoHeight || 240;

      setStatus('Loading AI...', false);
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
      } catch (e) {
        options.baseOptions.delegate = 'CPU';
        handLandmarker = await Vision.HandLandmarker.createFromOptions(vision, options);
      }

      isCamRunning = true;
      btnCam.textContent = '■ Stop Camera';
      setStatus('Tracking Active Tab...', false);

      function loop() {
        if (!isCamRunning) return;
        if (webcam.currentTime !== lastVideoTime && handLandmarker) {
          lastVideoTime = webcam.currentTime;
          const results = handLandmarker.detectForVideo(webcam, performance.now());
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results && results.landmarks && results.landmarks.length > 0) {
            const lm = results.landmarks[0];
            drawSkeleton(lm);
            processPose(lm);
          }
        }
        animId = requestAnimationFrame(loop);
      }
      animId = requestAnimationFrame(loop);

    } catch (err) {
      setStatus('Cam Error: ' + err.message, true);
    }
  }

  function drawSkeleton(lm) {
    if (!ctx) return;
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

  function processPose(lm) {
    const raw = detectRawPose(lm);
    const now = Date.now();

    if (raw.type === candidateGesture) {
      if (now - candidateStartTime > 120) {
        if (raw.action && now - lastActionTime > 450) {
          lastActionTime = now;
          dispatchToActiveTab(raw.action, raw.label);
        }
      }
    } else {
      candidateGesture = raw.type;
      candidateStartTime = now;
    }
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
      if (now - lastScrollTime > 80) {
        if (fistY < 0.52) {
          lastScrollTime = now;
          dispatchToActiveTab('SCROLL_UP', 'Fist: Scroll Up');
          return { type: 'SCROLL_UP', label: 'Fist: Scroll Up' };
        } else if (fistY > 0.62) {
          lastScrollTime = now;
          dispatchToActiveTab('SCROLL_DOWN', 'Fist: Scroll Down');
          return { type: 'SCROLL_DOWN', label: 'Fist: Scroll Down' };
        } else {
          return { type: 'FIST_IDLE', label: 'Fist: Ready to Scroll' };
        }
      }
    }

    // 2. Air Cursor broadcast
    if (isIdx) {
      const normX = 1 - lm[8].x;
      const normY = lm[8].y;
      chrome.runtime.sendMessage({ action: 'BROADCAST_GESTURE', type: 'AIR_CURSOR_MOVE', normX, normY }).catch(() => {});

      // Pinch click
      const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
      if (pinchDist < 0.05) {
        if (now - lastPinchTime > 380) {
          lastPinchTime = now;
          dispatchToActiveTab('CLICK', 'Pinch Click');
          chrome.runtime.sendMessage({ action: 'BROADCAST_GESTURE', type: 'AIR_CURSOR_CLICK' }).catch(() => {});
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
        if (dx > 0.09) return { type: 'ARROW_LEFT', action: 'ARROW_LEFT', label: 'Left Arrow' };
        else if (dx < -0.09) return { type: 'ARROW_RIGHT', action: 'ARROW_RIGHT', label: 'Right Arrow' };
      }
    }

    // Keys A, B, C, D, E
    if (count === 1 && isIdx) return { type: 'KEY_A', action: 'PRESS_A', label: 'Key A' };
    if (count === 2 && isIdx && isMid) return { type: 'KEY_B', action: 'PRESS_B', label: 'Key B' };
    if (count === 3 && isIdx && isMid && (isRing || isThumb)) return { type: 'KEY_C', action: 'PRESS_C', label: 'Key C' };
    if (count === 4 && isIdx && isMid && isRing && isPinky) return { type: 'KEY_D', action: 'PRESS_D', label: 'Key D' };
    if (count === 5) return { type: 'KEY_E', action: 'PRESS_E', label: 'Key E' };

    return { type: 'IDLE', label: count > 0 ? `${count} Fingers` : 'Tracking...' };
  }

  btnCam.addEventListener('click', () => {
    if (isCamRunning) {
      if (animId) cancelAnimationFrame(animId);
      if (webcam.srcObject) {
        webcam.srcObject.getTracks().forEach(t => t.stop());
        webcam.srcObject = null;
      }
      isCamRunning = false;
      btnCam.textContent = '▶ Start Camera';
      setStatus('Offline', false);
    } else {
      startCam();
    }
  });
});
