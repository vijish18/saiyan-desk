/**
 * Study & Gym Tracker — Apps Script backend.
 *
 * Serves Index.html as a web app and reads/writes the existing tabs of the
 * tracker spreadsheet. Nothing is restructured: the app only fills the reps
 * columns (adding a dated row when the workout plan puts an exercise on a day
 * the tracker had none for), the stamina row for a date, Study plan statuses,
 * and (on an explicit, backed-up re-plan) the future part of the Study plan.
 */

const SPREADSHEET_ID = '1jZTjQaSb56_SsxkQHDT9E4WgOflacvH_uKDNSE9X-uA';

const TAB = {
  lifting: 'Daily-Power-lifting tracker',
  exercises: 'Exercise list',
  stamina: 'stamina tracker',
  study: 'Study plan',
  settings: 'App settings',
  art: 'App art',
  list: 'Study list',
};

// Character art: an uploaded image (stored in the hidden "App art" tab) wins over a link in App settings.
const ART_KEYS = ['artBase', 'artSsj', 'artSsj2', 'artSsj3', 'artBlue'];
const ART_CHUNK = 45000; // a cell holds 50,000 characters

const STATUS = { done: 'Completed', planned: 'Planned', skipped: 'Skipped', moved: 'Rescheduled', archived: 'Archived' };

const LEARNING_RE = /learning/i;

// Routines are "HH:MM Activity" lines. Office hours are inserted automatically
// on work days, so the weekday routine only lists what happens outside them.
const DEFAULT_SETTINGS = {
  officeStart: '09:00',
  officeEnd: '18:00',
  workDays: 'Mon,Tue,Wed,Thu,Fri',
  weekdayRoutine: [
    '05:30 Morning routine',
    '05:45 Workout',
    '07:00 First Priority Learning',
    '08:15 Break',
    '18:00 Break',
    '19:00 Second Priority Learning',
    '20:00 Communication',
    '20:30 Break',
    '21:00 Revision',
    '21:45 Family Time',
    '22:30 Sleep',
  ].join('\n'),
  weekendRoutine: [
    '06:30 Morning routine',
    '07:00 Workout',
    '08:30 Break',
    '09:00 First Priority Learning',
    '12:00 Break',
    '13:00 Second Priority Learning',
    '15:30 Break',
    '16:00 Communication',
    '17:00 Break',
    '18:00 Revision',
    '20:00 Family Time',
    '22:30 Sleep',
  ].join('\n'),
  // The gym tab follows this split; the dated rows in the tracker tab are only a log.
  workoutPlan: [
    'Mon: Back, Triceps',
    'Tue: Chest, Biceps, Forearms, Abs',
    'Wed: Legs, Shoulders',
    'Thu: Back, Triceps',
    'Fri: Chest, Biceps, Forearms, Abs',
    'Sat: Legs, Shoulders',
    'Sun: Rest',
  ].join('\n'),
  // Optional character art (links); uploads in the App art tab take priority. "none" switches a slot off.
  artBase: '',
  artSsj: '',
  artSsj2: '',
  artSsj3: '',
  artBlue: '',
  sheetUpdate: '',
};

const SETTING_NOTES = {
  officeStart: 'HH:MM, 24-hour',
  officeEnd: 'HH:MM, 24-hour',
  workDays: 'Comma-separated: Mon,Tue,Wed,Thu,Fri,Sat,Sun',
  weekdayRoutine: 'One "HH:MM Activity" per line. Office hours are added automatically on work days. Activities containing "Learning" are filled from your pending study sections.',
  weekendRoutine: 'Same format, used on non-work days.',
  workoutPlan: 'One line per weekday, e.g. "Mon: Back, Triceps". Body parts must match the Exercise list. Write "Rest" for a day off.',
  artBase: 'Optional https:// image link for the base-form character. An image uploaded in the app (App art tab) takes priority.',
  artSsj: 'Optional image link for Super Saiyan.',
  artSsj2: 'Optional image link for Super Saiyan 2 (falls back to Super Saiyan).',
  artSsj3: 'Optional image link for Super Saiyan 3 (falls back to Super Saiyan 2).',
  artBlue: 'Optional image link for Super Saiyan Blue (falls back to Super Saiyan).',
  sheetUpdate: 'Set by the app: the last one-time sheet update you applied.',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------- web app

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Study & Gym Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------- reads

function getData() {
  const tz = tz_();
  return {
    settings: readSettings_(),
    exercises: readExercises_(),
    lifting: readLifting_(tz),
    stamina: readStamina_(tz),
    study: readStudy_(tz),
    artIndex: readArtIndex_(),
    listPriority: readListPriority_(),
    sheetUrl: ss_().getUrl(),
    loadedAt: new Date().toISOString(),
  };
}

function readExercises_() {
  const sh = sheet_(TAB.exercises);
  const n = sh.getLastRow() - 2; // two header rows
  if (n < 1) return [];
  return sh.getRange(3, 1, n, 12).getValues()
    .filter(r => str_(r[0]))
    .map(r => ({
      name: str_(r[0]),
      part: str_(r[1]),
      muscle: str_(r[2]),
      equipment: str_(r[3]),
      cue: str_(r[4]),
      target: [num_(r[5]), num_(r[6]), num_(r[7])],
      weight: [str_(r[9]), str_(r[10]), str_(r[11])],
    }));
}

function readLifting_(tz) {
  const sh = sheet_(TAB.lifting);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const out = [];
  sh.getRange(2, 1, n, 8).getValues().forEach((r, i) => {
    const date = isoDate_(r[0], tz);
    const name = str_(r[1]);
    if (!date || !name) return;
    out.push({ row: i + 2, date, name, part: str_(r[2]), reps: [numOrNull_(r[5]), numOrNull_(r[6]), numOrNull_(r[7])] });
  });
  return out;
}

function readStamina_(tz) {
  const sh = sheet_(TAB.stamina);
  const width = sh.getLastColumn() - 1;
  const headers = sh.getRange(1, 2, 1, width).getDisplayValues()[0].map(str_);
  const rows = [];
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const rng = sh.getRange(2, 1, n, width + 1);
    const vals = rng.getValues();
    const disp = rng.getDisplayValues();
    disp.forEach((r, i) => {
      const values = r.slice(1).map(str_);
      if (values.some(v => v !== '')) rows.push({ row: i + 2, date: isoDate_(vals[i][0], tz), values });
    });
  }
  return { headers, rows };
}

