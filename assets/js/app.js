/* ========================================================================== */
/*                           FLASHCARDS – VERSION 7.0                         */
/*   Korrigierte Komplettversion – Training ✅ Autoplay ✅ Scroll ✅ Pinyin ✅ */
/* ========================================================================== */


/* ========================================================================== */
/*                               TEIL 1 VON 4                                 */
/*          GLOBAL STATE · SETTINGS · PROGRESS · CSV PARSING                  */
/* ========================================================================== */

const CSV_URL = "./data/Long-Chinesisch_Lektionen.csv";

const LS_KEYS = {
    settings: "fc_settings_v1",
    progress: "fc_progress_v1"
};

const state = {
    mode: "de2zh",
    order: "seq",
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

    autoplay: {
        on: false,
        timers: [],
        gapMs: 800
    },

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


/* ======================= SETTINGS & PROGRESS ======================= */

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


/* =========================== CSV PARSING =========================== */

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
    try {
        const res = await fetch(CSV_URL);
        const buf = await res.arrayBuffer();
        const text = new TextDecoder("utf-8").decode(buf);

        parseCSV(text);
        populateLessonSelect();
    } catch (e) {
        alert("CSV konnte nicht geladen werden!");
        console.error(e);
    }
}

function parseCSV(text) {
    state.lessons.clear();
    state.lessonOrder = [];

    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length < 2) return;

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 9) continue;

        const lesson = (cols[8] || "").trim();
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
}

function populateLessonSelect() {
    const sel = $("#lessonSelect");
    if (!sel) return;

    sel.innerHTML = "";
    for (const k of state.lessonOrder) {
        const opt = document.createElement("option");
        opt.value = k;

        const cards = state.lessons.get(k) || [];
        const total = cards.length;
        const p = state.progress.byLesson[k] || { known: 0, unknown: 0 };
        const known = p.known || 0;
        const unknown = p.unknown || 0;

        const pct = total > 0 ? Math.round((known / total) * 100) : 0;

        opt.textContent = `${k} (${total}) · 🟩 ${known} 🟥 ${unknown} (${pct}%)`;

        if (state.settings.lessons.includes(k)) opt.selected = true;

        sel.appendChild(opt);
    }
}


/* ========================================================================== */
/*                               TEIL 2 VON 4                                 */
/*         CARD RENDERING · NAVIGATION · RATING · TRAINING FLOW               */
/* ========================================================================== */


function renderModeUI() {
    const left = $('#modeLeft');
    const right = $('#modeRight');
    if (!left || !right) return;

    if (state.mode === "de2zh") {
        left.textContent = "🇩🇪 DE";
        right.textContent = "🇨🇳 ZH";
    } else {
        left.textContent = "🇨🇳 ZH";
        right.textContent = "🇩🇪 DE";
    }

    $('#btnOrderToggle').textContent =
        "Reihenfolge: " + (state.order === "seq" ? "Sequenziell" : "Zufällig");
}


/* ------------------------ HILFSFUNKTIONEN ------------------------ */

function scrollToBottom() {
    setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }, 30);
}

function syncCardHeights() {
    const q = document.querySelector("#promptBox");
    const a = document.querySelector("#solBox");
    if (!q || !a) return;

    q.style.minHeight = "";
    a.style.minHeight = "";

    const h = Math.max(q.offsetHeight, a.offsetHeight);
    q.style.minHeight = h + "px";
    a.style.minHeight = h + "px";
}


/* ------------------------ KARTEN-RENDERING ------------------------ */

