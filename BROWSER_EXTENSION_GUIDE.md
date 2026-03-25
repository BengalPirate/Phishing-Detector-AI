# Browser Extension Installation & Testing Guide

This guide will walk you through installing and testing the Phishing Detector AI browser extension step-by-step.

## Prerequisites

Before you begin, make sure:
- [ ] Backend server is running (`python api_server.py`)
- [ ] You see "Starting Phishing Detection API server on localhost:5000"
- [ ] Extension icons are created (run `python extension/icons/create_icons.py`)

## Installing the Extension

### Google Chrome / Microsoft Edge

1. **Open Extensions Page**
   - Chrome: Navigate to `chrome://extensions/`
   - Edge: Navigate to `edge://extensions/`
   - Or click the puzzle icon → "Manage Extensions"

2. **Enable Developer Mode**
   - Look for "Developer mode" toggle in the top-right corner
   - Turn it ON

3. **Load the Extension**
   - Click "Load unpacked" button
   - Navigate to your project folder: `AI_Detection_All/AI_Detection_6/extension`
   - Select the `extension` folder
   - Click "Select Folder" (or "Open" on Mac)

4. **Verify Installation**
   - You should see "Phishing Detector AI" in your extensions list
   - Extension should be enabled (toggle switch is blue/on)
   - You should see the extension icon in your browser toolbar
   - If icon is not visible, click the puzzle icon and pin "Phishing Detector AI"

### Mozilla Firefox

1. **Open Debugging Page**
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Or go to `about:debugging` and click "This Firefox" in the sidebar

2. **Load Temporary Add-on**
   - Click "Load Temporary Add-on..." button
   - Navigate to `AI_Detection_All/AI_Detection_6/extension`
   - Select the `manifest.json` file
   - Click "Open"

3. **Verify Installation**
   - Extension should appear in the list
   - You should see the extension icon in your toolbar
   - **Note**: In Firefox, temporary extensions are removed when you close the browser

## Testing the Extension

### Test 1: Popup Interface

1. **Open the Popup**
   - Click the Phishing Detector AI icon in your toolbar
   - A popup window should appear

2. **Check API Status**
   - Look at the top of the popup
   - You should see a green dot and "API Connected"
   - If you see red dot "API Offline", the backend server isn't running

3. **Paste and Analyze**
   - Copy this phishing example:
   ```
   URGENT: Your PayPal account will be suspended in 24 hours!
   Click here to verify: http://paypa1.tk/verify
   Provide your credit card number and CVV immediately to restore access.
   ```
   - Paste it into the text area
   - Select "Email" from the dropdown
   - Click "Analyze Message"
   - Wait 2-5 seconds for analysis

4. **Review Results**
   - You should see a verdict: "HIGHLY LIKELY PHISHING"
   - Risk score should be high (70-100)
   - Red flags should be listed (URL issues, urgency, sensitive info request)
   - Detailed indicators should show analysis of each dimension

### Test 2: Selected Text Analysis

1. **Open Any Webpage**
   - Go to any website (e.g., news article, blog post)

2. **Select Some Text**
   - Highlight any paragraph or sentence on the page

3. **Use Extension**
   - Click the Phishing Detector AI icon
   - Click "Analyze Selected Text" button
   - The selected text should appear in the text area
   - Results should display automatically

### Test 3: Context Menu (Right-Click)

1. **Select Text on Any Page**
   - Highlight some text on any webpage

2. **Right-Click**
   - Right-click on the selected text
   - Look for "Analyze for Phishing" in the context menu
   - Click it

3. **Extension Opens**
   - The popup should open
   - Analysis should begin automatically

### Test 4: Different Message Types

Try analyzing different types of content:

**Legitimate Email:**
```
Subject: Your Amazon order has shipped

Hello,

Your order #123-4567890-1234567 has been shipped and is on the way.

Track your package: https://www.amazon.com/tracking

Thanks for shopping with us!
- Amazon Team
```
Expected: SAFE verdict, low risk score

**Suspicious SMS:**
```
ALERT: Your bank account has been compromised.
Call us immediately at 555-0100 or click: bit.ly/bank-alert
```
Expected: SUSPICIOUS or HIGHLY LIKELY PHISHING

