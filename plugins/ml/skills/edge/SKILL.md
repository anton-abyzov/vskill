---
description: "Edge ML / Mobile ML / Core ML expert. Covers Core ML (iOS) model conversion and inference, TensorFlow Lite (Android/iOS) with delegates, ONNX Runtime Mobile, ML Kit, on-device training, model optimization (pruning/distillation/quantization), privacy-preserving ML, federated learning, and performance benchmarking."
model: opus
context: fork
---

# Edge ML / Mobile ML

Expert guidance for deploying machine learning models on edge devices: iOS (Core ML), Android (TensorFlow Lite), cross-platform (ONNX Runtime Mobile), and Google ML Kit. Covers model conversion, optimization, on-device inference, privacy-preserving techniques, and performance benchmarking.

## Core ML (iOS)

### Model Conversion with coremltools

```python
import coremltools as ct
import torch

# From PyTorch
class SimpleClassifier(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.linear1 = torch.nn.Linear(768, 256)
        self.relu = torch.nn.ReLU()
        self.linear2 = torch.nn.Linear(256, 10)

    def forward(self, x):
        return self.linear2(self.relu(self.linear1(x)))

model = SimpleClassifier()
model.eval()

# Trace the model
example_input = torch.randn(1, 768)
traced_model = torch.jit.trace(model, example_input)

# Convert to Core ML
mlmodel = ct.convert(
    traced_model,
    inputs=[ct.TensorType(name="features", shape=(1, 768))],
    outputs=[ct.TensorType(name="logits")],
    compute_units=ct.ComputeUnit.ALL,        # CPU + GPU + Neural Engine
    minimum_deployment_target=ct.target.iOS17,
)

# Set model metadata
mlmodel.author = "ML Team"
mlmodel.short_description = "Text classifier for sentiment analysis"
mlmodel.version = "1.0.0"

# Save
mlmodel.save("TextClassifier.mlpackage")
```

### Converting Hugging Face Transformers

```python
import coremltools as ct
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

model_name = "distilbert-base-uncased-finetuned-sst-2-english"
model = AutoModelForSequenceClassification.from_pretrained(model_name)
tokenizer = AutoTokenizer.from_pretrained(model_name)
model.eval()

# Create example input
example_text = "This movie is great"
inputs = tokenizer(example_text, return_tensors="pt", padding="max_length", max_length=128)

# Trace with example inputs
class WrappedModel(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
        return outputs.logits

wrapped = WrappedModel(model)
traced = torch.jit.trace(wrapped, (inputs["input_ids"], inputs["attention_mask"]))

# Convert
mlmodel = ct.convert(
    traced,
    inputs=[
        ct.TensorType(name="input_ids", shape=(1, 128), dtype=int),
        ct.TensorType(name="attention_mask", shape=(1, 128), dtype=int),
    ],
    outputs=[ct.TensorType(name="logits")],
    compute_units=ct.ComputeUnit.ALL,
    minimum_deployment_target=ct.target.iOS17,
)

mlmodel.save("SentimentClassifier.mlpackage")
```

### Quantization for Core ML

```python
import coremltools as ct
from coremltools.models.neural_network import quantization_utils

# Post-training quantization
model = ct.models.MLModel("TextClassifier.mlpackage")

# Linear quantization to 8-bit
quantized_model = ct.compression_utils.linear_quantize_weights(
    model,
    dtype=ct.converters.mil.mil.types.type_mapping.np.int8,
)

# Palettization (k-means clustering of weights)
palettized_model = ct.compression_utils.palettize_weights(
    model,
    nbits=4,       # 4-bit palettization (16 unique values per tensor)
    mode="kmeans",
)

# Pruning (set small weights to zero)
pruned_model = ct.compression_utils.prune_weights(
    model,
    target_sparsity=0.5,   # Remove 50% of weights
    mode="threshold_based",
)

quantized_model.save("TextClassifier_quantized.mlpackage")
```

### On-Device Inference (Swift)

```swift
import CoreML
import NaturalLanguage

// Load model
let config = MLModelConfiguration()
config.computeUnits = .all  // CPU + GPU + Neural Engine

let model = try SentimentClassifier(configuration: config)

// Prepare input
let tokenizer = NLTokenizer(unit: .word)
tokenizer.string = "This product is amazing"

// Run inference
let input = SentimentClassifierInput(
    input_ids: inputTensor,
    attention_mask: maskTensor
)

let prediction = try model.prediction(input: input)
let sentiment = prediction.logits  // [negative_score, positive_score]

// Async prediction (non-blocking UI)
Task {
    let result = try await model.prediction(input: input)
    await MainActor.run {
        updateUI(with: result)
    }
}
```