function readStudy_(tz) {
  const sh = sheet_(TAB.study);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rng = sh.getRange(2, 1, n, 6);
  const vals = rng.getValues();
  const disp = rng.getDisplayValues(); // times are read as displayed to avoid timezone drift
  const rows = [];
  for (let i = 0; i < n; i++) {
    const activity = str_(vals[i][2]);
    if (!activity) continue;
    rows.push({
      row: i + 2,
      date: isoDate_(vals[i][0], tz),
      start: parseHm_(disp[i][1]),
      activity,
      topic: str_(vals[i][3]),
      section: str_(vals[i][4]),
      status: str_(vals[i][5]) || STATUS.planned,
    });
  }
  addDurations_(rows);
  return rows;
}

/** Each row lasts until the next row on the same date (the sheet has no end-time column). */
function addDurations_(rows) {
  const byDate = {};
  rows.forEach(r => (byDate[r.date] = byDate[r.date] || []).push(r));
  Object.keys(byDate).forEach(d => {
    const day = byDate[d].slice().sort((a, b) => (a.start == null ? -1 : a.start) - (b.start == null ? -1 : b.start) || a.row - b.row);
    day.forEach((r, i) => {
      const next = day[i + 1];
      r.mins = r.start == null ? 0 : Math.max(0, (next && next.start != null ? next.start : 1440) - r.start);
    });
  });
}

function readSettings_() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  const sh = ss_().getSheetByName(TAB.settings);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(r => {
      const key = r[0].trim();
      if (key in DEFAULT_SETTINGS && r[1].trim() !== '') s[key] = r[1].trim();
    });
  }
  return s;
}

// ---------------------------------------------------------------- writes

/**
 * p: {row, date, name, reps: [rpe4_5, rpe8, rpe9_5]} — blank clears a band.
 * Writes into the tracker row for that date + exercise, or inserts one in date
 * order when the plan puts an exercise on a day the tracker had no row for.
 */
function saveReps(p) {
  assertIso_(p.date);
  const reps = [0, 1, 2].map(i => cleanReps_(p.reps && p.reps[i]));
  return withLock_(() => {
    const tz = tz_();
    const sh = sheet_(TAB.lifting);
    let row = 0;
    try {
      row = findRow_(sh, p.row || 0, 2, v => isoDate_(v[0], tz) === p.date && str_(v[1]) === p.name);
    } catch (e) {
      row = 0;
    }
    let inserted = false;
    if (!row) {
      if (reps.every(x => x === '')) return { row: 0, reps: [null, null, null], inserted };
      const ex = readExercises_().filter(e => e.name === p.name)[0];
      if (!ex) throw new Error('"' + p.name + '" is not in the Exercise list.');
      row = insertLiftRow_(sh, p.date, tz);
      sh.getRange(row, 1, 1, 5).setValues([[isoToSerial_(p.date), ex.name, ex.part, ex.muscle, ex.equipment]]);
      sh.getRange(row, 1).setNumberFormat('m/d/yyyy');
      inserted = true;
    }
    sh.getRange(row, 6, 1, 3).setValues([reps]);
    return { row, reps: reps.map(x => (x === '' ? null : x)), inserted };
  });
}

/** Inserts an empty row after the last row dated on or before `date`; returns its number. */
function insertLiftRow_(sh, date, tz) {
  const last = sh.getLastRow();
  let after = 1;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach((v, i) => {
      const d = isoDate_(v[0], tz);
      if (d && d <= date) after = i + 2;
    });
  }
  sh.insertRowAfter(after);
  return after + 1;
}

/** p: {date, values: [...one per stamina column after Date]} */
function saveStamina(p) {
  assertIso_(p.date);
  return withLock_(() => {
    const tz = tz_();
    const sh = sheet_(TAB.stamina);
    const width = sh.getLastColumn() - 1;
    let row;
    try {
      row = findRow_(sh, p.row || 0, 1, v => isoDate_(v[0], tz) === p.date);
    } catch (e) {
      row = sh.getLastRow() + 1;
      sh.getRange(row, 1).setValue(isoToSerial_(p.date)).setNumberFormat('m/d/yyyy');
    }
    const values = [];
    for (let i = 0; i < width; i++) {
      const v = str_(p.values && p.values[i]);
      values.push(/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    }
    sh.getRange(row, 2, 1, width).setValues([values]);
    return { row, date: p.date, values: sh.getRange(row, 2, 1, width).getDisplayValues()[0].map(str_) };
  });
}

/** p: {row, date, start, activity, status} */
function setStudyStatus(p) {
  if ([STATUS.done, STATUS.planned, STATUS.skipped].indexOf(p.status) < 0) throw new Error('Unknown status: ' + p.status);
  return withLock_(() => {
    const sh = sheet_(TAB.study);
    const row = findStudyRow_(sh, p);
    sh.getRange(row, 6).setValue(p.status);
    return { row, status: p.status };
  });
}

/** p: {date, start ("HH:MM"), activity, topic, section} — inserted in date/time order. */
function addStudyRow(p) {
  assertIso_(p.date);
  const start = parseHm_(p.start);
  if (start == null) throw new Error('Start time must look like 19:30');
  if (!str_(p.activity)) throw new Error('Activity is required');
  withLock_(() => {
    const tz = tz_();
    const sh = sheet_(TAB.study);
    let after = 1;
    readStudy_(tz).forEach(r => {
      if (r.date < p.date || (r.date === p.date && (r.start == null ? -1 : r.start) <= start)) after = Math.max(after, r.row);
    });
    sh.insertRowAfter(after);
    sh.getRange(after + 1, 1, 1, 6).setValues([[isoToSerial_(p.date), start / 1440, str_(p.activity), str_(p.topic), str_(p.section), STATUS.planned]]);
    sh.getRange(after + 1, 1).setNumberFormat('m/d/yyyy');
    sh.getRange(after + 1, 2).setNumberFormat('h:mm');
  });
  return getData();
}

/** p: {row, date, start, activity} */
function deleteStudyRow(p) {
  withLock_(() => {
    const sh = sheet_(TAB.study);
    sh.deleteRow(findStudyRow_(sh, p));
  });
  return getData();
}

function saveSettings(input) {
  return withLock_(() => {
    const s = mergeSettings_(input);
    writeSettings_(s);
    return s;
  });
}

// ---------------------------------------------------------------- character art

function artSheet_(create) {
  const ss = ss_();
  let sh = ss.getSheetByName(TAB.art);
  if (!sh && create) {
    sh = ss.insertSheet(TAB.art);
    sh.hideSheet();
  }
  return sh;
}

/** {key: uploadedAt} for every uploaded image, so the page can tell whether its cached copy is current. */
function readArtIndex_() {
  const sh = artSheet_(false);
  const out = {};
  if (!sh || sh.getLastRow() < 1) return out;
  sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues().forEach(r => {
    if (ART_KEYS.indexOf(r[0]) >= 0) out[r[0]] = r[1];
  });
  return out;
}

/** {key: {v, data}} — the uploaded images as data URLs. */
function getArt() {
  const sh = artSheet_(false);
  const out = {};
  if (!sh || sh.getLastRow() < 1) return out;
  sh.getRange(1, 1, sh.getLastRow(), Math.max(3, sh.getLastColumn())).getValues().forEach(r => {
    const key = str_(r[0]);
    if (ART_KEYS.indexOf(key) >= 0) out[key] = { v: str_(r[1]), data: r.slice(2).map(str_).join('') };
  });
  return out;
}

/** p: {key, data} — data is a data:image/... URL, or '' to remove the upload. Returns the new art index. */
function saveArt(p) {
  if (ART_KEYS.indexOf(p && p.key) < 0) throw new Error('Unknown art slot.');
  const data = str_(p.data);
  if (data && !/^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+\/=]+$/.test(data)) throw new Error('That file is not a PNG, WebP, JPEG or GIF image.');
  if (data.length > 3000000) throw new Error('That image is too large. Use one under about 2 MB.');
  return withLock_(() => {
    const sh = artSheet_(true);
    const last = sh.getLastRow();
    if (last >= 1) {
      sh.getRange(1, 1, last, 1).getValues().forEach((r, i) => {
        if (r[0] === p.key) sh.getRange(i + 1, 1, 1, Math.max(1, sh.getLastColumn())).clearContent();
      });
    }
    if (data) {
      const row = [p.key, new Date().toISOString()];
      for (let i = 0; i < data.length; i += ART_CHUNK) row.push(data.slice(i, i + ART_CHUNK));
      if (sh.getMaxColumns() < row.length) sh.insertColumnsAfter(sh.getMaxColumns(), row.length - sh.getMaxColumns());
      sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    }
    return readArtIndex_();
  });
}

