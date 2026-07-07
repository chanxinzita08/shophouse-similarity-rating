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
  PROGRESS_GROUP_SIZE: 30, // 360 trials / 30 = 12 even groups for the jump-to-trial grid
};

// Bilingual strings. t(key, ...args) resolves against currentLang.
const STRINGS = {
  en: {
    switchToLabel: "中文",
    continueHintDefault: "Press SPACE or tap anywhere to continue",
    continueBtn: "Continue",
    submitBtn: "Continue",

    welcomeTitle: "Welcome",
    welcomeBody: "Thank you for taking part in this study. You will see pairs of building facade photographs, side by side, and rate how similar they are.",

    participantInfoTitle: "Participant information",
    participantIdLabel: "Participant ID",
    ageLabel: "Age",
    genderLabel: "Gender (optional)",
    nationalityLabel: "Nationality",
    backgroundQuestion: "Do you have an architecture / design / heritage background?",
    yes: "Yes",
    no: "No",
    familiarityQuestion: "Familiarity with Singapore shophouses (1 = not at all, 7 = very familiar)",

    instructionsTitle: "Instructions",
    instructionsBody1: 'On each trial you will see two shophouse facade photographs side by side. Please rate: <em>"How similar are these two shophouse facades as architectural types?"</em>',
    instructionsBody1b: "This is really about your overall impression of stylistic similarity — you can base your judgement on whatever aspects you personally think matter most (for example colours, materials, decorative details, proportions, or anything else that stands out to you).",
    instructionsBody2: "Click a number from <strong>1 to 7</strong>: 1 = not similar at all &nbsp;&nbsp; 4 = moderate / unsure &nbsp;&nbsp; 7 = highly similar",
    instructionsBody3: 'You can click a different number to change your answer before confirming — click <strong>Next</strong> once you\'re happy with your choice. You can also click <strong>Back</strong> at any time to revisit an earlier pair and change your answer.',
    instructionsBody4a: "Please use the full rating scale whenever appropriate, rather than giving the same score repeatedly.",
    instructionsBody4b: "There are no right or wrong answers — we're interested in your own judgement.",
    instructionsBody5: 'A counter at the top shows your progress ("Trial X of N"). Take as much time as you need on each trial.',

    questionText: "How similar are these two shophouse facades as architectural types?",
    similarityLabel1: "not similar at all",
    similarityLabel4: "moderate / unsure",
    similarityLabel7: "highly similar",
    backBtn: "Back",
    nextBtn: "Next",
    trialLabel: (i, n) => `Trial ${i} of ${n}`,

    endTitle: "All done",
    endBody1: "All responses have been saved. You may now close this page.",
    endBody2: "Thank you for taking part. You can also download a personal copy of your results below if you'd like.",
    downloadBtn: "Download CSV",

    loadErrorTitle: "Could not load trials.csv",
    loadErrorBody: "This page needs to be served over http(s), not opened directly as a file:// URL. See README.md section 3.",
  },
  zh: {
    switchToLabel: "English",
    continueHintDefault: "按空格键或点击任意位置继续",
    continueBtn: "继续",
    submitBtn: "继续",

    welcomeTitle: "欢迎",
    welcomeBody: "感谢您参与本研究。您将看到成对的建筑立面照片，并需要评价它们的相似程度。",

    participantInfoTitle: "参与者信息",
    participantIdLabel: "参与者编号",
    ageLabel: "年龄",
    genderLabel: "性别（可选）",
    nationalityLabel: "国籍",
    backgroundQuestion: "您是否有建筑 / 设计 / 文化遗产相关背景？",
    yes: "是",
    no: "否",
    familiarityQuestion: "您对新加坡店屋（shophouse）的熟悉程度（1 = 完全不熟悉，7 = 非常熟悉）",

    instructionsTitle: "任务说明",
    instructionsBody1: "每一题您将看到两张店屋立面照片并排显示。请评价：<em>“这两张店屋立面在建筑类型上有多相似？”</em>",
    instructionsBody1b: "这更多是关于您对两张图片整体风格相似度的直觉判断——您可以根据自己认为最重要的任何方面来判断（例如颜色、材质、装饰细节、比例，或其他任何让您觉得相关的方面）。",
    instructionsBody2: "点击 <strong>1 到 7</strong> 中的一个数字：1 = 完全不相似 &nbsp;&nbsp; 4 = 中等 / 不确定 &nbsp;&nbsp; 7 = 非常相似",
    instructionsBody3: "确认前可以点击其他数字修改答案——满意后点击<strong>下一题</strong>确认。您也可以随时点击<strong>上一题</strong>返回之前的题目并修改答案。",
    instructionsBody4a: "请尽量使用完整的评分范围，不要总是给同一个分数。",
    instructionsBody4b: "没有标准答案——我们想了解您自己的判断。",
    instructionsBody5: "页面顶部会显示您的进度（“第 X / N 题”）。每一题都可以按您需要的时间慢慢作答。",

    questionText: "这两张店屋立面在建筑类型上有多相似？",
    similarityLabel1: "完全不相似",
    similarityLabel4: "中等 / 不确定",
    similarityLabel7: "非常相似",
    backBtn: "上一题",
    nextBtn: "下一题",
    trialLabel: (i, n) => `第 ${i} / ${n} 题`,

    endTitle: "全部完成",
    endBody1: "所有回答已保存，您现在可以关闭此页面。",
    endBody2: "感谢您的参与。如果需要，您也可以在下方下载一份个人结果副本。",
    downloadBtn: "下载 CSV",

    loadErrorTitle: "无法加载 trials.csv",
    loadErrorBody: "此页面需要通过 http(s) 访问，不能直接以 file:// 方式打开。详见 README.md 第 3 节。",
  },
};

