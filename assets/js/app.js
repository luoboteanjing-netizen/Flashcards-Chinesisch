/* --------------- Flashcards – CSV Version 6.0.4----------- */
/* -------------------------------------------------------------------------- */
/*                          Flashcards – Vollversion                          */
/*              TEIL 1 von 4 — Global State · Settings · CSV Parser          */
/* -------------------------------------------------------------------------- */

const CSV_URL = "./data/Long-Chinesisch_Lektionen.csv";

const LS_KEYS = {
    settings: "fc_settings_v1",
    progress: "fc_progress_v1"
};

/* ============================  GLOBAL STATE  =============================== */

const state = {
    mode: "de2zh",
    order: "seq",   // für Zurück-Button sinnvoller Default

    rateDe: 0.95,
    pitchDe: 1.0,
    rateZh: 0.95,
    pitchZh: 1.0,

    lessons: new Map(),
    lessonOrder: [],         // ✅ Reihenfolge aus CSV gespeichert
    selectedLessons: new Set(),

    pool: [],
    idx: null,history: [],historyPos: -1,
    current: null,

    voices: [],
    browserVoice: { zh: null, de: null },
    voicePanelTarget: "de",

    autoplay: { on: false, timers: [], gapMs: 800 },

    settings: {
        mode: "de2zh",
        order: "seq",
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
        version: "v1",
        cards: {},
        byLesson: {}
    },

    wakeLock: null,
    trainingOn: false
};

const $ = (s) => document.querySelector(s);

/* ============================ SETTINGS / PROGRESS ========================= */

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
        if (p && p.version === "v1") state.progress = p;
    } catch (e) {}
}

/* ============================ CSV PARSING ================================= */

function parseCSVLine(line) {
    const result = [];
    let cur = "";
    let quotes = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];

        if (c === '"') {
            if (quotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                quotes = !quotes;
            }
        } else if (c === ";" && !quotes) {
            result.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }

    result.push(cur);
    return result;
}

async function loadCSV() {
    console.log("[CSV] Lade CSV…");

    try {
        const res = await fetch(CSV_URL);
        if (!res.ok) {
            alert("CSV konnte nicht geladen werden!");
            return;
        }

        const buf = await res.arrayBuffer();
        const text = new TextDecoder("utf-8").decode(buf);

        parseCSV(text);
        populateLessonSelect();
    } catch (e) {
        console.error("[CSV] Fehler:", e);
    }
}

function parseCSV(text) {
    state.lessons.clear();
    state.lessonOrder = [];

    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) return;

    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        const cols = parseCSVLine(raw);

        if (cols.length < 9) continue;
        if (cols[0].trim().startsWith("*")) continue;

        const lesson = (cols[8] || "")
            .replace(/\uFEFF/g, "")
            .trim();

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
            lesson
        };

        if (!state.lessons.has(lesson)) {
            state.lessons.set(lesson, []);
            state.lessonOrder.push(lesson);
        }

        state.lessons.get(lesson).push(entry);
    }

    console.log("[CSV] Lessons:", state.lessonOrder);
}

/* ============================ UNICODE BAR ================================ */
/*   ✅ Funktion war vorher NICHT definiert → jetzt korrekt vorhanden!       */

function makeBar(known, total) {
    if (total <= 0) return "░░░░░░░░░░";

    const full = Math.round((known / total) * 10);
    return "██████████".slice(0, full) + "░░░░░░░░░░".slice(full);
}

/* ============================ LESSON SELECT =============================== */

function populateLessonSelect() {
    const sel = $("#lessonSelect");
    if (!sel) return;

    sel.innerHTML = "";

    const keys = state.lessonOrder;

    for (const k of keys) {
        const opt = document.createElement("option");
        opt.value = k;

        const cards = state.lessons.get(k) || [];
        const count = cards.length;

        const p = state.progress.byLesson[k] || { known: 0, unknown: 0 };
        const known = p.known || 0;

        const bar = makeBar(known, count);

        opt.textContent = `${k} (${count}) ${bar}`;
        if (state.settings.lessons.includes(k)) {
            opt.selected = true;
        }

        sel.appendChild(opt);
    }
}