// ---------------------------------------------------------------- sheet menu + study list

const STUDY_LIST_FACTOR = 1.5;

/** Simple trigger: creates the Study list tab the first time and keeps it next to the Study plan. */
function onOpen(e) {
  if (e && e.source) SS_ = e.source;
  try {
    if (!ss_().getSheetByName(TAB.list)) buildStudyList_();
    placeStudyList_();
  } catch (err) {
    console.warn('study list: ' + err);
  }
}

/** Keeps the Study list tab right after the Study plan tab, so it is easy to find. */
function placeStudyList_() {
  const ss = ss_();
  const list = ss.getSheetByName(TAB.list);
  const plan = ss.getSheetByName(TAB.study);
  if (!list || !plan || list.getIndex() === plan.getIndex() + 1) return;
  const active = ss.getActiveSheet();
  ss.setActiveSheet(list);
  ss.moveActiveSheet(plan.getIndex() + (list.getIndex() < plan.getIndex() ? 0 : 1));
  if (active) ss.setActiveSheet(active);
}

/** Weekly plan whose 3-day cycle (Chest+Biceps → Legs+Shoulders → Back+Triceps) starts on `start`, Mon–Sat. */
function restartPlan_(start) {
  const cycle = ['Chest, Biceps, Forearms, Abs', 'Legs, Shoulders', 'Back, Triceps'];
  const s = (dow_(start) + 6) % 7;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n, i) => n + ': ' + cycle[((((i - s) % 6) + 6) % 6) % 3]).concat('Sun: Rest').join('\n');
}

/**
 * Writes the "Study list" tab: every learning section once, in plan order, with its planned
 * time (end − start, from the plan as originally written), that time × 1.5, a running total,
 * its status, and the day it lands on if today is Day 1 and the routine's learning slots are used.
 * Returns the number of sections.
 */