### Core ML with Vision Framework

```swift
import Vision
import CoreML

// Image classification
let config = MLModelConfiguration()
config.computeUnits = .all

let model = try VNCoreMLModel(for: ImageClassifier(configuration: config).model)

let request = VNCoreMLRequest(model: model) { request, error in
    guard let results = request.results as? [VNClassificationObservation] else { return }
    let topResult = results.first!
    print("\(topResult.identifier): \(topResult.confidence)")
}

// Process image
let handler = VNImageRequestHandler(cgImage: image, options: [:])
try handler.perform([request])
```

### Core ML with NLP Framework

```swift
import NaturalLanguage

// Built-in NLP (no model needed)
let tagger = NLTagger(tagSchemes: [.nameType])
tagger.string = "Apple Inc. is headquartered in Cupertino, California."

tagger.enumerateTags(in: tagger.string!.startIndex..<tagger.string!.endIndex,
                      unit: .word,
                      scheme: .nameType,
                      options: [.omitPunctuation, .omitWhitespace]) { tag, range in
    if let tag = tag {
        print("\(tagger.string![range]): \(tag.rawValue)")
    }
    return true
}

// Custom NLP model
let sentimentModel = try NLModel(mlModel: CustomSentiment(configuration: config).model)
let sentiment = sentimentModel.predictedLabel(for: "This is great!")
```

### Performance: Neural Engine vs GPU vs CPU

| Compute Unit | Best For | Latency | Power |
|-------------|----------|---------|-------|
| Neural Engine | Most ML ops, quantized models | Lowest | Lowest |
| GPU | Large batches, complex architectures | Low | Medium |
| CPU | Small models, compatibility | Medium-High | Highest |
| ALL (recommended) | Auto-dispatch per layer | Optimal | Optimal |

```swift
// Force specific compute unit
let config = MLModelConfiguration()
config.computeUnits = .cpuAndNeuralEngine  // Skip GPU for battery savings

// Measure performance
let start = CFAbsoluteTimeGetCurrent()
let _ = try model.prediction(input: input)
let elapsed = CFAbsoluteTimeGetCurrent() - start
print("Inference time: \(elapsed * 1000)ms")
```

## TensorFlow Lite (Android/iOS)

### Model Conversion from TensorFlow

```python
import tensorflow as tf

# From SavedModel
converter = tf.lite.TFLiteConverter.from_saved_model("saved_model_dir")
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()

with open("model.tflite", "wb") as f:
    f.write(tflite_model)

# From Keras model
model = tf.keras.applications.MobileNetV3Small(
    input_shape=(224, 224, 3),
    weights="imagenet",
)

converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]

# Full integer quantization (smallest, fastest on mobile)
def representative_dataset():
    for _ in range(100):
        yield [tf.random.normal((1, 224, 224, 3))]

converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.uint8
converter.inference_output_type = tf.uint8

tflite_quant_model = converter.convert()
```

### Android Inference (Kotlin)

```kotlin
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.GpuDelegate
import org.tensorflow.lite.support.image.TensorImage
import java.nio.ByteBuffer

class ImageClassifier(context: Context) {
    private val interpreter: Interpreter

    init {
        // Load model from assets
        val modelBuffer = loadModelFile(context, "model.tflite")

        // Configure with GPU delegate
        val options = Interpreter.Options()
        options.addDelegate(GpuDelegate())
        options.setNumThreads(4)

        interpreter = Interpreter(modelBuffer, options)
    }

    fun classify(bitmap: Bitmap): FloatArray {
        val input = preprocessImage(bitmap)  // Resize, normalize
        val output = Array(1) { FloatArray(1000) }
        interpreter.run(input, output)
        return output[0]
    }

    fun close() { interpreter.close() }
}
```

### TFLite Delegates

| Delegate | Platform | Speedup | Best For |
|----------|----------|---------|----------|
| GPU | Android, iOS | 2-7x | Conv, dense layers |
| NNAPI | Android (8.1+) | 2-10x | Quantized models, device NPU |
| Metal | iOS | 2-5x | GPU-intensive models |
| Hexagon | Qualcomm SoCs | 3-10x | Quantized models |
| XNNPACK | All (CPU) | 1.5-3x | CPU fallback, float models |
| Core ML | iOS | 2-8x | Apple Neural Engine |

