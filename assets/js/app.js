/* --------------- Flashcards – CSV Version 6.0.2----------- */
/* -------------------------------------------------------------------------- */
/*                          Flashcards – Vollversion                          */
/*                   CSV-Import + Debug + Vollständige App                    */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/*                          Flashcards – Vollversion                          */
/*              TEIL 1 von 4 — Global State · Settings · CSV Parser          */
/* -------------------------------------------------------------------------- */

const CSV_URL = "./data/Long-Chinesisch_Lektionen.csv";

const LS_KEYS = {
    settings: 'fc_settings_v1',
    progress: 'fc_progress_v1'
};

/* ============================  GLOBAL STATE  =============================== */

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

const $ = sel => document.querySelector(sel);

/* ============================ SETTINGS & PROGRESS ========================= */

function saveSettings() {
    try { localStorage.setItem(LS_KEYS.settings, JSON.stringify(state.settings)); }
    catch (e) {}
}

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(LS_KEYS.settings) || "null");
        if (s) Object.assign(state.settings, s);
    } catch (e) {}
}

function saveProgress() {
    try { localStorage.setItem(LS_KEYS.progress, JSON.stringify(state.progress)); }
    catch (e) {}
}

function loadProgress() {
    try {
        const p = JSON.parse(localStorage.getItem(LS_KEYS.progress) || "null");
        if (p && p.version === 'v1') state.progress = p;
    } catch (e) {}
}

/* ============================ CSV PARSING (robust!) ======================= */

/**
 * Robuster CSV‑Parser für Semikolon‑getrennte Werte.
 * Unterstützt Anführungszeichen und chinesische Zeichen.
 */
function parseCSVLine(line) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];

        if (c === '"') {
            // Doppelte Anführungszeichen → escaped quote
            if (insideQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (c === ';' && !insideQuotes) {
            result.push(current);
            current = "";
        } else {
            current += c;
        }
    }
    result.push(current);
    return result;
}

async function loadCSV() {
    console.log("[CSV] Starte CSV-Ladevorgang…");
    console.log("[CSV] Pfad:", CSV_URL);

    try {
        const res = await fetch(CSV_URL);
        console.log("[CSV] Fetch:", res.status, res.statusText);

        if (!res.ok) {
            console.error("[CSV] Fehler beim Laden!", res.status, res.statusText);
            alert("CSV konnte nicht geladen werden: " + res.statusText);
            return;
        }

        // UTF‑8 erzwingen
        const buf = await res.arrayBuffer();
        const text = new TextDecoder("utf-8").decode(buf);

        console.log("[CSV] Zeichen:", text.length);
        console.log("[CSV] Vorschau:\n" + text.slice(0, 200));

        parseCSV(text);

        console.log("[CSV] Lessons:", [...state.lessons.keys()]);
        populateLessonSelect();
    } catch (err) {
        console.error("[CSV] Fehler:", err);
        alert("CSV konnte nicht geladen werden: " + err.message);
    }
}

function parseCSV(text) {
    console.log("[CSV] parseCSV gestartet…");

    state.lessons.clear();

    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
    console.log("[CSV] Zeilen gesamt:", lines.length);

    if (lines.length <= 1) {
        console.warn("[CSV] Keine Datenzeilen vorhanden.");
        return;
    }

    console.log("[CSV] Header:", lines[0]);

    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        const cols = parseCSVLine(raw);

        if (cols.length < 9) {
            skipped++;
            console.warn(`[CSV] Zeile ${i + 1}: Zu wenige Spalten.`);
            continue;
        }

        // Zeilen ignorieren, die mit * beginnen
        if (cols[0].trim().startsWith("*")) {
            skipped++;
            continue;
        }

        const lessonClean =
            (cols[8] || "")
                .replace(/\uFEFF/g, "")
                .replace(/\r/g, "")
                .replace(/\n/g, "")
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
            lesson: lessonClean
        };

        imported++;

        if (!state.lessons.has(entry.lesson)) {
            state.lessons.set(entry.lesson, []);
        }
        state.lessons.get(entry.lesson).push(entry);
    }

    console.log(`[CSV] Import abgeschlossen: ${imported} geladen, ${skipped} übersprungen.`);
}