function buildStudyList_() {
  const tz = tz_();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const rows = readStudy_(tz).filter(r => LEARNING_RE.test(r.activity) && r.status !== STATUS.skipped);
  const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || 0) - (b.start || 0) || a.row - b.row);
  // The plan as written: once re-planned, the originals are the completed + "Rescheduled" rows.
  const replanned = rows.some(r => r.status === STATUS.moved || r.status === STATUS.archived);
  const original = (replanned ? rows.filter(r => r.status === STATUS.done || r.status === STATUS.moved || r.status === STATUS.archived) : rows).sort(byTime);
  const items = [];
  const index = {};
  original.forEach(r => {
    const key = r.topic + '\u0000' + r.section;
    if (!(key in index)) {
      index[key] = items.length;
      items.push({ key, priority: /first/i.test(r.activity) ? 'First' : /second/i.test(r.activity) ? 'Second' : r.activity, activity: r.activity, topic: r.topic, section: r.section, mins: 0, done: 0, open: 0 });
    }
    items[index[key]].mins += r.mins;
  });
  rows.forEach(r => {
    const it = items[index[r.topic + '\u0000' + r.section]];
    if (!it) return;
    if (r.status === STATUS.done) it.done++;
    else if (r.status === STATUS.planned) it.open++;
  });
  items.forEach(it => (it.status = !it.open && it.done ? 'Done' : it.done ? 'In progress' : 'To do'));

  // Day numbers: Day 1 = today, filling each day's learning slots (× 1.5 times) in plan order.
  const settings = readSettings_();
  const workDays = parseWorkDays_(settings.workDays);
  const office = [parseHm_(settings.officeStart), parseHm_(settings.officeEnd)];
  const routine = { work: withOffice_(parseRoutine_(settings.weekdayRoutine), office), free: parseRoutine_(settings.weekendRoutine) };
  const queues = {};
  const order = [];
  items.filter(it => it.status !== 'Done').forEach(it => {
    if (!queues[it.activity]) { queues[it.activity] = []; order.push(it.activity); }
    queues[it.activity].push({ it, left: Math.max(1, it.mins * STUDY_LIST_FACTOR) });
  });
  const pending = () => order.some(a => queues[a].length);
  let dayNo = 0;
  let date = today;
  while (pending() && dayNo < 1000) {
    dayNo++;
    const slots = workDays[dow_(date)] ? routine.work : routine.free;
    slots.forEach((slot, i) => {
      if (!LEARNING_RE.test(slot.activity)) return;
      let room = (i + 1 < slots.length ? slots[i + 1].start : 1440) - slot.start;
      while (room > 0) {
        const q = (queues[slot.activity] && queues[slot.activity].length ? queues[slot.activity] : null) || order.map(a => queues[a]).filter(x => x.length)[0];
        if (!q) break;
        const cur = q[0];
        if (!cur.it.firstDay) { cur.it.firstDay = dayNo; cur.it.firstDate = date; }
        const take = Math.min(cur.left, room);
        cur.left -= take;
        room -= take;
        if (cur.left <= 0.0001) { cur.it.lastDay = dayNo; q.shift(); }
      }
    });
    date = addDays_(date, 1);
  }
  const weekCap = kind => {
    const slots = kind === 'work' ? routine.work : routine.free;
    return slots.reduce((s, slot, i) => s + (LEARNING_RE.test(slot.activity) ? (i + 1 < slots.length ? slots[i + 1].start : 1440) - slot.start : 0), 0);
  };

  // Write the tab.
  const ss = ss_();
  const sh = ss.getSheetByName(TAB.list) || ss.insertSheet(TAB.list);
  sh.clear();
  const head = ['#', 'Priority', 'Course', 'Section', 'Plan (min)', 'Study × ' + STUDY_LIST_FACTOR + ' (min)', 'Study time', 'Running total (h)', 'Status', 'Day', 'Date'];
  const body = items.map((it, i) => {
    const r = i + 2;
    const day = it.status === 'Done' ? '' : it.firstDay === it.lastDay ? 'Day ' + it.firstDay : 'Day ' + it.firstDay + '–' + it.lastDay;
    const when = it.firstDate ? Utilities.formatDate(Utilities.parseDate(it.firstDate, tz, 'yyyy-MM-dd'), tz, 'EEE d MMM') : '';
    return [i + 1, it.priority, it.topic || 'Other', it.section, it.mins, '=E' + r + '*' + STUDY_LIST_FACTOR, '=F' + r + '/1440', '=SUM($F$2:F' + r + ')/60', it.status, day, when];
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#111722').setFontColor('#f5c242');
  if (body.length) {
    sh.getRange(2, 1, body.length, head.length).setValues(body);
    sh.getRange(2, 7, body.length, 1).setNumberFormat('[h]:mm');
    sh.getRange(2, 8, body.length, 1).setNumberFormat('0.0');
    sh.getRange(2, 6, body.length, 1).setNumberFormat('0.#');
  }
  sh.setFrozenRows(1);
  [44, 74, 150, 360, 80, 110, 86, 116, 90, 90, 96].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // Summary by course, to the right.
  const courses = [];
  items.forEach(it => { const c = it.topic || 'Other'; if (courses.indexOf(c) < 0) courses.push(c); });
  const last = Math.max(2, body.length + 1);
  const sum = [['Course', 'Sections', 'Plan (h)', 'Study × ' + STUDY_LIST_FACTOR + ' (h)', 'Done', 'Finishes']].concat(courses.map((c, i) => {
    const r = i + 2;
    const mine = items.filter(it => (it.topic || 'Other') === c && it.lastDay);
    const finish = mine.length ? 'Day ' + Math.max.apply(null, mine.map(it => it.lastDay)) : 'Done';
    return [c, '=COUNTIF($C$2:$C$' + last + ',M' + r + ')', '=SUMIF($C$2:$C$' + last + ',M' + r + ',$E$2:$E$' + last + ')/60',
      '=SUMIF($C$2:$C$' + last + ',M' + r + ',$F$2:$F$' + last + ')/60', '=COUNTIFS($C$2:$C$' + last + ',M' + r + ',$I$2:$I$' + last + ',"Done")', finish];
  }));
  const tr = courses.length + 2;
  sum.push(['Total', '=SUM(N2:N' + (tr - 1) + ')', '=SUM(O2:O' + (tr - 1) + ')', '=SUM(P2:P' + (tr - 1) + ')', '=SUM(Q2:Q' + (tr - 1) + ')',
    'Day ' + items.reduce((m, it) => Math.max(m, it.lastDay || 0), 0)]);
  sh.getRange(1, 13, sum.length, 6).setValues(sum);
  sh.getRange(1, 13, 1, 6).setFontWeight('bold').setBackground('#111722').setFontColor('#f5c242');
  sh.getRange(tr, 13, 1, 6).setFontWeight('bold');
  sh.getRange(2, 15, sum.length - 1, 2).setNumberFormat('0.0');
  const notes = [
    ['Day 1 = ' + Utilities.formatDate(Utilities.parseDate(today, tz, 'yyyy-MM-dd'), tz, 'EEE d MMM yyyy') + '.'],
    ['Plan (min) = end time − start time of each section in your Study plan, as you first wrote it.'],
    ['Study time = plan × ' + STUDY_LIST_FACTOR + '. Days use your learning slots: ' + weekCap('work') + ' min on work days, ' + weekCap('free') + ' min on days off, at the × ' + STUDY_LIST_FACTOR + ' times.'],
    ['Rebuild any time: Saiyan Desk menu → Rebuild the Study list.'],
  ];
  sh.getRange(tr + 2, 13, notes.length, 1).setValues(notes).setFontColor('#7d8b9c');
  [180, 70, 70, 110, 60, 80].forEach((w, i) => sh.setColumnWidth(13 + i, w));
  return items.length;
}

// ---------------------------------------------------------------- Day 1: plan by priority

/** Study list rows: [{row, order, priority, course, section, mins}] — mins is the × 1.5 study time. */
function readStudyList_() {
  const sh = ss_().getSheetByName(TAB.list);
  if (!sh || sh.getLastRow() < 2) return [];
  const out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach((r, i) => {
    const course = str_(r[2]).replace(/\s+/g, ' ').trim();
    const section = str_(r[3]).replace(/\s+/g, ' ').trim();
    if (!course && !section) return;
    const pri = typeof r[1] === 'number' ? r[1] : parseFloat(str_(r[1]));
    const f = typeof r[5] === 'number' ? r[5] : NaN;
    const e = typeof r[4] === 'number' ? r[4] : NaN;
    const mins = isFinite(f) && f > 0 ? f : isFinite(e) && e > 0 ? e * STUDY_LIST_FACTOR : 0;
    out.push({ row: i + 2, order: i, priority: isFinite(pri) ? pri : 99, course: course || 'Other', section: section || course, mins });
  });
  return out;
}

/** {course: lowest priority number} from the Study list, for the app's course table. */
function readListPriority_() {
  const out = {};
  readStudyList_().forEach(it => { if (!(it.course in out) || it.priority < out[it.course]) out[it.course] = it.priority; });
  return out;
}

/** Lays study items, in the given order, into the routine's learning slots from startDate/fromMinute. */
function layQueue_(items, settings, startDate, fromMinute) {
  const office = [parseHm_(settings.officeStart), parseHm_(settings.officeEnd)];
  const workDays = parseWorkDays_(settings.workDays);
  const routine = { work: withOffice_(parseRoutine_(settings.weekdayRoutine), office), free: parseRoutine_(settings.weekendRoutine) };
  const split = parseWorkoutPlan_(settings.workoutPlan);
  const queue = items.map(it => ({ it, left: Math.max(5, Math.round(it.mins)) }));
  const rows = [];
  let date = startDate;
  let day = 0;
  while (queue.length && day < 1000) {
    const slots = workDays[dow_(date)] ? routine.work : routine.free;
    slots.forEach((slot, i) => {
      const end = i + 1 < slots.length ? slots[i + 1].start : 1440;
      let t = slot.start;
      const learning = LEARNING_RE.test(slot.activity);
      if (day === 0 && t < fromMinute) {
        if (!learning || end <= fromMinute) return;
        t = Math.ceil(fromMinute / 5) * 5;
        if (t >= end) return;
      }
      if (!learning) {
        let topic = '';
        let section = '';
        if (/workout/i.test(slot.activity)) topic = (split[dow_(date)] || []).join(' · ') || 'Rest day';
        if (/revision/i.test(slot.activity)) topic = section = '-';
        rows.push({ date, start: t, activity: slot.activity, topic, section, mins: end - t });
        return;
      }
      while (t < end) {
        const room = end - t;
        if (!queue.length || (queue[0].left > room && room < 10)) {
          rows.push({ date, start: t, activity: 'Break', topic: '', section: '', mins: room });
          break;
        }
        const q = queue[0];
        const take = Math.min(q.left, room);
        if (!q.it.firstDay) { q.it.firstDay = day + 1; q.it.firstDate = date; }
        rows.push({ date, start: t, activity: slot.activity, topic: q.it.course, section: q.it.section, mins: take });
        q.left -= take;
        t += take;
        if (q.left <= 0) { q.it.lastDay = day + 1; q.it.lastDate = date; queue.shift(); }
      }
    });
    date = addDays_(date, 1);
    day++;
  }
  const learn = rows.filter(r => LEARNING_RE.test(r.activity));
  return { rows, endDate: learn.length ? learn[learn.length - 1].date : startDate, leftover: queue.length };
}

function day1Summary_(items, lay) {
  const courses = [];
  items.forEach(it => {
    let c = courses.filter(x => x.course === it.course)[0];
    if (!c) { c = { course: it.course, priority: it.priority, sections: 0, minutes: 0, firstDay: it.firstDay || 0, lastDay: 0, lastDate: '' }; courses.push(c); }
    c.sections++;
    c.minutes += it.mins;
    if (it.lastDay > c.lastDay) { c.lastDay = it.lastDay; c.lastDate = it.lastDate; }
  });
  return {
    sections: items.length,
    minutes: items.reduce((s, it) => s + it.mins, 0),
    endDate: lay.endDate,
    days: items.reduce((m, it) => Math.max(m, it.lastDay || 0), 0),
    leftover: lay.leftover,
    courses,
  };
}

/** Writes To do / Day / Date back into the Study list and refreshes its summary; leaves your other columns alone. */
function updateStudyList_(items, startDate, tz) {
  const sh = ss_().getSheetByName(TAB.list);
  const last = sh.getLastRow();
  const fmt = iso => Utilities.formatDate(Utilities.parseDate(iso, tz, 'yyyy-MM-dd'), tz, 'EEE d MMM');
  const ik = sh.getRange(2, 9, last - 1, 3).getValues();
  items.forEach(it => {
    ik[it.row - 2] = ['To do', it.firstDay ? (it.firstDay === it.lastDay ? 'Day ' + it.firstDay : 'Day ' + it.firstDay + '–' + it.lastDay) : '', it.firstDate ? fmt(it.firstDate) : ''];
  });
  sh.getRange(2, 9, last - 1, 3).setValues(ik);
  const sum = day1Summary_(items, { endDate: '', leftover: 0 });
  const courses = sum.courses.slice().sort((a, b) => a.priority - b.priority || a.firstDay - b.firstDay);
  const R = '$C$2:$C$' + last;
  const out = [['Course', 'Priority', 'Sections', 'Plan (h)', 'Study × ' + STUDY_LIST_FACTOR + ' (h)', 'Finishes']].concat(courses.map((c, i) => {
    const r = i + 2;
    return [c.course, c.priority, '=COUNTIF(' + R + ',M' + r + ')', '=SUMIF(' + R + ',M' + r + ',$E$2:$E$' + last + ')/60',
      '=SUMIF(' + R + ',M' + r + ',$F$2:$F$' + last + ')/60', c.lastDay ? 'Day ' + c.lastDay + ' · ' + fmt(c.lastDate) : ''];
  }));
  const tr = courses.length + 2;
  out.push(['Total', '', '=SUM(O2:O' + (tr - 1) + ')', '=SUM(P2:P' + (tr - 1) + ')', '=SUM(Q2:Q' + (tr - 1) + ')', 'Day ' + sum.days]);
  sh.getRange(1, 13, Math.max(40, out.length + 8), 6).clearContent();
  sh.getRange(1, 13, out.length, 6).setValues(out);
  sh.getRange(1, 13, 1, 6).setFontWeight('bold').setBackground('#111722').setFontColor('#f5c242');
  sh.getRange(tr, 13, 1, 6).setFontWeight('bold');
  sh.getRange(2, 16, out.length - 1, 2).setNumberFormat('0.0');
  sh.getRange(tr + 2, 13, 4, 1).setValues([
    ['Day 1 = ' + Utilities.formatDate(Utilities.parseDate(startDate, tz, 'yyyy-MM-dd'), tz, 'EEE d MMM yyyy') + '. Everything counts as to do.'],
    ['Planned by Priority, lowest number first; your list order within the same priority.'],
    ['Study time = the “Study × ' + STUDY_LIST_FACTOR + '” column, laid into your learning slots (App settings).'],
    ['Change priorities or add rows here, then Saiyan Desk menu → Plan study by priority from today.'],
  ]).setFontColor('#7d8b9c');
}

/**
 * Day 1: restarts the gym split with the Chest day, and re-plans every Study list section — all
 * counted as to do — by priority (lowest number first) from opts.startDate/fromMinute. Earlier
 * learning rows are archived; rows from the start point on are replaced. Both tabs are backed up.
 * opts: {startDate, fromMinute, mark, gym (default true), apply}
 */
function startDay1(opts) {
  opts = opts || {};
  assertIso_(opts.startDate);
  const start = opts.startDate;
  const fromMinute = Math.max(0, Math.min(1440, Number(opts.fromMinute) || 0));
  const withGym = opts.gym !== false;
  const gymStart = dow_(start) === 0 ? addDays_(start, 1) : start;
  const byPriority = list => list.sort((a, b) => a.priority - b.priority || a.order - b.order);
  if (!opts.apply) {
    const items = byPriority(readStudyList_());
    if (!items.length) throw new Error('The Study list tab is empty.');
    const settings = readSettings_();
    if (withGym) settings.workoutPlan = restartPlan_(gymStart);
    const lay = layQueue_(items, settings, start, fromMinute);
    const sum = day1Summary_(items, lay);
    sum.first = lay.rows.filter(r => LEARNING_RE.test(r.activity)).slice(0, 6);
    return { summary: sum };
  }
  if (opts.mark && readSettings_().sheetUpdate === opts.mark) return { skipped: true, data: getData() };
  const gym = withGym ? rebuildLifting({ startDate: gymStart, plan: restartPlan_(gymStart), apply: true }).summary : null;
  const summary = withLock_(() => {
    const tz = tz_();
    const items = byPriority(readStudyList_());
    if (!items.length) throw new Error('The Study list tab is empty.');
    const settings = readSettings_();
    const lay = layQueue_(items, settings, start, fromMinute);
    const sh = sheet_(TAB.study);
    sh.copyTo(ss_()).setName('Study plan backup ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'));
    const rows = readStudy_(tz);
    const later = r => r.date > start || (r.date === start && (r.start == null || r.start >= fromMinute));
    const n = sh.getLastRow() - 1;
    if (n > 0) {
      const range = sh.getRange(2, 6, n, 1);
      const st = range.getValues();
      rows.forEach(r => { if (LEARNING_RE.test(r.activity) && !later(r)) st[r.row - 2][0] = STATUS.archived; });
      range.setValues(st);
    }
    const doomed = rows.filter(later).map(r => r.row).concat(emptyRows_(sh)).sort((a, b) => b - a);
    for (let i = 0; i < doomed.length;) {
      let j = i;
      while (j + 1 < doomed.length && doomed[j + 1] === doomed[j] - 1) j++;
      sh.deleteRows(doomed[j], j - i + 1);
      i = j + 1;
    }
    if (lay.rows.length) {
      const at = sh.getLastRow() + 1;
      const short = at + lay.rows.length - 1 - sh.getMaxRows();
      if (short > 0) sh.insertRowsAfter(sh.getMaxRows(), short);
      sh.getRange(at, 1, lay.rows.length, 6).setValues(lay.rows.map(r => [isoToSerial_(r.date), r.start / 1440, r.activity, r.topic, r.section, STATUS.planned]));
      sh.getRange(at, 1, lay.rows.length, 1).setNumberFormat('m/d/yyyy');
      sh.getRange(at, 2, lay.rows.length, 1).setNumberFormat('h:mm');
    }
    updateStudyList_(items, start, tz);
    const s2 = readSettings_();
    if (opts.mark) s2.sheetUpdate = opts.mark;
    writeSettings_(s2);
    const sum = day1Summary_(items, lay);
    sum.archived = rows.filter(r => LEARNING_RE.test(r.activity) && !later(r)).length;
    sum.replaced = rows.filter(later).length;
    return sum;
  });
  summary.gym = gym;
  return { summary, data: getData() };
}

