/* --------------- Flashcards – CSV Version 6.0------------ */
/* Komplett neue Version ohne Excel, mit CSV-Import         */
/* CSV UTF‑8, Semikolon‑Trennung, Header-Zeile,             */
/* Zeilen mit "*" in Spalte A werden ignoriert              */
/* -------------------------------------------------------- */

const CSV_URL = "./Long-Chinesisch_Lektionen.csv";
const LS_KEYS = {
    settings: 'fc_settings_v1',
    progress: 'fc_progress_v1'
};

const state = {
    mode: 'de2zh',
    order: 'random',

    rateDe: 0.95,
    pitchDe: 1.0,
    rateZh: 0.95,
    pitchZh: 1.0,

    lessons: new Map(),
    selectedLessons: new Set(),

    pool: [],
    idx: null,
    current: null,

    voices: [],
    browserVoice: { zh: null, de: null },
    voicePanelTarget: 'de',

    autoplay: { on: false, timers: [], gapMs: 800 },

    settings: {
        mode: 'de2zh',
        order: 'random',
        rateDe: 0.95,
        pitchDe: 1.0,
        rateZh: 0.95,
        pitchZh: 1.0,
        lessons: [],
        browserVoiceZh: null,
        browserVoiceDe: null,
        autoplayGap: 800
    },

    session: {
        total: 0,
        done: 0,
        known: 0,
        unsure: 0,
        unknown: 0,
        ttrSum: 0,
        ttrCount: 0
    },

    startedAt: null,
    revealedAt: null,

    progress: {
        version: 'v1',
        cards: {},
        byLesson: {}
    },

    wakeLock: null,
    trainingOn: false
};

const $ = s => document.querySelector(s);

/* -------------------------------------------------------- */
/* SETTINGS & PROGRESS                                      */
/* -------------------------------------------------------- */

function saveSettings() {
    try {
        localStorage.setItem(LS_KEYS.settings, JSON.stringify(state.settings));
    } catch (e) {}
}
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(LS_KEYS.settings) || "null");
        if (s) Object.assign(state.settings, s);
    } catch (e) {}
}

function saveProgress() {
    try {
        localStorage.setItem(LS_KEYS.progress, JSON.stringify(state.progress));
    } catch (e) {}
}
function loadProgress() {
    try {
        const p = JSON.parse(localStorage.getItem(LS_KEYS.progress) || "null");
        if (p && p.version === 'v1') state.progress = p;
    } catch (e) {}
}

/* -------------------------------------------------------- */
/* CSV IMPORT                                               */
/* -------------------------------------------------------- */

async function loadCSV() {
    try {
        const res = await fetch(CSV_URL);
        if (!res.ok) {
            alert("CSV konnte nicht geladen werden: " + res.statusText);
            return;
        }
        const text = await res.text();
        parseCSV(text);
        populateLessonSelect();
    } catch (e) {
        alert("Fehler beim Laden der CSV: " + e.message);
    }
}

function parseCSV(text) {
    state.lessons.clear();

    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");

    if (lines.length <= 1) return;

    // Header wird übersprungen
    for (let i = 1; i < lines.length; i++) {

        const raw = lines[i];
        const cols = raw.split(";");

        if (cols.length < 9) continue;

        // IGNORIEREN wenn Spalte A mit "*" beginnt
        if (cols[0].trim().startsWith("*")) continue;

        const entry = {
            word: {
                de: (cols[0] || "").trim(),
                py: (cols[1] || "").trim(),
                zh: (cols[5] || "").trim()
            },
            pos: (cols[2] || "").trim(),
            sent: {
                py: (cols[3] || "").trim(),
                de: (cols[4] || "").trim(),
                zh: (cols[6] || "").trim()
            },
            id: (cols[7] || "").trim(),
            lesson: (cols[8] || "").trim()
        };

        if (!state.lessons.has(entry.lesson)) {
            state.lessons.set(entry.lesson, []);
        }
        state.lessons.get(entry.lesson).push(entry);
    }
}

/* -------------------------------------------------------- */
/* UI – Lesson Select                                       */
/* -------------------------------------------------------- */

function populateLessonSelect() {
    const sel = $('#lessonSelect');
    sel.innerHTML = "";

    const lessonKeys = [...state.lessons.keys()];
    lessonKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const k of lessonKeys) {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = k;

        if (state.settings.lessons.includes(k))
            opt.selected = true;

        sel.appendChild(opt);
    }
}

/* -------------------------------------------------------- */
/* POOL HANDLING                                             */
/* -------------------------------------------------------- */

function resetSessionStats() {
    state.session = {
        total: state.pool.length,
        done: 0,
        known: 0,
        unsure: 0,
        unknown: 0,
        ttrSum: 0,
        ttrCount: 0
    };
    renderSessionStats();
}