/* ============================ LESSON HANDLING ============================= */

function populateLessonSelect() {
    const sel = $('#lessonSelect');
    if (!sel) return;

    sel.innerHTML = "";

    const keys = [...state.lessons.keys()];
    keys.sort((a,b) => a.localeCompare(b, undefined, { numeric:true }));

    for (const k of keys) {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = k;

        if (state.settings.lessons.includes(k))
            opt.selected = true;

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
    renderSessionStats();
}

function gatherPool() {
    const arr = [];
    for (const lesson of state.selectedLessons) {
        const l = state.lessons.get(lesson);
        if (l) arr.push(...l);
    }
    state.pool = arr;
    state.idx = null;
    resetSessionStats();
}

function gatherPoolFromSettings() {
    state.selectedLessons.clear();
    (state.settings.lessons || []).forEach(x => state.selectedLessons.add(x));
    gatherPool();
}

/* -------------------------------------------------------------------------- */
/*                                ENDE TEIL 1                                 */
/* -------------------------------------------------------------------------- */--- */
/* -------------------------------------------------------------------------- */
/*                               TEIL 2 von 4                                 */
/*      Card Rendering · Navigation · Rating · Session Stats · Training       */
/* -------------------------------------------------------------------------- */


/* ============================ CARD RENDERING ============================== */

function setCard(entry) {
    state.current = entry;

    $('#solBox').classList.add('masked');
    state.startedAt = Date.now();
    state.revealedAt = null;

    if (state.mode === 'zh2de') {
        // Frage (ZH → DE)
        $('#promptWord').innerHTML = entry.word.zh || "—";
        $('#promptWordSub').innerHTML = formatPinyinAndPos(entry.word.py, entry.pos);
        $('#promptSent').innerHTML = formatZh(entry.sent.zh, entry.sent.py);

        // Lösung
        $('#solWord').textContent = entry.word.de || "—";
        $('#solSent').textContent = entry.sent.de || "—";

    } else {
        // Frage (DE → ZH)
        $('#promptWord').textContent = entry.word.de || "—";
        $('#promptWordSub').innerHTML = entry.pos || "";
        $('#promptSent').textContent = entry.sent.de || "—";

        // Lösung
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

function nextCard() {
    if (!state.pool.length) return alert("Bitte Lektionen auswählen und übernehmen.");

    if (state.order === 'seq') {
        if (state.idx == null) state.idx = 0;
        else state.idx = (state.idx + 1) % state.pool.length;

        setCard(state.pool[state.idx]);
    } else {
        const random = Math.floor(Math.random() * state.pool.length);
        setCard(state.pool[random]);
    }
}

function prevCard() {
    if (state.order !== 'seq' || !state.pool.length) return;

    if (state.idx == null) state.idx = 0;
    else state.idx = (state.idx - 1 + state.pool.length) % state.pool.length;

    setCard(state.pool[state.idx]);
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

    // Fort­schritt pro Lektion
    const lesson = state.current.lesson;
    if (lesson) {
        if (!state.progress.byLesson[lesson])
            state.progress.byLesson[lesson] = { known: 0, unknown: 0 };

        if (mark === 'known') state.progress.byLesson[lesson].known++;
        if (mark === 'unknown') state.progress.byLesson[lesson].unknown++;

        saveProgress();
        populateLessonSelect();
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

        state.idx = (state.order === 'seq') ? 0 : null;

        if (state.order === 'seq')
            setCard(state.pool[state.idx]);
        else
            setCard(state.pool[Math.floor(Math.random() * state.pool.length)]);

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

