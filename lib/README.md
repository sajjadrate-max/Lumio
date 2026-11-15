# Third-party files

Face tracking for Lumio's face effects. Loaded only when a face effect is chosen.

- `vision_bundle.mjs`, `wasm/vision_wasm_internal.*`: MediaPipe Tasks Vision (`@mediapipe/tasks-vision` 1.2.2), Apache License 2.0, © Google LLC. https://github.com/google-ai-edge/mediapipe
- `face_landmarker.task`: MediaPipe Face Landmarker model (float16, v1), Apache License 2.0, © Google LLC. https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- `selfie_segmenter.tflite`: MediaPipe Selfie Segmenter model (float16), Apache License 2.0, © Google LLC. Used for the background lenses (person cut-out). https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
