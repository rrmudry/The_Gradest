// The Gradest - Webcam Scanner & OMR Engine

// Distance helper
const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

class BubbleScanner {
  constructor(videoElement, canvasElement, options = {}) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
    
    this.options = Object.assign({
      onScanSuccess: null, // callback(studentId, score)
      onStatusChange: null, // callback(statusText, isAligned)
      sensitivity: 22,      // OMR delta threshold (higher = stricter)
      maxScore: 100
    }, options);

    this.stream = null;
    this.isActive = false;
    this.animationFrameId = null;

    // Canvas Processing Dimensions
    this.width = 450;
    this.height = 594; // Aspect ratio matches Letter card aspect ratio 250:330

    // Set canvas internal dimensions
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Helper canvas for resizing and extracting grayscale data
    this.processingCanvas = document.createElement('canvas');
    this.processingCanvas.width = this.width;
    this.processingCanvas.height = this.height;
    this.pCtx = this.processingCanvas.getContext('2d', { willReadFrequently: true });

    // Anchor configuration (relative to 450 x 594 canvas)
    // Normalized physical coordinates on card: TL(15,15), TR(235,15), BL(15,315), BR(235,315) inside 250x330
    this.defaultAnchors = [
      { x: (15 / 250) * this.width, y: (15 / 330) * this.height },   // TL
      { x: (235 / 250) * this.width, y: (15 / 330) * this.height },  // TR
      { x: (15 / 250) * this.width, y: (315 / 330) * this.height },  // BL
      { x: (235 / 250) * this.width, y: (315 / 330) * this.height }  // BR
    ];

    // Tracking state
    this.trackedAnchors = [null, null, null, null];
    
    // QR Code detection state (for mixed-stack assignment routing)
    this.lastDetectedQR = null;      // Last decoded QR string (assignment name)
    this.lastQRTimestamp = 0;        // performance.now() timestamp of last QR detection
    this.QR_TTL_MS = 3000;           // How long (ms) a detected QR stays valid

    // Audio synthesis setup for scan feedback
    this.audioCtx = null;

