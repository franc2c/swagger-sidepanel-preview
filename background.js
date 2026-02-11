// Background service worker
// Handles context menu and side panel opening

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'import-openapi-selection',
    title: 'Import to Swagger Side Preview',
    contexts: ['selection']
  });
});

// Open side panel when clicking the extension icon
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Handle context menu click: grab selected text and send to side panel
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'import-openapi-selection') {
    // First, open the side panel
    chrome.sidePanel.open({ tabId: tab.id }).then(() => {
      // Give the panel a moment to load, then send the selected text
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'IMPORT_SELECTION',
          text: info.selectionText
        });
      }, 500);
    });
  }
});

// Relay messages from content script to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'IMPORT_SELECTION') {
    // Forward to side panel (it listens for this)
    // The side panel picks it up via its own onMessage listener
  }
});
