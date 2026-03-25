"""
Flask API Server for Phishing Detection Browser Extension
Provides REST API endpoints for the browser extension to communicate with.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from phishing_detector import PhishingDetector
import logging
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)

# Enable CORS for browser extension
CORS(app, resources={
    r"/api/*": {
        "origins": ["chrome-extension://*", "moz-extension://*"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize the phishing detector
try:
    detector = PhishingDetector()
    logger.info("Phishing detector initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize phishing detector: {e}")
    detector = None


@app.route('/api/health', methods=['GET'])
def health_check():
    """
    Health check endpoint to verify the API is running.
    """
    return jsonify({
        'status': 'healthy',
        'message': 'Phishing Detection API is running',
        'detector_status': 'ready' if detector else 'not initialized'
    }), 200


@app.route('/api/analyze', methods=['POST', 'OPTIONS'])
def analyze_message():
    """
    Analyze a message for phishing indicators.

    Expected JSON payload:
    {
        "message": "The message content to analyze",
        "type": "email" | "sms" | "url" | "chat"  (optional, default: "email")
    }

    Returns:
    {
        "verdict": "SAFE" | "SUSPICIOUS" | "HIGHLY LIKELY PHISHING",
        "risk_score": 0-100,
        "red_flags": [...],
        "explanation": "...",
        "user_advice": "...",
        "indicators": {...}
    }
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 204

    # Check if detector is initialized
    if not detector:
        return jsonify({
            'error': 'Phishing detector not initialized',
            'message': 'Please check API key configuration'
        }), 503

    try:
        # Get request data
        data = request.get_json()

        if not data:
            return jsonify({
                'error': 'Invalid request',
                'message': 'Request body must be JSON'
            }), 400

        # Extract message and type
        message = data.get('message', '')
        message_type = data.get('type', 'email')

        if not message:
            return jsonify({
                'error': 'Missing message',
                'message': 'The "message" field is required'
            }), 400

        # Validate message type
        valid_types = ['email', 'sms', 'url', 'chat']
        if message_type not in valid_types:
            message_type = 'email'

        # Log the request
        logger.info(f"Analyzing {message_type} message (length: {len(message)} chars)")

        # Analyze the message
        result = detector.analyze_message(message, message_type)

        # Log the result
        logger.info(f"Analysis complete: {result['verdict']} (risk score: {result['risk_score']})")

        return jsonify(result), 200

    except Exception as e:
        logger.error(f"Error analyzing message: {e}")
        return jsonify({
            'error': 'Analysis failed',
            'message': str(e)
        }), 500


@app.route('/api/analyze/batch', methods=['POST', 'OPTIONS'])
def analyze_batch():
    """
    Analyze multiple messages in batch.

    Expected JSON payload:
    {
        "messages": [
            {"content": "message 1", "type": "email"},
            {"content": "message 2", "type": "sms"},
            ...
        ]
    }

    Returns:
    {
        "results": [
            {...analysis result 1...},
            {...analysis result 2...},
            ...
        ],
        "summary": {
            "total": 10,
            "safe": 5,
            "suspicious": 3,
            "phishing": 2
        }
    }
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 204

    # Check if detector is initialized
    if not detector:
        return jsonify({
            'error': 'Phishing detector not initialized',
            'message': 'Please check API key configuration'
        }), 503

    try:
        # Get request data
        data = request.get_json()

        if not data:
            return jsonify({
                'error': 'Invalid request',
                'message': 'Request body must be JSON'
            }), 400

        messages = data.get('messages', [])

        if not messages or not isinstance(messages, list):
            return jsonify({
                'error': 'Invalid messages',
                'message': 'The "messages" field must be a non-empty array'
            }), 400

        # Limit batch size
        if len(messages) > 50:
            return jsonify({
                'error': 'Batch too large',
                'message': 'Maximum 50 messages per batch request'
            }), 400

        logger.info(f"Analyzing batch of {len(messages)} messages")

        # Analyze all messages
        results = detector.analyze_batch(messages)

        # Generate summary
        summary = {
            'total': len(results),
            'safe': sum(1 for r in results if r['verdict'] == 'SAFE'),
            'suspicious': sum(1 for r in results if r['verdict'] == 'SUSPICIOUS'),
            'phishing': sum(1 for r in results if r['verdict'] == 'HIGHLY LIKELY PHISHING')
        }

        logger.info(f"Batch analysis complete: {summary}")

        return jsonify({
            'results': results,
            'summary': summary
        }), 200

    except Exception as e:
        logger.error(f"Error analyzing batch: {e}")
        return jsonify({
            'error': 'Batch analysis failed',
            'message': str(e)
        }), 500


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """
    Get API statistics (placeholder for future implementation).
    """
    return jsonify({
        'message': 'Statistics endpoint - to be implemented',
        'detector_model': detector.model_name if detector else None
    }), 200


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({
        'error': 'Not found',
        'message': 'The requested endpoint does not exist'
    }), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    logger.error(f"Internal error: {error}")
    return jsonify({
        'error': 'Internal server error',
        'message': 'An unexpected error occurred'
    }), 500


def main():
    """
    Run the Flask development server.
    """
    host = os.getenv('BACKEND_HOST', 'localhost')
    port = int(os.getenv('BACKEND_PORT', 5000))

    logger.info(f"Starting Phishing Detection API server on {host}:{port}")
    logger.info("Press Ctrl+C to stop the server")

    app.run(
        host=host,
        port=port,
        debug=True  # Set to False in production
    )


if __name__ == '__main__':
    main()
