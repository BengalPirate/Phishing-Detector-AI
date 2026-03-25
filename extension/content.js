/**
 * Content script for Phishing Detector AI
 * Runs on all web pages to enable text selection analysis
 */

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSelectedText') {
        const selectedText = window.getSelection().toString().trim();
        sendResponse({ text: selectedText });
    }
    return true;
});

// Log content script loading (for debugging)
console.log('Phishing Detector AI content script loaded');