function setCard(entry, fromHistory = false) {

    if (!fromHistory) pushToHistory(entry);

    const lessonStats = $("#lessonStats");

    if (state.order === "seq") {
        state.idx = state.pool.indexOf(entry);
    }

    /* Fortschrittsbalken */
    const cards = state.lessons.get(entry.lesson) || [];
    const total = cards.length;
    const prog = state.progress.byLesson[entry.lesson] || { known: 0, unknown: 0 };
    const known = prog.known || 0;
    const unknown = prog.unknown || 0;
    const greenPct = total > 0 ? (known / total) * 100 : 0;
    const redPct = total > 0 ? (unknown / total) * 100 : 0;

    lessonStats.innerHTML = `
        <div class="lesson-bar-large">
            <div class="lesson-bar-red" style="width:${redPct}%"></div>
            <div class="lesson-bar-green" style="left:${redPct}%; width:${greenPct}%"></div>
        </div>
    `;

    /* Karteninhalt */

    state.current = entry;
    $("#solBox").classList.add("masked");

    if (state.mode === "zh2de") {
        $("#promptWord").innerHTML = entry.word.zh;
        $("#promptWordSub").innerHTML = entry.word.py
            ? `<span class="pinyin-word">${entry.word.py}</span>`
            : "";
        $("#promptPOS").textContent = entry.pos;

        $("#promptSent").innerHTML =
            `${entry.sent.zh}<br><span class="zh-pinyin">${entry.sent.py}</span>`;

        $("#solWord").textContent = entry.word.de;
        $("#solSent").textContent = entry.sent.de;

    } else {
        $("#promptWord").textContent = entry.word.de;
        $("#promptWordSub").innerHTML = "";
        $("#promptPOS").textContent = entry.pos;
        $("#promptSent").textContent = entry.sent.de;

        $("#solWord").innerHTML =
            `${entry.word.zh}<br><span class="zh-pinyin">${entry.word.py}</span>`;
        $("#solSent").innerHTML =
            `${entry.sent.zh}<br><span class="zh-pinyin">${entry.sent.py}</span>`;
    }

    /* Buttons */
    $("#btnReveal").disabled = false;
    hideRatingButtons();
    showNavButtons();
    updateNavButtons();

    syncCardHeights();
}

/* ---Ende Teil 1+2----------- */

/* -------------------------------------------------------------------------- */
/*                               TEIL 3 von 4                                 */
/*                   TTS · Stimmen · Autoplay · Wake Lock                     */
/* -------------------------------------------------------------------------- */

/* ============================ VOICE FILTER ================================ */

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

    if (state.settings.browserVoiceZh) {
        const vz = state.voices.find(v =>
            v.name === state.settings.browserVoiceZh ||
            v.voiceURI === state.settings.browserVoiceZh
        );
        if (vz) state.browserVoice.zh = vz;
    }

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

        pick.onclick = () => {
            if (state.voicePanelTarget === "zh") {
                state.browserVoice.zh = v;
                state.settings.browserVoiceZh = v.name || v.voiceURI;
            } else {
                state.browserVoice.de = v;
                state.settings.browserVoiceDe = v.name || v.voiceURI;
            }
            saveSettings();
            closeVoices();
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

        const active = state.voicePanelTarget === "zh"
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


/* ============================ UTTERANCE BUILDER ============================ */

function ttsPrime(cb) {
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

    if (chosen) u.voice = chosen;

    return u;
}


/* ============================ PLAYBACK HELPERS ============================ */

function ttsSpeak(text, langKey) {
    const u = buildUtterance(text, langKey);
    speechSynthesis.speak(u);
    return u;
}

function playSequence(a, aLang, b, bLang) {
    ttsPrime(() => {
        try { speechSynthesis.cancel(); } catch (e) {}
        ttsSpeak(a, aLang);

        setTimeout(() => {
            ttsSpeak(b, bLang);
        }, 700);
    });
}


/* ============================ PLAY QUESTION/ANSWER ========================= */

function playQuestion() {
    if (!state.current) return;

    if (state.mode === "de2zh") {
        playSequence(
            state.current.word.de, "de",
            state.current.sent.de, "de"
        );
    } else {
        ttsSpeak(state.current.word.zh, "zh");
        setTimeout(() => ttsSpeak(state.current.sent.zh, "zh"), 700);
    }
}

function playAnswer() {
    if (!state.current) return;

    if (state.mode === "de2zh") {
        ttsSpeak(state.current.word.zh, "zh");
        setTimeout(() => ttsSpeak(state.current.sent.zh, "zh"), 700);
    } else {
        playSequence(
            state.current.word.de, "de",
            state.current.sent.de, "de"
        );
    }
}


/* ============================ AUTOPLAY ENGINE ============================= */

function setAutoplay(on) {
    state.autoplay.on = on;

    if (!on) {
        try { speechSynthesis.cancel(); } catch (e) {}
        state.autoplay.timers.forEach(x => clearTimeout(x));
        state.autoplay.timers = [];
        releaseWakeLock();
    }

    updateAutoplayBtn();
}

function updateAutoplayBtn() {
    $('#btnAutoplay').textContent =
        state.autoplay.on ? "Autoplay ■ Stop" : "Autoplay ▶";
}

function ensurePoolForAutoplay() {

    if (state.pool.length > 0) return true;

    if (!state.settings.lessons.length) {
        const sel = $('#lessonSelect');
        const picked = [];
        for (const o of sel.selectedOptions) picked.push(o.value);
        state.settings.lessons = picked;
        saveSettings();
    }

    gatherPoolFromSettings();

    if (!state.pool.length) {
        alert("Bitte Lektion auswählen.");
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

        }, 700);

        state.autoplay.timers.push(t);
    };

    speechSynthesis.speak(u1);
}

