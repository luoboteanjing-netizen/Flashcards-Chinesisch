/* --------------- Flashcards – CSV Version 6.0.5----------- */
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
    lessonOrder: [],         
    selectedLessons: new Set(),

    pool: [],
    idx: null,
    history: [],
    historyPos: -1,
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

        const lesson = (cols[8] || "").replace(/\uFEFF/g, "").trim();

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
        const total = cards.length;

        const p = state.progress.byLesson[k] || { known: 0, unknown: 0 };
        const known = p.known || 0;
        const unknown = p.unknown || 0;

        // Prozentzahl ermitteln
        const percent = total > 0 ? Math.round((known / total) * 100) : 0;

        // ✅ EXAKT DEINE FORMATVORGABE
        opt.textContent =
            `${k} (${total}) · 🟩 ${known}  🟥 ${unknown}  (${percent}%)`;

        // Vorauswahl aus Settings
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
    (state.settings.lessons || []).forEach((x) => state.selectedLessons.add(x));
    gatherPool();
}

/* -------------------------------------------------------------------------- */
/*                                ENDE TEIL 1                                 */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- *
/* -------------------------------------------------------------------------- */
/*                               TEIL 2 von 4                                 */
/*      Card Rendering · Navigation · Rating · Session Stats · Training       */
/* -------------------------------------------------------------------------- */


/* ============================ MODE UI RENDERING =========================== */

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
}


/* ============================ CARD RENDERING ============================== */

function setCard(entry, fromHistory = false) {

    if (!fromHistory) pushToHistory(entry);

    const lessonStats = document.querySelector("#lessonStats");

    // Sequenzposition aktualisieren
    if (state.order === "seq") {
        const pos = state.pool.indexOf(entry);
        if (pos >= 0) state.idx = pos;
    }

    /* ✅ Zweifarbiger Fortschrittsbalken */
    if (lessonStats) {
        const cards = state.lessons.get(entry.lesson) || [];
        const total = cards.length;

        const p = state.progress.byLesson[entry.lesson] || { known: 0, unknown: 0 };
        const known = p.known || 0;
        const unknown = p.unknown || 0;

        const greenPct = total > 0 ? (known / total) * 100 : 0;
        const redPct   = total > 0 ? (unknown / total) * 100 : 0;

        lessonStats.innerHTML = `
            <div class="lesson-bar-large">
                <div class="lesson-bar-red" style="width:${redPct}%"></div>
                <div class="lesson-bar-green" style="left:${redPct}%; width:${greenPct}%"></div>
            </div>
        `;
    }

    /* ===== Karteninhalt setzen ===== */

    state.current = entry;

    $('#solBox').classList.add('masked');

    state.startedAt = Date.now();
    state.revealedAt = null;

    if (state.mode === 'zh2de') {

        $('#promptWord').innerHTML = entry.word.zh || "—";
        $('#promptWordSub').innerHTML = entry.word.py || "";
        $('#promptPOS').textContent = entry.pos || "";

        $('#promptSent').innerHTML =
            `${entry.sent.zh}<br><span class="zh-pinyin">${entry.sent.py}</span>`;

        $('#solWord').textContent = entry.word.de || "—";
        $('#solSent').textContent = entry.sent.de || "—";

    } else {

        $('#promptWord').textContent = entry.word.de || "—";
        $('#promptWordSub').innerHTML = entry.word.py || "";
        $('#promptPOS').textContent = entry.pos || "";

        $('#promptSent').textContent = entry.sent.de || "—";

        $('#solWord').innerHTML = formatZh(entry.word.zh, entry.word.py);
        $('#solSent').innerHTML = formatZh(entry.sent.zh, entry.sent.py);
    }

    /* === Buttons initial === */

    $('#btnReveal').disabled = false;          // ✅ Aufdecken-Button AKTIVIEREN!
    hideRatingButtons();
    showNavButtons();
    updateNavButtons();

    syncCardHeights();
}


/* ============================ CARD NAVIGATION ============================= */

function pushToHistory(entry) {

    if (state.historyPos < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyPos + 1);
    }

    state.history.push(entry);
    state.historyPos = state.history.length - 1;
}

function updateNavButtons() {
    $('#btnPrev').disabled = state.historyPos <= 0;
    $('#btnNext').disabled = !state.pool.length;
}

function nextCard() {

    if (!state.pool.length) return;

    // In der History weiter
    if (state.historyPos < state.history.length - 1) {
        state.historyPos++;
        setCard(state.history[state.historyPos], true);
        return;
    }

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
}


/* ============================ FORMATTING ================================= */

function formatZh(hz, py) {
    const h = (hz || "").trim();
    const p = (py || "").trim();
    return p ? `${h}<br>${p}` : (h || "—");
}


/* ============================ REVEAL / RATING ============================= */