/* ============================ POOL HANDLING =============================== */

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
    (state.settings.lessons || []).forEach((x) =>
        state.selectedLessons.add(x)
    );
    gatherPool();
}

/* -------------------------------------------------------------------------- */
/*                                ENDE TEIL 1                                 */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/*                               TEIL 2 von 4                                 */
/*      Card Rendering · Navigation · Rating · Session Stats · Training       */
/* -------------------------------------------------------------------------- */


/* ============================ CARD RENDERING ============================== */

function setCard(entry) {

    /* === TITEL & LEKTIONS-INFOS ============================= */

	
	
    const cardTitle = document.querySelector("#cardTitle");
    const cardLesson = document.querySelector("#cardLesson");
    const lessonStats = document.querySelector("#lessonStats");
	
function setCard(entry, fromHistory = false) {

    // 👉 NUR wenn NICHT aus History-Navigation
    if (!fromHistory) {
        pushToHistory(entry);
    }
	
	/* === Zufallsmodus: History aufbauen === */
if (state.order === "random") {

    // Wenn wir normale Navigation machen (nicht "Zurück")
    if (state.historyPos === -1 || entry.id !== state.history[state.historyPos]?.id) {

        // Wenn History voll → erste entfernen
        if (state.history.length >= 10) {
            state.history.shift();
        }

        // Eintrag hinzufügen
        state.history.push(entry);
        state.historyPos = state.history.length - 1;
    }
}
	
	
 	 // Sequenzielle Position aktualisieren (wichtiger Fix!)
    if (state.order === "seq") {
        const pos = state.pool.indexOf(entry);
        if (pos >= 0) {
            state.idx = pos;
    }
}
	
	
    if (cardTitle) {
        cardTitle.textContent = `Karte (ID ${entry.id})`;
    }

    if (cardLesson) {
        cardLesson.textContent = `Lektion ${entry.lesson}`;
    }

    // Statistik: ✅x ❌y für diese Lektion
    if (lessonStats) {
        const ls = state.progress.byLesson[entry.lesson] || { known: 0, unknown: 0 };
        lessonStats.textContent = `✅ ${ls.known || 0}     ❌ ${ls.unknown || 0}`;
    }
	
	    updateNavButtons();
}
	
// Fortschritt-Balken unter dem Titel
if (lessonStats) {
    const cards = state.lessons.get(entry.lesson) || [];
    const total = cards.length;

    const p = state.progress.byLesson[entry.lesson] || { known: 0, unknown: 0 };
    const known = p.known || 0;

    const percent = total > 0 ? Math.round((known / total) * 100) : 0;

    lessonStats.innerHTML = `
        <div class="lesson-bar-large">
            <div class="lesson-bar-large-fill" style="width:${percent}%;"></div>
        </div>
    `;
}

    /* === KARTENINHALT ====================================== */

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

/* ============================ CARD NAVIGATION ============================= */

function pushToHistory(entry) {

    // Wenn wir nicht am Ende sind → Forward-History löschen
    if (state.historyPos < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyPos + 1);
    }

    state.history.push(entry);
    state.historyPos = state.history.length - 1;

    updateNavButtons();
}

function updateNavButtons() {
    $('#btnPrev').disabled = state.historyPos <= 0;
    $('#btnNext').disabled = state.pool.length === 0;
}

function nextCard() {

    if (!state.pool.length) return;

    // 👉 Wenn wir in der History zurückgegangen sind → vorwärts gehen
    if (state.historyPos < state.history.length - 1) {
        state.historyPos++;
        setCard(state.history[state.historyPos], true);
        return;
    }

    // 👉 Normal neue Karte erzeugen
    let next;

    if (state.order === 'seq') {
        if (state.idx == null) state.idx = 0;
        else state.idx = (state.idx + 1) % state.pool.length;

        next = state.pool[state.idx];

    } else {
        next = state.pool[Math.floor(Math.random() * state.pool.length)];
    }

    setCard(next);
}