// ---------------------------------------------------------------- tracker rebuild

/**
 * Rewrites the power-lifting tracker from opts.startDate to the program's last date with the
 * weekly plan: unlogged rows from the start date onward are replaced, logged rows are kept, and a
 * copy of the tab is saved first. opts: {startDate, plan?, endDate?, mark?, apply}
 */
function rebuildLifting(opts) {
  opts = opts || {};
  assertIso_(opts.startDate);
  const run = () => {
    const tz = tz_();
    const input = {};
    if (opts.plan) input.workoutPlan = opts.plan;
    if (opts.mark) input.sheetUpdate = opts.mark;
    const settings = mergeSettings_(input);
    const split = parseWorkoutPlan_(settings.workoutPlan);
    const exercises = readExercises_();
    const canon = {};
    exercises.forEach(e => (canon[e.part.toLowerCase()] = e.part));
    const rows = readLifting_(tz);
    const start = opts.startDate;
    const end = opts.endDate || rows.reduce((m, r) => (r.date > m ? r.date : m), start);
    const isLogged = r => r.reps.some(v => v > 0);
    const kept = rows.filter(r => r.date >= start && isLogged(r));
    const keep = {};
    kept.forEach(r => (keep[r.date + '|' + r.name] = true));
    const fresh = [];
    const days = [];
    for (let d = start; d <= end; d = addDays_(d, 1)) {
      const parts = (split[dow_(d)] || []).map(p => canon[String(p).toLowerCase()]).filter(Boolean);
      if (days.length < 7) days.push({ date: d, label: parts.join(' · ') || 'Rest' });
      parts.forEach(part => exercises.filter(e => e.part === part).forEach(e => {
        if (!keep[d + '|' + e.name]) fresh.push({ date: d, values: [isoToSerial_(d), e.name, e.part, e.muscle, e.equipment, '', '', ''] });
      }));
    }
    const removed = rows.filter(r => r.date >= start && !isLogged(r)).length;
    const summary = { startDate: start, endDate: end, removed, added: fresh.length, kept: kept.length, days };
    if (!opts.apply) return { summary };

    const ss = ss_();
    const sh = sheet_(TAB.lifting);
    // Logged rows from the start date on are lifted out with their values and put back in date order.
    const keptRows = kept.map(r => {
      const v = sh.getRange(r.row, 1, 1, 8).getValues()[0];
      v[0] = isoToSerial_(r.date);
      return { date: r.date, values: v };
    });
    const add = [];
    const byDate = {};
    keptRows.concat(fresh).forEach(x => (byDate[x.date] = byDate[x.date] || []).push(x.values));
    Object.keys(byDate).sort().forEach(d => byDate[d].forEach(v => add.push(v)));
    const doomed = rows.filter(r => r.date >= start).map(r => r.row);
    sh.copyTo(ss).setName('Tracker backup ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'));
    doomed.sort((a, b) => b - a);
    for (let i = 0; i < doomed.length;) {
      let j = i;
      while (j + 1 < doomed.length && doomed[j + 1] === doomed[j] - 1) j++;
      sh.deleteRows(doomed[j], j - i + 1);
      i = j + 1;
    }
    if (add.length) {
      let after = 1;
      const last = sh.getLastRow();
      if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach((v, i) => { const d = isoDate_(v[0], tz); if (d && d < start) after = i + 2; });
      sh.insertRowsAfter(after, add.length);
      sh.getRange(after + 1, 1, add.length, 8).setValues(add);
      sh.getRange(after + 1, 1, add.length, 1).setNumberFormat('m/d/yyyy');
    }
    writeSettings_(settings);
    return { summary, data: getData() };
  };
  return opts.apply ? withLock_(run) : run();
}

