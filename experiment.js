// experiment.js — Shophouse Facade Similarity Rating pretest.
// Structure/conventions (CSV parsing, shuffle, localStorage safety net, CSV
// export via Blob download) are deliberately reused from
// eeg_similarity_task/experiment.js. This task has no fixation/blank/second-
// image sequence, no practice, no blocks — both facades are shown together
// and the participant rates similarity on a 1-7 scale by CLICKING a button
// (not a keypress), can change their selection before confirming with
// "Next", and there is no confidence rating.
//
// All 360 trials are driven by ONE custom jsPsych node (ratingAppNode) that
// manually manages a currentIndex + Back/Next navigation, instead of one
// jsPsych timeline node per trial — jsPsych's timeline is forward-only, so
// "go back and re-answer a previous trial" needs manual state management.
// Progress ("Trial X of N") is shown on every trial.
//
// Each trial's result is also POSTed to a Google Sheets Web App (see
// GOOGLE_SHEET_WEB_APP_URL below and README.md) so data is collected
// centrally without requiring participants to send back a CSV file. This
// happens every time "Next" is clicked — including when re-confirming a
// revised answer after going Back — so autosave granularity is every single
// trial (the finest possible interval; see README for why coarser intervals
// aren't needed).

const GOOGLE_SHEET_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbw9sFFFr6WoIIJuRuHv4z1Wnezf6eE-PPcqGUMP0J30ez37OVFfF6egMeiVzBZX8sh6pw/exec";

const CONFIG = {
  TRIALS_CSV_PATH: "./trials.csv",
  IMAGES_DIR: "./images/",
  IMAGE_DISPLAY_HEIGHT_PX: 480,

  SIMILARITY_LABELS: {
    1: "not similar at all",
    4: "moderate / unsure",
    7: "highly similar",
  },
};

const TRIAL_CSV_COLUMNS = [
  "participant_id", "trial_index_global", "trial_id", "condition",
  "original_image_A", "original_image_B", "left_image", "right_image", "left_right_swapped",
  "visual_A", "visual_B", "graph_A", "graph_B",
  "visual_similarity_score", "graph_similarity_score", "screening_score",
  "similarity_rating", "rating_onset", "rating_rt_ms",
  "trial_end_time", "timestamp",
];

let participantInfo = {};
let trialRecords = [];   // one entry per trial, fixed order, filled/overwritten as answered
let currentIndex = 0;
let currentTrialRenderTime = null;
let jsPsychInstance;

// =============================================================================
// CSV parsing (same minimal RFC4180-ish parser used elsewhere in this project)
// =============================================================================

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  const objs = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === "") continue;
    const obj = {};
    header.forEach((h, i) => { obj[h] = rows[r][i] !== undefined ? rows[r][i] : ""; });
    objs.push(obj);
  }
  return objs;
}

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =============================================================================
// Server-side data collection (Google Sheets Web App) — fire-and-forget,
// sent right after each trial finishes so a dropped-off participant still
// leaves their completed trials on the server. `mode: "no-cors"` is required
// because Apps Script Web Apps don't return CORS headers; we don't need to
// read the response, so this is fine.
// =============================================================================

function submitToSheet(record) {
  if (!GOOGLE_SHEET_WEB_APP_URL || GOOGLE_SHEET_WEB_APP_URL.startsWith("PASTE_")) {
    console.warn("GOOGLE_SHEET_WEB_APP_URL not configured — trial not sent to server (still saved locally).");
    return;
  }
  fetch(GOOGLE_SHEET_WEB_APP_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify(record),
  }).catch((e) => console.warn("submitToSheet failed:", e));
}

// Sent once, when the participant reaches the end page having answered all
// trials. Lets the researcher filter out anyone who dropped out partway
// through — see Code.gs, which routes this to a separate "completions" tab
// instead of the per-trial "responses" tab (detected via `type: "completion"`).
function submitCompletion() {
  const payload = {
    type: "completion",
    participant_id: participantInfo.participant_id || "",
    completed: true,
    completion_time: new Date().toISOString(),
    total_answered: trialRecords.filter(r => r.similarity_rating !== null).length,
  };
  if (!GOOGLE_SHEET_WEB_APP_URL || GOOGLE_SHEET_WEB_APP_URL.startsWith("PASTE_")) {
    console.warn("GOOGLE_SHEET_WEB_APP_URL not configured — completion not sent to server.");
    return;
  }
  fetch(GOOGLE_SHEET_WEB_APP_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify(payload),
  }).catch((e) => console.warn("submitCompletion failed:", e));
}

// =============================================================================
// Trial records (one per trial, built once up front) + a single custom
// screen that renders whichever trial `currentIndex` points at, with
// Back/Next navigation. Re-visiting a trial via Back shows its previously
// selected rating (if any) and overwrites it on the next "Next" click.
// =============================================================================

