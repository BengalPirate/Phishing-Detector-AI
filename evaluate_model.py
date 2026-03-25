"""
Quantitative Evaluation of Phishing Detector
Computes accuracy, precision, recall, and F1 score on the dataset
"""

import pandas as pd
import json
from phishing_detector import PhishingDetector
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, classification_report
import time
from tqdm import tqdm

def load_dataset(sample_size=100):
    """Load a sample of the phishing email dataset."""
    print(f"Loading dataset (sample size: {sample_size})...")
    df = pd.read_csv('archive/phishing_email.csv')

    # Sample dataset for evaluation (balance classes)
    phishing = df[df['label'] == 1].sample(n=min(sample_size//2, len(df[df['label'] == 1])), random_state=42)
    legitimate = df[df['label'] == 0].sample(n=min(sample_size//2, len(df[df['label'] == 0])), random_state=42)

    sample_df = pd.concat([phishing, legitimate]).sample(frac=1, random_state=42)  # Shuffle

    print(f"Loaded {len(sample_df)} samples ({len(phishing)} phishing, {len(legitimate)} legitimate)")
    return sample_df

def map_verdict_to_label(verdict, risk_score):
    """
    Map model verdict to binary label.

    SAFE = 0 (legitimate)
    SUSPICIOUS or HIGHLY LIKELY PHISHING = 1 (phishing)

    Also consider risk score as tie-breaker.
    """
    if verdict == "SAFE":
        return 0
    elif verdict in ["SUSPICIOUS", "HIGHLY LIKELY PHISHING"]:
        return 1
    else:
        # Use risk score as fallback
        return 1 if risk_score >= 50 else 0

def evaluate_detector(sample_size=100):
    """
    Evaluate the phishing detector on a sample of the dataset.

    Args:
        sample_size: Number of samples to evaluate (default: 100)

    Returns:
        Dictionary with evaluation metrics
    """
    print("\n" + "="*80)
    print("PHISHING DETECTOR QUANTITATIVE EVALUATION")
    print("="*80 + "\n")

    # Initialize detector
    print("Initializing detector...")
    detector = PhishingDetector()

    # Load dataset
    df = load_dataset(sample_size)

    # Evaluate
    print(f"\nAnalyzing {len(df)} messages...")
    print("This may take several minutes due to API rate limits...")
    print()

    y_true = []
    y_pred = []
    results = []

    for idx, row in tqdm(df.iterrows(), total=len(df), desc="Evaluating"):
        message = str(row['text_combined'])
        true_label = int(row['label'])

        try:
            # Analyze message
            result = detector.analyze_message(message, "email")

            # Map verdict to label
            predicted_label = map_verdict_to_label(result['verdict'], result['risk_score'])

            y_true.append(true_label)
            y_pred.append(predicted_label)

            results.append({
                'true_label': true_label,
                'predicted_label': predicted_label,
                'verdict': result['verdict'],
                'risk_score': result['risk_score'],
                'correct': true_label == predicted_label
            })

            # Rate limiting: small delay between requests
            time.sleep(0.5)

        except Exception as e:
            print(f"\nError analyzing message {idx}: {e}")
            continue

    # Compute metrics
    print("\n" + "="*80)
    print("EVALUATION RESULTS")
    print("="*80 + "\n")

    accuracy = accuracy_score(y_true, y_pred)
    precision = precision_score(y_true, y_pred, zero_division=0)
    recall = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)

    print(f"Accuracy:  {accuracy:.4f} ({accuracy*100:.2f}%)")
    print(f"Precision: {precision:.4f} ({precision*100:.2f}%)")
    print(f"Recall:    {recall:.4f} ({recall*100:.2f}%)")
    print(f"F1 Score:  {f1:.4f}")

    print("\n" + "-"*80)
    print("CONFUSION MATRIX")
    print("-"*80 + "\n")

    cm = confusion_matrix(y_true, y_pred)
    print(f"                 Predicted")
    print(f"                 Legit  Phishing")
    print(f"Actual  Legit    {cm[0][0]:5d}  {cm[0][1]:5d}")
    print(f"        Phishing {cm[1][0]:5d}  {cm[1][1]:5d}")

    print("\n" + "-"*80)
    print("CLASSIFICATION REPORT")
    print("-"*80 + "\n")

    print(classification_report(y_true, y_pred,
                                target_names=['Legitimate', 'Phishing'],
                                digits=4))

    # Analyze errors
    print("-"*80)
    print("ERROR ANALYSIS")
    print("-"*80 + "\n")

    false_positives = sum(1 for r in results if r['true_label'] == 0 and r['predicted_label'] == 1)
    false_negatives = sum(1 for r in results if r['true_label'] == 1 and r['predicted_label'] == 0)

    print(f"False Positives (legitimate marked as phishing): {false_positives}")
    print(f"False Negatives (phishing marked as legitimate): {false_negatives}")

    # Save results
    output = {
        'metrics': {
            'accuracy': float(accuracy),
            'precision': float(precision),
            'recall': float(recall),
            'f1_score': float(f1)
        },
        'confusion_matrix': cm.tolist(),
        'sample_size': len(df),
        'model': detector.model_name,
        'detailed_results': results
    }

    with open('evaluation_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\nDetailed results saved to: evaluation_results.json")

    print("\n" + "="*80)
    print("EVALUATION COMPLETE")
    print("="*80 + "\n")

    return output

if __name__ == "__main__":
    import sys

    # Allow custom sample size from command line
    sample_size = int(sys.argv[1]) if len(sys.argv) > 1 else 100

    print(f"Note: Using sample size of {sample_size} to balance API usage.")
    print("For full dataset evaluation, this would require ~82,487 API calls.")
    print("Free tier limit: 1,500 requests/day, 15 requests/minute")
    print()

    evaluate_detector(sample_size)