// ---------------------------------------------------------------- re-plan

/**
 * Lays every unfinished "... Learning" section, in its original order, into the
 * learning slots of the routine, day by day from opts.startDate, keeping office
 * hours free on work days.
 *
 * opts: {startDate, fromMinute, settings?, apply}
 *  - preview (apply falsy): returns {summary}; the sheet is not touched.
 *  - apply: backs up the Study plan tab, marks overdue unfinished sections
 *    "Rescheduled", replaces unfinished rows from the start point onward with
 *    the new plan, saves the settings used, and returns {summary, data}.
 */
function replanStudy(opts) {
  opts = opts || {};
  assertIso_(opts.startDate);
  const run = () => {
    const tz = tz_();
    const settings = mergeSettings_(opts.settings);
    const plan = buildPlan_(readStudy_(tz), settings, opts.startDate, Number(opts.fromMinute) || 0);
    const sh = sheet_(TAB.study);
    plan.summary.emptyRows = emptyRows_(sh).length;
    if (!opts.apply) return { summary: plan.summary };

    const ss = ss_();
    const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    sh.copyTo(ss).setName('Study plan backup ' + stamp);

    if (plan.overdue.length) sh.getRangeList(plan.overdue.map(r => 'F' + r.row)).setValue(STATUS.moved);

    const doomed = plan.replaced.map(r => r.row).concat(emptyRows_(sh)).sort((a, b) => b - a);
    for (let i = 0; i < doomed.length;) {
      let j = i;
      while (j + 1 < doomed.length && doomed[j + 1] === doomed[j] - 1) j++;
      sh.deleteRows(doomed[j], j - i + 1);
      i = j + 1;
    }

    if (plan.rows.length) {
      const at = sh.getLastRow() + 1;
      const short = at + plan.rows.length - 1 - sh.getMaxRows();
      if (short > 0) sh.insertRowsAfter(sh.getMaxRows(), short);
      sh.getRange(at, 1, plan.rows.length, 6).setValues(plan.rows.map(r =>
        [isoToSerial_(r.date), r.start / 1440, r.activity, r.topic, r.section, STATUS.planned]));
      sh.getRange(at, 1, plan.rows.length, 1).setNumberFormat('m/d/yyyy');
      sh.getRange(at, 2, plan.rows.length, 1).setNumberFormat('h:mm');
    }
    writeSettings_(settings);
    return { summary: plan.summary, data: getData() };
  };
  return opts.apply ? withLock_(run) : run();
}

