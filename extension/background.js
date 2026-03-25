/**
 * Background service worker for Phishing Detector AI
 * Handles context menu integration and background tasks
 */

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    // Create context menu for selected text
    chrome.contextMenus.create({
        id: 'analyzePhishing',
        title: 'Analyze for Phishing',
        contexts: ['selection']
    });

    // Create context menu for links
    chrome.contextMenus.create({
        id: 'analyzeLink',
        title: 'Check Link for Phishing',
        contexts: ['link']
    });

    console.log('Phishing Detector AI extension installed');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'analyzePhishing') {
        // Store selected text and open popup
        chrome.storage.local.set({
            selectedText: info.selectionText,
            messageType: 'email'
        }, () => {
            chrome.action.openPopup();
        });
    } else if (info.menuItemId === 'analyzeLink') {
        // Store link URL and open popup
        chrome.storage.local.set({
            selectedText: info.linkUrl,
            messageType: 'url'
        }, () => {
            chrome.action.openPopup();
        });
    }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyzeText') {
        // Store text for analysis
        chrome.storage.local.set({
            selectedText: request.text,
            messageType: request.type || 'email'
        });
        sendResponse({ success: true });
    }
    return true;
});

// Log extension activity (for debugging)
console.log('Phishing Detector AI background script loaded');
