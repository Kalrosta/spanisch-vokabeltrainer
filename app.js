import { fsrsNewCard, fsrsReview, fsrsSkip, fsrsRedistribute, isDue } from "./fsrs.js";

/* ---------- Konstanten ---------- */
const DAY = 86400000;
const APP_VERSION = "1.0.0";
const LS = {
  fsrs: "esp_fsrs",
  notes: "esp_notes",
  errors: "esp_errors",
  settings: "esp_settings",
  progress: "esp_progress",
  redist: "esp_redist",
  backupReminder: "esp_backup_reminder",
};
// a/b/c-Schwellen (Stability in Tagen), live abgeleitet
const T_B = 7;   // < 7 Tage -> c
const T_A = 30;  // 7..30 -> b ; >=30 -> a

/* ---------- State ---------- */
let WORDS = [];
let EXAMPLES = {};
let fsrs = load(LS.fsrs, {});
let notes = load(LS.notes, {});
let errors = load(LS.errors, []);
let settings = load(LS.settings, { dir: "de2es", abc: ["a", "b", "c"], theme: "__all__", newCap: 15 });
let progress = load(LS.progress, { date: today(), newToday: 0, reviewsToday: 0 });

let queue = [];
let qIndex = 0;
let revealed = false;

/* ---------- Helpers ---------- */
function load(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function today() { return new Date().toISOString().slice(0, 10); }
function $(id) { return document.getElementById(id); }
function toast(msg, ms = 2200) { const t = $("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms); }

function rollProgressDate() {
  if (progress.date !== today()) {
    progress = { date: today(), newToday: 0, reviewsToday: 0 };
    save(LS.progress, progress);
  }
}

/* effektive a/b/c-Einstufung: aus FSRS sobald geübt, sonst xlsx-Startwert */
function bucket(w) {
  const c = fsrs[w.id];
  if (!c || c.reps === 0 || c.state === "new") return w.prio;
  if (c.S < T_B) return "c";
  if (c.S < T_A) return "b";
  return "a";
}

/* ---------- Datenladung ---------- */
async function loadData() {
  const [w, e] = await Promise.all([
    fetch("./data/words.json").then(r => r.json()),
    fetch("./data/examples.json").then(r => r.json()),
  ]);
  WORDS = w; EXAMPLES = e;
}

/* ---------- Stau-Umverteilung (1x täglich) ---------- */
function maybeRedistribute() {
  const last = load(LS.redist, "");
  if (last === today()) return;
  const cards = Object.values(fsrs);
  const overdue = cards.filter(c => c.due && c.due < Date.now() && c.state !== "new").length;
  if (overdue > 25) {
    fsrsRedistribute(cards, Date.now()); // mutiert in place
    save(LS.fsrs, fsrs);
  }
  save(LS.redist, today());
}

/* ---------- Queue ---------- */
function buildQueue(extra = false) {
  rollProgressDate();
  const abcSet = new Set(settings.abc);
  const theme = settings.theme;
  const now = Date.now();

  const pool = WORDS.filter(w => {
    if (theme !== "__all__" && w.theme !== theme) return false;
    return abcSet.has(bucket(w));
  });

  const reviews = [];
  const fresh = [];
  for (const w of pool) {
    const c = fsrs[w.id];
    if (c && c.reps > 0 && c.state !== "new") {
      if (isDue(c, now)) reviews.push(w);
    } else {
      fresh.push(w);
    }
  }
  reviews.sort((a, b) => (fsrs[a.id]?.due || 0) - (fsrs[b.id]?.due || 0));
  shuffle(fresh);

  // Normal: Rest des Tageslimits. Extra: voller Stapel, Limit ignoriert.
  const budget = extra ? settings.newCap : Math.max(0, settings.newCap - progress.newToday);
  const newPick = fresh.slice(0, budget);

  // Reviews zuerst (fällig), neue Karten gemischt dahinter
  queue = reviews.concat(newPick);
  qIndex = 0;
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

/* ---------- Rendering: Start ---------- */
function renderHome() {
  rollProgressDate();
  // Today-Banner
  const banner = $("todayBanner");
  const did = progress.reviewsToday + progress.newToday;
  if (did > 0) {
    banner.classList.add("done");
    banner.innerHTML = `<strong>Heute schon gelernt.</strong> ${did} Karten (${progress.newToday} neu, ${progress.reviewsToday} Wdh.).`;
  } else {
    banner.classList.remove("done");
    banner.innerHTML = `Noch nichts gelernt heute. Auf geht's.`;
  }

  // Stats: Verteilung a/b/c über gesamten Wortschatz
  let a = 0, b = 0, c = 0;
  for (const w of WORDS) { const k = bucket(w); if (k === "a") a++; else if (k === "b") b++; else c++; }
  $("statRow").innerHTML =
    `<div class="stat a"><span class="n">${a}</span><span class="l">kann ich</span></div>` +
    `<div class="stat b"><span class="n">${b}</span><span class="l">erkenne</span></div>` +
    `<div class="stat c"><span class="n">${c}</span><span class="l">neu</span></div>`;

  // Direction
  document.querySelectorAll("#dirSeg .seg-btn").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.dir === settings.dir));

  // Theme select
  const sel = $("themeSel");
  if (!sel.dataset.filled) {
    const themes = [...new Set(WORDS.map(w => w.theme))].sort((x, y) => x.localeCompare(y, "de"));
    sel.innerHTML = `<option value="__all__">Alle Themen</option>` +
      themes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    sel.dataset.filled = "1";
  }
  sel.value = settings.theme;

  $("newCap").value = String(settings.newCap);

  // Fälligkeits-Vorschau für Start-Button
  buildQueue();
  const n = queue.length;
  $("startBtn").disabled = n === 0;
  $("startBtn").textContent = n === 0 ? "Nichts fällig — Filter anpassen" : `Lernen starten (${n})`;

  // Extra-Button: ungesehene Karten, die das normale Tageslimit heute nicht mehr erreicht
  const abcSet2 = new Set(settings.abc);
  const freshTotal = WORDS.filter(w => {
    if (settings.theme !== "__all__" && w.theme !== settings.theme) return false;
    if (!abcSet2.has(bucket(w))) return false;
    const c = fsrs[w.id];
    return !(c && c.reps > 0 && c.state !== "new");
  }).length;
  const budgetLeft = Math.max(0, settings.newCap - progress.newToday);
  const extraBtn = $("extraBtn");
  if (freshTotal > budgetLeft) {
    extraBtn.classList.remove("hidden");
    extraBtn.innerHTML = `Weitere Karten lernen<small>${freshTotal} neu offen</small>`;
  } else {
    extraBtn.classList.add("hidden");
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* Grammatik aus Wortart + Hinweis ableiten -> Badges + Genus-Farbe */
function grammar(w) {
  const h = (w.hint || "");
  const hl = h.toLowerCase();
  const out = { gender: null, badges: [] };

  if (w.pos === "Nomen") {
    const first = w.es.trim().split(/\s+/)[0].toLowerCase();
    const plural = first === "los" || first === "las" || /\bplural\b/.test(hl);
    if (first === "las" || /\(f\)/.test(hl)) out.gender = "f";
    else if (first === "los" || /\(m\)/.test(hl)) out.gender = "m";
    if (out.gender) out.badges.push({ t: out.gender, c: out.gender === "f" ? "b-fem" : "b-masc" });
    if (plural) out.badges.push({ t: "Pl.", c: "b-neutral" });
  } else if (w.pos === "Verb") {
    let base = w.es.trim().toLowerCase().replace(/\s.*$/, "");
    if (base.endsWith("se")) base = base.slice(0, -2);
    let cls = base.endsWith("ar") ? "-ar" : base.endsWith("er") ? "-er" : base.endsWith("ir") ? "-ir" : null;
    if (cls) out.badges.push({ t: cls, c: "b-verb" });
    if (/unreg|irreg/.test(hl)) out.badges.push({ t: "irr.", c: "b-irr" });
    const sc = h.match(/([a-záéíóúñü])\s*->\s*([a-záéíóúñü]+)/i);
    if (sc) out.badges.push({ t: `${sc[1]}\u2192${sc[2]}`, c: "b-stem" });
  } else if (w.pos === "Adjektiv") {
    if (/-o\s*\/\s*-a|\bo\/a\b/.test(hl)) out.badges.push({ t: "-o/-a", c: "b-neutral" });
    else if (/gleich für m\/f|invariab|unveränder/.test(hl)) out.badges.push({ t: "m/f gleich", c: "b-neutral" });
  }
  return out;
}

const GENDER_VAR = { m: "var(--masc)", f: "var(--fem)" };

/* ---------- Rendering: Karte ---------- */
function renderCard() {
  if (qIndex >= queue.length) return endSession();
  revealed = false;
  const w = queue[qIndex];
  const frontEs = settings.dir === "es2de";

  $("fcPos").textContent = w.pos + (w.theme ? " · " + w.theme : "");
  $("fcFront").textContent = frontEs ? w.es : w.de;
  $("fcBack").textContent = frontEs ? w.de : w.es;

  // Grammatik: Genus-Farbe auf das spanische Wort, Badges in der Antwort
  const g = grammar(w);
  const esEl = frontEs ? $("fcFront") : $("fcBack");
  const otherEl = frontEs ? $("fcBack") : $("fcFront");
  otherEl.style.color = "";
  esEl.style.color = (w.pos === "Nomen" && g.gender) ? GENDER_VAR[g.gender] : "";
  const badgeBox = $("fcBadges");
  if (g.badges.length) {
    badgeBox.innerHTML = g.badges.map(b => `<span class="badge ${b.c}">${esc(b.t)}</span>`).join("");
    badgeBox.style.display = "";
  } else { badgeBox.innerHTML = ""; badgeBox.style.display = "none"; }

  // Hinweis nur sinnvoll wenn vorhanden (Genus, Konjugationsklasse, Stem-Change …)
  const hint = w.hint && w.hint.trim();
  $("fcHint").textContent = hint || "";
  $("fcHint").style.display = hint ? "" : "none";

  // Beispiel
  const ex = EXAMPLES[w.id];
  const exBox = $("fcExample");
  if (ex && (ex.es || ex.de)) {
    exBox.innerHTML = (ex.es ? `<div class="ex-es">${esc(ex.es)}</div>` : "") +
                      (ex.de ? `<div class="ex-de">${esc(ex.de)}</div>` : "");
    exBox.style.display = "";
  } else { exBox.innerHTML = ""; exBox.style.display = "none"; }

  // Notiz
  $("noteField").value = notes[w.id] || "";

  // UI-Zustand
  $("fcAnswer").classList.add("hidden");
  $("rateRow").classList.add("hidden");
  $("tapHint").classList.remove("hidden");

  // Meta + Fortschritt
  $("studyMeta").textContent = `Karte ${qIndex + 1} von ${queue.length}`;
  $("progressFill").style.width = `${Math.round((qIndex / queue.length) * 100)}%`;
}

function reveal() {
  if (revealed) return;
  revealed = true;
  $("fcAnswer").classList.remove("hidden");
  $("tapHint").classList.add("hidden");
  $("rateRow").classList.remove("hidden");
  // Intervall-Vorschau pro Bewertung
  const w = queue[qIndex];
  const card = fsrs[w.id] || fsrsNewCard();
  const now = Date.now();
  [1, 2, 3, 4].forEach(rate => {
    const res = fsrsReview({ ...card }, rate, now);
    $("iv" + rate).textContent = fmtInterval(res.due - now);
  });
}

function fmtInterval(ms) {
  const d = Math.max(1, Math.round(ms / DAY));
  if (d < 30) return d + " T";
  if (d < 365) return Math.round(d / 30) + " Mon";
  return (d / 365).toFixed(1).replace(".", ",") + " J";
}

/* ---------- Aktionen ---------- */
function rate(rating) {
  if (!revealed) return;
  const w = queue[qIndex];
  const prev = fsrs[w.id];
  const wasNew = !prev || prev.reps === 0 || prev.state === "new";
  fsrs[w.id] = fsrsReview(prev || fsrsNewCard(), rating, Date.now());
  save(LS.fsrs, fsrs);
  if (wasNew) progress.newToday++; else progress.reviewsToday++;
  save(LS.progress, progress);
  next();
}

function skip() {
  const w = queue[qIndex];
  fsrs[w.id] = fsrsSkip(fsrs[w.id] || fsrsNewCard(), Date.now());
  save(LS.fsrs, fsrs);
  toast("Auf 60 Tage geschoben");
  next();
}

function next() { qIndex++; renderCard(); }

function saveNote() {
  const w = queue[qIndex]; if (!w) return;
  const v = $("noteField").value.trim();
  if (v) notes[w.id] = v; else delete notes[w.id];
  save(LS.notes, notes);
}

function reportError() {
  const w = queue[qIndex]; if (!w) return;
  const note = prompt(`Fehler melden für „${w.es}" → „${w.de}"\nWas stimmt nicht? (optional)`);
  if (note === null) return;
  errors.push({ id: w.id, es: w.es, de: w.de, pos: w.pos, hint: w.hint, note: note.trim(), ts: new Date().toISOString() });
  save(LS.errors, errors);
  toast("Fehler notiert — in Daten exportierbar");
}

function endSession() {
  $("progressFill").style.width = "100%";
  showView("home");
  toast(`Fertig. ${progress.newToday} neu, ${progress.reviewsToday} Wdh. heute.`);
  maybeBackupReminder();
}

/* ---------- Backup-Reminder ---------- */
function maybeBackupReminder() {
  const last = load(LS.backupReminder, 0);
  if (Date.now() - last > 7 * DAY) {
    save(LS.backupReminder, Date.now());
    setTimeout(() => toast("Tipp: alle paar Tage ein Backup exportieren (⚙ → Daten).", 4000), 1200);
  }
}

/* ---------- Daten-View ---------- */
function renderData() {
  const reviewed = Object.values(fsrs).filter(c => c.reps > 0).length;
  $("dataStats").textContent = `${reviewed} von ${WORDS.length} Karten geübt · ${Object.keys(notes).length} Notizen.`;
  $("errStats").textContent = errors.length ? `${errors.length} gemeldete Fehler.` : "Keine gemeldeten Fehler.";
  $("versionLine").textContent = `Spanisch B2 · App v${APP_VERSION}`;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const data = { v: 1, app: APP_VERSION, exported: new Date().toISOString(), fsrs, notes, errors, progress, settings };
  download(`spanisch-b2-backup-${today()}.json`, JSON.stringify(data), "application/json");
  save(LS.backupReminder, Date.now());
  toast("Backup exportiert");
}

function importBackup(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.fsrs) { fsrs = d.fsrs; save(LS.fsrs, fsrs); }
      if (d.notes) { notes = d.notes; save(LS.notes, notes); }
      if (d.errors) { errors = d.errors; save(LS.errors, errors); }
      if (d.settings) { settings = { ...settings, ...d.settings }; save(LS.settings, settings); }
      if (d.progress) { progress = d.progress; save(LS.progress, progress); }
      toast("Backup importiert");
      renderData();
    } catch { toast("Import fehlgeschlagen — keine gültige Datei"); }
  };
  r.readAsText(file);
}

/* CSV-Export der aktuellen a/b/c-Einstufung (Delta für Rückspielung ins Repo) */
function exportWordlist() {
  const rows = [["Nr", "Spanisch", "Prioritaet"]];
  for (const w of WORDS) rows.push([w.id, w.es, bucket(w)]);
  const csv = rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  download(`prio-update-${today()}.csv`, csv, "text/csv");
  toast("a/b/c-Liste exportiert — in updates/ committen");
}

function exportErrors() {
  if (!errors.length) return toast("Keine Fehler gemeldet");
  const rows = [["id", "Spanisch", "Deutsch", "Wortart", "Hinweis", "Anmerkung", "Zeit"]];
  for (const e of errors) rows.push([e.id, e.es, e.de, e.pos, e.hint || "", e.note || "", e.ts]);
  const csv = "\uFEFF" + rows.map(r => r.map(c => csvCell(c, ";")).join(";")).join("\r\n");
  download(`fehler-${today()}.csv`, csv, "text/csv");
}

function csvCell(v, sep = ",") {
  const s = String(v ?? "");
  return (/["\n\r]/.test(s) || s.includes(sep)) ? `"${s.replace(/"/g, '""')}"` : s;
}

function resetAll() {
  if (!confirm("Lernfortschritt, Notizen und Fehler auf diesem Gerät löschen?")) return;
  [LS.fsrs, LS.notes, LS.errors, LS.progress, LS.redist].forEach(k => localStorage.removeItem(k));
  fsrs = {}; notes = {}; errors = []; progress = { date: today(), newToday: 0, reviewsToday: 0 };
  toast("Zurückgesetzt");
  renderData(); renderHome();
}

/* ---------- View-Switch ---------- */
function showView(name) {
  $("viewHome").classList.toggle("hidden", name !== "home");
  $("viewStudy").classList.toggle("hidden", name !== "study");
  $("viewData").classList.toggle("hidden", name !== "data");
  if (name === "home") renderHome();
  if (name === "data") renderData();
  window.scrollTo(0, 0);
}

/* ---------- Events ---------- */
function wire() {
  $("navHome").onclick = () => showView("home");
  $("navData").onclick = () => showView("data");

  document.querySelectorAll("#dirSeg .seg-btn").forEach(btn =>
    btn.onclick = () => { settings.dir = btn.dataset.dir; save(LS.settings, settings); renderHome(); });

  $("themeSel").onchange = e => { settings.theme = e.target.value; save(LS.settings, settings); renderHome(); };
  $("newCap").onchange = e => { settings.newCap = +e.target.value; save(LS.settings, settings); renderHome(); };

  $("startBtn").onclick = () => { buildQueue(); if (queue.length) { showView("study"); renderCard(); } };
  $("extraBtn").onclick = () => { buildQueue(true); if (queue.length) { showView("study"); renderCard(); } else toast("Keine neuen Karten in diesem Filter"); };
  $("homeBackup").onclick = exportBackup;

  $("flashcard").onclick = reveal;
  document.querySelectorAll("#rateRow .rate-btn").forEach(b =>
    b.onclick = () => rate(+b.dataset.rate));
  $("skipBtn").onclick = skip;
  $("errBtn").onclick = reportError;
  $("endBtn").onclick = () => { saveNote(); endSession(); };
  $("noteField").onblur = saveNote;

  $("exportBackup").onclick = exportBackup;
  $("importBackup").onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  $("exportWordlist").onclick = exportWordlist;
  $("exportErrors").onclick = exportErrors;
  $("clearErrors").onclick = () => { if (confirm("Fehlerliste leeren?")) { errors = []; save(LS.errors, errors); renderData(); toast("Geleert"); } };
  $("resetAll").onclick = resetAll;

  // Tastatur (Desktop): Space=umdrehen, 1-4=bewerten
  document.addEventListener("keydown", e => {
    if ($("viewStudy").classList.contains("hidden")) return;
    if (e.code === "Space") { e.preventDefault(); reveal(); }
    else if (["1", "2", "3", "4"].includes(e.key) && revealed) rate(+e.key);
  });
}

/* ---------- Init ---------- */
(async function init() {
  wire();
  try {
    await loadData();
  } catch {
    toast("Daten konnten nicht geladen werden", 5000);
    return;
  }
  maybeRedistribute();
  showView("home");
})();

/* Service Worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