function buildPlan_(study, settings, startDate, fromMinute) {
  const open = r => r.status !== STATUS.done && r.status !== STATUS.moved && r.status !== STATUS.skipped && r.status !== STATUS.archived;
  const fromHere = r => r.date > startDate || (r.date === startDate && (r.start == null || r.start >= fromMinute));
  const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || 0) - (b.start || 0) || a.row - b.row);

  // Unfinished sections form one queue in plan order (the plan is already in priority order),
  // and every learning slot takes the next one.
  const pending = study.filter(r => LEARNING_RE.test(r.activity) && open(r)).sort(byTime);
  const queues = {};
  const order = [];
  pending.forEach(r => {
    if (!queues.all) { queues.all = []; order.push('all'); }
    const q = queues.all;
    const last = q[q.length - 1];
    if (last && last.topic === r.topic && last.section === r.section) last.left += r.mins;
    else q.push({ activity: r.activity, topic: r.topic, section: r.section, left: r.mins });
  });
  order.forEach(a => queues[a].forEach(it => (it.left = Math.max(5, it.left))));
  const totalMinutes = order.reduce((s, a) => s + queues[a].reduce((t, it) => t + it.left, 0), 0);

  const office = [parseHm_(settings.officeStart), parseHm_(settings.officeEnd)];
  const workDays = parseWorkDays_(settings.workDays);
  const routine = { work: withOffice_(parseRoutine_(settings.weekdayRoutine), office), free: parseRoutine_(settings.weekendRoutine) };

  const split = parseWorkoutPlan_(settings.workoutPlan);

  const rows = [];
  const hasWork = () => order.some(a => queues[a].length);
  const queueFor = activity => (queues[activity] && queues[activity].length ? queues[activity] : null) ||
    order.map(a => queues[a]).filter(q => q.length)[0] || null;

  const MAX_DAYS = 366;
  let date = startDate;
  let days = 0;
  while (hasWork() && days < MAX_DAYS) {
    const slots = workDays[dow_(date)] ? routine.work : routine.free;
    slots.forEach((slot, i) => {
      const end = i + 1 < slots.length ? slots[i + 1].start : 1440;
      let t = slot.start;
      const learning = LEARNING_RE.test(slot.activity);
      if (days === 0 && t < fromMinute) {
        if (!learning || end <= fromMinute) return;
        t = Math.ceil(fromMinute / 5) * 5;
        if (t >= end) return;
      }
      if (!learning) {
        let topic = '';
        let section = '';
        if (/workout/i.test(slot.activity)) topic = (split[dow_(date)] || []).join(' · ') || 'Rest day';
        if (/revision/i.test(slot.activity)) topic = section = '-';
        rows.push({ date, start: t, activity: slot.activity, topic, section, mins: end - t });
        return;
      }
      while (t < end) {
        const q = queueFor(slot.activity);
        const room = end - t;
        if (!q || (q[0].left > room && room < 10)) {
          rows.push({ date, start: t, activity: 'Break', topic: '', section: '', mins: room });
          break;
        }
        const it = q[0];
        const take = Math.min(it.left, room);
        rows.push({ date, start: t, activity: slot.activity, topic: it.topic, section: it.section, mins: take });
        it.left -= take;
        t += take;
        if (it.left <= 0) q.shift();
      }
    });
    date = addDays_(date, 1);
    days++;
  }

  const learnRows = rows.filter(r => LEARNING_RE.test(r.activity));
  const topics = {};
  learnRows.forEach(r => {
    const t = topics[r.topic] = topics[r.topic] || { topic: r.topic, minutes: 0, first: r.date, last: r.date };
    t.minutes += r.mins;
    t.last = r.date;
  });
  const weekMinutes = [0, 1, 2, 3, 4, 5, 6].reduce((sum, d) => {
    const slots = workDays[d] ? routine.work : routine.free;
    return sum + slots.reduce((s, slot, i) => s + (LEARNING_RE.test(slot.activity) ? (i + 1 < slots.length ? slots[i + 1].start : 1440) - slot.start : 0), 0);
  }, 0);

  const overdue = pending.filter(r => !fromHere(r));
  const replaced = study.filter(r => fromHere(r) && r.status !== STATUS.done);
  const leftover = order.reduce((s, a) => s + queues[a].reduce((t, it) => t + it.left, 0), 0);

  return {
    rows,
    overdue,
    replaced,
    summary: {
      startDate,
      endDate: learnRows.length ? learnRows[learnRows.length - 1].date : null,
      days,
      rowsToAdd: rows.length,
      learningMinutes: totalMinutes - leftover,
      leftoverMinutes: leftover,
      weekMinutes,
      sections: pending.length,
      overdue: overdue.length,
      replaced: replaced.length,
      topics: Object.keys(topics).map(k => topics[k]),
      preview: rows.filter(r => r.date <= addDays_(startDate, 1)).map(r => ({ date: r.date, start: r.start, activity: r.activity, topic: r.topic, section: r.section, mins: r.mins })),
    },
  };
}