function gatherPool() {
    const out = [];
    for (const k of state.selectedLessons) {
        const arr = state.lessons.get(k);
        if (arr) out.push(...arr);
    }
    state.pool = out;
    state.idx = null;

    resetSessionStats();
}

function gatherPoolFromSettings() {
    state.selectedLessons.clear();
    const list = state.settings.lessons || [];
    list.forEach(x => state.selectedLessons.add(x));
    gatherPool();
}

/* -------------------------------------------------------- */
/* CARD RENDERING                                            */
/* -------------------------------------------------------- */

function setCard(entry) {
    state.current = entry;

    $('#solBox').classList.add('masked');
    state.startedAt = Date.now();
    state.revealedAt = null;

    if (state.mode === 'zh2de') {

        $('#promptWord').innerHTML = entry.word.zh || "—";
        $('#promptWordSub').innerHTML = formatPinyinAndPos(entry.word.py, entry.pos);
        $('#promptSent').innerHTML = formatZh(entry.sent.zh, entry.sent.py);

        $('#solWord').textContent = entry.word.de || "—";
        $('#solSent').textContent = entry.sent.de || "—";

    } else {

        $('#promptWord').textContent = entry.word.de || "—";
        $('#promptWordSub').innerHTML = entry.pos || "";
        $('#promptSent').textContent = entry.sent.de || "—";

        $('#solWord').innerHTML = formatZh(entry.word.zh, entry.word.py);
        $('#solSent').innerHTML = formatZh(entry.sent.zh, entry.sent.py);
    }

    $('#btnNext').disabled = false;
    $('#btnReveal').disabled = false;
    $('#btnPlayQ').disabled = false;
    $('#btnPlayA').disabled = false;

    disableRating();
    renderModeUI();
}

function nextCard() {
    if (!state.pool.length) return alert("Bitte Lektionen wählen und übernehmen.");

    if (state.order === 'seq') {
        if (state.idx == null) state.idx = 0;
        else state.idx = (state.idx + 1) % state.pool.length;
        setCard(state.pool[state.idx]);
    } else {
        const e = state.pool[Math.floor(Math.random() * state.pool.length)];
        setCard(e);
    }
}

function prevCard() {
    if (state.order !== 'seq' || !state.pool.length) return;

    if (state.idx == null) state.idx = 0;
    else state.idx = (state.idx - 1 + state.pool.length) % state.pool.length;

    setCard(state.pool[state.idx]);
}

/* -------------------------------------------------------- */
/* FORMATTING                                                */
/* -------------------------------------------------------- */

function formatZh(hz, py) {
    const h = (hz || "").trim();
    const p = (py || "").trim();
    return p ? `${h}\n${p}` : h || "—";
}

function formatPinyinAndPos(py, pos) {
    const a = (py || "").trim();
    const b = (pos || "").trim();
    if (a && b) return `${a}\n${b}`;
    if (a) return a;
    if (b) return b;
    return "";
}

/* -------------------------------------------------------- */
/* REVEAL + RATING                                           */
/* -------------------------------------------------------- */

function doReveal() {
    $('#solBox').classList.remove('masked');

    state.revealedAt = Date.now();
    const ttr = state.revealedAt - (state.startedAt || state.revealedAt);

    if (ttr > 0) {
        state.session.ttrSum += ttr;
        state.session.ttrCount += 1;
    }

    enableRating();
    renderSessionStats();
}

function enableRating() {
    $('#btnRateKnown').disabled = false;
    $('#btnRateUnsure').disabled = false;
    $('#btnRateUnknown').disabled = false;
}
function disableRating() {
    $('#btnRateKnown').disabled = true;
    $('#btnRateUnsure').disabled = true;
    $('#btnRateUnknown').disabled = true;
}

function rate(mark) {
    if (!state.current) return;

    state.session.done += 1;
    if (mark === 'known') state.session.known += 1;
    else if (mark === 'unsure') state.session.unsure += 1;
    else state.session.unknown += 1;

    renderSessionStats();

    // LESSON PROGRESS
    try {
        const lessonKey = state.current.lesson;
        if (lessonKey) {
            if (!state.progress.byLesson[lessonKey])
                state.progress.byLesson[lessonKey] = { known: 0, unknown: 0 };

            if (mark === 'known') state.progress.byLesson[lessonKey].known++;
            else if (mark === 'unknown') state.progress.byLesson[lessonKey].unknown++;

            saveProgress();
            populateLessonSelect();
        }
    } catch (e) {}

    disableRating();
    nextCard();
}

function renderSessionStats() {
    const s = state.session;
    const avg = s.ttrCount ? (s.ttrSum / s.ttrCount / 1000).toFixed(1) : "—";
    const acc = s.done ? Math.round(100 * s.known / s.done) + "%" : "—";

    $('#sessionStats').textContent =
        `Karten: ${s.done}/${s.total} · Korrekt: ${acc} · Ø Aufdeck‑Zeit: ${avg}s`;
}

/* -------------------------------------------------------- */