```kotlin
// NNAPI delegate (Android)
val nnApiOptions = NnApiDelegate.Options()
nnApiOptions.setAllowFp16(true)
nnApiOptions.setExecutionPreference(NnApiDelegate.Options.EXECUTION_PREFERENCE_SUSTAINED_SPEED)
val nnApiDelegate = NnApiDelegate(nnApiOptions)

val options = Interpreter.Options()
options.addDelegate(nnApiDelegate)
```

### Quantization Approaches

```python
import tensorflow as tf

# 1. Post-training dynamic range quantization (simplest)
converter = tf.lite.TFLiteConverter.from_saved_model("saved_model")
converter.optimizations = [tf.lite.Optimize.DEFAULT]
# Weights quantized to int8, activations remain float at runtime
tflite_model = converter.convert()

# 2. Post-training full integer quantization (best performance)
converter = tf.lite.TFLiteConverter.from_saved_model("saved_model")
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8
tflite_model = converter.convert()

# 3. Quantization-aware training (best accuracy)
import tensorflow_model_optimization as tfmot

q_aware_model = tfmot.quantization.keras.quantize_model(model)
q_aware_model.compile(optimizer="adam", loss="sparse_categorical_crossentropy")
q_aware_model.fit(train_data, epochs=5)

converter = tf.lite.TFLiteConverter.from_keras_model(q_aware_model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()
```

## ONNX Runtime Mobile

### Cross-Platform Inference

```python
import onnxruntime as ort
import numpy as np

# Export PyTorch model to ONNX
import torch

model = MyModel()
model.eval()
dummy = torch.randn(1, 3, 224, 224)

torch.onnx.export(
    model, dummy, "model.onnx",
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
    opset_version=17,
)

# Inference with ONNX Runtime
session = ort.InferenceSession(
    "model.onnx",
    providers=["CoreMLExecutionProvider", "CPUExecutionProvider"],
)

# Run
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)
results = session.run(None, {"input": input_data})
print(f"Output shape: {results[0].shape}")
```

### ONNX Model Optimization

```python
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.transformers import optimizer

# Graph optimization
optimized_model = optimizer.optimize_model(
    "model.onnx",
    model_type="bert",
    num_heads=12,
    hidden_size=768,
    optimization_options=None,
)
optimized_model.save_model_to_file("model_optimized.onnx")

# Dynamic quantization
quantize_dynamic(
    model_input="model_optimized.onnx",
    model_output="model_quantized.onnx",
    weight_type=QuantType.QInt8,
)
```

### Platform-Specific Execution Providers

| Provider | Platform | Hardware |
|----------|----------|----------|
| CoreMLExecutionProvider | iOS, macOS | Apple Neural Engine + GPU |
| NnapiExecutionProvider | Android | NPU, GPU, DSP |
| QNNExecutionProvider | Android (Qualcomm) | Hexagon DSP, Adreno GPU |
| XnnpackExecutionProvider | All | CPU (optimized) |
| CPUExecutionProvider | All | CPU (baseline) |

```python
# Priority order: tries first provider, falls back to next
session = ort.InferenceSession(
    "model.onnx",
    providers=[
        "CoreMLExecutionProvider",    # Try Neural Engine first
        "XnnpackExecutionProvider",   # Optimized CPU fallback
        "CPUExecutionProvider",       # Basic CPU fallback
    ],
)

# Check which provider was selected
print(session.get_providers())
```

## ML Kit (Google)

### Pre-Built APIs

```kotlin
// Text Recognition (OCR)
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

val recognizer = TextRecognition.getClient(TextRecognizerOptions.Builder().build())

val image = InputImage.fromBitmap(bitmap, 0)
recognizer.process(image)
    .addOnSuccessListener { result ->
        for (block in result.textBlocks) {
            for (line in block.lines) {
                println("Text: ${line.text}, Confidence: ${line.confidence}")
            }
        }
    }
    .addOnFailureListener { e ->
        println("Error: ${e.message}")
    }
```

### Custom Models with ML Kit

