"""
Test script for the Phishing Detector
Tests the detector with various sample messages
"""

import json
from phishing_detector import PhishingDetector

# Sample test messages
TEST_MESSAGES = [
    {
        "name": "Clear Phishing Attempt",
        "content": """
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
        """,
        "type": "email"
    },
    {
        "name": "Legitimate Business Email",
        "content": """
Subject: Your order #12345 has shipped

Hello John,

Your recent order from Amazon has been shipped and is on its way.

Order Details:
- Order Number: #12345-67890
- Tracking Number: 1Z999AA10123456784
- Estimated Delivery: March 28, 2024

You can track your shipment at: https://www.amazon.com/tracking

Thank you for shopping with Amazon!

Best regards,
Amazon Customer Service
        """,
        "type": "email"
    },
    {
        "name": "Suspicious SMS",
        "content": """
ALERT: Your bank account has been locked due to suspicious activity.
Verify your identity now: bit.ly/verify123
Reply STOP to cancel
        """,
        "type": "sms"
    },
    {
        "name": "Typosquatting URL",
        "content": "https://secure-paypa1.com/login?redirect=account-verify",
        "type": "url"
    },
    {
        "name": "CEO Fraud / Business Email Compromise",
        "content": """
Subject: Urgent Wire Transfer Needed

Hi,

I'm in a meeting and need you to process an urgent wire transfer immediately.
Transfer $50,000 to the following account:

Account: 123456789
Routing: 987654321
Bank: International Trust Bank

This is time-sensitive - please complete by end of day.
Don't reply to this email, I'm in meetings. Just confirm when done.

Thanks,
CEO
        """,
        "type": "email"
    }
]


def print_separator(char='=', length=80):
    """Print a separator line."""
    print(char * length)


def print_result(test_name, result):
    """Print formatted analysis result."""
    print_separator()
    print(f"TEST: {test_name}")
    print_separator()
    print(f"Verdict: {result['verdict']}")
    print(f"Risk Score: {result['risk_score']}/100")
    print(f"\nExplanation:")
    print(result['explanation'])

    if result.get('red_flags'):
        print(f"\nRed Flags ({len(result['red_flags'])}):")
        for i, flag in enumerate(result['red_flags'], 1):
            print(f"  {i}. {flag}")

    print(f"\nUser Advice:")
    print(result['user_advice'])

    if result.get('indicators'):
        print(f"\nDetailed Indicators:")
        for key, value in result['indicators'].items():
            print(f"  - {key.replace('_', ' ').title()}: {value}")

    print_separator()
    print()


def main():
    """Run all tests."""
    print("\n" + "="*80)
    print("PHISHING DETECTOR TEST SUITE")
    print("="*80 + "\n")

    try:
        # Initialize detector
        print("Initializing Phishing Detector...")
        detector = PhishingDetector()
        print(f"Using model: {detector.model_name}")
        print()

        # Test each message
        for i, test in enumerate(TEST_MESSAGES, 1):
            print(f"\n[{i}/{len(TEST_MESSAGES)}] Running test: {test['name']}")
            print("Analyzing message...")

            result = detector.analyze_message(test['content'], test['type'])
            print_result(test['name'], result)

        # Summary
        print_separator('=', 80)
        print(f"TESTS COMPLETED: {len(TEST_MESSAGES)} messages analyzed")
        print_separator('=', 80)

    except Exception as e:
        print(f"\nERROR: {e}")
        print("\nMake sure you have:")
        print("1. Set up the .env file with your Gemini API key")
        print("2. Installed required packages: pip install -r requirements.txt")


if __name__ == '__main__':
    main()
