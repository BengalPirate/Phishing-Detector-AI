/**
 * Background service worker / event page for Phishing Detector AI.
 *
 * Cross-browser: the `chrome.*` namespace works in Chrome, Edge, Firefox (MV3),
 * and Safari. The surfaces differ, so we feature-detect:
 *   - Chrome / Edge : chrome.sidePanel  (opens the side panel on action click)
 *   - Firefox       : sidebarAction     (native sidebar)
 *   - Safari        : action popup      (opened by the browser; nothing to do here)
 *
 * The AI model never runs here (no WebGPU in workers); all inference is in the
 * panel/popup page. This script only handles the action, context menus, and
 * stashing selected text for the panel to pick up.
 */

const ext = (globalThis.browser || globalThis.chrome) as typeof chrome & {
  sidebarAction?: { open(): Promise<void> };
};
const hasSidePanel = !!(ext.sidePanel && ext.sidePanel.setPanelBehavior);
const hasSidebar = !!ext.sidebarAction;

ext.runtime.onInstalled.addListener(() => {
  // Chrome/Edge: clicking the toolbar icon opens the side panel.
  if (hasSidePanel) {
    ext.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error('setPanelBehavior failed:', err));
  }

  try {
    ext.contextMenus.create({
      id: 'analyzePhishing',
      title: 'Analyze for Phishing',
      contexts: ['selection'],
    });
    ext.contextMenus.create({
      id: 'analyzeLink',
      title: 'Check Link for Phishing',
      contexts: ['link'],
    });
  } catch (err) {
    console.warn('contextMenus unavailable:', err);
  }

  console.log('Phishing Detector AI installed');
});

// Firefox: open the sidebar when the toolbar icon is clicked.
// (Chrome opens the side panel via setPanelBehavior above; Safari uses a popup.)
if (!hasSidePanel && hasSidebar && ext.action && ext.action.onClicked) {
  ext.action.onClicked.addListener(() => {
    try {
      ext.sidebarAction?.open();
    } catch (err) {
      console.warn('sidebarAction.open failed:', err);
    }
  });
}

// Context-menu clicks: stash the text, then surface the UI where possible.
ext.contextMenus?.onClicked.addListener(async (info, tab) => {
  let payload: { selectedText: string; messageType: string } | null = null;
  if (info.menuItemId === 'analyzePhishing' && info.selectionText) {
    payload = { selectedText: info.selectionText, messageType: 'email' };
  } else if (info.menuItemId === 'analyzeLink' && info.linkUrl) {
    payload = { selectedText: info.linkUrl, messageType: 'url' };
  }
  if (!payload) return;

  await ext.storage.local.set(payload);

  try {
    if (hasSidePanel && tab && tab.windowId !== undefined) {
      await ext.sidePanel.open({ windowId: tab.windowId });
    } else if (hasSidebar) {
      await ext.sidebarAction?.open();
    }
    // Safari: cannot programmatically open the popup; the stashed text is
    // prefilled the next time the user opens it.
  } catch (err) {
    console.warn('Could not open panel/sidebar:', err);
  }
});

ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeText') {
    ext.storage.local.set({
      selectedText: request.text,
      messageType: request.type || 'email',
    });
    sendResponse({ success: true });
  }
  return true;
});

console.log('Phishing Detector AI background script loaded');