// ---------------------------------------------------------------- settings helpers

function mergeSettings_(input) {
  const s = readSettings_();
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (!input || input[k] == null) return;
    const v = String(input[k]).trim();
    if (ART_KEYS.indexOf(k) >= 0) {
      if (v && v !== 'none' && !/^https:\/\/\S+$/i.test(v)) throw new Error('Art links must start with https://');
      s[k] = v || 'none'; // "none" switches the slot off
    } else if (v !== '') s[k] = v;
  });
  const os = parseHm_(s.officeStart);
  const oe = parseHm_(s.officeEnd);
  if (os == null || oe == null || oe <= os) throw new Error('Office hours must be like 09:00 and 18:00, with the end after the start.');
  s.officeStart = hm_(os);
  s.officeEnd = hm_(oe);
  if (!Object.keys(parseWorkDays_(s.workDays)).length) throw new Error('Pick at least one work day.');
  parseRoutine_(s.weekdayRoutine);
  parseRoutine_(s.weekendRoutine);
  parseWorkoutPlan_(s.workoutPlan);
  return s;
}

/** "Mon: Back, Triceps" lines -> {1: ['Back', 'Triceps'], ...}; "Rest" or a missing day = no workout. */
function parseWorkoutPlan_(text) {
  const plan = {};
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    line = line.trim();
    if (!line) return;
    const m = line.match(/^([A-Za-z]{3})[A-Za-z]*\s*[:\-–]\s*(.*)$/);
    const day = m ? DAY_NAMES.map(d => d.toLowerCase()).indexOf(m[1].toLowerCase()) : -1;
    if (day < 0) throw new Error('Workout plan line ' + (i + 1) + ' should look like "Mon: Back, Triceps": ' + line);
    plan[day] = /^rest$/i.test(m[2].trim()) ? [] : m[2].split(',').map(s => s.trim()).filter(Boolean);
  });
  return plan;
}

function writeSettings_(s) {
  const ss = ss_();
  const sh = ss.getSheetByName(TAB.settings) || ss.insertSheet(TAB.settings);
  const rows = [['Setting', 'Value', 'Notes']].concat(Object.keys(DEFAULT_SETTINGS).map(k => [k, s[k], SETTING_NOTES[k]]));
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows).setVerticalAlignment('top').setWrap(true);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 140);
  sh.setColumnWidth(2, 280);
  sh.setColumnWidth(3, 360);
}

function parseRoutine_(text) {
  const slots = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    line = line.trim();
    if (!line) return;
    const m = line.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    const start = m && parseHm_(m[1]);
    if (start == null) throw new Error('Routine line ' + (i + 1) + ' should look like "19:00 Second Priority Learning": ' + line);
    slots.push({ start, activity: m[2].trim() });
  });
  if (!slots.length) throw new Error('A routine needs at least one line.');
  return slots.sort((a, b) => a.start - b.start);
}

function withOffice_(slots, office) {
  const out = slots.filter(s => s.start < office[0] || s.start >= office[1]);
  out.push({ start: office[0], activity: 'Office' });
  if (!out.some(s => s.start === office[1])) out.push({ start: office[1], activity: 'Break' });
  return out.sort((a, b) => a.start - b.start);
}

function parseWorkDays_(text) {
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const set = {};
  String(text || '').split(/[,\s]+/).forEach(d => {
    const i = names.indexOf(d.trim().slice(0, 3).toLowerCase());
    if (i >= 0) set[i] = true;
  });
  return set;
}

// ---------------------------------------------------------------- sheet helpers

let SS_;
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(SPREADSHEET_ID)); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The sheet has no tab named "' + name + '".');
  return sh;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Returns the row matching `match(values, displayValues)`, trying `hint` first, then scanning. */
function findRow_(sh, hint, width, match) {
  const last = sh.getLastRow();
  if (hint >= 2 && hint <= last) {
    const r = sh.getRange(hint, 1, 1, width);
    if (match(r.getValues()[0], r.getDisplayValues()[0])) return hint;
  }
  if (last >= 2) {
    const r = sh.getRange(2, 1, last - 1, width);
    const v = r.getValues();
    const d = r.getDisplayValues();
    for (let i = 0; i < v.length; i++) if (match(v[i], d[i])) return i + 2;
  }
  throw new Error('That row has moved or changed in the sheet. Reload and try again.');
}

function findStudyRow_(sh, p) {
  const tz = tz_();
  return findRow_(sh, p.row, 3, (v, d) => isoDate_(v[0], tz) === p.date && parseHm_(d[1]) === p.start && str_(v[2]) === p.activity);
}

/** Rows that have a value in Date only (left over from dragging the Date column down). */
function emptyRows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const out = [];
  sh.getRange(2, 2, n, 5).getDisplayValues().forEach((r, i) => {
    if (r.every(c => c.trim() === '')) out.push(i + 2);
  });
  return out;
}

// ---------------------------------------------------------------- value helpers

function str_(v) { return v == null ? '' : String(v).trim(); }

function num_(v) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

function numOrNull_(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function cleanReps_(v) {
  const s = str_(v);
  if (s === '') return '';
  const n = Number(s.replace(/,/g, ''));
  if (!isFinite(n) || n < 0) throw new Error('Reps must be a positive number, got "' + s + '".');
  return Math.round(n);
}

function isoDate_(v, tz) {
  if (v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = str_(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // the sheet's m/d/yyyy
  if (m) return m[3] + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
  return '';
}

function assertIso_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error('Expected a date like 2026-10-27, got "' + s + '".');
}

/** "9:30", "09:30:00", "7:05 PM" -> minutes after midnight, or null. */
function parseHm_(s) {
  const m = str_(s).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    const pm = /^p/i.test(m[3]);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function hm_(mins) { return pad2_(Math.floor(mins / 60)) + ':' + pad2_(mins % 60); }
function pad2_(n) { return ('0' + n).slice(-2); }

/** Dates and times are written as serial numbers so the sheet's locale can't misread them. */
function isoToSerial_(iso) {
  const p = iso.split('-').map(Number);
  return (Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(1899, 11, 30)) / 86400000;
}

function addDays_(iso, n) {
  const p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

function dow_(iso) {
  const p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}
