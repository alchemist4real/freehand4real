// Background service worker for freehand4real

chrome.runtime.onInstalled.addListener(async (details) => {
  // Set default configuration
  chrome.storage.local.set({
    airCursorEnabled: true,
    handGestureEnabled: true,
    mouseGestureEnabled: true,
    autoSelectEnabled: true,
    soundEnabled: true,
    widgetVisible: true,
    widgetMinimized: false
  });

  // Enable side panel behavior
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }

  // Auto-inject content script into all existing HTTP/HTTPS/File tabs
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
    for (const tab of tabs) {
      if (tab.id && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {});
        chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css']
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('Auto-injection warning:', e);
  }

  // Open permission tab on fresh install
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  }
});

// Central Message Dispatcher to Active Tab
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXECUTE_ON_ACTIVE_TAB' || request.action === 'BROADCAST_GESTURE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: request.type || 'GESTURE_ACTION',
          action: request.gestureAction || request.actionName,
          normX: request.normX,
          normY: request.normY
        }).catch(() => {});
      }
    });
    sendResponse({ status: 'dispatched' });
  } else if (request.action === 'OPEN_PERMISSION_TAB') {
    chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    sendResponse({ status: 'ok' });
  } else if (request.action === 'OPEN_TEST_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('test.html') });
    sendResponse({ status: 'ok' });
  } else if (request.action === 'OPEN_SIDE_PANEL') {
    if (chrome.sidePanel && sender.tab && sender.tab.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id });
    }
    sendResponse({ status: 'ok' });
  }
  return true;
});
