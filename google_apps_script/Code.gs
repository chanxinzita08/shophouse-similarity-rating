// Google Apps Script — receives one POST per completed trial from
// similarity_rating_pretest/experiment.js AND from every
// similarity_rating_pretest_v1..v5/experiment.js copy (they all share this
// SAME deployment/URL — only one Code.gs to maintain, one redeploy needed
// after editing this file). Appends a row to a PER-PARTICIPANT tab (one tab
// per participant_id, e.g. "P01") — appropriate for small studies (well
// under Google Sheets' ~200-tab-per-spreadsheet limit; do NOT use this
// per-participant layout for large-N online studies, switch back to one
// shared "responses" tab instead, see git history). Each row records which
// `version` (v1-v5, or blank for the original) the participant did.
//
// Also receives one POST per participant when they reach the end page
// (submitCompletion() in experiment.js, `type: "completion"`), which is
// routed to a single SHARED "completions" tab (not split per participant —
// it's a small roster/overview, easiest to keep in one place) — use that
// tab to filter out participants who dropped out partway through before
// treating their per-participant tab's rows as valid.
//
// See README.md section "Server-side data collection" for the full
// copy-paste deployment steps.
//
// NOTE on the `completions` tab specifically: ensureHeader_() only writes a
// header row into a brand-new, empty tab — if `completions` already exists
// from before this COMPLETION_COLUMNS change (e.g. from earlier testing),
// its header row will still show the OLD, shorter column list. New rows
// after this update will have MORE values than the existing header labels.
// Fix by manually editing that tab's header row to match COMPLETION_COLUMNS
// below (do not delete the tab if it has real in-progress participants'
// rows in it already).

const COMPLETIONS_SHEET_NAME = "completions";

const COLUMNS = [
  "participant_id", "version", "trial_index_global", "trial_id", "condition",
  "original_image_A", "original_image_B", "left_image", "right_image", "left_right_swapped",
  "visual_A", "visual_B", "graph_A", "graph_B",
  "visual_similarity_score", "graph_similarity_score", "screening_score",
  "similarity_rating", "rating_onset", "rating_rt_ms",
  "trial_end_time", "timestamp", "is_practice",
];

const COMPLETION_COLUMNS = [
  "participant_id", "version", "completed", "completion_time", "total_answered",
  "age", "gender", "nationality", "background", "familiarity",
];

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  // Multiple participants can submit at the same moment. LockService
  // serializes concurrent executions so two simultaneous requests can't both
  // see "sheet/tab doesn't exist yet" and race to create it, or otherwise
  // interleave writes. Each request waits its turn (up to 30s) rather than
  // running in parallel with another write.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (data.type === "completion") {
      appendCompletion_(data);
    } else {
      appendTrialResponse_(data);
    }
  } finally {
    lock.releaseLock();
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "similarity_rating_pretest collector is running" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function appendTrialResponse_(data) {
  const tabName = participantTabName_(data.participant_id);
  const sheet = getOrCreateSheet_(tabName);
  ensureHeader_(sheet, COLUMNS);
  const row = COLUMNS.map(col => (data[col] === undefined || data[col] === null) ? "" : data[col]);
  row.push(new Date().toISOString()); // server_received_at, for auditing/debugging and dedup on revision
  sheet.appendRow(row);
}

function appendCompletion_(data) {
  const sheet = getOrCreateSheet_(COMPLETIONS_SHEET_NAME);
  ensureHeader_(sheet, COMPLETION_COLUMNS);
  const row = COMPLETION_COLUMNS.map(col => (data[col] === undefined || data[col] === null) ? "" : data[col]);
  row.push(new Date().toISOString()); // server_received_at
  sheet.appendRow(row);
}

// Google Sheets tab names can't contain [ ] * ? / \ : , can't be blank, and
// are capped at 100 characters. Falls back to "unknown_participant" if the
// participant_id is empty/missing after sanitizing.
function participantTabName_(participantId) {
  const cleaned = String(participantId || "")
    .replace(/[\[\]\*\?\/\\:]/g, "_")
    .trim()
    .slice(0, 90); // leave headroom below the 100-char limit
  return cleaned.length > 0 ? cleaned : "unknown_participant";
}

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeader_(sheet, columns) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([...columns, "server_received_at"]);
  }
}