let currentLang = "en";

function t(key, ...args) {
  const entry = STRINGS[currentLang][key];
  return typeof entry === "function" ? entry(...args) : entry;
}

function langToggleHtml() {
  return `<button type="button" id="lang-toggle-btn" class="lang-toggle">${t("switchToLabel")}</button>`;
}

// Flips currentLang and calls the caller-supplied rerender() so each screen
// redraws itself in place, without advancing the jsPsych timeline.
function attachLangToggle(root, rerender) {
  const btn = root.querySelector("#lang-toggle-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentLang = currentLang === "en" ? "zh" : "en";
    rerender();
  });
}

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
let maxReachedIndex = 0; // furthest trial reached so far — jump-to-trial grid only allows navigating within this range
let viewedGroup = 0;     // which group of PROGRESS_GROUP_SIZE squares is currently shown in the grid
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
    age: participantInfo.age || "",
    gender: participantInfo.gender || "",
    nationality: participantInfo.nationality || "",
    background: participantInfo.background || "",
    familiarity: participantInfo.familiarity || "",
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
  maxReachedIndex = Math.max(maxReachedIndex, currentIndex);
  viewedGroup = Math.floor(currentIndex / CONFIG.PROGRESS_GROUP_SIZE);

  const similarityLabels = {
    1: t("similarityLabel1"),
    4: t("similarityLabel4"),
    7: t("similarityLabel7"),
  };
  const buttonsHtml = [1, 2, 3, 4, 5, 6, 7].map(n => {
    const label = similarityLabels[n]
      ? `<div class="likert-label">${similarityLabels[n]}</div>` : "";
    const selectedClass = record.similarity_rating === n ? " selected" : "";
    return `<button type="button" class="likert-btn${selectedClass}" data-value="${n}">${n}${label}</button>`;
  }).join("");

  container.innerHTML = `
    <div class="trial-header">
      <div class="progress-text">${t("trialLabel", currentIndex + 1, total)}</div>
      ${langToggleHtml()}
    </div>
    <div id="progress-grid"></div>
    <div class="stim-pair">
      <img class="facade-img" src="${CONFIG.IMAGES_DIR + encodeURIComponent(record.left_image)}">
      <img class="facade-img" src="${CONFIG.IMAGES_DIR + encodeURIComponent(record.right_image)}">
    </div>
    <div class="question-text">${t("questionText")}</div>
    <div class="likert-scale">${buttonsHtml}</div>
    <div class="nav-buttons">
      <button type="button" id="back-btn" class="jspsych-btn secondary-btn"${currentIndex === 0 ? " disabled" : ""}>${t("backBtn")}</button>
      <button type="button" id="next-btn" class="jspsych-btn"${record.similarity_rating === null ? " disabled" : ""}>${t("nextBtn")}</button>
    </div>
  `;

  attachLangToggle(container, () => renderCurrentTrial(container));
  renderProgressGrid(container);

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