function doReveal() {

    $('#solBox').classList.remove('masked');

    state.revealedAt = Date.now();

    hideNavButtons();
    showRatingButtons();

    enableRating();
    syncCardHeights();
}

function enableRating() {
    $('#btnRateKnown').disabled = false;
    $('#btnRateUnknown').disabled = false;
    $('#btnRateUnsure').disabled = false;
}

function disableRating() {
    $('#btnRateKnown').disabled = true;
    $('#btnRateUnknown').disabled = true;
    $('#btnRateUnsure').disabled = true;
}

function showRatingButtons() {
    document.getElementById('ratingButtons').classList.add('visible');
}

function hideRatingButtons() {
    document.getElementById('ratingButtons').classList.remove('visible');
}

function hideNavButtons() {
    $('#btnPrev').style.display = 'none';
    $('#btnReveal').style.display = 'none';
    $('#btnNext').style.display = 'none';
}

function showNavButtons() {
    $('#btnPrev').style.display = '';
    $('#btnReveal').style.display = '';
    $('#btnNext').style.display = '';
}

function rate(mark) {

    if (!state.current) return;

    // Statistik
    state.session.done++;

    if (mark === 'known') state.session.known++;
    else if (mark === 'unknown') state.session.unknown++;
    else if (mark === 'unsure') state.session.unsure++;

    // Fortschritt speichern (nur bei known/unknown)
    const lesson = state.current.lesson;

    if (lesson) {

        if (!state.progress.byLesson[lesson])
            state.progress.byLesson[lesson] = { known: 0, unknown: 0 };

        if (mark === "known")   state.progress.byLesson[lesson].known++;
        if (mark === "unknown") state.progress.byLesson[lesson].unknown++;

        saveProgress();
    }

    // UI wiederherstellen
    hideRatingButtons();
    showNavButtons();
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
        `Karten: ${s.done}/${s.total} · Richtig: ${acc} · Ø ${avg}s`;
}


/* ============================ TRAINING FLOW =============================== */

function startTraining() {

    if (!state.trainingOn) {

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

        if (state.order === 'seq') {
            state.idx = 0;
            setCard(state.pool[state.idx]);
        } else {
            const r = state.pool[Math.floor(Math.random() * state.pool.length)];
            setCard(r);
        }

        state.trainingOn = true;
        scrollToBottom();

    } else {
        stopTraining();
    }
}

function stopTraining() {

    state.trainingOn = false;

    $('#btnPrev').disabled = true;
    $('#btnReveal').disabled = true;
    $('#btnNext').disabled = true;

    hideRatingButtons();
    disableRating();

    $('#solBox').classList.add('masked');
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


/* ============================ APPLY SAVED VOICES =========================== */

function applySavedVoices() {

    // ZH Stimme wiederherstellen
    if (state.settings.browserVoiceZh) {
        const vz = state.voices.find(v =>
            v.name === state.settings.browserVoiceZh ||
            v.voiceURI === state.settings.browserVoiceZh
        );
        if (vz) state.browserVoice.zh = vz;
    }

    // DE Stimme wiederherstellen
    if (state.settings.browserVoiceDe) {
        const vd = state.voices.find(v =>
            v.name === state.settings.browserVoiceDe ||
            v.voiceURI === state.settings.browserVoiceDe
        );
        if (vd) state.browserVoice.de = vd;
    }
}


/* ============================ UPDATE VOICE LIST ============================ */

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

        /* ✅ Stimme wird SOFORT gespeichert */
        pick.onclick = () => {
            if (state.voicePanelTarget === "zh") {
                state.browserVoice.zh = v;
                state.settings.browserVoiceZh = v.name || v.voiceURI;
            } else {
                state.browserVoice.de = v;
                state.settings.browserVoiceDe = v.name || v.voiceURI;
            }

            saveSettings();
            closeVoices();      // ✅ Panel automatisch schließen
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

        if (active && (active.name === v.name || active.voiceURI === v.voiceURI)) {
            name.textContent += " • [Aktiv]";
        }

        actions.appendChild(pick);
        actions.appendChild(test);

        row.appendChild(name);
        row.appendChild(meta);
        row.appendChild(actions);

        box.appendChild(row);
    });
}


/* ============================ REFRESH VOICES =============================== */

