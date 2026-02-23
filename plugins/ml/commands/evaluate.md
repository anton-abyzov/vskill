---
description: Evaluate ML model with comprehensive metrics
---

# Evaluate ML Model

You are evaluating an ML model. Generate a comprehensive evaluation report following ML best practices.

## Your Task

1. **Load Model**: Load the model from the specified increment
2. **Run Evaluation**: Execute comprehensive evaluation with appropriate metrics
3. **Generate Report**: Create evaluation report in increment folder

## Evaluation Steps

### Step 1: Identify Model Type
- Classification: accuracy, precision, recall, F1, ROC AUC, confusion matrix
- Regression: RMSE, MAE, MAPE, R², residual analysis
- Ranking: precision@K, recall@K, NDCG@K, MAP

### Step 2: Load Test Data
```python
# Load test set from increment
X_test = load_test_data(increment_path)
y_test = load_test_labels(increment_path)
```

### Step 3: Compute Metrics
```python
from sklearn.metrics import classification_report, confusion_matrix

predictions = model.predict(X_test)
metrics = classification_report(y_test, predictions, output_dict=True)
```

### Step 4: Generate Visualizations
- Confusion matrix (classification)
- ROC curves (classification)
- Residual plots (regression)
- Calibration curves (classification)

### Step 5: Statistical Validation
- Cross-validation results
- Confidence intervals
- Comparison to baseline
- Statistical significance tests

### Step 6: Generate Report

Create `evaluation-report.md` in increment folder:

```markdown
# Model Evaluation Report

## Model: [Model Name]
- Version: [Version]
- Increment: [Increment ID]
- Date: [Evaluation Date]

## Overall Performance
[Metrics table]

## Visualizations
[Embedded plots]

## Cross-Validation
[CV results]

## Comparison to Baseline
[Baseline comparison]

## Statistical Tests
[Significance tests]

## Recommendations
[Deploy/improve/investigate]
```

## Output

After evaluation, report:
- Overall performance summary
- Key metrics
- Whether model meets success criteria (from spec.md)
- Recommendation (deploy/improve/investigate)