// Clickable grid of trial numbers, grouped in batches of CONFIG.PROGRESS_GROUP_SIZE
// (360 trials / 30 = 12 groups). Only trials already reached (<= maxReachedIndex)
// are clickable — clicking one jumps straight to it (Back/re-answer semantics
// apply, same as the Back button). Switching groups only changes which
// batch of squares is shown, it doesn't move currentIndex by itself.
function renderProgressGrid(container) {
  const gridEl = container.querySelector("#progress-grid");
  const total = trialRecords.length;
  const groupSize = CONFIG.PROGRESS_GROUP_SIZE;
  const nGroups = Math.ceil(total / groupSize);

  const groupButtonsHtml = Array.from({ length: nGroups }, (_, g) => {
    const start = g * groupSize + 1;
    const end = Math.min((g + 1) * groupSize, total);
    return `<button type="button" class="group-btn${g === viewedGroup ? " active" : ""}" data-group="${g}">${start}-${end}</button>`;
  }).join("");

  const groupStart = viewedGroup * groupSize;
  const groupEnd = Math.min(groupStart + groupSize, total);
  const squaresHtml = [];
  for (let i = groupStart; i < groupEnd; i++) {
    const classes = ["trial-square"];
    if (i === currentIndex) classes.push("current");
    if (trialRecords[i].similarity_rating !== null) classes.push("answered");
    const reachable = i <= maxReachedIndex;
    if (!reachable) classes.push("unreached");
    squaresHtml.push(
      `<button type="button" class="${classes.join(" ")}" data-index="${i}"${reachable ? "" : " disabled"}>${i + 1}</button>`
    );
  }

  gridEl.innerHTML = `
    <div class="group-selector">${groupButtonsHtml}</div>
    <div class="trial-grid">${squaresHtml.join("")}</div>
  `;

  gridEl.querySelectorAll(".group-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      viewedGroup = parseInt(btn.dataset.group, 10);
      renderProgressGrid(container);
    });
  });

  gridEl.querySelectorAll(".trial-square:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => {
      currentIndex = parseInt(btn.dataset.index, 10);
      renderCurrentTrial(container);
    });
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

function infoPage(contentFn) {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div id="info-page-root"></div>',
    choices: [" "],
    on_load: () => {
      renderInfoPage(document.getElementById("info-page-root"), contentFn);
    },
  };
}

function renderInfoPage(root, contentFn) {
  root.innerHTML = `
    <div class="info-page" id="info-page-tap-target">
      ${langToggleHtml()}
      ${contentFn()}
      <button type="button" class="jspsych-btn">${t("continueBtn")}</button>
      <p class="continue-hint">${t("continueHintDefault")}</p>
    </div>
  `;
  attachLangToggle(root, () => renderInfoPage(root, contentFn));
  // Whole box is tappable, not just the button — more reliable on
  // mobile/tablet than relying on a single small button hitting exactly
  // right. { once: true } prevents the button's own click bubbling up
  // to this same listener and firing finishTrial() twice. Guard against the
  // toggle button itself so switching language doesn't advance the page.
  root.querySelector("#info-page-tap-target").addEventListener("click", (e) => {
    if (e.target.closest("#lang-toggle-btn")) return;
    jsPsychInstance.finishTrial();
  }, { once: true });
}

const welcomeNode = infoPage(() => `
  <h2>${t("welcomeTitle")}</h2>
  <p>${t("welcomeBody")}</p>
`);

function participantInfoNode() {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div id="participant-info-root"></div>',
    choices: "NO_KEYS",
    on_load: () => {
      renderParticipantInfo(document.getElementById("participant-info-root"));
    },
  };
}

