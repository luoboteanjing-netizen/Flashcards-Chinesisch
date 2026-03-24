/* --------------- Flashcards – CSV Version 6.0.1----------- */
/* --------------- Flashcards – CSV Version (mit DEBUG) --------------- */
/* CSV UTF‑8, Semikolon‑Trennung, Header-Zeile, Sternchen-Zeilen ignoriert */
/* Vollständige Version inklusive aller TTS-, UI-, Autoplay-Funktionen    */
/* ---------------------------------------------------------------------- */

const CSV_URL = "./data/Long-Chinesisch_Lektionen.csv";   // ✅ Deine Ordnerstruktur

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
/* CSV IMPORT + DEBUG                                       */
/* -------------------------------------------------------- */

async function loadCSV() {
    console.log("[CSV] Starte CSV‑Ladevorgang…");
    console.log("[CSV] Erwarteter Pfad:", CSV_URL);

    try {
        const res = await fetch(CSV_URL);
        console.log("[CSV] Fetch abgeschlossen. Status:", res.status, res.statusText);

        if (!res.ok) {
            console.error("[CSV] FEHLER: CSV konnte nicht geladen werden!", res.status, res.statusText);
            alert("CSV konnte nicht geladen werden: " + res.statusText);
            return;
        }

        const text = await res.text();

        console.log("[CSV] CSV‑Text empfangen. Zeichen:", text.length);
        console.log("[CSV] Erste 200 Zeichen:\n" + text.slice(0, 200));

        parseCSV(text);

        console.log("[CSV] parseCSV fertig.");
        console.log("[CSV] Gefundene Lektionen:", [...state.lessons.keys()]);

        populateLessonSelect();
        console.log("[CSV] LessonSelect aktualisiert.");

    } catch (e) {
        console.error("[CSV] Fehler beim Laden:", e);
        alert("Fehler beim Laden der CSV: " + e.message);
    }
}

function parseCSV(text) {
    console.log("[CSV] parseCSV gestartet.");

    state.lessons.clear();

    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
    console.log("[CSV] Anzahl nicht‑leerer Zeilen:", lines.length);

    if (lines.length <= 1) {
        console.warn("[CSV] Keine verwertbaren Datenzeilen gefunden!");
        return;
    }

    console.log("[CSV] Header:", lines[0]);

    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        const cols = raw.split(";");

        if (cols.length < 9) {
            skipped++;
            console.warn(`[CSV] Zeile ${i + 1} übersprungen (zu wenige Spalten).`);
            continue;
        }

        // IGNORIERTE ZEILEN (*) in Spalte A
        if (cols[0].trim().startsWith("*")) {
            skipped++;
            console.log(`[CSV] Zeile ${i + 1} ignoriert (Sternchenmarkierung).`);
            continue;
        }

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

        imported++;

        if (!state.lessons.has(entry.lesson)) {
            state.lessons.set(entry.lesson, []);
        }
        state.lessons.get(entry.lesson).push(entry);
    }

    console.log(`[CSV] Import abgeschlossen: ${imported} importiert, ${skipped} übersprungen.`);
    console.log("[CSV] Lektionen:", [...state.lessons.keys()]);
}

/* -------------------------------------------------------- */
/* LESSON SELECT                                             */
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
    (state.settings.lessons || []).forEach(x => state.selectedLessons.add(x));
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