function autoplayStep() {

    if (!state.autoplay.on) return;
    if (!ensurePoolForAutoplay()) {
        setAutoplay(false);
        return;
    }

    $('#solBox').classList.add('masked');
    disableRating();

    const qLang =
        state.mode === "de2zh" ? "de" : "zh";
    const aLang =
        state.mode === "de2zh" ? "zh" : "de";

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
                                    state.pool[Math.floor(Math.random() *
                                        state.pool.length)]
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
            state.wakeLock =
                await navigator.wakeLock.request("screen");

            state.wakeLock.addEventListener?.("release", () => {
                state.wakeLock = null;
            });

            document.addEventListener(
                "visibilitychange",
                onVisibilityChange,
                { passive: true }
            );
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

function stopAutoplayOnUserAction() {
    if (state.autoplay.on) setAutoplay(false);
}

/* -------------------------------------------------------------------------- */
/*                               TEIL 4 von 4                                 */
/*                 Event Listener · Mode Switch · Init Routine                */
/* -------------------------------------------------------------------------- */

window.addEventListener("DOMContentLoaded", () => {

    /* ============================ SETTINGS & DATA ============================ */

    loadSettings();
    loadProgress();
    loadCSV();

    state.mode  = state.settings.mode  || "de2zh";
    state.order = state.settings.order || "random";

    renderModeUI();


    /* ====================================================================== */
    /*                AUTOPLAY-BUTTON neben Training platzieren               */
    /* ====================================================================== */

    (function placeAutoplayButton() {

        const trainingBtn = document.querySelector("#btnStart");
        const autoplayBtn = document.querySelector("#btnAutoplay");
        if (!trainingBtn || !autoplayBtn) return;

        const parent = trainingBtn.parentNode;

        let group = parent.querySelector(".training-group");
        if (!group) {
            group = document.createElement("div");
            group.className = "training-group";
            parent.insertBefore(group, trainingBtn);
            group.appendChild(trainingBtn);
        }

        group.appendChild(autoplayBtn);
        autoplayBtn.classList.add("primary");
    })();


    /* ====================================================================== */
    /*                           BUTTON EVENT LISTENER                         */
    /* ====================================================================== */

    /* ---------- MODUS ---------- */
    $('#btnSwapMode').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        state.mode = state.mode === "de2zh" ? "zh2de" : "de2zh";
        state.settings.mode = state.mode;
        saveSettings();
        renderModeUI();
        if (state.current) setCard(state.current);
    });


    /* ---------- REIHENFOLGE ---------- */
    $('#btnOrderToggle').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        state.order = state.order === "random" ? "seq" : "random";
        state.settings.order = state.order;
        saveSettings();
        renderModeUI();
    });


    /* ---------- AUTOPLAY ---------- */
    $('#btnAutoplay').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        toggleAutoplay();
    });


    /* ---------- GAP SLIDER ---------- */
    $('#gapRange').addEventListener("input", e => {
        const s = parseFloat(e.target.value) || 0.8;
        state.autoplay.gapMs = Math.round(s * 1000);
        state.settings.autoplayGap = state.autoplay.gapMs;
        $('#gapVal').textContent = `(${s}s)`;
        saveSettings();
    });


    /* ====================================================================== */
    /*                          LAUTSPRECHER-ICONS                             */
    /* ====================================================================== */

    $('#speakerQuestion').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        playQuestion();
    });

    $('#speakerAnswer').addEventListener("click", () => {
        stopAutoplayOnUserAction();
        playAnswer();
    });


    /* ====================================================================== */
    /*                               TRAINING                                  */
    /* ====================================================================== */

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


    /* ====================================================================== */
    /*                                 RATING                                  */
    /* ====================================================================== */

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


    /* ====================================================================== */
    /*                               LEKTIONEN                                 */
    /* ====================================================================== */

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


    /* ====================================================================== */
    /*                             IMPORT / EXPORT                             */
    /* ====================================================================== */

    $('#btnExport').addEventListener("click", () => {
        const blob = new Blob(
            [JSON.stringify(state.progress, null, 2)],
            { type: "application/json" }
        );
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
/*                               ENDE TEIL 4                                  */
/* -------------------------------------------------------------------------- */