function buildTrialRecords(orderedTrials) {
  return orderedTrials.map((trial, i) => {
    const swapped = Math.random() < 0.5;
    const leftImg = swapped ? trial.image_B : trial.image_A;
    const rightImg = swapped ? trial.image_A : trial.image_B;
    return {
      participant_id: "",
      trial_index_global: i,
      trial_id: trial.trial_id,
      condition: trial.condition,
      original_image_A: trial.image_A,
      original_image_B: trial.image_B,
      left_image: leftImg,
      right_image: rightImg,
      left_right_swapped: swapped,
      visual_A: trial.visual_A,
      visual_B: trial.visual_B,
      graph_A: trial.graph_A,
      graph_B: trial.graph_B,
      visual_similarity_score: trial.visual_similarity_score,
      graph_similarity_score: trial.graph_similarity_score,
      screening_score: trial.screening_score,
      similarity_rating: null,
      rating_onset: null,
      rating_rt_ms: null,
      trial_end_time: null,
      timestamp: null,
    };
  });
}

function finalizeRecord(record) {
  record.trial_end_time = performance.now();
  record.timestamp = new Date().toISOString();
  record.participant_id = participantInfo.participant_id || "";
  autoSaveProgress();
  submitToSheet(record); // appends a fresh row even on a re-answer/revision — see README
}

function renderCurrentTrial(container) {
  const total = trialRecords.length;
  const record = trialRecords[currentIndex];
  currentTrialRenderTime = performance.now();

  const buttonsHtml = [1, 2, 3, 4, 5, 6, 7].map(n => {
    const label = CONFIG.SIMILARITY_LABELS[n]
      ? `<div class="likert-label">${CONFIG.SIMILARITY_LABELS[n]}</div>` : "";
    const selectedClass = record.similarity_rating === n ? " selected" : "";
    return `<button type="button" class="likert-btn${selectedClass}" data-value="${n}">${n}${label}</button>`;
  }).join("");

  container.innerHTML = `
    <div class="progress-text">Trial ${currentIndex + 1} of ${total}</div>
    <div class="stim-pair">
      <img class="facade-img" src="${CONFIG.IMAGES_DIR + encodeURIComponent(record.left_image)}">
      <img class="facade-img" src="${CONFIG.IMAGES_DIR + encodeURIComponent(record.right_image)}">
    </div>
    <div class="question-text">How similar are these two shophouse facades as architectural types?</div>
    <div class="likert-scale">${buttonsHtml}</div>
    <div class="nav-buttons">
      <button type="button" id="back-btn" class="jspsych-btn secondary-btn"${currentIndex === 0 ? " disabled" : ""}>Back</button>
      <button type="button" id="next-btn" class="jspsych-btn"${record.similarity_rating === null ? " disabled" : ""}>Next</button>
    </div>
  `;

  container.querySelectorAll(".likert-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      record.similarity_rating = parseInt(btn.dataset.value, 10);
      container.querySelectorAll(".likert-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      container.querySelector("#next-btn").disabled = false;
    });
  });

  container.querySelector("#back-btn").addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentTrial(container);
    }
  });

  container.querySelector("#next-btn").addEventListener("click", () => {
    record.rating_onset = currentTrialRenderTime;
    record.rating_rt_ms = Math.round(performance.now() - currentTrialRenderTime);
    finalizeRecord(record);
    if (currentIndex < total - 1) {
      currentIndex++;
      renderCurrentTrial(container);
    } else {
      jsPsychInstance.finishTrial();
    }
  });
}

function ratingAppNode() {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div id="rating-app"></div>',
    choices: "NO_KEYS",
    on_load: () => {
      renderCurrentTrial(document.getElementById("rating-app"));
    },
  };
}

// =============================================================================
// localStorage safety net (no resume UI — see README for manual recovery)
// =============================================================================

function autoSaveProgress() {
  try {
    const key = "similarity_rating_progress_" + (participantInfo.participant_id || "unknown");
    localStorage.setItem(key, JSON.stringify(trialRecords));
  } catch (e) {
    console.warn("auto-save failed:", e);
  }
}

// =============================================================================
// CSV export (local backup download — the primary data path is
// submitToSheet() above, this is just a convenience copy for the participant
// or researcher)
// =============================================================================

