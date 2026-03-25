/**
 * Popup script for Phishing Detector AI browser extension
 * Handles UI interactions and communicates with the backend API
 */

// Configuration
const API_BASE_URL = 'http://localhost:8080/api';

// DOM Elements
let messageInput, messageType, analyzeBtn, analyzeText, analyzeLoader;
let analyzeSelectedBtn, clearBtn;
let resultsSection, errorSection;
let statusDot, statusText;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    setupEventListeners();
    checkAPIStatus();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
    // Input elements
    messageInput = document.getElementById('messageInput');
    messageType = document.getElementById('messageType');
    analyzeBtn = document.getElementById('analyzeBtn');
    analyzeText = document.getElementById('analyzeText');
    analyzeLoader = document.getElementById('analyzeLoader');

    // Action buttons
    analyzeSelectedBtn = document.getElementById('analyzeSelectedBtn');
    clearBtn = document.getElementById('clearBtn');

    // Section elements
    resultsSection = document.getElementById('resultsSection');
    errorSection = document.getElementById('errorSection');

    // Status elements
    statusDot = document.getElementById('statusDot');
    statusText = document.getElementById('statusText');
}

/**
 * Setup event listeners for all interactive elements
 */
function setupEventListeners() {
    analyzeBtn.addEventListener('click', handleAnalyze);
    analyzeSelectedBtn.addEventListener('click', handleAnalyzeSelected);
    clearBtn.addEventListener('click', handleClear);
    messageInput.addEventListener('input', handleInputChange);
}

/**
 * Check if the backend API is available
 */
async function checkAPIStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();

        if (data.status === 'healthy') {
            updateStatus(true, 'API Connected');
        } else {
            updateStatus(false, 'API Not Ready');
        }
    } catch (error) {
        updateStatus(false, 'API Offline - Start backend server');
        console.error('API health check failed:', error);
    }
}

/**
 * Update the status indicator
 */
function updateStatus(connected, message) {
    statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = message;
}

/**
 * Handle input change to enable/disable analyze button
 */
function handleInputChange() {
    const hasContent = messageInput.value.trim().length > 0;
    analyzeBtn.disabled = !hasContent;
}

/**
 * Handle analyze button click
 */
async function handleAnalyze() {
    const message = messageInput.value.trim();

    if (!message) {
        showError('Please enter a message to analyze');
        return;
    }

    const type = messageType.value;
    await analyzeMessage(message, type);
}

/**
 * Handle analyze selected text button click
 */
async function handleAnalyzeSelected() {
    try {
        // Get selected text from the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        chrome.tabs.sendMessage(tab.id, { action: 'getSelectedText' }, (response) => {
            if (chrome.runtime.lastError) {
                showError('Could not get selected text. Please try copying and pasting.');
                return;
            }

            if (response && response.text) {
                messageInput.value = response.text;
                messageType.value = 'email';
                handleAnalyze();
            } else {
                showError('No text selected. Please select text on the page.');
            }
        });
    } catch (error) {
        showError('Error getting selected text: ' + error.message);
    }
}

/**
 * Handle clear button click
 */
function handleClear() {
    messageInput.value = '';
    hideResults();
    hideError();
    analyzeBtn.disabled = true;
}

/**
 * Analyze a message using the backend API
 */
async function analyzeMessage(message, type) {
    // Show loading state
    setLoading(true);
    hideResults();
    hideError();

    try {
        const response = await fetch(`${API_BASE_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                type: type
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Analysis failed');
        }

        const result = await response.json();
        displayResults(result);

    } catch (error) {
        console.error('Analysis error:', error);
        showError('Analysis failed: ' + error.message);
    } finally {
        setLoading(false);
    }
}

/**
 * Display analysis results
 */
function displayResults(result) {
    // Hide error if showing
    hideError();

    // Get result elements
    const verdictCard = document.getElementById('verdictCard');
    const verdictIcon = document.getElementById('verdictIcon');
    const verdictText = document.getElementById('verdictText');
    const riskScore = document.getElementById('riskScore');
    const explanation = document.getElementById('explanation');
    const userAdvice = document.getElementById('userAdvice');
    const indicatorsGrid = document.getElementById('indicatorsGrid');
    const redFlagsSection = document.getElementById('redFlagsSection');
    const redFlagsList = document.getElementById('redFlagsList');

    // Set verdict styling
    verdictCard.className = 'verdict-card';
    if (result.verdict === 'SAFE') {
        verdictCard.classList.add('safe');
        verdictIcon.textContent = '✅';
    } else if (result.verdict === 'SUSPICIOUS') {
        verdictCard.classList.add('suspicious');
        verdictIcon.textContent = '⚠️';
    } else {
        verdictCard.classList.add('phishing');
        verdictIcon.textContent = '🚨';
    }

    // Set verdict text and score
    verdictText.textContent = result.verdict;
    riskScore.textContent = `${result.risk_score}/100`;

    // Set explanation and advice
    explanation.textContent = result.explanation;
    userAdvice.textContent = result.user_advice;

    // Display red flags if any
    if (result.red_flags && result.red_flags.length > 0) {
        redFlagsSection.style.display = 'block';
        redFlagsList.innerHTML = '';
        result.red_flags.forEach(flag => {
            const li = document.createElement('li');
            li.textContent = flag;
            redFlagsList.appendChild(li);
        });
    } else {
        redFlagsSection.style.display = 'none';
    }

    // Display indicators
    if (result.indicators) {
        indicatorsGrid.innerHTML = '';
        const indicators = [
            { key: 'sender_analysis', label: 'Sender Analysis' },
            { key: 'urgency_tactics', label: 'Urgency Tactics' },
            { key: 'link_analysis', label: 'Link Analysis' },
            { key: 'grammar_tone', label: 'Grammar & Tone' },
            { key: 'requested_action', label: 'Requested Action' }
        ];

        indicators.forEach(ind => {
            if (result.indicators[ind.key]) {
                const div = document.createElement('div');
                div.className = 'indicator-item';
                div.innerHTML = `
                    <strong>${ind.label}</strong>
                    <span>${result.indicators[ind.key]}</span>
                `;
                indicatorsGrid.appendChild(div);
            }
        });
    }

    // Show results section
    resultsSection.style.display = 'block';

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Show error message
 */
function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
    resultsSection.style.display = 'none';
}

/**
 * Hide error message
 */
function hideError() {
    errorSection.style.display = 'none';
}

/**
 * Hide results section
 */
function hideResults() {
    resultsSection.style.display = 'none';
}

/**
 * Set loading state for analyze button
 */
function setLoading(loading) {
    analyzeBtn.disabled = loading;
    analyzeText.style.display = loading ? 'none' : 'inline';
    analyzeLoader.style.display = loading ? 'inline-block' : 'none';
}
