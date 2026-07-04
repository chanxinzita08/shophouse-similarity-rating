// Google Apps Script — receives one POST per completed trial from
// similarity_rating_pretest/experiment.js and appends a row to this
// spreadsheet. See README.md section "Server-side data collection" for the
// full copy-paste deployment steps.

const SHEET_NAME = "responses";

const COLUMNS = [
  "participant_id", "trial_index_global", "trial_id", "condition",
  "original_image_A", "original_image_B", "left_image", "right_image", "left_right_swapped",
  "visual_A", "visual_B", "graph_A", "graph_B",
  "visual_similarity_score", "graph_similarity_score", "screening_score",
  "similarity_rating", "rating_onset", "rating_rt_ms",
  "trial_end_time", "timestamp",
];

function doPost(e) {
  const sheet = getOrCreateSheet_();
  const data = JSON.parse(e.postData.contents);

  ensureHeader_(sheet);

  const row = COLUMNS.map(col => (data[col] === undefined || data[col] === null) ? "" : data[col]);
  row.push(new Date().toISOString()); // server_received_at, for auditing/debugging only
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "similarity_rating_pretest collector is running" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([...COLUMNS, "server_received_at"]);
  }
}
