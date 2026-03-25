"""
Phishing Detection System using Google Gemini API
This module provides phishing analysis using advanced prompt engineering
and the Gemini generative AI model.
"""

import json
import os
import re
from typing import Dict, List, Any
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables
load_dotenv()

class PhishingDetector:
    """
    A cybersecurity-focused phishing detector leveraging Google Gemini API
    with sophisticated prompt engineering for phishing analysis.
    """

    def __init__(self, model_name: str = None, use_few_shot: bool = True):
        """
        Initialize the phishing detector with Gemini API.

        Args:
            model_name: Name of the Gemini model to use (default: from .env)
            use_few_shot: Whether to include few-shot examples in prompts (default: True)
        """
        # Configure Gemini API
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")

        genai.configure(api_key=api_key)

        # Set model
        self.model_name = model_name or os.getenv('GEMINI_MODEL', 'gemini-1.5-flash')
        self.model = genai.GenerativeModel(self.model_name)
        self.use_few_shot = use_few_shot

        # Configure generation parameters for consistent JSON output
        self.generation_config = {
            'temperature': 0.1,  # Low temperature for more consistent outputs
            'top_p': 0.95,
            'top_k': 40,
            'max_output_tokens': 2048,
        }

    def _create_system_prompt(self) -> str:
        """
        Create the system prompt that instructs Gemini to act as a cybersecurity analyst.
        This uses advanced prompt engineering techniques for optimal performance.

        Returns:
            System prompt string
        """
        return """You are an expert cybersecurity analyst specializing in phishing detection.
Your task is to analyze messages (emails, SMS, chat messages, or URLs) and provide a comprehensive
risk assessment based on multiple phishing indicators.

ANALYSIS FRAMEWORK - Evaluate the following dimensions:

1. SENDER/EMAIL ADDRESS ANALYSIS
   - Check for impersonation of known brands/organizations
   - Identify typosquatting (e.g., paypa1.com instead of paypal.com)
   - Look for use of free email providers for corporate communications
   - Examine domain reputation and legitimacy
   - Check for mismatched sender display names and email addresses

2. URGENCY & PSYCHOLOGICAL MANIPULATION
   - Detect artificial urgency or time pressure ("act now", "within 24 hours")
   - Identify fear-based tactics (account suspension, security breach)
   - Look for too-good-to-be-true offers or rewards
   - Check for authority exploitation (pretending to be CEO, IT, law enforcement)

3. LINK & DOMAIN INSPECTION
   - Analyze URL structure for suspicious patterns
   - Check for domain/subdomain tricks (e.g., secure-paypal.phishing.com)
   - Identify suspicious TLDs (.tk, .ml, .ga, etc.)
   - Detect mismatches between link text and actual URL
   - Look for URL shorteners hiding the true destination
   - Check for typosquatting in URLs

4. GRAMMAR, TONE & FORMATTING
   - Identify poor grammar, spelling errors, or awkward phrasing
   - Detect unusual formatting or inconsistent styling
   - Look for generic greetings ("Dear Customer" instead of your name)
   - Check for professional tone inconsistency with claimed sender

5. REQUESTED ACTION ANALYSIS
   - Check if asking for sensitive information (passwords, SSN, credit cards)
   - Identify requests for MFA codes or verification codes
   - Look for payment requests, especially urgent ones
   - Detect requests to download attachments or click links
   - Check for requests to grant remote access or install software

OUTPUT FORMAT:
You must respond ONLY with valid JSON in exactly this structure:
{
    "verdict": "SAFE" | "SUSPICIOUS" | "HIGHLY LIKELY PHISHING",
    "risk_score": <integer 0-100>,
    "red_flags": [
        "List of specific red flags found"
    ],
    "explanation": "2-4 sentence summary of your analysis and reasoning",
    "user_advice": "Clear, actionable advice for the user",
    "indicators": {
        "sender_analysis": "Brief assessment",
        "urgency_tactics": "Brief assessment",
        "link_analysis": "Brief assessment",
        "grammar_tone": "Brief assessment",
        "requested_action": "Brief assessment"
    }
}

IMPORTANT:
- Be thorough but concise
- Base your verdict on evidence found in the message
- Risk score should reflect the severity: 0-30 (SAFE), 31-70 (SUSPICIOUS), 71-100 (HIGHLY LIKELY PHISHING)
- Provide specific examples from the message to support your findings
- Return ONLY valid JSON, no additional text before or after"""

    def _get_few_shot_examples(self) -> str:
        """
        Provide few-shot learning examples to improve model performance.

        Returns:
            String containing example analyses
        """
        return """
EXAMPLE 1 - Clear Phishing:

MESSAGE:
URGENT: Your account will be suspended! Click here now: http://paypa1.tk/verify
Provide your password immediately.

ANALYSIS:
{
    "verdict": "HIGHLY LIKELY PHISHING",
    "risk_score": 95,
    "red_flags": [
        "Typosquatting domain: paypa1.tk instead of paypal.com",
        "Suspicious TLD: .tk",
        "Extreme urgency: 'URGENT', 'immediately'",
        "Requests sensitive information: password",
        "Generic greeting, no personalization"
    ],
    "explanation": "This is a classic phishing attempt with multiple red flags including typosquatting (paypa1 instead of paypal), a suspicious .tk domain, extreme urgency tactics, and direct requests for passwords which legitimate companies never do via unsolicited messages.",
    "user_advice": "Do NOT click the link or provide any information. Delete this message immediately. If concerned about your PayPal account, visit paypal.com directly by typing the URL.",
    "indicators": {
        "sender_analysis": "Domain uses typosquatting and suspicious TLD",
        "urgency_tactics": "Extreme urgency with 'URGENT' and 'immediately'",
        "link_analysis": "Typosquatted domain paypa1.tk, suspicious TLD",
        "grammar_tone": "Generic greeting, unprofessional tone",
        "requested_action": "Requests password directly, major red flag"
    }
}

EXAMPLE 2 - Legitimate Email:

MESSAGE:
Subject: Your Amazon Order #123-456 Has Shipped

Hello John Smith,

Your recent order has shipped. You can track your package at:
https://www.amazon.com/your-orders

Order details:
- Order #: 123-456-789
- Delivery: March 28, 2024

Thank you for shopping with Amazon.

ANALYSIS:
{
    "verdict": "SAFE",
    "risk_score": 5,
    "red_flags": [],
    "explanation": "This appears to be a legitimate shipping notification with proper personalization, legitimate Amazon domain, no urgency tactics, and no requests for sensitive information. The URL matches the claimed sender.",
    "user_advice": "This email appears legitimate. However, you can verify by logging into your Amazon account directly and checking your orders, rather than clicking links in emails.",
    "indicators": {
        "sender_analysis": "Uses legitimate amazon.com domain",
        "urgency_tactics": "No urgency or pressure tactics present",
        "link_analysis": "Legitimate amazon.com domain",
        "grammar_tone": "Professional, personalized greeting",
        "requested_action": "No sensitive information requested"
    }
}

EXAMPLE 3 - Suspicious Business Email Compromise:

MESSAGE:
From: CEO Johnson
Subject: Urgent Wire Transfer

I'm in a meeting. Need you to wire $50,000 to supplier immediately.
Account: 123456789, Routing: 987654321
Don't reply, just confirm when done.

ANALYSIS:
{
    "verdict": "HIGHLY LIKELY PHISHING",
    "risk_score": 90,
    "red_flags": [
        "Unusual urgency for financial transaction",
        "Requests immediate action without verification",
        "Instructs not to reply or verify",
        "Lacks official channels or approval process",
        "Generic greeting, no context or details",
        "Authority exploitation (impersonating CEO)"
    ],
    "explanation": "This is a Business Email Compromise (BEC) attempt exploiting authority. The sender claims to be a CEO requesting urgent financial transfers without proper verification channels, explicitly instructing not to reply, which prevents verification.",
    "user_advice": "DO NOT proceed with any financial transaction. Verify directly with the CEO through known phone numbers or in-person contact. Legitimate CEOs use proper channels for financial approvals, not unsolicited emails.",
    "indicators": {
        "sender_analysis": "Claims to be CEO but lacks verification",
        "urgency_tactics": "Extreme urgency, 'immediately', prevents verification",
        "link_analysis": "No links present",
        "grammar_tone": "Terse, lacks professional context",
        "requested_action": "Large financial transfer without verification"
    }
}

Now analyze the following message using the same framework:
"""

    def _extract_json_from_response(self, response_text: str) -> Dict[str, Any]:
        """
        Extract and parse JSON from the model's response.
        Handles cases where the model includes extra text around the JSON.

        Args:
            response_text: Raw response from Gemini

        Returns:
            Parsed JSON dictionary
        """
        # Try to find JSON in the response
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            json_str = json_match.group()
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

        # If extraction fails, return a default error response
        return {
            "verdict": "SUSPICIOUS",
            "risk_score": 50,
            "red_flags": ["Unable to parse analysis results"],
            "explanation": "The analysis could not be completed properly. Please review the message manually.",
            "user_advice": "Exercise caution and verify the message through official channels.",
            "indicators": {
                "sender_analysis": "Unable to analyze",
                "urgency_tactics": "Unable to analyze",
                "link_analysis": "Unable to analyze",
                "grammar_tone": "Unable to analyze",
                "requested_action": "Unable to analyze"
            }
        }

    def analyze_message(self, message: str, message_type: str = "email") -> Dict[str, Any]:
        """
        Analyze a message for phishing indicators using Gemini API.

        Args:
            message: The message content to analyze (email text, SMS, URL, etc.)
            message_type: Type of message ("email", "sms", "url", "chat")

        Returns:
            Dictionary containing the phishing analysis results
        """
        if not message or not message.strip():
            return {
                "verdict": "SAFE",
                "risk_score": 0,
                "red_flags": [],
                "explanation": "No message content provided for analysis.",
                "user_advice": "Please provide message content to analyze.",
                "indicators": {
                    "sender_analysis": "N/A",
                    "urgency_tactics": "N/A",
                    "link_analysis": "N/A",
                    "grammar_tone": "N/A",
                    "requested_action": "N/A"
                }
            }

        # Construct the analysis prompt
        system_prompt = self._create_system_prompt()

        # Add few-shot examples if enabled
        if self.use_few_shot:
            few_shot_examples = self._get_few_shot_examples()
            user_prompt = f"""{few_shot_examples}

MESSAGE TYPE: {message_type}
MESSAGE:
{message}

Provide your analysis in the required JSON format."""
        else:
            user_prompt = f"""Analyze the following {message_type} for phishing indicators:

MESSAGE:
{message}

Provide your analysis in the required JSON format."""

        # Combine prompts
        full_prompt = f"{system_prompt}\n\n{user_prompt}"

        try:
            # Call Gemini API
            response = self.model.generate_content(
                full_prompt,
                generation_config=self.generation_config
            )

            # Extract and parse the response
            result = self._extract_json_from_response(response.text)

            # Add metadata
            result['message_type'] = message_type
            result['model_used'] = self.model_name

            return result

        except Exception as e:
            # Handle API errors gracefully
            return {
                "verdict": "SUSPICIOUS",
                "risk_score": 50,
                "red_flags": [f"Analysis error: {str(e)}"],
                "explanation": f"An error occurred during analysis: {str(e)}",
                "user_advice": "Unable to complete automated analysis. Please verify the message manually through official channels.",
                "indicators": {
                    "sender_analysis": "Error occurred",
                    "urgency_tactics": "Error occurred",
                    "link_analysis": "Error occurred",
                    "grammar_tone": "Error occurred",
                    "requested_action": "Error occurred"
                },
                "message_type": message_type,
                "model_used": self.model_name,
                "error": str(e)
            }

    def analyze_batch(self, messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        """
        Analyze multiple messages in batch.

        Args:
            messages: List of dictionaries with 'content' and 'type' keys

        Returns:
            List of analysis results
        """
        results = []
        for msg in messages:
            content = msg.get('content', '')
            msg_type = msg.get('type', 'email')
            result = self.analyze_message(content, msg_type)
            results.append(result)

        return results


def main():
    """
    Example usage and testing of the PhishingDetector.
    """
    # Initialize detector
    detector = PhishingDetector()

    # Example phishing email
    phishing_example = """
    Subject: URGENT: Your Account Will Be Suspended!

    Dear Valued Customer,

    We have detected suspicious activity on your PayPal account. Your account will be
    suspended within 24 hours unless you verify your information immediately.

    Click here to verify: http://paypa1-secure.tk/verify?id=12345

    Please provide your:
    - Full Name
    - Credit Card Number
    - CVV Code
    - Social Security Number

    Act now to prevent account closure!

    Best regards,
    PayPal Security Team
    """

    # Analyze the message
    print("Analyzing suspicious message...\n")
    result = detector.analyze_message(phishing_example, "email")

    # Display results
    print(json.dumps(result, indent=2))
    print(f"\nVerdict: {result['verdict']}")
    print(f"Risk Score: {result['risk_score']}/100")
    print(f"\nRed Flags Found:")
    for flag in result['red_flags']:
        print(f"  - {flag}")


if __name__ == "__main__":
    main()