function refreshVoices() {
    state.voices = window.speechSynthesis?.getVoices?.() || [];

    /* ✅ automatisch gespeicherte Stimme setzen */
    applySavedVoices();

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


/* ============================ TTS BUILDERS ================================ */

function ttsPrime(cb) {
    setTimeout(cb, 150);
}

function buildUtterance(text, langKey) {

    const lang = langKey === "zh" ? "zh-CN" : "de-DE";
    const u = new SpeechSynthesisUtterance(text || "");

    u.lang = lang;

    // ✅ Pitch & Speed automatisch übernommen (persistente Settings)
    if (langKey === "zh") {
        u.rate = state.rateZh;
        u.pitch = state.pitchZh;
    } else {
        u.rate = state.rateDe;
        u.pitch = state.pitchDe;
    }

    // ✅ gewählte Stimme verwenden
    const chosen =
        langKey === "zh" ? state.browserVoice.zh : state.browserVoice.de;

    if (chosen) {
        u.voice = chosen;
    } else {
        // fallback
        const cand = (state.voices || []).filter(v =>
            (v.lang || "").toLowerCase().startsWith(langKey)
        );
        u.voice = cand.find(v => v.default) || cand[0] || null;
    }

    return u;
}


/* ============================ NATIVE MANDARIN ============================= */

const VOICE_PACK = {
    female1: "zh-CN-XiaoxiaoNeural",
    female2: "zh-CN-XiaochenNeural",
    male1: "zh-CN-YunxiNeural",
    male2: "zh-CN-YunyangNeural"
};

let NATIVE_TTS_ENDPOINT = "";
let nativeVoiceChoice = "female1";
const nativeAudioCache = new Map();

async function nativeMandarinSpeak(text) {

    if (!text) return;

    if (!NATIVE_TTS_ENDPOINT) {
        const u = buildUtterance(text, "zh");
        speechSynthesis.speak(u);
        return;
    }

    const cacheKey = nativeVoiceChoice + "\n" + text;

    if (nativeAudioCache.has(cacheKey)) {
        new Audio(nativeAudioCache.get(cacheKey)).play();
        return;
    }

    try {
        const res = await fetch(NATIVE_TTS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text,
                voice: VOICE_PACK[nativeVoiceChoice]
            })
        });

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        nativeAudioCache.set(cacheKey, url);
        new Audio(url).play();

    } catch (e) {
        // fallback → Browser TTS
        speechSynthesis.speak(buildUtterance(text, "zh"));
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
        setTimeout(() => nativeMandarinSpeak(state.current.sent.zh), 700);
    }
}

function playAnswer() {
    if (!state.current) return;

    if (state.mode === "de2zh") {
        nativeMandarinSpeak(state.current.word.zh);
        setTimeout(() => nativeMandarinSpeak(state.current.sent.zh), 700);
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

        scrollToBottom();

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

window.addEventListener("DOMContentLoaded", () => {

    /* ============================ SETTINGS LADEN =========================== */

    loadSettings();
    loadProgress();
    loadCSV();

    state.mode = state.settings.mode || "de2zh";
    state.order = state.settings.order || "random";

    renderModeUI();


    /* ======================== AUTOPLAY-BUTTON REPOSITION =================== */

    (function placeAutoplayButton() {
        const trainingBtn = document.querySelector("#btnStart");
        const autoplayBtn = document.querySelector("#btnAutoplay");

        if (!trainingBtn || !autoplayBtn) return;

        const parent = trainingBtn.parentNode;

        // Gruppe erzeugen falls nicht vorhanden
        let group = parent.querySelector(".training-group");

        if (!group) {
            group = document.createElement("div");
            group.className = "training-group";

            // Training rein
            parent.insertBefore(group, trainingBtn);
            group.appendChild(trainingBtn);
        }

        // Autoplay rein
        group.appendChild(autoplayBtn);

        autoplayBtn.classList.add("primary");
    })();


    /* ============================== BUTTON EVENTS =========================== */

    // Modus wechseln
    $('#btnSwapMode').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        state.mode = state.mode === "de2zh" ? "zh2de" : "de2zh";
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
    $('#btnAutoplay').addEventListener("click", toggleAutoplay);

    // Pause zwischen Karten
    $('#gapRange').addEventListener("input", e => {
        const s = parseFloat(e.target.value) || 0.8;
        state.autoplay.gapMs = Math.round(s * 1000);
        state.settings.autoplayGap = state.autoplay.gapMs;
        $('#gapVal').textContent = `(${s}s)`;
        saveSettings();
    });


    /* ============================== SPEAKER ================================ */

    $('#speakerQuestion').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        playQuestion();
    });

    $('#speakerAnswer').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        playAnswer();
    });


    /* ============================== TRAINING =============================== */

    $('#btnStart').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        startTraining();
        updateTrainingBtn();
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


    /* ============================== RATING ================================= */

    $('#btnRateKnown').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        rate("known");
    });

    $('#btnRateUnknown').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        rate("unknown");
    });

    $('#btnRateUnsure').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        rate("unsure");
    });


    /* ============================= LEKTIONEN =============================== */

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


    /* =========================== IMPORT / EXPORT =========================== */

    $('#btnExport').addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(state.progress, null, 2)], {
            type: "application/json"
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "progress.json";
        a.click();
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
                alert("Import Fehler: " + err.message);
            }
        };

        r.readAsText(f);
    });

});
/* -------------------------------------------------------------------------- */
/*                             ENDE TEIL 4 (FINAL)                             */
/* -------------------------------------------------------------------------- */