**Suspicious URL:**
```
https://secure-paypa1-login.tk/verify-account.php?user=12345
```
Expected: HIGHLY LIKELY PHISHING

## Troubleshooting

### Extension Icon Not Showing

**Solution:**
- Click the puzzle piece icon in Chrome/Edge toolbar
- Find "Phishing Detector AI"
- Click the pin icon to pin it to toolbar

### "API Offline" Status

**Problem**: Green dot doesn't appear, shows "API Offline"

**Solutions:**
1. Make sure backend is running:
   ```bash
   python api_server.py
   ```
2. Check the server output - should show "Running on http://localhost:5000"
3. Try accessing http://localhost:5000/api/health in your browser
4. Restart the extension: disable and re-enable in extensions page

### No Results Displayed

**Problem**: Click "Analyze" but nothing happens

**Solutions:**
1. Open browser console (F12) and check for errors
2. Make sure backend server is running
3. Check that message is not empty
4. Verify API key in .env file is valid

### Extension Won't Load

**Problem**: "Load unpacked" fails or extension shows errors

**Solutions:**
1. Make sure you selected the `extension` folder, not individual files
2. Check that all required files exist:
   - manifest.json
   - popup.html, popup.css, popup.js
   - background.js
   - content.js
3. Look at the error message - it will tell you what's wrong
4. Refresh the extension after making fixes

### Icons Not Showing

**Problem**: Extension shows generic icon

**Solution:**
```bash
cd extension/icons
pip install pillow
python create_icons.py
```
Then reload the extension.

### Firefox: Extension Gone After Restart

**This is normal!** Firefox temporary extensions are removed when you close the browser.

**Solutions:**
- Reload it each time: `about:debugging` → "Load Temporary Add-on"
- For permanent installation, the extension would need to be signed by Mozilla
- For this assignment, reloading each session is fine

## Testing Checklist

Before submitting your assignment, verify:

- [ ] Backend server starts without errors
- [ ] Extension installs successfully
- [ ] Green "API Connected" status shows in popup
- [ ] Can paste and analyze messages
- [ ] Results display correctly with verdict, risk score, red flags
- [ ] Different message types work (email, SMS, URL)
- [ ] "Analyze Selected Text" button works
- [ ] Context menu (right-click) appears and works
- [ ] Clear button resets the form
- [ ] Multiple analyses can be run in sequence

## Demo for Your Professor

Here's a suggested demo flow:

1. **Show Backend Running**
   - Open terminal showing `python api_server.py` running
   - Show "API Connected" status in extension

2. **Demonstrate Clear Phishing**
   - Paste obvious phishing email
   - Show high risk score and detailed analysis
   - Highlight the red flags detected

3. **Demonstrate Legitimate Email**
   - Paste legitimate business email
   - Show low risk score and "SAFE" verdict

4. **Show Selected Text Feature**
   - Go to a webpage (Gmail, news site, etc.)
   - Select some text
   - Use "Analyze Selected Text"
   - Show results

5. **Explain the Analysis**
   - Point out the 5 indicator categories
   - Show how the AI explains its reasoning
   - Demonstrate the educational value

## Advanced Usage

### Testing with Real Emails

1. Open your email (Gmail, Outlook, etc.)
2. Find a suspicious email
3. Select the email text
4. Right-click → "Analyze for Phishing"
5. Review the AI's analysis

### Testing URLs

1. Find a suspicious link (or create one)
2. Copy the URL
3. Open extension popup
4. Paste URL
5. Select "URL" from dropdown
6. Analyze

### Batch Testing

Use the test script for comprehensive testing:
```bash
python test_detector.py
```

This runs 5 different test cases and shows detailed results.

## Privacy Note

When you analyze a message:
1. Text is sent to your local Flask server (localhost:5000)
2. Flask server sends it to Google Gemini API
3. Results come back through the same path

The extension does NOT:
- Store any messages you analyze
- Send data anywhere except Google Gemini API
- Access your emails without you selecting text
- Run automatically in the background

## Next Steps

Once the extension is working:
- Try analyzing real suspicious emails
- Experiment with different message types
- Review the detailed indicators to learn about phishing
- Read the README.md for full documentation
- Check ASSIGNMENT_NOTES.md for assignment compliance

Good luck with your assignment!