```kotlin
import com.google.mlkit.common.model.LocalModel
import com.google.mlkit.vision.objects.custom.CustomObjectDetectorOptions

// Load custom TFLite model
val localModel = LocalModel.Builder()
    .setAssetFilePath("custom_model.tflite")
    .build()

val options = CustomObjectDetectorOptions.Builder(localModel)
    .setDetectorMode(CustomObjectDetectorOptions.SINGLE_IMAGE_MODE)
    .enableMultipleObjects()
    .enableClassification()
    .setClassificationConfidenceThreshold(0.5f)
    .setMaxPerObjectLabelCount(3)
    .build()

val objectDetector = ObjectDetection.getClient(options)
```

## Model Optimization Techniques

### Pruning

```python
import tensorflow_model_optimization as tfmot

# Structured pruning (remove entire channels/filters)
pruning_params = {
    "pruning_schedule": tfmot.sparsity.keras.PolynomialDecay(
        initial_sparsity=0.0,
        final_sparsity=0.5,         # Remove 50% of weights
        begin_step=0,
        end_step=1000,
    )
}

pruned_model = tfmot.sparsity.keras.prune_low_magnitude(model, **pruning_params)
pruned_model.compile(optimizer="adam", loss="sparse_categorical_crossentropy")

# Training callbacks for pruning
callbacks = [tfmot.sparsity.keras.UpdatePruningStep()]
pruned_model.fit(train_data, epochs=10, callbacks=callbacks)

# Strip pruning wrappers for deployment
final_model = tfmot.sparsity.keras.strip_pruning(pruned_model)
```

### Knowledge Distillation

```python
import torch
import torch.nn.functional as F

class DistillationTrainer:
    def __init__(self, teacher, student, temperature=4.0, alpha=0.5):
        self.teacher = teacher.eval()
        self.student = student
        self.temperature = temperature
        self.alpha = alpha  # Balance between distillation and task loss

    def distillation_loss(self, student_logits, teacher_logits, labels):
        # Soft target loss (KL divergence on softened probabilities)
        soft_teacher = F.softmax(teacher_logits / self.temperature, dim=-1)
        soft_student = F.log_softmax(student_logits / self.temperature, dim=-1)
        distill_loss = F.kl_div(soft_student, soft_teacher, reduction="batchmean")
        distill_loss *= self.temperature ** 2

        # Hard target loss (standard cross-entropy)
        hard_loss = F.cross_entropy(student_logits, labels)

        # Combined loss
        return self.alpha * distill_loss + (1 - self.alpha) * hard_loss

    def train_step(self, batch):
        inputs, labels = batch
        with torch.no_grad():
            teacher_logits = self.teacher(inputs)

        student_logits = self.student(inputs)
        loss = self.distillation_loss(student_logits, teacher_logits, labels)
        return loss
```

### Model Size Comparison

| Technique | Size Reduction | Accuracy Impact | Inference Speedup |
|-----------|---------------|-----------------|-------------------|
| Float16 | 2x | Minimal | 1.5-2x |
| INT8 quantization | 4x | 1-3% drop | 2-4x |
| INT4 quantization | 8x | 3-8% drop | 3-6x |
| Pruning (50%) | ~2x | 1-5% drop | 1.5-3x |
| Knowledge distillation | 5-20x (model dependent) | 2-5% drop | 5-20x |
| Pruning + quantization | ~8x | 3-6% drop | 4-8x |

## Performance Benchmarking

### Performance Targets by Use Case

| Use Case | Target Latency | Max Model Size | Max Memory |
|----------|---------------|----------------|------------|
| Real-time camera | < 33ms (30 FPS) | < 10 MB | < 50 MB |
| Photo processing | < 500ms | < 50 MB | < 200 MB |
| Text classification | < 50ms | < 5 MB | < 30 MB |
| Voice command | < 100ms | < 20 MB | < 100 MB |
| Background task | < 5s | < 100 MB | < 500 MB |

## Decision Framework: Choosing an Edge ML Platform

| Criterion | Core ML | TFLite | ONNX Runtime | ML Kit |
|-----------|---------|--------|-------------|--------|
| Platform | iOS/macOS only | Android + iOS | Cross-platform | Android + iOS |
| Ease of use | High | Medium | Medium | Highest |
| Custom models | Yes | Yes | Yes | Limited |
| Pre-built APIs | Vision/NLP frameworks | No | No | Yes (text, face, barcode) |
| Neural Engine | Native | Via delegate | Via Core ML EP | Via TFLite |
| Model format | .mlpackage | .tflite | .onnx | .tflite |
| Best for | iOS-first apps | Android-first apps | Cross-platform | Quick prototyping |