function prevCard() {

    if (state.historyPos > 0) {
        state.historyPos--;
        setCard(state.history[state.historyPos], true);
    }

    updateNavButtons();
}

/* ============================ FORMATTING ================================= */

function formatZh(hz, py) {
    const h = (hz || "").trim();
    const p = (py || "").trim();
    return p ? `${h}\n${p}` : (h || "—");
}

function formatPinyinAndPos(py, pos) {
    const a = (py || "").trim();
    const b = (pos || "").trim();

    if (a && b) return `${a}\n${b}`;
    if (a) return a;
    if (b) return b;

    return "";
}


/* ============================ REVEAL / RATING ============================= */

function doReveal() {
    $('#solBox').classList.remove('masked');

    state.revealedAt = Date.now();
    const ttr = state.revealedAt - (state.startedAt || state.revealedAt);

    if (ttr > 0) {
        state.session.ttrSum += ttr;
        state.session.ttrCount++;
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

    state.session.done++;
    if (mark === 'known') state.session.known++;
    else if (mark === 'unsure') state.session.unsure++;
    else state.session.unknown++;

    renderSessionStats();

    // Fortschritt pro Lektion
    const lesson = state.current.lesson;

    if (lesson) {
        if (!state.progress.byLesson[lesson]) {
            state.progress.byLesson[lesson] = { known: 0, unknown: 0 };
        }

        if (mark === 'known') state.progress.byLesson[lesson].known++;
        if (mark === 'unknown') state.progress.byLesson[lesson].unknown++;

        saveProgress();
    }

    disableRating();
    nextCard();
}


/* ============================ SESSION STATS =============================== */

function renderSessionStats() {
    const s = state.session;

    const avg = s.ttrCount
        ? (s.ttrSum / s.ttrCount / 1000).toFixed(1)
        : "—";

    const acc = s.done
        ? `${Math.round(100 * s.known / s.done)}%`
        : "—";

    $('#sessionStats').textContent =
        `Karten: ${s.done}/${s.total} · Korrekt: ${acc} · Ø Aufdeck‑Zeit: ${avg}s`;
}


/* ============================ TRAINING FLOW =============================== */

function startTraining() {
    if (!state.trainingOn) {

	// History zurücksetzen
state.history = [];
state.historyPos = -1;

	
        const sel = $('#lessonSelect');
        state.selectedLessons.clear();

        const picked = [];
        for (const opt of sel.selectedOptions) {
            picked.push(opt.value);
            state.selectedLessons.add(opt.value);
        }

        state.settings.lessons = picked;
        saveSettings();

        gatherPool();

        if (!state.pool.length) {
            alert("Bitte zuerst Lektionen auswählen.");
            return;
        }

        // ✅ WICHTIGER FIX: Sequenziellen Index korrekt setzen!
        if (state.order === 'seq') {
            state.idx = 0;
            setCard(state.pool[state.idx]);   // erste Karte zeigen
        } else {
            state.idx = null;                 // Zufall hat keinen Index
            setCard(state.pool[Math.floor(Math.random() * state.pool.length)]);
        }

        state.trainingOn = true;
        updateTrainingBtn();

    } else {
        stopTraining();
    }
}

function stopTraining() {
    state.trainingOn = false;
    updateTrainingBtn();

    $('#btnPrev').disabled = true;
    $('#btnReveal').disabled = true;
    $('#btnNext').disabled = true;
    $('#btnPlayQ').disabled = true;
    $('#btnPlayA').disabled = true;

    disableRating();

    $('#solBox').classList.add('masked');
    $('#promptWord').textContent = "—";
    $('#promptWordSub').innerHTML = " ";
    $('#promptSent').textContent = "—";
    $('#solWord').textContent = "—";
    $('#solSent').textContent = "—";
}

function updateTrainingBtn() {
    $('#btnStart').textContent = state.trainingOn
        ? "Training stoppen ■"
        : "Training starten ▶";
}


/* -------------------------------------------------------------------------- */
/*                                ENDE TEIL 2                                 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                               TEIL 3 von 4                                 */
/*                   TTS · Stimmen · Autoplay · Wake Lock                     */
/* -------------------------------------------------------------------------- */


/* ============================ VOICE TESTING ================================ */

function isZhVoice(v) {
    const L = (v.lang || "").toLowerCase();
    return (
        L.startsWith("zh") ||
        L.includes("cmn") ||
        L.includes("hans") ||
        L.includes("zh-cn")
    );
}

function isDeVoice(v) {
    const L = (v.lang || "").toLowerCase();
    return L.startsWith("de");
}

function updateVoiceList() {
    const box = $('#dbgVoices');
    if (!box) return;

    box.innerHTML = "";

    const list = (state.voices || []).filter(v =>
        state.voicePanelTarget === 'zh' ? isZhVoice(v) : isDeVoice(v)
    );

    if (list.length === 0) {
        box.innerHTML = "<div>Keine passenden Stimmen gefunden.</div>";
        return;
    }

    list.forEach(v => {
        const row = document.createElement("div");
        row.className = "voice";

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = v.name || "(namenlos)";

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${v.lang || ""}${v.default ? " · default" : ""}`;

        const actions = document.createElement("div");
        actions.style.marginLeft = "auto";
        actions.style.display = "flex";
        actions.style.gap = "6px";

        const pick = document.createElement("button");
        pick.className = "btn";
        pick.textContent = "Diese Stimme wählen";

        pick.onclick = () => {
            if (state.voicePanelTarget === "zh") {
                state.browserVoice.zh = v;
                state.settings.browserVoiceZh = v.name || v.voiceURI;
            } else {
                state.browserVoice.de = v;
                state.settings.browserVoiceDe = v.name || v.voiceURI;
            }
            saveSettings();
            updateVoiceList();
        };

        const test = document.createElement("button");
        test.className = "btn ghost";
        test.textContent = "Probehören";
        test.onclick = () => {
            const u = new SpeechSynthesisUtterance(
                state.voicePanelTarget === "zh"
                    ? "这是一个测试。"
                    : "Dies ist ein Test."
            );
            u.lang = state.voicePanelTarget === "zh" ? "zh-CN" : "de-DE";
            u.voice = v;

            try { speechSynthesis.cancel(); } catch (e) {}
            speechSynthesis.speak(u);
        };

        const active =
            state.voicePanelTarget === "zh"
                ? state.browserVoice.zh
                : state.browserVoice.de;

        if (active && (active.name === v.name || active.voiceURI === v.voiceURI))
            name.textContent += " • [Aktiv]";

        actions.appendChild(pick);
        actions.appendChild(test);

        row.appendChild(name);
        row.appendChild(meta);
        row.appendChild(actions);

        box.appendChild(row);
    });
}


function refreshVoices() {
    state.voices = window.speechSynthesis?.getVoices?.() || [];

    if (state.settings.browserVoiceZh) {
        const vz = state.voices.find(
            x =>
                x.name === state.settings.browserVoiceZh ||
                x.voiceURI === state.settings.browserVoiceZh
        );
        if (vz) state.browserVoice.zh = vz;
    }

    if (state.settings.browserVoiceDe) {
        const vd = state.voices.find(
            x =>
                x.name === state.settings.browserVoiceDe ||
                x.voiceURI === state.settings.browserVoiceDe
        );
        if (vd) state.browserVoice.de = vd;
    }

    updateVoiceList();
}


/* ============================ VOICE PANEL ================================= */

let _voicesRetryT = null;

function openVoicesPanelFor(target) {
    state.voicePanelTarget = target;
    refreshVoices();

    if (!state.voices || state.voices.length === 0) {
        clearTimeout(_voicesRetryT);
        let tries = 0;

        const tick = () => {
            tries++;
            refreshVoices();

            if (state.voices.length > 0 || tries >= 10) return;
            _voicesRetryT = setTimeout(tick, 200);
        };

        _voicesRetryT = setTimeout(tick, 200);
    }

    $('#voicePanel').classList.remove('hidden');
}

function closeVoices() {
    $('#voicePanel').classList.add('hidden');
}


/* ============================ TTS BUILDER ================================= */

function ttsPrime(cb) {
    // Workaround: minimal delay, "warms up" speech engine.
    setTimeout(cb, 150);
}

function buildUtterance(text, langKey) {
    const lang = langKey === "zh" ? "zh-CN" : "de-DE";
    const u = new SpeechSynthesisUtterance(text || "");
    u.lang = lang;

    if (langKey === "zh") {
        u.rate = state.rateZh;
        u.pitch = state.pitchZh;
    } else {
        u.rate = state.rateDe;
        u.pitch = state.pitchDe;
    }

    const chosen =
        langKey === "zh" ? state.browserVoice.zh : state.browserVoice.de;

    if (chosen) {
        u.voice = chosen;
    } else {
        const cand = (state.voices || []).filter(v =>
            (v.lang || "").toLowerCase().startsWith(langKey)
        );
        u.voice = cand.find(v => v.default) || cand[0] || null;
    }

    return u;
}


/* ============================ NATIVE MANDARIN PACK ======================== */

const VOICE_PACK = {
    female1: "zh-CN-XiaoxiaoNeural",
    female2: "zh-CN-XiaochenNeural",
    male1: "zh-CN-YunxiNeural",
    male2: "zh-CN-YunyangNeural"
};

let NATIVE_TTS_ENDPOINT = "";       // Wenn leer → fallback auf Browser TTS
let nativeVoiceChoice = "female1";
const nativeAudioCache = new Map();

async function nativeMandarinSpeak(text) {
    if (!text) return;

    // Kein Server definiert → Browser TTS verwenden
    if (!NATIVE_TTS_ENDPOINT) {
        const u = buildUtterance(text, "zh");
        speechSynthesis.speak(u);
        return;
    }

    const cacheKey = nativeVoiceChoice + "\n" + text;
    if (nativeAudioCache.has(cacheKey)) {
        const audio = new Audio(nativeAudioCache.get(cacheKey));
        audio.play();
        return;
    }

    try {
        const res = await fetch(NATIVE_TTS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: text,
                voice: VOICE_PACK[nativeVoiceChoice]
            })
        });

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        nativeAudioCache.set(cacheKey, url);

        const audio = new Audio(url);
        audio.play();

    } catch (e) {
        const u = buildUtterance(text, "zh");
        speechSynthesis.speak(u);
    }
}


/* ============================ TTS PLAYBACK ================================ */

function ttsSpeak(text, langKey) {
    const u = buildUtterance(text, langKey);
    speechSynthesis.speak(u);
    return u;
}

function playSequence(firstText, firstLangKey, secondText, secondLangKey) {
    ttsPrime(() => {
        try { speechSynthesis.cancel(); } catch (e) {}

        ttsSpeak(firstText, firstLangKey);

        setTimeout(() => {
            ttsSpeak(secondText, secondLangKey);
        }, 800);
    });
}

function playQuestion() {
    if (!state.current) return;

    if (state.mode === "de2zh") {
        playSequence(
            state.current.word.de,
            "de",
            state.current.sent.de,
            "de"
        );
    } else {
        nativeMandarinSpeak(state.current.word.zh);
        setTimeout(
            () => nativeMandarinSpeak(state.current.sent.zh),
            700
        );
    }
}

function playAnswer() {
    if (!state.current) return;

    if (state.mode === "de2zh") {
        nativeMandarinSpeak(state.current.word.zh);
        setTimeout(
            () => nativeMandarinSpeak(state.current.sent.zh),
            700
        );
    } else {
        playSequence(
            state.current.word.de,
            "de",
            state.current.sent.de,
            "de"
        );
    }
}


/* ============================ AUTOPLAY =================================== */

function setAutoplay(on) {
    state.autoplay.on = on;

    if (!on) {
        try { speechSynthesis.cancel(); } catch (e) {}

        state.autoplay.timers.forEach(id => clearTimeout(id));
        state.autoplay.timers = [];

        releaseWakeLock();
    }

    updateAutoplayBtn();
}

function updateAutoplayBtn() {
    const b = $('#btnAutoplay');
    if (!b) return;

    b.textContent = state.autoplay.on
        ? "Autoplay ■ Stop"
        : "Autoplay ▶︎";
}

function speakPair(word, sent, langKey, done) {
    if (!state.autoplay.on) return;

    const u1 = buildUtterance(word, langKey);

    u1.onend = () => {
        if (!state.autoplay.on) return;

        const t = setTimeout(() => {
            if (!state.autoplay.on) return;

            const u2 = buildUtterance(sent, langKey);
            u2.onend = () => {
                if (!state.autoplay.on) return;
                done && done();
            };

            speechSynthesis.speak(u2);
        }, 800);

        state.autoplay.timers.push(t);
    };

    speechSynthesis.speak(u1);
}

function ensurePoolForAutoplay() {
    if (state.pool.length > 0) return true;

    if (!state.settings.lessons || state.settings.lessons.length === 0) {
        const sel = $('#lessonSelect');
        const picked = [];

        for (const o of sel?.selectedOptions || []) picked.push(o.value);

        if (picked.length > 0) {
            state.settings.lessons = picked;
            saveSettings();
        }
    }

    gatherPoolFromSettings();

    if (!state.pool.length) {
        alert("Bitte Lektionen wählen, bevor Autoplay startet.");
        return false;
    }

    if (state.order === "seq") {
        state.idx = 0;
        setCard(state.pool[state.idx]);
    } else {
        setCard(state.pool[Math.floor(Math.random() * state.pool.length)]);
    }

    return true;
}

function autoplayStep() {
    if (!state.autoplay.on) return;
    if (!ensurePoolForAutoplay()) {
        setAutoplay(false);
        return;
    }

    $('#solBox').classList.add('masked');
    disableRating();

    const qLang = state.mode === "de2zh" ? "de" : "zh";
    const aLang = state.mode === "de2zh" ? "zh" : "de";

    ttsPrime(() => {
        try { speechSynthesis.cancel(); } catch (e) {}

        speakPair(
            state.current.word[qLang],
            state.current.sent[qLang],
            qLang,
            () => {
                if (!state.autoplay.on) return;

                $('#solBox').classList.remove('masked');

                speakPair(
                    state.current.word[aLang],
                    state.current.sent[aLang],
                    aLang,
                    () => {
                        if (!state.autoplay.on) return;

                        const t = setTimeout(() => {
                            if (!state.autoplay.on) return;

                            if (state.order === "seq") {
                                if (state.idx == null) state.idx = 0;
                                else state.idx = (state.idx + 1) % state.pool.length;

                                setCard(state.pool[state.idx]);
                            } else {
                                setCard(
                                    state.pool[Math.floor(Math.random() * state.pool.length)]
                                );
                            }

                            autoplayStep();

                        }, state.autoplay.gapMs);

                        state.autoplay.timers.push(t);
                    }
                );
            }
        );
    });
}

function toggleAutoplay() {
    if (!state.autoplay.on) {
        if (!ensurePoolForAutoplay()) return;

        setAutoplay(true);
        requestWakeLock();

        setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }, 60);

        autoplayStep();

    } else {
        setAutoplay(false);
    }
}


/* ============================ WAKE LOCK ================================== */

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator && !state.wakeLock) {
            state.wakeLock = await navigator.wakeLock.request("screen");

            state.wakeLock.addEventListener?.("release", () => {
                state.wakeLock = null;
            });

            document.addEventListener("visibilitychange", onVisibilityChange, {
                passive: true
            });
        }
    } catch (e) {}
}

function onVisibilityChange() {
    if (
        document.visibilityState === "visible" &&
        state.autoplay.on &&
        !state.wakeLock
    ) {
        requestWakeLock();
    }
}

function releaseWakeLock() {
    try {
        if (state.wakeLock) state.wakeLock.release?.();
    } catch (e) {}

    state.wakeLock = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
}


/* ============================ AUTOPLAY SAFETY ============================ */

function stopAutoplayOnUserAction() {
    if (state.autoplay.on) setAutoplay(false);
}


/* -------------------------------------------------------------------------- */
/*                                ENDE TEIL 3                                 */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/*                               TEIL 4 von 4                                 */
/*                 Event Listener · Mode Switch · Init Routine                */
/* -------------------------------------------------------------------------- */


/* ============================ MODE + UI ================================== */

function renderModeUI() {
    const left = $('#modeLeft');
    const right = $('#modeRight');

    if (!left || !right) return;

    if (state.mode === 'de2zh') {
        left.textContent = "🇩🇪 DE";
        right.textContent = "🇨🇳 ZH";
    } else {
        left.textContent = "🇨🇳 ZH";
        right.textContent = "🇩🇪 DE";
    }

    $('#btnOrderToggle').textContent =
        "Reihenfolge: " + (state.order === 'seq' ? "Sequenziell" : "Zufällig");

    updateTrainingBtn();
}


/* ============================ DOM INIT =================================== */

window.addEventListener("DOMContentLoaded", () => {
    console.log("[INIT] DOM geladen – Initialisierung startet…");

    loadSettings();
    loadProgress();

    state.mode = state.settings.mode || 'de2zh';
    state.order = state.settings.order || 'random';

    state.autoplay.gapMs =
        typeof state.settings.autoplayGap === 'number'
            ? state.settings.autoplayGap
            : 800;

    state.rateDe = state.settings.rateDe;
    state.pitchDe = state.settings.pitchDe;
    state.rateZh = state.settings.rateZh;
    state.pitchZh = state.settings.pitchZh;

    renderModeUI();

    console.log("[INIT] CSV-Import wird gestartet…");
    loadCSV();

/* === Autoplay-Button neben Training-Button platzieren — stabile Version === */

(function placeAutoplayButton() {
    const trainingBtn = document.querySelector("#btnStart");
    const autoplayBtn = document.querySelector("#btnAutoplay");

    if (!trainingBtn || !autoplayBtn) {
        console.warn("[UI] Training oder Autoplay Button nicht gefunden.");
        return;
    }

    const parent = trainingBtn.parentNode;

    // Prüfen, ob Gruppe existiert
    let group = parent.querySelector(".training-group");

    if (!group) {
        // Neue Flex-Gruppe erstellen
        group = document.createElement("div");
        group.className = "training-group";

        // Training-Button in Gruppe verschieben
        parent.insertBefore(group, trainingBtn);
        group.appendChild(trainingBtn);
    }

    // Autoplay-Button in die Gruppe einfügen
    group.appendChild(autoplayBtn);

    // 🎨 Autoplay soll genauso aussehen wie Training-Button
    autoplayBtn.classList.add("primary");

    console.log("[UI] Autoplay-Button stabil neben Training-Button platziert.");
})();

    /* ============================ BUTTON EVENTS =========================== */

    // Richtungswechsel
    $('#btnSwapMode').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        state.mode = state.mode === 'de2zh' ? 'zh2de' : 'de2zh';
        state.settings.mode = state.mode;
        saveSettings();
        renderModeUI();
        if (state.current) setCard(state.current);
    });

    // Reihenfolge
    $('#btnOrderToggle').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        state.order = state.order === "random" ? "seq" : "random";
        state.settings.order = state.order;
        saveSettings();
        renderModeUI();
    });

    // Autoplay
    $('#btnAutoplay').addEventListener("click", () => {
        toggleAutoplay();
    });

    // Gap Slider
    $('#gapRange').addEventListener("input", e => {
        const s = parseFloat(e.target.value) || 0.8;
        state.autoplay.gapMs = Math.round(s * 1000);
        state.settings.autoplayGap = state.autoplay.gapMs;
        $('#gapVal').textContent = `(${s.toFixed(1)} s)`;
        saveSettings();
    });

    /* ---- Voice Controls ---- */

    $('#btnVoiceDe').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        openVoicesPanelFor("de");
    });
    $('#btnVoiceZh').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        openVoicesPanelFor("zh");
    });
    $('#btnCloseVoices').addEventListener("click", closeVoices);

    // Rate / Pitch German
    $('#rateDeRange').addEventListener("input", e => {
        stopAutoplayOnUserAction();
        state.rateDe = parseFloat(e.target.value);
        state.settings.rateDe = state.rateDe;
        $('#rateDeVal').textContent = `(${state.rateDe.toFixed(2)})`;
        saveSettings();
    });
    $('#pitchDeRange').addEventListener("input", e => {
        stopAutoplayOnUserAction();
        state.pitchDe = parseFloat(e.target.value);
        state.settings.pitchDe = state.pitchDe;
        $('#pitchDeVal').textContent = `(${state.pitchDe.toFixed(2)})`;
        saveSettings();
    });

    // Rate / Pitch Chinese
    $('#rateZhRange').addEventListener("input", e => {
        stopAutoplayOnUserAction();
        state.rateZh = parseFloat(e.target.value);
        state.settings.rateZh = state.rateZh;
        $('#rateZhVal').textContent = `(${state.rateZh.toFixed(2)})`;
        saveSettings();
    });
    $('#pitchZhRange').addEventListener("input", e => {
        stopAutoplayOnUserAction();
        state.pitchZh = parseFloat(e.target.value);
        state.settings.pitchZh = state.pitchZh;
        $('#pitchZhVal').textContent = `(${state.pitchZh.toFixed(2)})`;
        saveSettings();
    });


    /* ---- Training ---- */

    $('#btnStart').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        startTraining();
    });

    $('#btnNext').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        nextCard();
    });

    $('#btnPrev').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        prevCard();
    });

    $('#btnReveal').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        doReveal();
    });

    $('#btnPlayQ').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        playQuestion();
    });

    $('#btnPlayA').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        playAnswer();
    });


    /* ---- Rating ---- */

    $('#btnRateKnown').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        rate("known");
    });
    $('#btnRateUnsure').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        rate("unsure");
    });
    $('#btnRateUnknown').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        rate("unknown");
    });


    /* ---- Lessons ---- */

    $('#btnUseLessons').addEventListener("click", () => {
        stopAutoplayOnUserAction();

        const sel = $('#lessonSelect');
        const picked = [];

        for (const o of sel.selectedOptions) picked.push(o.value);

        state.settings.lessons = picked;
        saveSettings();
        gatherPoolFromSettings();
    });

    $('#btnClearLessons').addEventListener("click", () => {
        stopAutoplayOnUserAction();

        state.selectedLessons.clear();
        state.settings.lessons = [];
        saveSettings();

        state.pool = [];
        state.idx = null;
        resetSessionStats();

        const sel = $('#lessonSelect');
        for (const o of sel.options) o.selected = false;

        if (state.trainingOn) stopTraining();
    });


    /* ---- Export / Import ---- */

    $('#btnExport').addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(state.progress, null, 2)], {
            type: "application/json"
        });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "progress.json";
        a.click();

        setTimeout(() => URL.revokeObjectURL(a.href), 600);
    });

    $('#fileImport').addEventListener("change", e => {
        stopAutoplayOnUserAction();

        const f = e.target.files?.[0];
        if (!f) return;

        const r = new FileReader();
        r.onload = () => {
            try {
                const p = JSON.parse(r.result);
                if (p && p.version === "v1") {
                    state.progress = p;
                    saveProgress();
                    populateLessonSelect();
                    alert("Fortschritt importiert.");
                } else {
                    alert("Ungültiges Format.");
                }
            } catch (err) {
                alert("Import fehlgeschlagen: " + err.message);
            }
        };

        r.readAsText(f);
        e.target.value = "";
    });

    console.log("[INIT] Alle Event Listener aktiviert. App bereit.");
});


/* -------------------------------------------------------------------------- */
/*                             ENDE TEIL 4 (FINAL)                             */
/* -------------------------------------------------------------------------- */