function downloadBlob(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportResults() {
  const pid = participantInfo.participant_id || "participant";
  const lines = [TRIAL_CSV_COLUMNS.join(",")];
  trialRecords.forEach(r => {
    if (r.similarity_rating === null) return; // not reached (shouldn't happen on normal completion)
    lines.push(TRIAL_CSV_COLUMNS.map(col => csvEscape(r[col])).join(","));
  });
  downloadBlob(lines.join("\n"), `${pid}_similarity_ratings.csv`);
}

// =============================================================================
// Static pages — never mention condition, cluster labels, similarity scores,
// screening_score, or filenames.
// =============================================================================

function infoPage(html, continueText) {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="info-page">${html}<p class="continue-hint">${continueText || "Press SPACE to continue"}</p></div>`,
    choices: [" "],
  };
}

const welcomeNode = infoPage(`
  <h2>Welcome</h2>
  <p>Thank you for taking part in this study. You will see pairs of building
  facade photographs, side by side, and rate how similar they are.</p>
`);

function participantInfoNode() {
  return {
    type: jsPsychSurveyHtmlForm,
    preamble: '<h2 style="text-align:left">Participant information</h2>',
    html: `
      <p><label>Participant ID<br><input name="participant_id" type="text" required></label></p>
      <p><label>Age<br><input name="age" type="number" min="1" max="120" required></label></p>
      <p><label>Gender (optional)<br><input name="gender" type="text"></label></p>
      <p>Do you have an architecture / design / heritage background?<br>
        <label><input type="radio" name="background" value="yes" required> Yes</label>
        <label><input type="radio" name="background" value="no"> No</label>
      </p>
      <p>Familiarity with Singapore shophouses (1 = not at all, 7 = very familiar)<br>
        <div class="likert-row">
          ${[1, 2, 3, 4, 5, 6, 7].map(n =>
            `<span class="likert-option"><input type="radio" name="familiarity" value="${n}" required>${n}</span>`
          ).join("")}
        </div>
      </p>
    `,
    button_label: "Continue",
    on_finish: (data) => {
      const r = data.response;
      participantInfo = {
        participant_id: r.participant_id, age: r.age, gender: r.gender || "",
        background: r.background, familiarity: r.familiarity,
      };
    },
  };
}

const instructionsNode = infoPage(`
  <h2>Instructions</h2>
  <p>On each trial you will see two shophouse facade photographs side by
  side. Please rate:<br>
  <em>"How similar are these two shophouse facades as architectural
  types?"</em></p>
  <p>Click a number from <strong>1 to 7</strong>:<br>
  1 = not similar at all &nbsp;&nbsp;
  4 = moderate / unsure &nbsp;&nbsp;
  7 = highly similar</p>
  <p>You can click a different number to change your answer before
  confirming — click <strong>Next</strong> once you're happy with your
  choice. You can also click <strong>Back</strong> at any time to revisit an
  earlier pair and change your answer.</p>
  <p><strong class="emphasis">Please use the full rating scale whenever
  appropriate, rather than giving the same score repeatedly.</strong> There
  are no right or wrong answers — we're interested in your own judgement.</p>
  <p>A counter at the top shows your progress ("Trial X of N"). Take as much
  time as you need on each trial.</p>
`);

function endNode() {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="info-page">
      <h2>All done</h2>
      <p>All responses have been saved. You may now close this page.</p>
      <p>Thank you for taking part. You can also download a personal copy of
      your results below if you'd like.</p>
      <button id="download-btn" class="jspsych-btn">Download CSV</button>
    </div>`,
    choices: "NO_KEYS",
    on_load: () => {
      submitCompletion();
      document.getElementById("download-btn").addEventListener("click", exportResults);
    },
  };
}

// =============================================================================
// Trial list loading + main timeline
// =============================================================================

async function loadTrials() {
  const res = await fetch(CONFIG.TRIALS_CSV_PATH);
  const text = await res.text();
  return csvToObjects(text);
}

function allImagePaths(trials) {
  const names = new Set();
  trials.forEach(t => { names.add(t.image_A); names.add(t.image_B); });
  return Array.from(names).map(n => CONFIG.IMAGES_DIR + encodeURIComponent(n));
}

async function main() {
  let trials;
  try {
    trials = await loadTrials();
  } catch (e) {
    document.getElementById("jspsych-target").innerHTML =
      `<div class="info-page"><h2>Could not load trials.csv</h2>
       <p>This page needs to be served over http(s), not opened directly as a
       file:// URL. See README.md section 3.</p></div>`;
    return;
  }

  const orderedTrials = shuffle(trials);
  trialRecords = buildTrialRecords(orderedTrials);
  currentIndex = 0;

  jsPsychInstance = initJsPsych({
    on_finish: () => {},
  });

  const timeline = [];

  timeline.push({ type: jsPsychPreload, images: allImagePaths(trials) });
  timeline.push(welcomeNode);
  timeline.push(participantInfoNode());
  timeline.push(instructionsNode);
  timeline.push(ratingAppNode());
  timeline.push(endNode());

  jsPsychInstance.run(timeline);
}

main();