    // Stabilization state (requires sheet to be detected stably for X frames before saving)
    this.stableFrames = 0;
    this.lastScannedId = "";
    this.lastScannedScore = -1;
    this.scanLockout = 0; // cooldown after a successful scan (in frames)
    this.lastVideoTime = -1; // track last processed video timestamp
    this.lastDiagnostics = null;
  }

  // Set the current assignment max score to calculate correct column count
  setMaxScore(maxScore) {
    this.options.maxScore = parseInt(maxScore) || 100;
  }

  setSensitivity(val) {
    this.options.sensitivity = parseInt(val) || 28;
  }

  // Web Audio API Beep
  playBeep() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      
      // High-pitched "success" chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5 note
      osc.frequency.exponentialRampToValueAtTime(1320, this.audioCtx.currentTime + 0.1); // E6
      
      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.15);
      
      osc.start(this.audioCtx.currentTime);
      osc.stop(this.audioCtx.currentTime + 0.15);
    } catch (e) {
      console.warn("Failed to play audio feedback:", e);
    }
  }

  // Initialize and list cameras
  static async getCameras() {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          id: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 5)}...`
        }));
    } catch (e) {
      console.error("Error enumerating cameras:", e);
      return [];
    }
  }

  // Start the scanner stream
  async start(deviceId = null) {
    if (this.isActive) return;

    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'environment'
      }
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', true);
      
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          resolve();
        };
      });

      this.isActive = true;
      this.trackedAnchors = [null, null, null, null];
      this.stableFrames = 0;
      this.scanLockout = 0;
      
      this.tick();
      if (this.options.onStatusChange) {
        this.options.onStatusChange("Align bubble sheet", false);
      }
    } catch (e) {
      console.error("Error starting camera stream:", e);
      if (this.options.onStatusChange) {
        this.options.onStatusChange("Camera access denied", false);
      }
      throw e;
    }
  }

  // Stop the scanner stream
  stop() {
    this.isActive = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    if (this.options.onStatusChange) {
      this.options.onStatusChange("Scanner Offline", false);
    }
  }

  // Frame processing loop
  tick() {
    if (!this.isActive) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      if (this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        try {
          this.processFrame();
        } catch (err) {
          console.error("OMR processFrame error:", err);
          if (this.options.onStatusChange) {
            this.options.onStatusChange("OMR Error: " + err.message, false);
          }
        }
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.tick());
  }

  // Core OMR Processing
  processFrame() {
    this.lastDiagnostics = {
      timestamp: new Date().toISOString(),
      width: this.width,
      height: this.height,
      globalMin: 0,
      globalMax: 0,
      dynThreshold: 0,
      candidatesCount: 0,
      candidates: [],
      quadFound: false,
      quadCorners: null,
      quadMetrics: null,
      studentIdBubbles: [],
      scoreBubbles: [],
      studentIdDecoded: null,
      scoreDecoded: null,
      scanSuccess: false,
      error: null
    };

    try {
      // 1. Draw video onto processing canvas
    // Keep aspect ratio: crop center of video to aspect ratio width/height
    const vW = this.video.videoWidth;
    const vH = this.video.videoHeight;
    const targetAspect = this.width / this.height;
    
    let srcW = vW;
    let srcH = vH;
    let srcX = 0;
    let srcY = 0;

    if (vW / vH > targetAspect) {
      // Video is too wide: crop left & right
      srcW = vH * targetAspect;
      srcX = (vW - srcW) / 2;
    } else {
      // Video is too tall: crop top & bottom
      srcH = vW / targetAspect;
      srcY = (vH - srcH) / 2;
    }

    this.pCtx.drawImage(this.video, srcX, srcY, srcW, srcH, 0, 0, this.width, this.height);

    // 1b. Run jsQR on the raw frame to detect assignment QR codes
    if (typeof jsQR !== 'undefined') {
      const rawData = this.pCtx.getImageData(0, 0, this.width, this.height);
      const qrCode = jsQR(rawData.data, this.width, this.height, { inversionAttempts: 'dontInvert' });
      if (qrCode && qrCode.data) {
        this.lastDetectedQR = qrCode.data.trim();
        this.lastQRTimestamp = performance.now();
      } else if (performance.now() - this.lastQRTimestamp > this.QR_TTL_MS) {
        this.lastDetectedQR = null;
      }
      if (this.options.onQRChange) {
        this.options.onQRChange(this.lastDetectedQR);
      }
    }

    // Reset frame diagnostics object
    this.lastDiagnostics = {
      timestamp: performance.now(),
      width: this.width,
      height: this.height,
      quadFound: false,
      quadCorners: null,
      quadMetrics: null,
      globalMin: 0,
      globalMax: 0,
      dynThreshold: 0,
      adaptiveState: null,
      idBubbles: [],
      scoreBubbles: [],
      studentId: "",
      score: -1,
      maxScore: this.options.maxScore,
      valid: false
    };

    // 2. Clear output canvas and draw processed video frame
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(this.processingCanvas, 0, 0);

    // Get grayscale image data of the frame
    const imgData = this.pCtx.getImageData(0, 0, this.width, this.height);
    const pixels = imgData.data;

    // Calculate dynamic threshold using percentile sampling to filter out bright highlights and shadows
    const samples = [];
    const sampleCount = 1000;
    const step = Math.max(4, Math.floor(pixels.length / 4 / sampleCount) * 4);
    let sumGray = 0;
    for (let i = 0; i < pixels.length; i += step) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
      samples.push(gray);
      sumGray += gray;
    }
    samples.sort((a, b) => a - b);
    
    const p2Idx = Math.floor(samples.length * 0.02);
    const p96Idx = Math.floor(samples.length * 0.96);
    const globalMin = samples[p2Idx];
    const globalMax = samples[p96Idx];
    const avgLuminance = sumGray / samples.length;

    // Environmental Lighting Adaptation
    let lightingMode = "Standard";
    let threshFactor = 0.38;

    if (avgLuminance < 85) {
      lightingMode = "Shadow Adaptive";
      threshFactor = 0.42; // Raise threshold slightly to capture faint paper marks in dim light
    } else if (avgLuminance > 185) {
      lightingMode = "High Exposure";
      threshFactor = 0.34; // Lower threshold slightly to prevent glare false positives
    }

    const dynThreshold = globalMin + (globalMax - globalMin) * threshFactor;

    // Progressive Streak Engine timing
    const nowTime = performance.now();
    if (this.lastScanTime > 0 && (nowTime - this.lastScanTime) > this.streakTimeoutMs) {
      this.scanStreak = 0;
    }

    let requiredFrames = 18;
    let lockoutDelay = 30;

    if (this.scanStreak >= 3) {
      requiredFrames = 4;   // ~0.12s rapid lock
      lockoutDelay = 12;    // ~0.4s cooldown
    } else if (this.scanStreak >= 1) {
      requiredFrames = 9;   // ~0.27s fast lock
      lockoutDelay = 20;    // ~0.6s cooldown
    }

    this.adaptiveState = {
      lightingMode,
      ambientLuminance: Math.round(avgLuminance),
      requiredStableFrames: requiredFrames,
      lockoutFrames: lockoutDelay,
      streakCount: this.scanStreak,
      rapidMode: this.scanStreak >= 3
    };

    this.lastDiagnostics.globalMin = Math.round(globalMin);
    this.lastDiagnostics.globalMax = Math.round(globalMax);
    this.lastDiagnostics.dynThreshold = Math.round(dynThreshold);
    this.lastDiagnostics.adaptiveState = this.adaptiveState;

    // Helper: compute grayscale at (x, y)
    const getGray = (x, y) => {
      const idx = (Math.round(y) * this.width + Math.round(x)) * 4;
      return 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
    };

    // 3. Track/Locate anchors
    let allFound = false;
    let geometricValid = false;
    
    // Check if we were already tracking anchors
    const isTracking = this.trackedAnchors.every(a => a !== null);
    
    if (isTracking) {
      // Fast local tracking search (centroid windows)
      const nextTracked = [null, null, null, null];
      const winSize = 38;
      const winHalf = winSize / 2;

      for (let k = 0; k < 4; k++) {
        const center = this.trackedAnchors[k];
        let startX = Math.max(0, Math.round(center.x - winHalf));
        let startY = Math.max(0, Math.round(center.y - winHalf));
        let endX = Math.min(this.width - 1, Math.round(center.x + winHalf));
        let endY = Math.min(this.height - 1, Math.round(center.y + winHalf));

        let minG = 255;
        let maxG = 0;
        for (let y = startY; y <= endY; y++) {
          for (let x = startX; x <= endX; x++) {
            const g = getGray(x, y);
            if (g < minG) minG = g;
            if (g > maxG) maxG = g;
          }
        }

        // Lower contrast requirement for tracking window to be robust in shadow / low light
        if (maxG - minG > 35) {
          const thresh = minG + (maxG - minG) * 0.35;
          let sumX = 0, sumY = 0, count = 0;
          for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
              const g = getGray(x, y);
              if (g < thresh) {
                sumX += x;
                sumY += y;
                count++;
              }
            }
          }
          // Differentiate top (large) and bottom (small) anchor size expectations
          const minCount = (k < 2) ? 8 : 3;
          const maxCount = (k < 2) ? 600 : 300;
          if (count >= minCount && count <= maxCount) {
            nextTracked[k] = { x: sumX / count, y: sumY / count };
          }
        }
      }

      const localAllFound = nextTracked.every(a => a !== null);
      if (localAllFound && this.validateQuad(nextTracked[0], nextTracked[1], nextTracked[2], nextTracked[3])) {
        this.trackedAnchors = nextTracked;
        allFound = true;
        geometricValid = true;
      } else {
        // Local tracking lost or geometry failed, reset tracking state to run global search next
        this.trackedAnchors = [null, null, null, null];
      }
    }

    // If not tracking (or tracking was just lost above), run global search
    if (!allFound) {
      // Run global search if frame has reasonable contrast
      if (globalMax - globalMin > 50) {
        const globalAnchors = this.findGlobalAnchors(pixels, dynThreshold);
        if (globalAnchors) {
          const [TL, TR, BL, BR] = globalAnchors;
          if (this.validateQuad(TL, TR, BL, BR)) {
            this.trackedAnchors = globalAnchors;
            allFound = true;
            geometricValid = true;
          }
        }
      }
    }

    // Draw scanning border indicators
    if (allFound && geometricValid) {
      const [TL, TR, BL, BR] = this.trackedAnchors;

      this.lastDiagnostics.quadFound = true;
      this.lastDiagnostics.quadCorners = this.trackedAnchors.map((p, i) => ({
        corner: ["TL", "TR", "BL", "BR"][i],
        x: Math.round(p.x),
        y: Math.round(p.y)
      }));
      // Calculate quad validation metrics
      const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const diagWTop = dist(TL, TR);
      const diagWBottom = dist(BL, BR);
      const diagHLeft = dist(TL, BL);
      const diagHRight = dist(TR, BR);
      const diagAvgW = (diagWTop + diagWBottom) / 2;
      const diagAvgH = (diagHLeft + diagHRight) / 2;

      // Compute corner angle cosines and angles in degrees for reporting
      const getCornerCos = (p, p1, p2) => {
        const v1x = p1.x - p.x;
        const v1y = p1.y - p.y;
        const v2x = p2.x - p.x;
        const v2y = p2.y - p.y;
        const d1 = Math.hypot(v1x, v1y);
        const d2 = Math.hypot(v2x, v2y);
        if (d1 === 0 || d2 === 0) return 0;
        return (v1x * v2x + v1y * v2y) / (d1 * d2);
      };
      
      const angleTL = Math.round(Math.acos(getCornerCos(TL, TR, BL)) * (180 / Math.PI));
      const angleTR = Math.round(Math.acos(getCornerCos(TR, TL, BR)) * (180 / Math.PI));
      const angleBR = Math.round(Math.acos(getCornerCos(BR, TR, BL)) * (180 / Math.PI));
      const angleBL = Math.round(Math.acos(getCornerCos(BL, TL, BR)) * (180 / Math.PI));

      this.lastDiagnostics.quadMetrics = {
        topWidth: Math.round(diagWTop),
        bottomWidth: Math.round(diagWBottom),
        leftHeight: Math.round(diagHLeft),
        rightHeight: Math.round(diagHRight),
        aspectRatio: parseFloat((diagAvgW / diagAvgH).toFixed(3)),
        angles: { TL: angleTL, TR: angleTR, BR: angleBR, BL: angleBL }
      };

      // Draw tracked quadrilateral boundary line
      this.ctx.beginPath();
      this.ctx.moveTo(TL.x, TL.y);
      this.ctx.lineTo(TR.x, TR.y);
      this.ctx.lineTo(BR.x, BR.y);
      this.ctx.lineTo(BL.x, BL.y);
      this.ctx.closePath();
      
      this.ctx.lineWidth = 2.5;
      this.ctx.strokeStyle = '#10b981'; // emerald green
      this.ctx.stroke();

      // Attempt QR code decoding in the header area between top anchors
      this.scanQRCodeInHeader(pixels, TL, TR);
    } else {
      this.lastDiagnostics.quadFound = false;
    }

    // 4. If quadrilateral lock is valid, evaluate bubble grid markings
    if (allFound && geometricValid) {
      if (this.scanLockout > 0) {
        this.scanLockout--;
      }

      // 5. Sample the bubble grids
      const [TL_p, TR_p, BL_p, BR_p] = this.trackedAnchors;

      const x0 = TL_p.x, y0 = TL_p.y;
      const x1 = TR_p.x, y1 = TR_p.y;
      const x2 = BL_p.x, y2 = BL_p.y;
      const x3 = BR_p.x, y3 = BR_p.y;

      const dx1 = x1 - x3;
      const dx2 = x2 - x3;
      const dy1 = y1 - y3;
      const dy2 = y2 - y3;
      const sx = x0 - x1 + x3 - x2;
      const sy = y0 - y1 + y3 - y2;

      const det = dx1 * dy2 - dy1 * dx2;
      
      let mapCoords;

      if (Math.abs(det) < 0.001) {
        mapCoords = (u, v) => {
          const x = (1 - u) * (1 - v) * x0 + u * (1 - v) * x1 + (1 - u) * v * x2 + u * v * x3;
          const y = (1 - u) * (1 - v) * y0 + u * (1 - v) * y1 + (1 - u) * v * y2 + u * v * y3;
          return { x, y };
        };
      } else {
        const g = (sx * dy2 - sy * dx2) / det;
        const h = (sy * dx1 - sx * dy1) / det;
        const a = x1 - x0 + g * x1;
        const b = x2 - x0 + h * x2;
        const c = x0;
        const d = y1 - y0 + g * y1;
        const e = y2 - y0 + h * y2;
        const f = y0;

        mapCoords = (u, v) => {
          const den = g * u + h * v + 1;
          const x = (a * u + b * v + c) / den;
          const y = (d * u + e * v + f) / den;
          return { x, y };
        };
      }

      // Measure bubble density based on paper size scale
      const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const wTop = dist(TL_p, TR_p);
      const wBottom = dist(BL_p, BR_p);
      const avgW = (wTop + wBottom) / 2;
      
      const bubbleR = Math.max(1.5, 3.2 * (avgW / 250));

      const sampleBubble = (u, v) => {
        const center = mapCoords(u, v);
        const vals = [];
        const rCeil = Math.ceil(bubbleR);

        for (let dy = -rCeil; dy <= rCeil; dy++) {
          for (let dx = -rCeil; dx <= rCeil; dx++) {
            if (dx * dx + dy * dy <= bubbleR * bubbleR) {
              const sx = Math.round(center.x + dx);
              const sy = Math.round(center.y + dy);
              if (sx >= 0 && sx < this.width && sy >= 0 && sy < this.height) {
                vals.push(getGray(sx, sy));
              }
            }
          }
        }
        
        if (vals.length === 0) {
          return { avg: 255, x: center.x, y: center.y };
        }

        vals.sort((a, b) => a - b);
        
        const countToAverage = Math.max(1, Math.round(vals.length * 0.45));
        let sum = 0;
        for (let i = 0; i < countToAverage; i++) {
          sum += vals[i];
        }
        const avg = sum / countToAverage;

        return {
          avg,
          x: center.x,
          y: center.y
        };
      };

      // Sample Student ID (6 columns)
      const studentIdDigits = [];
      const idBubblesToDraw = [];
      
      for (let col = 0; col < 6; col++) {
        const u = (10 + col * 14) / 220;
        const columnGrays = [];
        
        for (let row = 0; row < 10; row++) {
          const v = (100 + row * 14) / 300;
        const otherAvg = otherSum / 9;
        const delta = otherAvg - darkest.sample.avg;

         // Is darkest bubble significantly darker than empty baseline and actually filled?
         const isFilled = delta > this.options.sensitivity;
        
        // Double fill validation: check if the 2nd darkest is also very close to the darkest
        const secondDarkest = columnGrays[1];
        const isDoubleFill = isFilled && (secondDarkest.sample.avg - darkest.sample.avg < 10);

        let finalRow = -1; // empty
        if (isFilled && !isDoubleFill) {
          finalRow = darkest.row;
        }

        studentIdDigits.push(finalRow);

        this.lastDiagnostics.studentIdBubbles.push({
          column: col,
          darkestRow: darkest.row,
          darkestAvg: Math.round(darkest.sample.avg),
          secondDarkestRow: secondDarkest.row,
          secondDarkestAvg: Math.round(secondDarkest.sample.avg),
          otherAvg: Math.round(otherAvg),
          delta: Math.round(delta),
          isFilled: isFilled,
          isDoubleFill: isDoubleFill,
          rawValues: [...columnGrays].sort((a,b)=>a.row-b.row).map(item => ({ row: item.row, avg: Math.round(item.sample.avg) }))
        });

        // Keep bubble coords for feedback rendering
        columnGrays.forEach(item => {
          idBubblesToDraw.push({
            x: item.sample.x,
            y: item.sample.y,
            filled: item.row === finalRow,
            isDarkestButInvalid: item.row === darkest.row && (isDoubleFill || !isFilled) && delta > 10
          });
        });
      }

      // Sample Score columns
      // Max score determines column count
      let D = 2; // default
      if (this.options.maxScore <= 9) D = 1;
      else if (this.options.maxScore <= 99) D = 2;
      else D = 3;

      const scoreDigits = [];
      const scoreBubblesToDraw = [];

      for (let col = 0; col < D; col++) {
        const u = (120 + col * 14) / 220;
        const columnGrays = [];
        
        for (let row = 0; row < 10; row++) {
          const v = (100 + row * 14) / 300;
          const sample = sampleBubble(u, v);
          columnGrays.push({ row, sample });
        }

        columnGrays.sort((a, b) => a.sample.avg - b.sample.avg);
        const darkest = columnGrays[0];
        
        let otherSum = 0;
        for (let idx = 1; idx < 10; idx++) {
          otherSum += columnGrays[idx].sample.avg;
        }
        const otherAvg = otherSum / 9;
        const delta = otherAvg - darkest.sample.avg;

        // Is darkest bubble significantly darker than empty baseline and actually filled?
        const isFilled = delta > this.options.sensitivity;
        const secondDarkest = columnGrays[1];
        const isDoubleFill = isFilled && (secondDarkest.sample.avg - darkest.sample.avg < 10);

        let finalRow = -1; // empty
        if (isFilled && !isDoubleFill) {
          finalRow = darkest.row;
        }

        scoreDigits.push(finalRow);

        this.lastDiagnostics.scoreBubbles.push({
          column: col,
          darkestRow: darkest.row,
          darkestAvg: Math.round(darkest.sample.avg),
          secondDarkestRow: secondDarkest.row,
          secondDarkestAvg: Math.round(secondDarkest.sample.avg),
          otherAvg: Math.round(otherAvg),
          delta: Math.round(delta),
          isFilled: isFilled,
          isDoubleFill: isDoubleFill,
          rawValues: [...columnGrays].sort((a,b)=>a.row-b.row).map(item => ({ row: item.row, avg: Math.round(item.sample.avg) }))
        });

        columnGrays.forEach(item => {
          scoreBubblesToDraw.push({
            x: item.sample.x,
            y: item.sample.y,
            filled: item.row === finalRow,
            isDarkestButInvalid: item.row === darkest.row && (isDoubleFill || !isFilled) && delta > 10
          });
        });
      }

      // Draw bubble overlay feedback
      // This is a beautiful feature where empty bubbles are faint red/blue, and filled bubbles glow neon green
      const drawBubbles = (bubbles) => {
        bubbles.forEach(b => {
          this.ctx.beginPath();
          this.ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
          if (b.filled) {
            this.ctx.fillStyle = 'rgba(16, 185, 129, 0.8)'; // Neon Green
            this.ctx.fill();
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
          } else if (b.isDarkestButInvalid) {
            this.ctx.fillStyle = 'rgba(245, 158, 11, 0.7)'; // Warning amber
            this.ctx.fill();
          } else {
            this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'; // Soft Indigo border
            this.ctx.lineWidth = 0.5;
            this.ctx.stroke();
          }
        });
      };

      drawBubbles(idBubblesToDraw);
      drawBubbles(scoreBubblesToDraw);

      // 6. Decode ID and Score
      // If any ID column is missing, ID is incomplete
      const hasIncompleteId = studentIdDigits.some(d => d === -1);
      
      // Parse Student ID string
      const studentIdStr = studentIdDigits.map(d => d === -1 ? "?" : d).join("");

      // Parse Score number
      // We allow leading empty columns (treated as 0). But if all columns are empty, score is incomplete
      const allScoreEmpty = scoreDigits.every(d => d === -1);
      
      let parsedScoreVal = -1;
      let scoreStr = "---";
      if (!allScoreEmpty) {
        const digits = scoreDigits.map(d => d === -1 ? 0 : d);
        parsedScoreVal = parseInt(digits.join(""));
        scoreStr = parsedScoreVal.toString();
      }

      // Determine OMR Scan State
      const scanSuccess = !hasIncompleteId && !allScoreEmpty && parsedScoreVal <= this.options.maxScore;

      this.lastDiagnostics.studentIdDecoded = studentIdStr;
      this.lastDiagnostics.scoreDecoded = scoreStr;
      this.lastDiagnostics.scanSuccess = scanSuccess;

      if (scanSuccess) {
        // Stabilize tracking
        if (studentIdStr === this.lastScannedId && parsedScoreVal === this.lastScannedScore) {
          this.stableFrames++;
          if (this.stableFrames >= 8) { // Stable for 8 frames (~0.25s) -> Trigger scan save!
            // Check lockout here so we still process and display diagnostics, but ignore saving duplicates during cooldown
            if (this.scanLockout > 0) {
              if (this.options.onStatusChange) {
                this.options.onStatusChange("Processing scan cooldown...", true);
              }
              return;
            }

            this.playBeep();
            
            // Trigger callback
            if (this.options.onScanSuccess) {
              this.options.onScanSuccess(studentIdStr, parsedScoreVal, this.lastDetectedQR);
            }
            
            // Trigger lockout (e.g. 30 frames or 1.0 second of cool down to prevent double scanning)
            this.scanLockout = 30;
            this.stableFrames = 0;
            this.lastScannedId = "";
            this.lastScannedScore = -1;
            
            if (this.options.onStatusChange) {
              this.options.onStatusChange("Scan saved! Remove paper", true);
            }
            return;
          } else {
            if (this.options.onStatusChange) {
              this.options.onStatusChange(`Holding steady (${Math.round(this.stableFrames / 18 * 100)}%)`, true);
            }
          }
        } else {
          // Reset stabilization
          this.stableFrames = 1;
          this.lastScannedId = studentIdStr;
          this.lastScannedScore = parsedScoreVal;
          if (this.options.onStatusChange) {
            this.options.onStatusChange("Valid sheet detected - Hold steady", true);
          }
        }
      } else {
        // We have anchors, but bubble reading is incomplete/invalid
        this.stableFrames = 0;
        
        let errorMsg = "Align card";
        if (hasIncompleteId && !allScoreEmpty) {
          errorMsg = "ID Incomplete (fill all 6 digits)";
        } else if (!hasIncompleteId && allScoreEmpty) {
          errorMsg = "Score Incomplete (bubble student score)";
        } else if (parsedScoreVal > this.options.maxScore) {
          errorMsg = `Score ${parsedScoreVal} exceeds Max (${this.options.maxScore})`;
        } else if (!hasIncompleteId && !allScoreEmpty) {
          errorMsg = "Invalid bubble markings";
        }
        
        if (this.options.onStatusChange) {
          this.options.onStatusChange(errorMsg, true);
        }
      }

      // Display live numbers on top in a floating style
      this.ctx.font = "bold 16px 'Outfit', sans-serif";
      this.ctx.fillStyle = scanSuccess ? '#10b981' : '#f59e0b';
      
      const debugText = `ID: ${studentIdStr} | Score: ${scoreStr}`;
      const textWidth = this.ctx.measureText(debugText).width;
      
      // Semi-transparent banner background
      this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      this.ctx.beginPath();
      this.ctx.roundRect((this.width - textWidth - 24) / 2, 40, textWidth + 24, 28, 6);
      this.ctx.fill();

      // Text print
      this.ctx.fillStyle = scanSuccess ? '#10b981' : '#f59e0b';
      this.ctx.fillText(debugText, (this.width - textWidth) / 2, 60);

    } else {
      // Anchors not found or geometric validation failed
      this.stableFrames = 0;
      
      if (this.options.onStatusChange) {
        let msg = "Align bubble sheet";
        if (allFound && !geometricValid) {
          msg = "Straighten sheet (avoid tilt)";
        }
        this.options.onStatusChange(msg, false);
      }

      // Draw red crosshairs/corners on default anchors to help the user align
      this.ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
      this.ctx.lineWidth = 1.5;
      
      this.defaultAnchors.forEach(a => {
        this.ctx.beginPath();
        this.ctx.arc(a.x, a.y, 14, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(a.x, a.y, 2, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(244, 63, 94, 0.5)';
        this.ctx.fill();
      });
    }
    } catch (err) {
      this.lastDiagnostics.error = err.stack || err.message || err.toString();
      throw err;
    }
  }

  // Force capture of current frame and return readings manually
  captureManual() {
    if (!this.isActive || this.video.readyState !== this.video.HAVE_ENOUGH_DATA) {
      return null;
    }
    
    // Perform OMR processing on the current frame
    // We already do this inside processFrame, so we can check the decoded variables
    if (this.lastScannedId && this.lastScannedScore >= 0 && this.lastScannedScore <= this.options.maxScore) {
      this.playBeep();
      return {
        studentId: this.lastScannedId,
        score: this.lastScannedScore,
        assignmentName: this.lastDetectedQR
      };
    }
    return null;
  }

  // Copy current webcam frame to clipboard as a PNG image
  copyFrameToClipboard() {
    if (!this.isActive || !this.processingCanvas) {
      return Promise.reject(new Error("Scanner is not active or video is not loaded"));
    }
    return new Promise((resolve, reject) => {
      this.processingCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to generate image blob"));
          return;
        }
        if (typeof ClipboardItem === 'undefined') {
          reject(new Error("ClipboardItem is not supported in this browser"));
          return;
        }
        try {
          const item = new ClipboardItem({ "image/png": blob });
          navigator.clipboard.write([item])
            .then(() => resolve())
            .catch(err => reject(err));
        } catch (err) {
          reject(err);
        }
      }, "image/png");
    });
  }

  // --- Hybrid Global Tracking Helpers ---

  // Flood fill / blob expansion to detect the area and bounds of a dark pixel group
  floodFill(startX, startY, pixels, visited, threshold) {
    const queue = [{ x: startX, y: startY }];
    const idxStart = startY * this.width + startX;
    visited[idxStart] = 1;
    
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;

    const width = this.width;
    const height = this.height;

    let head = 0;
    while (head < queue.length) {
      const p = queue[head++];
      sumX += p.x;
      sumY += p.y;
      count++;

      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;

      const neighbors = [
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 }
      ];

      for (let i = 0; i < neighbors.length; i++) {
        const nx = neighbors[i].x;
        const ny = neighbors[i].y;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            
            const pIdx = nIdx * 4;
            const gray = 0.299 * pixels[pIdx] + 0.587 * pixels[pIdx + 1] + 0.114 * pixels[pIdx + 2];
            
            if (gray < threshold) {
              queue.push({ x: nx, y: ny });
              
              if (queue.length > 750) {
                return null; // Reject blob if it is too massive
              }
            }
          }
        }
      }
    }

    return {
      cX: sumX / count,
      cY: sumY / count,
      count: count,
      w: maxX - minX + 1,
      h: maxY - minY + 1
    };
  }

  // Scan the frame globally to locate candidates for anchors and sort them into corners
  findGlobalAnchors(pixels, threshold) {
    const candidates = [];
    const visited = new Uint8Array(this.width * this.height);
    // Reduce stride to 3 to ensure we don't skip small bottom dots at a distance
    const stride = 3;

    for (let y = 10; y < this.height - 10; y += stride) {
      for (let x = 10; x < this.width - 10; x += stride) {
        const idx = y * this.width + x;
        if (visited[idx]) continue;

        const pIdx = idx * 4;
        const gray = 0.299 * pixels[pIdx] + 0.587 * pixels[pIdx + 1] + 0.114 * pixels[pIdx + 2];

        if (gray < threshold) {
          const blob = this.floodFill(x, y, pixels, visited, threshold);
          // Allow smaller blob sizes (>= 4 pixels) to capture small bottom dots far away
          if (blob && blob.count >= 4 && blob.count <= 600) {
            const aspect = blob.w / blob.h;
            // Tolerant aspect ratio range for tiny pixelated blobs
            if (aspect >= 0.45 && aspect <= 2.2) {
              candidates.push({
                x: blob.cX,
                y: blob.cY,
                area: blob.count
              });
            }
          }
        }
      }
    }

    if (candidates.length < 4) return null;

    // Limit candidate count to avoid combinatorial explosion under high noise.
    // We keep the 8 smallest and 8 largest candidates to ensure we preserve both the 
    // small bottom dots and the large top squares.
    // Limit candidate count to avoid combinatorial explosion under high noise.
    // We keep the 12 smallest and 24 largest candidates to ensure we preserve both the 
    // small bottom dots and the large top squares even when background clutter exists.
    if (candidates.length > 32) {
      candidates.sort((a, b) => a.area - b.area);
      const smallPruned = candidates.slice(0, 12);
      const largePruned = candidates.slice(-24);
      
      candidates.length = 0;
      const uniqueSet = new Set();
      smallPruned.forEach(c => uniqueSet.add(c));
      largePruned.forEach(c => uniqueSet.add(c));
      uniqueSet.forEach(c => candidates.push(c));
    }

    if (this.lastDiagnostics) {
      this.lastDiagnostics.candidatesCount = candidates.length;
      this.lastDiagnostics.candidates = candidates.map(c => ({
        x: Math.round(c.x),
        y: Math.round(c.y),
        area: c.area
      }));
    }

    let bestQuad = null;
    let bestScore = -1;

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        for (let k = j + 1; k < candidates.length; k++) {
          for (let l = k + 1; l < candidates.length; l++) {
            const pts = [candidates[i], candidates[j], candidates[k], candidates[l]];
            
            // Sort these 4 points into corners TL, TR, BL, BR based on sum/difference coordinates
            let tl = null, tr = null, bl = null, br = null;
            let minSum = Infinity, maxSum = -Infinity;
            let maxDiff = -Infinity, minDiff = Infinity;

            pts.forEach(p => {
              const sum = p.x + p.y;
              const diff = p.x - p.y;
              if (sum < minSum) { minSum = sum; tl = p; }
              if (sum > maxSum) { maxSum = sum; br = p; }
              if (diff > maxDiff) { maxDiff = diff; tr = p; }
              if (diff < minDiff) { minDiff = diff; bl = p; }
            });

            const uniqueSet = new Set([tl, tr, bl, br]);
            if (uniqueSet.size !== 4) continue;

            if (this.validateQuad(tl, tr, bl, br)) {
              const classified = this.classifyCornersBySize([tl, tr, bl, br]);
              if (!classified) continue;

              const [TL, TR, BL, BR] = classified;
              // Re-validate the size-classified quad shape to reject diagonal/warped shapes
              if (!this.validateQuad(TL, TR, BL, BR)) continue;
              
              const wTop = dist(TL, TR);
              const wBottom = dist(BL, BR);
              const hLeft = dist(TL, BL);
              const hRight = dist(TR, BR);

              const avgW = (wTop + wBottom) / 2;
              const avgH = (hLeft + hRight) / 2;
              const aspect = avgW / avgH;

              // Compute symmetry score (closer to card aspect ratio 0.758 is better)
              const aspectDiff = Math.abs(aspect - 0.758);
              const symW = Math.abs(wTop - wBottom) / avgW;
              const symH = Math.abs(hLeft - hRight) / avgH;

              // Penalty for asymmetric shapes and size deviations
              const symmetryPenalty = symW + symH + aspectDiff;
              
              // Score favors larger size and higher symmetry
              const score = (5.0 - symmetryPenalty) * 10 + avgW;

              if (score > bestScore) {
                bestScore = score;
                bestQuad = classified;
              }
            }
          }
        }
      }
    }

    return bestQuad;
  }

  // Classify 4 quad corners into [TL, TR, BL, BR] relative to the sheet's printed orientation
  // using size differences (Top large, Bottom small) and vector projection math.
  classifyCornersBySize(points) {
    // Sort points by area descending
    const sorted = [...points].sort((a, b) => b.area - a.area);
    
    const L1 = sorted[0];
    const L2 = sorted[1];
    const S1 = sorted[2];
    const S2 = sorted[3];

    // Verify size ratio
    const avgLarge = (L1.area + L2.area) / 2;
    const avgSmall = (S1.area + S2.area) / 2;
    
    // BACKWARD COMPATIBILITY FALLBACK:
    // If the size ratio is NOT distinct (ratio < 1.35), it means they are using the old sheet 
    // design where all anchors are equal size. We fall back to coordinate-based classification.
    if (avgLarge / avgSmall < 1.35) {
      let tl = null, tr = null, bl = null, br = null;
      let minSum = Infinity, maxSum = -Infinity;
      let maxDiff = -Infinity, minDiff = Infinity;

      points.forEach(c => {
        const sum = c.x + c.y;
        const diff = c.x - c.y;
        
        if (sum < minSum) { minSum = sum; tl = c; }
        if (sum > maxSum) { maxSum = sum; br = c; }
        if (diff > maxDiff) { maxDiff = diff; tr = c; }
        if (diff < minDiff) { minDiff = diff; bl = c; }
      });
      return [tl, tr, bl, br];
    }

    // Check for diagonal configurations (large anchors cannot be diagonally opposite in coordinate order).
    // points[0] is tl, points[1] is tr, points[2] is bl, points[3] is br.
    const isDiagonal = (L1 === points[0] && L2 === points[3]) || (L1 === points[3] && L2 === points[0]) ||
                       (L1 === points[1] && L2 === points[2]) || (L1 === points[2] && L2 === points[1]);
    if (isDiagonal) {
      return null;
    }

    // Verify size hierarchy for asymmetric anchors to filter out background noise combinations
    const largeRatio = L1.area / L2.area;
    const smallRatio = S1.area / S2.area;
    const separationRatio = L2.area / S1.area;
    const sizeRatio = avgLarge / avgSmall;

    // Estimate average width of the card based on distance between the two large anchors
    // and distance between the two small anchors to perform adaptive scaling validation.
    const avgW = (dist(L1, L2) + dist(S1, S2)) / 2;

    // Reject combinations where anchors deviate too far from their expected proportions:
    // 1. Two large anchors should be similar in size (largeRatio <= 2.0).
    // 2. Two small anchors should be similar in size (smallRatio <= 2.2).
    // 3. Size separation ratio of smaller large-anchor to larger small-anchor must be between 1.6 and 12.0 (expected ~4.0).
    // 4. Overall average size ratio must be between 1.35 and 10.0.
    // 5. Small and large anchors must scale with the overall width of the card.
    const minSmallArea = Math.max(3, 0.00012 * avgW * avgW);
    const minLargeArea = Math.max(4, 0.0006 * avgW * avgW);

    if (largeRatio > 2.0 || 
        smallRatio > 2.2 || 
        separationRatio < 1.6 || 
        separationRatio > 12.0 || 
        sizeRatio > 10.0 ||
        avgSmall < minSmallArea ||
        avgLarge < minLargeArea) {
      return null;
    }

    // Centroids
    const cSmall = { x: (S1.x + S2.x) / 2, y: (S1.y + S2.y) / 2 };
    const cLarge = { x: (L1.x + L2.x) / 2, y: (L1.y + L2.y) / 2 };

    // Up vector from bottom (small) to top (large)
    const vUp = { x: cLarge.x - cSmall.x, y: cLarge.y - cSmall.y };
    
    // Right vector (Up vector rotated 90 deg clockwise)
    const vRight = { x: -vUp.y, y: vUp.x };

    // Project large points onto vRight relative to cLarge
    const projL1 = (L1.x - cLarge.x) * vRight.x + (L1.y - cLarge.y) * vRight.y;
    const projL2 = (L2.x - cLarge.x) * vRight.x + (L2.y - cLarge.y) * vRight.y;

    const tl = projL1 < projL2 ? L1 : L2;
    const tr = projL1 < projL2 ? L2 : L1;

    // Project small points onto vRight relative to cSmall
    const projS1 = (S1.x - cSmall.x) * vRight.x + (S1.y - cSmall.y) * vRight.y;
    const projS2 = (S2.x - cSmall.x) * vRight.x + (S2.y - cSmall.y) * vRight.y;

    const bl = projS1 < projS2 ? S1 : S2;
    const br = projS1 < projS2 ? S2 : S1;

    return [tl, tr, bl, br];
  }

  // Check aspect ratios, symmetry bounds, and orthogonality of a corner quad
  validateQuad(TL, TR, BL, BR) {
    const wTop = dist(TL, TR);
    const wBottom = dist(BL, BR);
    const hLeft = dist(TL, BL);
    const hRight = dist(TR, BR);

    const avgW = (wTop + wBottom) / 2;
    const avgH = (hLeft + hRight) / 2;
    const aspect = avgW / avgH;

    const correctAspect = (aspect >= 0.60 && aspect <= 0.90);
    // Expand size range (minimum average width 65 instead of 75) to allow scanning from further away
    const correctSize = (avgW >= 65 && avgW <= 440);
    const symmetricW = (Math.abs(wTop - wBottom) / avgW < 0.38);
    const symmetricH = (Math.abs(hLeft - hRight) / avgH < 0.38);

    // Compute corner angle cosines to check for skew/orthogonality
    const getCornerCos = (p, p1, p2) => {
      const v1x = p1.x - p.x;
      const v1y = p1.y - p.y;
      const v2x = p2.x - p.x;
      const v2y = p2.y - p.y;
      const d1 = Math.hypot(v1x, v1y);
      const d2 = Math.hypot(v2x, v2y);
      if (d1 === 0 || d2 === 0) return 1.0;
      return (v1x * v2x + v1y * v2y) / (d1 * d2);
    };

    const cosTL = getCornerCos(TL, TR, BL);
    const cosTR = getCornerCos(TR, TL, BR);
    const cosBL = getCornerCos(BL, TL, BR);
    const cosBR = getCornerCos(BR, TR, BL);

    // Cosine threshold of 0.31 corresponds to angles between 72 and 108 degrees
    const maxCosThreshold = 0.31;
    const orthogonal = (Math.abs(cosTL) < maxCosThreshold) &&
                       (Math.abs(cosTR) < maxCosThreshold) &&
                       (Math.abs(cosBL) < maxCosThreshold) &&
                       (Math.abs(cosBR) < maxCosThreshold);

    return correctAspect && correctSize && symmetricW && symmetricH && orthogonal;
  }

  // Generate a formatted diagnostic dump of the last evaluated frame
  getDiagnosticReportText() {
    if (!this.lastDiagnostics) {
      return "No frame has been processed by the camera yet. Click 'Start Scanner' first.";
    }
    const d = this.lastDiagnostics;
    let out = `========================================\n`;
    out += `         OMR DIAGNOSTIC REPORT\n`;
    out += `========================================\n`;
    if (d.error) {
      out += `⚠️ RUNTIME ERROR CAUGHT:\n${d.error}\n`;
      out += `========================================\n`;
      return out;
    }
    out += `Timestamp    : ${d.timestamp}\n`;
    out += `Viewport Size: ${d.width}x${d.height}\n`;
    out += `Exposure     : min=${d.globalMin}, max=${d.globalMax}, thresh=${d.dynThreshold}\n`;
    out += `Sensitivity  : ${this.options.sensitivity}\n`;
    out += `Max Score    : ${this.options.maxScore}\n`;
    out += `----------------------------------------\n`;
    out += `1. ANCHOR LOCK STATUS\n`;
    out += `----------------------------------------\n`;
    out += `Candidates   : ${d.candidatesCount} detected\n`;
    if (d.candidatesCount > 0) {
      out += `Candidate List:\n`;
      d.candidates.forEach((c, idx) => {
        out += `  [#${idx + 1}] center=(${c.x}, ${c.y}), area=${c.area} px\n`;
      });
    }
    out += `Quad Lock    : ${d.quadFound ? "SUCCESS ✅" : "FAILED ❌"}\n`;
    if (d.quadFound && d.quadCorners) {
      out += `Corner Anchors:\n`;
      d.quadCorners.forEach(c => {
        out += `  - ${c.corner}: coord=(${c.x}, ${c.y}), area=${c.area} px\n`;
      });
      const qm = d.quadMetrics;
      out += `Quad Geometry:\n`;
      out += `  - Widths (Top/Bottom): ${qm.wTop} / ${qm.wBottom} px\n`;
      out += `  - Heights (Left/Right): ${qm.hLeft} / ${qm.hRight} px\n`;
      out += `  - Aspect Ratio        : ${qm.aspect} (target ~0.758)\n`;
      out += `  - Asymmetry (W / H)   : ${qm.asymW} / ${qm.asymH} (max <0.380)\n`;
      if (qm.angleTL !== undefined) {
        out += `  - Corner Angles (TL/TR/BL/BR): ${qm.angleTL}° / ${qm.angleTR}° / ${qm.angleBL}° / ${qm.angleBR}° (target 90°±18°)\n`;
      }
    }
    out += `----------------------------------------\n`;
    out += `2. OMR BUBBLE SCAN DATA\n`;
    out += `----------------------------------------\n`;
    if (!d.quadFound) {
      out += `Bubble scanning skipped: No valid anchor lock.\n`;
    } else {
      out += `Student ID   : Decoded="${d.studentIdDecoded}"\n`;
      d.studentIdBubbles.forEach(col => {
        out += `  Col ${col.column + 1}: darkest=row ${col.darkestRow} (val=${col.darkestAvg}), 2nd=row ${col.secondDarkestRow} (val=${col.secondDarkestAvg})\n`;
        out += `         baseline=${col.otherAvg}, delta=${col.delta} (req. >${this.options.sensitivity})\n`;
        out += `         status=${col.isDoubleFill ? "DOUBLE FILL ❌" : col.isFilled ? "FILLED ✅" : "EMPTY ⚪"}\n`;
        out += `         raw=[${col.rawValues.map(v => `${v.row}:${v.avg}`).join(", ")}]\n`;
      });
      
      out += `Score        : Decoded="${d.scoreDecoded}"\n`;
      d.scoreBubbles.forEach(col => {
        out += `  Col ${col.column + 1}: darkest=row ${col.darkestRow} (val=${col.darkestAvg}), 2nd=row ${col.secondDarkestRow} (val=${col.secondDarkestAvg})\n`;
        out += `         baseline=${col.otherAvg}, delta=${col.delta} (req. >${this.options.sensitivity})\n`;
        out += `         status=${col.isDoubleFill ? "DOUBLE FILL ❌" : col.isFilled ? "FILLED ✅" : "EMPTY ⚪"}\n`;
        out += `         raw=[${col.rawValues.map(v => `${v.row}:${v.avg}`).join(", ")}]\n`;
      });
      out += `----------------------------------------\n`;
      out += `Scan Output  : ${d.scanSuccess ? "VALID GRADE DECODED 🎉" : "INCOMPLETE / INVALID ❌"}\n`;
    }
    out += `========================================\n`;
    return out;
  }
}
