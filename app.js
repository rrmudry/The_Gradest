// The Gradest - Main Application Script

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  const state = {
    assignmentName: "Quiz 1",
    assignmentDetails: "Chapter 1-3 Review. Fill in bubbles completely.",
    maxScore: 100,
    grades: [], // Array of { id, score, name, percentage, status, timestamp }
    roster: new Map(), // studentId (string) -> studentName (string)
    activeTab: 'generate',
    selectedCameraId: null,
    sensitivity: 22,
    editingGradeIndex: null,
    savedAssignmentName: null // The name under which this assignment was last explicitly saved/loaded
  };

  // DOM Elements
  const tabBtnGenerate = document.getElementById('tab-btn-generate');
  const tabBtnScan = document.getElementById('tab-btn-scan');
  const tabBtnGrades = document.getElementById('tab-btn-grades');

  const tabGenerate = document.getElementById('tab-generate');
  const tabScan = document.getElementById('tab-scan');
  const tabGrades = document.getElementById('tab-grades');

  const formGenerator = document.getElementById('generator-form');
  const inputAssignName = document.getElementById('input-assign-name');
  const inputAssignDetails = document.getElementById('input-assign-details');
  const inputMaxScore = document.getElementById('input-max-score');
  const bubbleSheetPreview = document.getElementById('bubble-sheet-preview');
  const btnDownloadTuningPdf = document.getElementById('btn-download-tuning-pdf');

  // Saved Assignments UI elements
  const selectAssignments = document.getElementById('select-assignments');
  const btnDeleteAssignment = document.getElementById('btn-delete-assignment');
  const btnSaveAssignment = document.getElementById('btn-save-assignment');
  const btnExportPortfolio = document.getElementById('btn-export-portfolio');
  const btnImportPortfolio = document.getElementById('btn-import-portfolio');
  const inputImportFile = document.getElementById('input-import-file');

  // Scanner UI elements
  const cameraSelector = document.getElementById('camera-selector');
  const btnToggleCamera = document.getElementById('btn-toggle-camera');
  const btnManualScan = document.getElementById('btn-manual-scan');
  const inputSensitivity = document.getElementById('input-sensitivity');
  const scanViewport = document.getElementById('scanner-viewport');
  const scanVideo = document.getElementById('scanner-video');
  const scanCanvas = document.getElementById('scanner-canvas');
  
  const scanStatusText = document.getElementById('scan-status-text');
  const scannerStatsContainer = document.getElementById('scanner-stats-container');
  const scannerPlaceholder = document.getElementById('scanner-placeholder');
  
  const scanOutAssignment = document.getElementById('scan-out-assignment');
  const scanOutMaxScore = document.getElementById('scan-out-max-score');
  const scanOutStudentId = document.getElementById('scan-out-student-id');
  const scanOutStudentName = document.getElementById('scan-out-student-name');
  const scanOutScore = document.getElementById('scan-out-score');
  const scanOutPercentage = document.getElementById('scan-out-percentage');
  
  const btnSaveScan = document.getElementById('btn-save-scan');
  const btnDiscardScan = document.getElementById('btn-discard-scan');
  const recentScansContainer = document.getElementById('recent-scans');
  const logCountText = document.getElementById('log-count');
  const btnCopyDiagnostics = document.getElementById('btn-copy-diagnostics');
  const txtDiagnostics = document.getElementById('txt-diagnostics');

  // Grades & Export UI elements
  const btnUploadRoster = document.getElementById('btn-upload-roster');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnClearGrades = document.getElementById('btn-clear-grades');
  const gradesTableBody = document.getElementById('grades-table-body');
  
  const statTotal = document.getElementById('stat-total');
  const statAverage = document.getElementById('stat-average');
  const statRange = document.getElementById('stat-range');

  // Edit Modal Elements
  const dialogEditGrade = document.getElementById('dialog-edit-grade');
  const editGradeForm = document.getElementById('edit-grade-form');
  const editOriginalIndex = document.getElementById('edit-original-index');
  const editStudentId = document.getElementById('edit-student-id');
  const editStudentName = document.getElementById('edit-student-name');
  const editScore = document.getElementById('edit-score');
  const btnCloseDialog = document.getElementById('btn-close-dialog');
  const labelEditScore = document.getElementById('label-edit-score');

  // Initialize Scanner Object
  const scanner = new BubbleScanner(scanVideo, scanCanvas, {
    sensitivity: state.sensitivity,
    maxScore: state.maxScore,
    onScanSuccess: (studentId, score) => {
      handleSuccessfulScan(studentId, score);
    },
    onStatusChange: (statusText, isAligned) => {
      scanStatusText.textContent = statusText;
      if (isAligned) {
        scanStatusText.className = "badge badge-success";
        scanViewport.classList.add('aligned');
      } else {
        scanStatusText.className = "badge badge-warning";
        scanViewport.classList.remove('aligned');
      }
    }
  });

  // --- TAP ROUTING & NAVIGATION ---
  function switchTab(tabName) {
    state.activeTab = tabName;
    
    // Update Tab Buttons
    tabBtnGenerate.classList.toggle('active', tabName === 'generate');
    tabBtnScan.classList.toggle('active', tabName === 'scan');
    tabBtnGrades.classList.toggle('active', tabName === 'grades');
    
    tabBtnGenerate.setAttribute('aria-selected', tabName === 'generate');
    tabBtnScan.setAttribute('aria-selected', tabName === 'scan');
    tabBtnGrades.setAttribute('aria-selected', tabName === 'grades');

    // Update Content Views
    tabGenerate.classList.toggle('active', tabName === 'generate');
    tabScan.classList.toggle('active', tabName === 'scan');
    tabGrades.classList.toggle('active', tabName === 'grades');

    // Handle Camera state on navigation
    if (tabName !== 'scan' && scanner.isActive) {
      toggleScanner(false);
    }
  }

  tabBtnGenerate.addEventListener('click', () => switchTab('generate'));
  tabBtnScan.addEventListener('click', () => switchTab('scan'));
  tabBtnGrades.addEventListener('click', () => switchTab('grades'));

  // --- TAB 1: SHEET GENERATOR PREVIEW & PDF ---
  
  // Real-time Preview Render (SVG)
  function renderLivePreview() {
    state.assignmentName = inputAssignName.value.trim() || "Quiz 1";
    state.assignmentDetails = inputAssignDetails.value.trim() || "";
    state.maxScore = parseInt(inputMaxScore.value) || 100;
    scanner.setMaxScore(state.maxScore);

    // Calculate score digit columns count
    let D = 2;
    if (state.maxScore <= 9) D = 1;
    else if (state.maxScore <= 99) D = 2;
    else D = 3;

    // Build SVG inside preview container (new compact size 250 x 330 pt)
    let html = `
      <!-- Dashed border representing cut line -->
      <rect x="1" y="1" width="248" height="328" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4,4" />
      
      <!-- 4 Anchors (Asymmetric Scantron-style: Top are large squares, Bottom are small circles) -->
      <rect x="7" y="7" width="16" height="16" fill="black" />
      <rect x="227" y="7" width="16" height="16" fill="black" />
      <circle cx="15" cy="315" r="4.5" fill="black" />
      <circle cx="235" cy="315" r="4.5" fill="black" />

      <!-- Assignment Info Header -->
      <text x="25" y="36" font-family="'Outfit', sans-serif" font-size="10" font-weight="bold" fill="black">${escapeHTML(state.assignmentName)}</text>
      <text x="25" y="48" font-family="'Outfit', sans-serif" font-size="6.2" fill="#475569">${escapeHTML(state.assignmentDetails)}</text>
      <text x="25" y="60" font-family="'Outfit', sans-serif" font-size="7" font-weight="bold" fill="black">MAX SCORE: ${state.maxScore}</text>

      <!-- Student ID Label -->
      <text x="25" y="86" font-family="'Outfit', sans-serif" font-size="8" font-weight="bold" fill="black">STUDENT ID</text>
      
      <!-- Score Label -->
      <text x="135" y="86" font-family="'Outfit', sans-serif" font-size="8" font-weight="bold" fill="black">SCORE</text>
    `;

    // Student ID Boxes & Grid (6 columns)
    for (let i = 0; i < 6; i++) {
      const x = 25 + i * 14;
      // Write-in box
      html += `<rect x="${x - 5}" y="92" width="10" height="10" fill="none" stroke="black" stroke-width="0.75" />`;
      // Bubble column
      for (let j = 0; j < 10; j++) {
        const y = 115 + j * 14;
        html += `
          <circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="black" stroke-width="0.75" />
          <text x="${x}" y="${y + 2}" font-family="Arial" font-size="5" font-weight="bold" text-anchor="middle" fill="black">${j}</text>
        `;
      }
    }

    // Score Boxes & Grid (D columns)
    for (let i = 0; i < D; i++) {
      const x = 135 + i * 14;
      // Write-in box
      html += `<rect x="${x - 5}" y="92" width="10" height="10" fill="none" stroke="black" stroke-width="0.75" />`;
      // Bubble column
      for (let j = 0; j < 10; j++) {
        const y = 115 + j * 14;
        html += `
          <circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="black" stroke-width="0.75" />
          <text x="${x}" y="${y + 2}" font-family="Arial" font-size="5" font-weight="bold" text-anchor="middle" fill="black">${j}</text>
        `;
      }
    }

    // Score max denominator indicator text next to score boxes
    const denomX = 135 + D * 14 - 2;
    html += `<text x="${denomX}" y="100" font-family="'Outfit', sans-serif" font-size="8.5" font-weight="bold" fill="black">/ ${state.maxScore}</text>`;

    bubbleSheetPreview.innerHTML = `
      <svg viewBox="0 0 250 330" width="100%" height="100%" style="display:block;">
        ${html}
      </svg>
    `;
    saveCurrentAssignmentDebounced(true);
  }

  // Live updates as form fields change
  inputAssignName.addEventListener('input', renderLivePreview);
  inputAssignDetails.addEventListener('input', renderLivePreview);
  inputMaxScore.addEventListener('input', renderLivePreview);

  // PDF Generation using jsPDF (downloads vector 4-up PDF)
  formGenerator.addEventListener('submit', (e) => {
    e.preventDefault();
    generatePDF(false);
  });

  if (btnDownloadTuningPdf) {
    btnDownloadTuningPdf.addEventListener('click', () => {
      generatePDF(true);
    });
  }

  function generatePDF(isTuning = false) {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'letter'
      });

      const assignName = inputAssignName.value.trim() || "Quiz 1";
      const assignDetails = inputAssignDetails.value.trim() || "";
      const maxScoreVal = parseInt(inputMaxScore.value) || 100;
      
      let D = 2;
      if (maxScoreVal <= 9) D = 1;
      else if (maxScoreVal <= 99) D = 2;
      else D = 3;

      // Coordinate offsets for 4-up layout (2x2 grid) with extended padding/gutters
      // Letter page is 612 x 792 pt. Card dimension: 250 x 330.
      // Margin top/bottom: 40pt, Margin left/right: 32pt.
      // Horizontal gap: 48pt, Vertical gap: 52pt.
      const cardW = 250;
      const cardH = 330;
      const positions = [
        { x: 32, y: 40 },        // Top-Left
        { x: 330, y: 40 },       // Top-Right
        { x: 32, y: 422 },       // Bottom-Left
        { x: 330, y: 422 }       // Bottom-Right
      ];

      // Draw horizontal and vertical crop/cutting guides
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(0, 396, 612, 396);
      doc.line(306, 0, 306, 792);

      // Draw 4 cards
      positions.forEach((pos, idx) => {
        const ox = pos.x;
        const oy = pos.y;

        // Draw card boundary dashed line for cutting outline
        doc.setDrawColor(148, 163, 184); // Slate gray
        doc.setLineWidth(0.75);
        doc.setLineDashPattern([3, 3], 0);
        doc.rect(ox, oy, cardW, cardH);
        doc.setLineDashPattern([], 0); // reset to solid

        // Draw 4 corner anchors (Asymmetric Scantron-style: Top are large squares, Bottom are small circles)
        doc.setFillColor(0, 0, 0);
        doc.rect(ox + 7, oy + 7, 16, 16, 'F');
        doc.rect(ox + 227, oy + 7, 16, 16, 'F');
        doc.circle(ox + 15, oy + 315, 4.5, 'F');
        doc.circle(ox + 235, oy + 315, 4.5, 'F');

        // Setup tuning data
        let targetId = [];
        let targetScore = [];
        let cardLabel = "";

        if (isTuning) {
          if (idx === 0) {
            targetId = [1, 2, 3, 4, 5, 6];
            targetScore = D === 1 ? [8] : D === 2 ? [8, 5] : [0, 8, 5];
            cardLabel = "TUNING 1 - IDEAL BUBBLES";
          } else if (idx === 1) {
            targetId = [6, 5, 4, 3, 2, 1];
            targetScore = D === 1 ? [5] : D === 2 ? [5, 0] : [0, 5, 0];
            cardLabel = "TUNING 2 - FAINT BUBBLES";
          } else if (idx === 2) {
            targetId = [3, 4, 5, 6, 7, 8];
            targetScore = D === 1 ? [7] : D === 2 ? [7, 2] : [0, 7, 2];
            cardLabel = "TUNING 3 - MESSY BUBBLES";
          } else {
            targetId = [9, 8, 7, 6, 5, 4];
            targetScore = D === 1 ? [9] : D === 2 ? [9, 9] : [0, 9, 9];
            cardLabel = "TUNING 4 - INCOMPLETE / ERASED";
          }
        }

        // Draw Info Header
        doc.setTextColor(0, 0, 0);
        doc.setFont('Helvetica', 'Bold');
        doc.setFontSize(10);
        const headerText = isTuning ? cardLabel : assignName.toUpperCase();
        doc.text(headerText, ox + 25, oy + 36);

        doc.setFont('Helvetica', 'Normal');
        doc.setFontSize(6.2);
        doc.setTextColor(71, 85, 105);
        let detailsTruncated = isTuning ? "Use this card to evaluate webcam OMR thresholds and binarization." : assignDetails;
        if (!isTuning && detailsTruncated.length > 55) {
          detailsTruncated = detailsTruncated.substring(0, 52) + "...";
        }
        doc.text(detailsTruncated, ox + 25, oy + 48);

        doc.setFont('Helvetica', 'Bold');
        doc.setFontSize(7);
        doc.setTextColor(0, 0, 0);
        doc.text(`MAX SCORE: ${maxScoreVal}`, ox + 25, oy + 60);

        // Labels
        doc.text("STUDENT ID", ox + 25, oy + 86);
        doc.text("SCORE", ox + 135, oy + 86);

        // Draw Student ID grid (6 columns)
        doc.setLineWidth(0.75);
        doc.setDrawColor(0, 0, 0);
        doc.setFont('Helvetica', 'Bold');
        doc.setFontSize(5);
        doc.setTextColor(0, 0, 0);

        // Helper to draw pre-filled or messy or faint bubbles for tuning
        const drawTunedBubble = (bx, by, val, isTargetFilled) => {
          if (!isTuning || !isTargetFilled) {
            // Draw normal empty bubble
            doc.setDrawColor(0, 0, 0);
            doc.setFillColor(255, 255, 255);
            doc.circle(bx, by, 4.5, 'S');
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(5);
            doc.setTextColor(0, 0, 0);
            doc.text(val.toString(), bx, by + 2, { align: 'center' });
            return;
          }

          // It's a target filled bubble in tuning mode!
          if (idx === 0) {
            // Ideal: perfect solid black fill
            doc.setFillColor(0, 0, 0);
            doc.circle(bx, by, 4.5, 'F');
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(5);
            doc.setTextColor(255, 255, 255);
            doc.text(val.toString(), bx, by + 2, { align: 'center' });
          } else if (idx === 1) {
            // Faint: light gray fill
            doc.setFillColor(185, 185, 185);
            doc.circle(bx, by, 4.5, 'F');
            doc.setDrawColor(0, 0, 0);
            doc.circle(bx, by, 4.5, 'S');
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(5);
            doc.setTextColor(60, 60, 60);
            doc.text(val.toString(), bx, by + 2, { align: 'center' });
          } else if (idx === 2) {
            // Messy / Scribbled: outline + a few messy scribble lines inside
            doc.setDrawColor(0, 0, 0);
            doc.circle(bx, by, 4.5, 'S');
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(5);
            doc.setTextColor(0, 0, 0);
            doc.text(val.toString(), bx, by + 2, { align: 'center' });
            
            doc.setLineWidth(1.0);
            doc.setDrawColor(40, 40, 40);
            doc.line(bx - 3, by - 1, bx + 3, by + 1);
            doc.line(bx - 2, by + 2.5, bx + 2, by - 2.5);
            doc.line(bx - 1, by - 3, bx + 1.5, by + 3);
            doc.setLineWidth(0.75); // restore
          } else {
            // Incomplete / Erased: outline + a small off-center gray blob (partially erased look)
            doc.setDrawColor(0, 0, 0);
            doc.circle(bx, by, 4.5, 'S');
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(5);
            doc.setTextColor(100, 100, 100);
            doc.text(val.toString(), bx, by + 2, { align: 'center' });
            
            doc.setFillColor(130, 130, 130);
            doc.circle(bx - 1.2, by + 1.2, 2.5, 'F');
          }
        };

        for (let i = 0; i < 6; i++) {
          const bx = ox + 25 + i * 14;
          // Write-in box
          doc.rect(bx - 5, oy + 92, 10, 10);
          
          if (isTuning) {
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(7);
            doc.setTextColor(0, 0, 0);
            doc.text(targetId[i].toString(), bx, oy + 99.5, { align: 'center' });
          }

          for (let j = 0; j < 10; j++) {
            const by = oy + 115 + j * 14;
            drawTunedBubble(bx, by, j, isTuning && j === targetId[i]);
          }
        }

        // Draw Score grid (D columns)
        for (let i = 0; i < D; i++) {
          const bx = ox + 135 + i * 14;
          // Write-in box
          doc.rect(bx - 5, oy + 92, 10, 10);
          
          if (isTuning) {
            doc.setFont('Helvetica', 'Bold');
            doc.setFontSize(7);
            doc.setTextColor(0, 0, 0);
            doc.text(targetScore[i].toString(), bx, oy + 99.5, { align: 'center' });
          }

          for (let j = 0; j < 10; j++) {
            const by = oy + 115 + j * 14;
            drawTunedBubble(bx, by, j, isTuning && j === targetScore[i]);
          }
        }

        // Denominator slash notation next to score boxes
        const denomX = ox + 135 + D * 14 - 2;
        doc.setFontSize(8.5);
        doc.setTextColor(0, 0, 0);
        doc.text(`/ ${maxScoreVal}`, denomX, oy + 100);
      });

      // Download file
      const filename = isTuning 
        ? `omr_tuning_sheets.pdf` 
        : `${assignName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_bubble_sheets.pdf`;
      doc.save(filename);
      
      const successTitle = isTuning ? "Tuning PDF Downloaded" : "PDF Downloaded";
      const successDesc = isTuning 
        ? "OMR tuning sheets with ideal, faint, messy, and erased bubbles generated successfully." 
        : "4 bubble sheets on a Letter-sized grid generated successfully.";
      showToast(successTitle, successDesc, "success");
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      showToast("PDF Error", "An error occurred while building the PDF. Please try again.", "error");
    }
  }

  // --- TAB 2: WEBCAM SCANNER INTERFACE ---
  
  async function loadCameras() {
    try {
      const cameras = await BubbleScanner.getCameras();
      cameraSelector.innerHTML = '';
      
      if (cameras.length === 0) {
        cameraSelector.innerHTML = '<option value="">No cameras found</option>';
        return;
      }

      cameras.forEach(cam => {
        const option = document.createElement('option');
        option.value = cam.id;
        option.textContent = cam.label;
        cameraSelector.appendChild(option);
      });

      state.selectedCameraId = cameras[0].id;
    } catch (err) {
      cameraSelector.innerHTML = '<option value="">Access denied</option>';
    }
  }

  // Camera selection change
  cameraSelector.addEventListener('change', () => {
    state.selectedCameraId = cameraSelector.value;
    if (scanner.isActive) {
      toggleScanner(false).then(() => toggleScanner(true));
    }
  });

  // Toggle Camera Active state
  async function toggleScanner(forceState = null) {
    const shouldStart = forceState !== null ? forceState : !scanner.isActive;
    
    if (shouldStart) {
      btnToggleCamera.textContent = "Stop Scanner";
      btnToggleCamera.className = "btn btn-secondary";
      btnManualScan.disabled = false;
      
      // Clear last scan details
      resetScanOutput();

      try {
        await scanner.start(state.selectedCameraId);
      } catch (err) {
        // Handle error inside scanner.start
        btnToggleCamera.textContent = "Start Scanner";
        btnToggleCamera.className = "btn btn-primary";
        btnManualScan.disabled = true;
      }
    } else {
      scanner.stop();
      btnToggleCamera.textContent = "Start Scanner";
      btnToggleCamera.className = "btn btn-primary";
      btnManualScan.disabled = true;
      resetScanOutput();
    }
  }

  btnToggleCamera.addEventListener('click', () => toggleScanner());

  // Manual Frame Capture click
  btnManualScan.addEventListener('click', () => {
    // Force OMR processing and diagnostics capture
    const reportText = scanner.getDiagnosticReportText();
    if (txtDiagnostics) {
      txtDiagnostics.value = reportText;
    }
    if (btnCopyDiagnostics) {
      btnCopyDiagnostics.disabled = false;
    }

    // Try to copy webcam image to the clipboard so the user can paste it in the chat
    scanner.copyFrameToClipboard()
      .then(() => {
        showToast("Webcam Frame Copied!", "The raw webcam frame has been copied to your clipboard. You can paste it (Ctrl+V) directly into the AI chat to share it!", "success");
      })
      .catch(err => {
        console.warn("Clipboard copy failed:", err);
        showToast("Frame Capture Done", "Diagnostics generated, but could not auto-copy image to clipboard. Make sure the browser tab has active focus.", "info");
      });

    const reading = scanner.captureManual();
    if (reading) {
      handleSuccessfulScan(reading.studentId, reading.score);
    } else {
      showToast("Capture Failed", "Could not decode bubble sheet. Diagnostic details have been logged in the console below.", "error");
    }
  });

  // Diagnostics copy click
  if (btnCopyDiagnostics && txtDiagnostics) {
    btnCopyDiagnostics.addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txtDiagnostics.value).then(() => {
          showToast("Copied to Clipboard", "OMR diagnostic log copied successfully.", "success");
        }).catch(err => {
          console.error("Clipboard copy failed:", err);
          fallbackCopyText(txtDiagnostics);
        });
      } else {
        fallbackCopyText(txtDiagnostics);
      }
    });
  }

  function fallbackCopyText(textarea) {
    textarea.select();
    try {
      document.execCommand('copy');
      showToast("Copied to Clipboard", "OMR diagnostic log copied successfully.", "success");
    } catch (err) {
      showToast("Copy Failed", "Please copy the text manually from the text box.", "error");
    }
  }

  // Sensitivity input changes
  inputSensitivity.addEventListener('input', () => {
    state.sensitivity = parseInt(inputSensitivity.value);
    scanner.setSensitivity(state.sensitivity);
    saveCurrentAssignmentDebounced(true);
  });

  // Reset scan info fields
  function resetScanOutput() {
    scannerStatsContainer.style.display = 'none';
    scannerPlaceholder.style.display = 'flex';
    btnSaveScan.disabled = true;
    
    scanOutStudentId.textContent = "------";
    scanOutStudentName.textContent = "Not in roster";
    scanOutScore.textContent = "---";
    scanOutPercentage.textContent = "--%";
  }

  // Scan detection callback
  function handleSuccessfulScan(studentId, score) {
    state.assignmentName = inputAssignName.value.trim() || "Quiz 1";
    
    // Set UI Fields
    scanOutAssignment.textContent = state.assignmentName;
    scanOutMaxScore.textContent = state.maxScore;
    
    scanOutStudentId.textContent = studentId;
    const studentName = state.roster.get(studentId) || "Not in roster";
    scanOutStudentName.textContent = studentName;
    
    scanOutScore.textContent = score;
    const percentage = Math.round((score / state.maxScore) * 100);
    scanOutPercentage.textContent = `${percentage}%`;

    scannerPlaceholder.style.display = 'none';
    scannerStatsContainer.style.display = 'flex';
    btnSaveScan.disabled = false;

    // Automatically trigger save (since stabilization guarantees the paper was held steady)
    saveCurrentScan(studentId, score, studentName, percentage);
  }

  // Save current scanned result to the log database
  function saveCurrentScan(studentId, score, name, percentage) {
    // Check if the student already has a recorded grade. If so, overwrite/warn
    const existingIndex = state.grades.findIndex(g => g.id === studentId);
    
    const newGrade = {
      id: studentId,
      score: score,
      name: name,
      percentage: percentage,
      status: name !== "Not in roster" ? "Valid" : "No Roster Match",
      timestamp: new Date().toLocaleTimeString()
    };

    if (existingIndex >= 0) {
      state.grades[existingIndex] = newGrade;
      showToast("Grade Overwritten", `Overwrote ID ${studentId} with score ${score}/${state.maxScore} (${percentage}%).`, "warning");
    } else {
      state.grades.push(newGrade);
      showToast("Grade Saved", `Recorded student ${studentId}: ${score}/${state.maxScore} (${percentage}%).`, "success");
    }

    // Refresh layout views
    renderGradesTable();
    updateStatsDashboard();
    renderRecentScansList();
    saveCurrentAssignment(true);
  }

  // Recent scans sidebar rendering in Tab 2
  function renderRecentScansList() {
    recentScansContainer.innerHTML = '';
    
    // Show last 5 scans in reverse order (newest first)
    const recent = [...state.grades].slice(-5).reverse();
    logCountText.textContent = `${state.grades.length} scans`;

    if (recent.length === 0) {
      recentScansContainer.innerHTML = `
        <div class="empty-state" style="padding: 1.5rem 0;">
          <p class="empty-text" style="font-size: 0.8rem;">No grades recorded in this session yet.</p>
        </div>
      `;
      return;
    }

    recent.forEach(g => {
      const item = document.createElement('div');
      item.className = 'recent-scan-item';
      
      const displayName = g.name !== "Not in roster" ? g.name : "Unknown Student";
      
      item.innerHTML = `
        <div class="recent-scan-info">
          <span class="recent-scan-id">${g.id} (${escapeHTML(displayName)})</span>
          <span class="recent-scan-score">${g.score} / ${state.maxScore} (${g.percentage}%) - ${g.timestamp}</span>
        </div>
        <span class="badge ${g.status === 'Valid' ? 'badge-success' : 'badge-warning'}">${g.status}</span>
      `;
      
      recentScansContainer.appendChild(item);
    });
  }

  btnSaveScan.addEventListener('click', () => {
    const studentId = scanOutStudentId.textContent;
    const score = parseInt(scanOutScore.textContent);
    const name = scanOutStudentName.textContent;
    const percentage = parseInt(scanOutPercentage.textContent);
    
    if (studentId !== "------" && !isNaN(score)) {
      saveCurrentScan(studentId, score, name, percentage);
      resetScanOutput();
    }
  });

  btnDiscardScan.addEventListener('click', () => {
    resetScanOutput();
    showToast("Scan Discarded", "Scan entry was cleared without saving.", "secondary");
  });

  // --- TAB 3: GRADES DIRECTORY, ROSTER, STATS, & CSV EXPORT ---

  // Render main directory table
  function renderGradesTable() {
    gradesTableBody.innerHTML = '';

    if (state.grades.length === 0) {
      gradesTableBody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-icon">📁</div>
              <p class="empty-text">No grades recorded yet. Print bubble sheets, scan them in the Webcam tab, or upload a roster to get started.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    state.grades.forEach((g, index) => {
      const tr = document.createElement('tr');
      
      const badgeClass = g.status === 'Valid' ? 'badge-success' : 
                          g.status === 'Manually Edited' ? 'badge-success' : 'badge-warning';

      tr.innerHTML = `
        <td style="font-family:'JetBrains Mono', monospace; font-weight: 500;">${g.id}</td>
        <td>${escapeHTML(g.name)}</td>
        <td style="font-family:'JetBrains Mono', monospace;">${g.score} / ${state.maxScore}</td>
        <td style="font-family:'JetBrains Mono', monospace;">${g.percentage}%</td>
        <td><span class="badge ${badgeClass}">${g.status}</span></td>
        <td>
          <div class="btn-group">
            <button class="btn btn-secondary edit-grade-btn" data-index="${index}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">Edit</button>
            <button class="btn btn-danger delete-grade-btn" data-index="${index}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">Delete</button>
          </div>
        </td>
      `;

      gradesTableBody.appendChild(tr);
    });

    // Add event listeners for edit and delete buttons
    document.querySelectorAll('.edit-grade-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'));
        openEditDialog(index);
      });
    });

    document.querySelectorAll('.delete-grade-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'));
        deleteGrade(index);
      });
    });
  }

  // Update statistics dashboards
  function updateStatsDashboard() {
    const total = state.grades.length;
    statTotal.textContent = total;

    if (total === 0) {
      statAverage.textContent = "0%";
      statRange.textContent = "0 / 0";
      return;
    }

    let sumPercent = 0;
    let max = -1;
    let min = 999999;
    
    state.grades.forEach(g => {
      sumPercent += g.percentage;
      if (g.score > max) max = g.score;
      if (g.score < min) min = g.score;
    });

    const avg = Math.round(sumPercent / total);
    statAverage.textContent = `${avg}%`;
    statRange.textContent = `${max} / ${min}`;
  }

  // Delete grade entry
  function deleteGrade(index) {
    const deleted = state.grades.splice(index, 1)[0];
    showToast("Grade Deleted", `Removed ID ${deleted.id} from records.`, "danger");
    renderGradesTable();
    updateStatsDashboard();
    renderRecentScansList();
    saveCurrentAssignment(true);
  }

  // Edit grade dialog controls
  function openEditDialog(index) {
    const entry = state.grades[index];
    state.editingGradeIndex = index;
    
    editOriginalIndex.value = index;
    editStudentId.value = entry.id;
    editStudentName.value = entry.name;
    editScore.value = entry.score;
    editScore.max = state.maxScore;
    
    labelEditScore.textContent = `Score (0 - ${state.maxScore})`;
    
    dialogEditGrade.classList.add('open');
  }

  function closeEditDialog() {
    dialogEditGrade.classList.remove('open');
    state.editingGradeIndex = null;
    editGradeForm.reset();
  }

  btnCloseDialog.addEventListener('click', closeEditDialog);

  editGradeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const index = parseInt(editOriginalIndex.value);
    const id = editStudentId.value.trim();
    const scoreVal = parseInt(editScore.value);
    
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > state.maxScore) {
      alert(`Score must be between 0 and ${state.maxScore}`);
      return;
    }

    if (id.length !== 6 || isNaN(parseInt(id))) {
      alert("Student ID must be a 6 digit number.");
      return;
    }

    // Remap name from roster
    const name = state.roster.get(id) || "Not in roster";
    const percentage = Math.round((scoreVal / state.maxScore) * 100);

    state.grades[index] = {
      id: id,
      score: scoreVal,
      name: name,
      percentage: percentage,
      status: "Manually Edited",
      timestamp: new Date().toLocaleTimeString()
    };

    showToast("Grade Updated", `Modified entry for ID ${id}.`, "success");
    closeEditDialog();
    renderGradesTable();
    updateStatsDashboard();
    renderRecentScansList();
    saveCurrentAssignment(true);
  });

  // Clear all recorded grades
  btnClearGrades.addEventListener('click', () => {
    if (state.grades.length === 0) return;
    
    const confirmClear = confirm("Are you sure you want to clear all grade entries? This action cannot be undone.");
    if (confirmClear) {
      state.grades = [];
      showToast("Data Cleared", "All scanned grade records have been deleted.", "danger");
      renderGradesTable();
      updateStatsDashboard();
      renderRecentScansList();
      saveCurrentAssignment(true);
    }
  });

  // Roster CSV Upload
  btnUploadRoster.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      parseRosterCSV(evt.target.result);
    };
    reader.readAsText(file);
    // Reset file input value to allow upload of same file later
    btnUploadRoster.value = '';
  });

  function parseRosterCSV(csvText) {
    try {
      const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) {
        alert("The uploaded CSV file must contain a header row and at least one student data row.");
        return;
      }

      // Read header row
      // We parse with simple comma splits but handle quotes optionally
      const parseCSVRow = (row) => {
        const result = [];
        let inQuotes = false;
        let cell = "";
        for (let k = 0; k < row.length; k++) {
          const char = row[k];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(cell.trim().replace(/^"|"$/g, ''));
            cell = "";
          } else {
            cell += char;
          }
        }
        result.push(cell.trim().replace(/^"|"$/g, ''));
        return result;
      };

      const headers = parseCSVRow(lines[0]);
      
      // Look for ID and Name columns
      let idIndex = -1;
      let nameIndex = -1;

      headers.forEach((h, idx) => {
        const lowerH = h.toLowerCase();
        if (lowerH.includes('id') || lowerH.includes('student id') || lowerH.includes('number')) {
          if (idIndex === -1) idIndex = idx;
        }
        if (lowerH.includes('name') || lowerH.includes('student name') || lowerH.includes('student')) {
          if (nameIndex === -1) nameIndex = idx;
        }
      });

      // Defaults if not matched by name search
      if (idIndex === -1) idIndex = 0;
      if (nameIndex === -1) nameIndex = 1;

      if (idIndex >= headers.length || nameIndex >= headers.length) {
        alert("Could not automatically locate 'Student ID' and 'Name' columns. Please ensure they are present in the CSV header.");
        return;
      }

      // Load roster map
      state.roster.clear();
      let count = 0;

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length <= Math.max(idIndex, nameIndex)) continue;

        let rawId = row[idIndex].replace(/[^0-9]/g, '');
        // Pad ID to 6 digits if it is numeric
        if (rawId.length > 0 && rawId.length < 6) {
          rawId = rawId.padStart(6, '0');
        }
        const studentName = row[nameIndex];

        if (rawId.length === 6 && studentName) {
          state.roster.set(rawId, studentName);
          count++;
        }
      }

      showToast("Roster Uploaded", `Successfully mapped ${count} students from CSV.`, "success");

      // Update existing records with names from the new roster
      state.grades.forEach(g => {
        if (state.roster.has(g.id)) {
          g.name = state.roster.get(g.id);
          if (g.status === "No Roster Match") {
            g.status = "Valid";
          }
        }
      });

      renderGradesTable();
      updateStatsDashboard();
      renderRecentScansList();
      saveCurrentAssignment(true);
    } catch (err) {
      console.error(err);
      alert("Error parsing CSV roster file. Please verify its formatting.");
    }
  }

  // Export Grades as CSV
  btnExportCsv.addEventListener('click', () => {
    if (state.grades.length === 0) {
      showToast("Export Denied", "No grade records to export. Scan sheets or enter grades first.", "warning");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Student ID,Student Name,Score,Max Score,Percentage,Scan Status\r\n";

    state.grades.forEach(g => {
      // Escape commas in names
      const nameEscaped = g.name.includes(',') ? `"${g.name}"` : g.name;
      csvContent += `${g.id},${nameEscaped},${g.score},${state.maxScore},${g.percentage}%,${g.status}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const assignFilename = state.assignmentName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.setAttribute("download", `${assignFilename}_grades_export.csv`);
    document.body.appendChild(link); // Required for FF
    
    link.click();
    document.body.removeChild(link);
    
    showToast("CSV Exported", "Grade records successfully compiled and downloaded.", "success");
  });

  // --- FLOATING TOAST NOTIFICATION UTILITY ---
  function showToast(title, message, type = "success") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = "🔔";
    if (type === "success") icon = "✅";
    else if (type === "warning") icon = "⚠️";
    else if (type === "error" || type === "danger") icon = "❌";

    toast.innerHTML = `
      <div style="font-size: 1.25rem;">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${escapeHTML(title)}</div>
        <div class="toast-message">${escapeHTML(message)}</div>
      </div>
    `;

    container.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      toast.style.animation = "slideIn var(--transition-fast) reverse";
      setTimeout(() => {
        if (toast.parentNode === container) {
          container.removeChild(toast);
        }
      }, 300);
    }, 4000);
  }

  // HTML escaping utility
  function escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- SAVED ASSIGNMENTS LOGIC ---

  let saveDebounceTimeout = null;
  function saveCurrentAssignmentDebounced(silent = true) {
    if (saveDebounceTimeout) clearTimeout(saveDebounceTimeout);
    saveDebounceTimeout = setTimeout(() => {
      saveCurrentAssignment(silent);
    }, 400);
  }

  function getStoredAssignments() {
    try {
      const data = localStorage.getItem('the_gradest_assignments');
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.error("Error reading localStorage:", e);
      return {};
    }
  }

  function setStoredAssignments(assignments) {
    try {
      localStorage.setItem('the_gradest_assignments', JSON.stringify(assignments));
    } catch (e) {
      console.error("Error writing localStorage:", e);
      showToast("Storage Error", "Local storage is full or disabled.", "error");
    }
  }

  function updateAssignmentsDropdown() {
    const list = getStoredAssignments();
    const names = Object.keys(list);
    
    selectAssignments.innerHTML = '<option value="">-- Start New Assignment --</option>';
    
    names.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      selectAssignments.appendChild(option);
    });

    const activeName = localStorage.getItem('the_gradest_active_assignment_name') || "";
    if (activeName && list[activeName]) {
      selectAssignments.value = activeName;
      btnDeleteAssignment.disabled = false;
    } else {
      selectAssignments.value = "";
      btnDeleteAssignment.disabled = true;
    }
  }

  function saveCurrentAssignment(silent = false) {
    const assignments = getStoredAssignments();

    if (silent) {
      // Auto-save: only write back to the exact name that was last explicitly saved/loaded.
      // This prevents intermediate keystrokes (e.g. typing "Quiz 123" through "Quiz 1", "Quiz 12")
      // from creating unwanted entries.
      const pinnedName = state.savedAssignmentName;
      if (!pinnedName || !assignments[pinnedName]) return;

      assignments[pinnedName] = {
        assignmentName: state.assignmentName,
        assignmentDetails: state.assignmentDetails,
        maxScore: state.maxScore,
        grades: state.grades,
        roster: Array.from(state.roster.entries()),
        sensitivity: state.sensitivity,
        timestamp: Date.now()
      };
      setStoredAssignments(assignments);
      return;
    }

    // Explicit save: use the current input name and register it as the pinned name.
    const name = state.assignmentName.trim();
    if (!name) {
      showToast("Save Failed", "Please enter an assignment name.", "error");
      return;
    }

    assignments[name] = {
      assignmentName: state.assignmentName,
      assignmentDetails: state.assignmentDetails,
      maxScore: state.maxScore,
      grades: state.grades,
      roster: Array.from(state.roster.entries()),
      sensitivity: state.sensitivity,
      timestamp: Date.now()
    };

    setStoredAssignments(assignments);
    state.savedAssignmentName = name;
    localStorage.setItem('the_gradest_active_assignment_name', name);
    
    updateAssignmentsDropdown();
    showToast("Assignment Saved", `"${name}" saved successfully to local storage.`, "success");
  }

  function loadAssignment(name) {
    if (!name) {
      state.assignmentName = "Quiz 1";
      state.assignmentDetails = "Chapter 1-3 Review. Fill in bubbles completely.";
      state.maxScore = 100;
      state.grades = [];
      state.roster.clear();
      state.sensitivity = 22;
      state.savedAssignmentName = null; // No pinned name; not yet saved
      localStorage.removeItem('the_gradest_active_assignment_name');
    } else {
      const assignments = getStoredAssignments();
      const data = assignments[name];
      if (!data) return;

      state.assignmentName = data.assignmentName || name;
      state.assignmentDetails = data.assignmentDetails || "";
      state.maxScore = data.maxScore || 100;
      state.grades = data.grades || [];
      state.roster = new Map(data.roster || []);
      state.sensitivity = data.sensitivity !== undefined ? data.sensitivity : 22;
      state.savedAssignmentName = name; // Pin to the loaded name for auto-saves
      
      localStorage.setItem('the_gradest_active_assignment_name', name);
    }

    inputAssignName.value = state.assignmentName;
    inputAssignDetails.value = state.assignmentDetails;
    inputMaxScore.value = state.maxScore;
    inputSensitivity.value = state.sensitivity;
    scanner.setMaxScore(state.maxScore);
    scanner.setSensitivity(state.sensitivity);

    renderLivePreview();
    renderGradesTable();
    updateStatsDashboard();
    renderRecentScansList();
    updateAssignmentsDropdown();

    showToast("Assignment Loaded", `Loaded "${state.assignmentName}".`, "success");
  }

  function deleteAssignment(name) {
    if (!name) return;
    if (!confirm(`Are you sure you want to delete "${name}"? This will erase all its roster data and scores.`)) return;

    const assignments = getStoredAssignments();
    delete assignments[name];
    setStoredAssignments(assignments);

    const activeName = localStorage.getItem('the_gradest_active_assignment_name');
    if (activeName === name) {
      localStorage.removeItem('the_gradest_active_assignment_name');
      loadAssignment("");
    } else {
      updateAssignmentsDropdown();
    }

    showToast("Assignment Deleted", `"${name}" removed from local storage.`, "warning");
  }

  function exportPortfolio() {
    const assignments = getStoredAssignments();
    const activeName = localStorage.getItem('the_gradest_active_assignment_name') || "";
    
    const portfolio = {
      version: "1.0",
      activeAssignmentName: activeName,
      assignments: assignments
    };

    const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `the_gradest_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast("Backup Created", "Saved portfolio backup to your downloads.", "success");
  }

  function importPortfolio(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !data.assignments) {
          throw new Error("Invalid format. Missing assignments object.");
        }

        const confirmed = confirm("Are you sure you want to import this file? This will overwrite or merge with your existing saved assignments.");
        if (!confirmed) return;

        const existing = getStoredAssignments();
        Object.assign(existing, data.assignments);
        setStoredAssignments(existing);

        if (data.activeAssignmentName && existing[data.activeAssignmentName]) {
          localStorage.setItem('the_gradest_active_assignment_name', data.activeAssignmentName);
          loadAssignment(data.activeAssignmentName);
        } else {
          updateAssignmentsDropdown();
        }

        showToast("Backup Restored", `Imported ${Object.keys(data.assignments).length} assignments.`, "success");
      } catch (err) {
        console.error(err);
        alert("Error parsing backup file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Bind Event Listeners for Save/Load panel
  selectAssignments.addEventListener('change', (e) => loadAssignment(e.target.value));
  btnDeleteAssignment.addEventListener('click', () => deleteAssignment(selectAssignments.value));
  btnSaveAssignment.addEventListener('click', () => saveCurrentAssignment(false));
  btnExportPortfolio.addEventListener('click', exportPortfolio);
  inputImportFile.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importPortfolio(e.target.files[0]);
    }
  });

  // --- APPLICATION SETUP INIT ---
  renderLivePreview();
  loadCameras();
  updateAssignmentsDropdown();

  // Load last active assignment on startup if it exists
  const activeNameOnStartup = localStorage.getItem('the_gradest_active_assignment_name') || "";
  if (activeNameOnStartup) {
    const listOnStartup = getStoredAssignments();
    if (listOnStartup[activeNameOnStartup]) {
      loadAssignment(activeNameOnStartup);
    }
  }
});
