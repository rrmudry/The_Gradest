# The Gradest 📝💯

**The Gradest** is a modern, high-performance, fully client-side web application designed to generate, preview, scan, and grade paper-based bubble sheets. Operating entirely in the browser without server dependencies, it uses native WebRTC camera feeds and custom Canvas-based pixel-manipulation algorithms to deliver sub-second Optical Mark Recognition (OMR).

👉 **Live Demo**: [https://rrmudry.github.io/The_Gradest/](https://rrmudry.github.io/The_Gradest/)

---

## 🚀 Key Features

* **Vector PDF Generator**: Dynamic, printable **4-up Letter-sized layouts** (2x2 grid, symmetrical margins) optimized for fast cutting. Renders crisp vector lines and anchors for precise tracking.
* **Live SVG Preview**: A real-time, responsive mock card that updates as you edit assignment details or the maximum score (dynamically adjusting score bubble columns).
* **Robust Hybrid OMR Engine**:
  * **Asymmetric Quad Tracking**: Locates the 4 corner anchors anywhere in the camera view by matching two large squares at the top and two small circles at the bottom.
  * **3D Perspective Homography**: Corrects out-of-plane page tilt, pitch, and yaw using projective mapping equations.
  * **Percentile Sub-sampling**: Sorts pixels inside the bubble boundaries and averages the **darkest 45% of pixels**—making it highly resilient to erased smudges, messy markings, or incomplete pencil marks.
  * **Relative Column Darkness Calibration**: Compares the darkest bubble against the average of the other 9 empty bubbles in that column, scaling contrast thresholds using an interactive slider.
* **OMR Diagnostics & Tuning Console**: Real-time logging of binarization statistics, anchor locations, aspect ratio calculations, and row-by-row bubble brightness grids.
* **Grades Directory & Roster Mapping**: Syncs scanned student IDs with a loaded CSV student roster, allows in-place manual overrides, and exports the final grades directly to CSV.

---

## 🛠️ The Technical OMR Pipeline

The OMR engine operates at **30+ FPS** using pure client-side JavaScript:

```
[Webcam Stream] ──> [Grayscale Capture] ──> [Dynamic Percentile Thresholding]
                                                       │
  ┌────────────────────────────────────────────────────┘
  ▼
[BFS Blob Extraction] ──> [Size & Adjacency Pruning] ──> [Orthogonality Checking]
                                                                 │
  ┌──────────────────────────────────────────────────────────────┘
  ▼
[Perspective Homography Warp] ──> [Percentile Sub-sampling (Darkest 45%)] ──> [Relative OMR Compare]
```

### 1. Dynamic Thresholding
Instead of a static threshold, the engine samples 1,000 pixels across the frame and calculates a dynamic threshold based on the **2nd and 96th percentiles** of brightness. This filters out harsh highlights (like ceiling bulbs) and deep shadows.

### 2. Candidate Filtering
A BFS-based flood fill extracts dark blobs. The candidate pool is pruned to keep the 12 smallest and 24 largest items. Combinations of 4 are selected and validated using aspect ratio, height/width symmetry, and a vector angle check ensuring corners are orthogonal ($90^\circ \pm 18^\circ$, or $|\cos(\theta)| < 0.31$).

### 3. Sub-Sampling Circle Search
Once the quad is locked, the grid coordinates $(u, v)$ are warped back to screen coordinates. Rather than sampling a single center pixel, the engine collects pixels inside the inner radius:
$$\text{Radius} = \max\left(1.5, 3.2 \times \frac{\text{Width}_{\text{pixels}}}{250}\right)$$
It sorts these pixels and averages the **darkest 45%**, isolating thin checkmarks or graphite smudges from white paper.

---

## 📦 File Structure

* `index.html`: UI structure, sidebar panels, modals, and WebRTC layout.
* `style.css`: Clean dark-slate glassmorphism styling, responsive dashboard grids, and custom print layouts.
* `app.js`: Application state, SVG rendering, vector jsPDF generation, CSV importing/exporting.
* `scanner.js`: Greyscale image processing, anchor detection, homography solver, OMR bubble evaluation, and Audio synth beep chime.

---

## 🚦 Future Areas for Improvement & Optimization

### 1. Machine Learning Write-in OCR
* **Opportunity**: Integrate a lightweight TensorFlow.js model (like MNIST) to automatically read the handwritten Student ID and Score from the write-in boxes.
* **Benefit**: Provides a double-verification overlay to match bubble sheets against handwritten inputs.

### 2. Camera Constraint Controls (Lock Focus/Exposure)
* **Opportunity**: Extend WebRTC stream queries to adjust advanced camera options such as `focusMode: "manual"`, `focusDistance`, and `exposureMode: "manual"` (supported on Chrome/Android and select webcams).
* **Benefit**: Eliminates autofocus hunting and auto-exposure changes when papers are brought close to the lens.

### 3. Automated Answer Key Scanner
* **Opportunity**: Add a toggle to scan a sheet as an "Answer Key".
* **Benefit**: The teacher could simply bubble in the correct answers on one card, scan it, and the app would instantly update its grading key.

### 4. Offline-First Progressive Web App (PWA)
* **Opportunity**: Configure a service worker and `manifest.json` file.
* **Benefit**: Allows the app to run completely offline in classrooms with poor or nonexistent internet connections.

### 5. Multi-Page Grading & LMS Integration
* **Opportunity**: Build API connectors for common Learning Management Systems (LMS) like Canvas, Google Classroom, or Moodle.
* **Benefit**: Enables teachers to directly sync the grades log spreadsheet to their digital gradebook with one click.
