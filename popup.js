// popup.js - Controls master extension switch & floating bubble toggle
document.addEventListener('DOMContentLoaded', () => {
  const btnTest = document.getElementById('btn-test');
  const btnSidePanel = document.getElementById('btn-sidepanel');
  const swMaster = document.getElementById('sw-master');
  const swFloating = document.getElementById('sw-floating');
  const swCursor = document.getElementById('sw-cursor');
  const swHand = document.getElementById('sw-hand');
  const swMouse = document.getElementById('sw-mouse');
  const swSelect = document.getElementById('sw-select');
  const swSound = document.getElementById('sw-sound');

  // Load configuration
  chrome.storage.local.get([
    'extensionEnabled',
    'floatingVisible',
    'airCursorEnabled',
    'handGestureEnabled',
    'mouseGestureEnabled',
    'autoSelectEnabled',
    'soundEnabled'
  ], (d) => {
    if (d.extensionEnabled !== undefined) swMaster.checked = d.extensionEnabled;
    if (d.floatingVisible !== undefined) swFloating.checked = d.floatingVisible;
    if (d.airCursorEnabled !== undefined) swCursor.checked = d.airCursorEnabled;
    if (d.handGestureEnabled !== undefined) swHand.checked = d.handGestureEnabled;
    if (d.mouseGestureEnabled !== undefined) swMouse.checked = d.mouseGestureEnabled;
    if (d.autoSelectEnabled !== undefined) swSelect.checked = d.autoSelectEnabled;
    if (d.soundEnabled !== undefined) swSound.checked = d.soundEnabled;
  });

  swMaster.addEventListener('change', () => {
    chrome.storage.local.set({ extensionEnabled: swMaster.checked });
  });

  swFloating.addEventListener('change', () => {
    chrome.storage.local.set({ floatingVisible: swFloating.checked });
  });

  swCursor.addEventListener('change', () => chrome.storage.local.set({ airCursorEnabled: swCursor.checked }));
  swHand.addEventListener('change', () => chrome.storage.local.set({ handGestureEnabled: swHand.checked }));
  swMouse.addEventListener('change', () => chrome.storage.local.set({ mouseGestureEnabled: swMouse.checked }));
  swSelect.addEventListener('change', () => chrome.storage.local.set({ autoSelectEnabled: swSelect.checked }));
  swSound.addEventListener('change', () => chrome.storage.local.set({ soundEnabled: swSound.checked }));

  btnTest.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('test.html') });
  });

  if (btnSidePanel) {
    btnSidePanel.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ tabId: tab.id });
        window.close();
      }
    });
  }
});
