// permission.js
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-request');
  const statusBox = document.getElementById('status-box');

  async function requestCamera() {
    statusBox.className = 'status';
    statusBox.textContent = 'Requesting camera... Please click "Allow" on the prompt.';
    statusBox.style.display = 'block';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 }
      });

      // Stop stream immediately after permission granted
      stream.getTracks().forEach(t => t.stop());

      chrome.storage.local.set({ cameraPermissionGranted: true });

      statusBox.className = 'status success';
      statusBox.textContent = '✓ Camera permission granted! Redirecting to playground...';

      setTimeout(() => {
        window.location.href = chrome.runtime.getURL('test.html');
      }, 1200);
    } catch (err) {
      statusBox.className = 'status error';
      statusBox.textContent = 'Camera blocked or error: ' + err.message + '. Please click the camera icon in your address bar and choose "Always allow".';
    }
  }

  btn.addEventListener('click', requestCamera);

  // Auto trigger prompt
  requestCamera();
});