function renderParticipantInfo(root) {
  const likertRow = (name) =>
    `<div class="likert-row">${[1, 2, 3, 4, 5, 6, 7].map(n =>
      `<span class="likert-option"><input type="radio" name="${name}" value="${n}" required>${n}</span>`
    ).join("")}</div>`;

  root.innerHTML = `
    <form class="jspsych-survey-html-form" id="participant-info-form" style="position: relative;">
      ${langToggleHtml()}
      <h2 style="text-align:left">${t("participantInfoTitle")}</h2>
      <p><label>${t("participantIdLabel")}<br><input name="participant_id" type="text" required></label></p>
      <p><label>${t("ageLabel")}<br><input name="age" type="number" min="1" max="120" required></label></p>
      <p><label>${t("genderLabel")}<br><input name="gender" type="text"></label></p>
      <p><label>${t("nationalityLabel")}<br><input name="nationality" type="text" required></label></p>
      <p>${t("backgroundQuestion")}<br>
        <label><input type="radio" name="background" value="yes" required> ${t("yes")}</label>
        <label><input type="radio" name="background" value="no"> ${t("no")}</label>
      </p>
      <p>${t("familiarityQuestion")}<br>${likertRow("familiarity")}</p>
      <button type="submit" class="jspsych-btn">${t("submitBtn")}</button>
    </form>
  `;

  attachLangToggle(root, () => renderParticipantInfo(root));

  root.querySelector("#participant-info-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    participantInfo = {
      participant_id: resolveParticipantId(fd.get("participant_id")),
      age: fd.get("age"),
      gender: fd.get("gender") || "",
      nationality: fd.get("nationality") || "",
      background: fd.get("background"),
      familiarity: fd.get("familiarity"),
    };
    jsPsychInstance.finishTrial();
  });
}

// Appends _02, _03, ... if this exact ID has already been started on this
// browser before (e.g. someone answered halfway, closed the tab, and came
// back to restart) — first attempt keeps the ID unchanged. This is what
// gets used everywhere downstream (Sheet tab name, localStorage key, CSV
// filename), so a partial attempt naturally ends up in its own separate
// Sheet tab instead of overwriting/merging with a later complete one.
function resolveParticipantId(rawId) {
  const key = "similarity_rating_attempt_count_" + rawId;
  const count = parseInt(localStorage.getItem(key) || "0", 10) + 1;
  localStorage.setItem(key, String(count));
  return count === 1 ? rawId : `${rawId}_${String(count).padStart(2, "0")}`;
}

const instructionsNode = infoPage(() => `
  <h2>${t("instructionsTitle")}</h2>
  <p>${t("instructionsBody1")}</p>
  <p>${t("instructionsBody1b")}</p>
  <p>${t("instructionsBody2")}</p>
  <p>${t("instructionsBody3")}</p>
  <p><strong class="emphasis">${t("instructionsBody4a")}</strong> ${t("instructionsBody4b")}</p>
  <p>${t("instructionsBody5")}</p>
`);

function endNode() {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div id="end-page-root"></div>',
    choices: "NO_KEYS",
    on_load: () => {
      submitCompletion();
      renderEndPage(document.getElementById("end-page-root"));
    },
  };
}

function renderEndPage(root) {
  root.innerHTML = `
    <div class="info-page">
      ${langToggleHtml()}
      <h2>${t("endTitle")}</h2>
      <p>${t("endBody1")}</p>
      <p>${t("endBody2")}</p>
      <button id="download-btn" class="jspsych-btn">${t("downloadBtn")}</button>
    </div>
  `;
  attachLangToggle(root, () => renderEndPage(root));
  root.querySelector("#download-btn").addEventListener("click", exportResults);
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
  trials.forEach(tr => { names.add(tr.image_A); names.add(tr.image_B); });
  return Array.from(names).map(n => CONFIG.IMAGES_DIR + encodeURIComponent(n));
}

async function main() {
  let trials;
  try {
    trials = await loadTrials();
  } catch (e) {
    document.getElementById("jspsych-target").innerHTML =
      `<div class="info-page"><h2>${t("loadErrorTitle")}</h2>
       <p>${t("loadErrorBody")}</p></div>`;
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
