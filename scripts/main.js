
    // ==============================
    // Flashcards App (Vanilla JS)
    // ==============================

    // ---- CSV Parsing (supports quotes, commas, newlines) ----
    function parseCSV(text) {
      const rows = [];
      let i = 0, field = '', row = [], inQuotes = false;
      while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { // escaped quote
              field += '"';
              i += 2;
              continue;
            } else {
              inQuotes = false; i++; continue;
            }
          } else { field += c; i++; continue; }
        } else {
          if (c === '"') { inQuotes = true; i++; continue; }
          if (c === ',') { row.push(field); field = ''; i++; continue; }
          if (c === '
') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
          if (c === '') { // handle CRLF
            if (text[i+1] === '
') { i++; }
            row.push(field); rows.push(row); row = []; field = ''; i++; continue;
          }
          field += c; i++;
        }
      }
      // last field
      row.push(field);
      rows.push(row);
      return rows;
    }

    // ---- Storage helpers ----
    const storage = {
      get(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
      },
      set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
      del(key) { localStorage.removeItem(key); }
    };

    // ---- Data model ----
    class Card {
      constructor(row) {
        this.deWord = row[0]?.trim() || '';
        this.pyWord = row[1]?.trim() || '';
        this.pos = row[2]?.trim() || '';
        this.pySent = row[3]?.trim() || '';
        this.deSent = row[4]?.trim() || '';
        this.hzWord = row[5]?.trim() || '';
        this.hzSent = row[6]?.trim() || '';
        this.id = row[7]?.trim() || '';
        this.lesson = row[8]?.trim() || '';
      }
    }

    // ---- App State ----
    const state = {
      cards: [],
      filtered: [],
      order: 'sequential',
      index: 0,
      revealed: false,
      autoplay: false,
      autoplayTimer: null,
      // de or zh
      sourceLang: 'de',
      targetLang: 'zh',
      // settings per language
      tts: {
        de: { voiceURI: null, pitch: 1.0, rate: 1.0 },
        zh: { voiceURI: null, pitch: 1.0, rate: 1.0 },
      },
      selectedLessons: new Set(),
      csvFile: 'vocab.csv'
    };

    // ---- DOM refs ----
    const els = {
      lessonsList: document.getElementById('lessonsList'),
      csvSelect: document.getElementById('csvSelect'),
      reloadCsvBtn: document.getElementById('reloadCsvBtn'),
      resetProgressBtn: document.getElementById('resetProgressBtn'),
      sourceLang: document.getElementById('sourceLang'),
      targetLang: document.getElementById('targetLang'),
      switchDirectionBtn: document.getElementById('switchDirectionBtn'),
      voiceConfigBtn: document.getElementById('voiceConfigBtn'),
      startTrainingBtn: document.getElementById('startTrainingBtn'),
      autoplayToggleBtn: document.getElementById('autoplayToggleBtn'),
      autoplayDelay: document.getElementById('autoplayDelay'),
      orderMode: document.getElementById('orderMode'),

      cardId: document.getElementById('cardId'),
      questionContent: document.getElementById('questionContent'),
      answerContent: document.getElementById('answerContent'),
      speakQuestionBtn: document.getElementById('speakQuestionBtn'),
      speakAnswerBtn: document.getElementById('speakAnswerBtn'),

      prevBtn: document.getElementById('prevBtn'),
      nextBtn: document.getElementById('nextBtn'),
      revealBtn: document.getElementById('revealBtn'),
      resultButtons: document.getElementById('resultButtons'),
      knownBtn: document.getElementById('knownBtn'),
      unknownBtn: document.getElementById('unknownBtn'),

      // modal
      voiceModal: document.getElementById('voiceModal'),
      voiceSelect: document.getElementById('voiceSelect'),
      voicePitch: document.getElementById('voicePitch'),
      voiceRate: document.getElementById('voiceRate'),
      pitchVal: document.getElementById('pitchVal'),
      rateVal: document.getElementById('rateVal'),
      voiceSaveBtn: document.getElementById('voiceSaveBtn'),
      voiceCancelBtn: document.getElementById('voiceCancelBtn'),
      voiceTestBtn: document.getElementById('voiceTestBtn'),
    };

    // ---- Utility ----
    function shuffleInPlace(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

    // ---- Progress handling ----
    function progressKey(cardId){ return `progress:${state.csvFile}:${cardId}`; }
    function setKnown(cardId, known){
      const rec = storage.get(progressKey(cardId), { known: false, seen: 0, correct: 0, wrong: 0 });
      rec.seen += 1;
      if (known) { rec.known = true; rec.correct += 1; } else { rec.known = false; rec.wrong += 1; }
      storage.set(progressKey(cardId), rec);
      updateLessonsProgressUI();
    }
    function getKnown(cardId){
      const rec = storage.get(progressKey(cardId), null); return rec?.known || false;
    }
    function getStats(cardId){ return storage.get(progressKey(cardId), { known:false, seen:0, correct:0, wrong:0 }); }

    function resetAllProgress(){
      if (!confirm('Gesamten Lernfortschritt wirklich löschen?')) return;
      Object.keys(localStorage).forEach(k=>{ if (k.startsWith('progress:')) localStorage.removeItem(k); });
      updateLessonsProgressUI();
      alert('Fortschritt zurückgesetzt.');
    }

    // ---- Lessons UI ----
    function computeLessonProgress(lesson, cards) {
      const list = cards.filter(c => c.lesson === lesson);
      if (list.length === 0) return { pct: 0, known: 0, total: 0 };
      const known = list.filter(c => getKnown(c.id)).length;
      return { pct: Math.round(100 * known / list.length), known, total: list.length };
    }

    function getUniqueLessons(cards){
      const s = new Set();
      for (const c of cards) if (c.lesson) s.add(c.lesson);
      return Array.from(s).sort((a,b)=> (a.localeCompare(b, 'de', {numeric:true})))
    }

    function renderLessonsBox(){
      const lessons = getUniqueLessons(state.cards);
      els.lessonsList.innerHTML = '';
      lessons.forEach(lesson => {
        const prog = computeLessonProgress(lesson, state.cards);
        const item = document.createElement('div');
        item.className = 'lesson-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.selectedLessons.size === 0 || state.selectedLessons.has(lesson);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) state.selectedLessons.add(lesson); else state.selectedLessons.delete(lesson);
          applyFilters();
        });

        const title = document.createElement('div');
        title.className = 'lesson-title';
        title.textContent = `Lektion ${lesson}`;

        const progress = document.createElement('div');
        progress.className = 'progress';
        const bar = document.createElement('span');
        bar.style.width = `${prog.pct}%`;
        progress.appendChild(bar);

        const ptxt = document.createElement('div');
        ptxt.className = 'progress-text';
        ptxt.textContent = `${prog.pct}% (${prog.known}/${prog.total})`;

        item.append(checkbox, title, progress, ptxt);
        els.lessonsList.appendChild(item);
      });

      // If no selection yet: select all by default
      if (state.selectedLessons.size === 0) lessons.forEach(l => state.selectedLessons.add(l));
    }

    function updateLessonsProgressUI(){
      // Just re-render to update bars
      renderLessonsBox();
    }

    function applyFilters(){
      const selected = state.selectedLessons;
      state.filtered = state.cards.filter(c => selected.has(c.lesson));
      if (state.order === 'random') shuffleInPlace(state.filtered);
      state.index = 0;
      renderCurrentCard();
    }

    // ---- Rendering Question/Answer ----
    function renderCurrentCard(){
      const c = state.filtered[state.index];
      els.resultButtons.hidden = true;
      els.answerContent.innerHTML = '<em>Drücke „Anzeige“, um die Lösung einzublenden.</em>';
      state.revealed = false;

      if (!c){
        els.cardId.textContent = '—';
        els.questionContent.innerHTML = '<em>Keine Karten in den gewählten Lektionen gefunden.</em>';
        return;
      }

      els.cardId.textContent = c.id || '—';
      els.questionContent.innerHTML = buildQAHTML(c, /*isQuestion=*/true);
    }

    function revealAnswer(){
      const c = state.filtered[state.index];
      if (!c) return;
      els.answerContent.innerHTML = buildQAHTML(c, /*isQuestion=*/false);
      state.revealed = true;
      els.resultButtons.hidden = false;
    }

    function buildQAHTML(card, isQuestion){
      const src = state.sourceLang; // 'de' or 'zh'
      const tgt = state.targetLang;

      function span(cls, txt){ return `<span class="${cls}">${escapeHTML(txt)}</span>`; }

      if (isQuestion){
        if (src === 'zh'){
          // ID is already shown elsewhere; here: hanzi word, pinyin word (+pos), hanzi sentence, pinyin sentence
          const pos = card.pos ? `   <span class="pos">${escapeHTML(card.pos)}</span>` : '';
          return [
            span('hanzi', card.hzWord),
            `<div class="pinyin">${escapeHTML(card.pyWord)}${pos}</div>`,
            span('hanzi', card.hzSent),
            `<div class="pinyin">${escapeHTML(card.pySent)}</div>`
          ].join('');
        } else {
          // Deutsch Quelle: Wort DE, POS, Satz DE
          return [
            `<div class="de">${escapeHTML(card.deWord)}</div>`,
            card.pos ? `<div class="pos">${escapeHTML(card.pos)}</div>` : '',
            `<div class="de">${escapeHTML(card.deSent)}</div>`
          ].join('');
        }
      } else {
        // ANSWER: per spec: if Zielsprache chinesisch -> hanzi/pinyin/pos + hz sentence + py sentence
        // otherwise (interpreted) Zielsprache deutsch -> de word + pos + de sentence
        if (tgt === 'zh'){
          const pos = card.pos ? `   <span class="pos">${escapeHTML(card.pos)}</span>` : '';
          return [
            span('hanzi', card.hzWord),
            `<div class="pinyin">${escapeHTML(card.pyWord)}${pos}</div>`,
            span('hanzi', card.hzSent),
            `<div class="pinyin">${escapeHTML(card.pySent)}</div>`
          ].join('');
        } else {
          return [
            `<div class="de">${escapeHTML(card.deWord)}</div>`,
            card.pos ? `<div class="pos">${escapeHTML(card.pos)}</div>` : '',
            `<div class="de">${escapeHTML(card.deSent)}</div>`
          ].join('');
        }
      }
    }

    function escapeHTML(s){
      return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',''':'&#39;'}[m]));
    }

    // ---- Navigation ----
    function nextCard(){
      if (state.filtered.length === 0) return;
      state.index = (state.index + 1) % state.filtered.length;
      renderCurrentCard();
    }
    function prevCard(){
      if (state.filtered.length === 0) return;
      state.index = (state.index - 1 + state.filtered.length) % state.filtered.length;
      renderCurrentCard();
    }

    // ---- Autoplay ----
    function setAutoplay(on){
      state.autoplay = on;
      els.autoplayToggleBtn.textContent = on ? 'Autoplay: AN' : 'Autoplay: AUS';
      if (!on && state.autoplayTimer){ clearTimeout(state.autoplayTimer); state.autoplayTimer = null; }
      if (on) runAutoplayCycle();
    }

    function runAutoplayCycle(){
      if (!state.autoplay) return;
      const delay = clamp(parseInt(els.autoplayDelay.value||'4',10),1,15) * 1000;
      // Step 1: speak question
      speakCurrent('question');
      // Step 2: reveal after delay
      state.autoplayTimer = setTimeout(()=>{
        revealAnswer();
        speakCurrent('answer');
        // Step 3: go next after another delay
        state.autoplayTimer = setTimeout(()=>{
          nextCard();
          runAutoplayCycle();
        }, delay);
      }, delay);
    }

    // ---- TTS ----
    function preferredVoiceFor(lang){
      const voices = window.speechSynthesis.getVoices();
      // Try match for language code
      const candidates = voices.filter(v => (v.lang||'').toLowerCase().startsWith(lang));
      return candidates[0] || voices[0] || null;
    }

    function getVoiceSettings(lang){
      return state.tts[lang];
    }
    function getVoiceByURI(uri){
      return window.speechSynthesis.getVoices().find(v => v.voiceURI === uri) || null;
    }

    function speak(text, lang){
      if (!text) return;
      const utter = new SpeechSynthesisUtterance(text);
      const set = getVoiceSettings(lang);
      let voice = set.voiceURI ? getVoiceByURI(set.voiceURI) : null;
      if (!voice){
        voice = preferredVoiceFor(lang);
        if (voice) set.voiceURI = voice.voiceURI;
      }
      if (voice) utter.voice = voice;
      utter.lang = voice?.lang || (lang === 'zh' ? 'zh-CN' : 'de-DE');
      utter.pitch = set.pitch || 1.0;
      utter.rate = set.rate || 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }

    function speakCurrent(which){
      const c = state.filtered[state.index];
      if (!c) return;
      if (which === 'question'){
        if (state.sourceLang === 'zh'){
          speak(`${c.hzWord}. ${c.hzSent}`, 'zh');
        } else {
          speak(`${c.deWord}. ${c.deSent}`, 'de');
        }
      } else {
        if (state.targetLang === 'zh'){
          speak(`${c.hzWord}. ${c.hzSent}`, 'zh');
        } else {
          speak(`${c.deWord}. ${c.deSent}`, 'de');
        }
      }
    }

    // ---- Voice modal ----
    function openVoiceModal(){
      // Populate list with voices matching current source language
      const lang = state.sourceLang;
      const voices = window.speechSynthesis.getVoices();
      const filtered = voices.filter(v => (v.lang||'').toLowerCase().startsWith(lang));
      const list = filtered.length ? filtered : voices; // fallback: show all
      els.voiceSelect.innerHTML = '';
      const set = getVoiceSettings(lang);
      list.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} — ${v.lang}`;
        if (set.voiceURI && set.voiceURI === v.voiceURI) opt.selected = true;
        els.voiceSelect.appendChild(opt);
      });
      els.voicePitch.value = set.pitch.toString();
      els.voiceRate.value = set.rate.toString();
      els.pitchVal.textContent = set.pitch.toFixed(1);
      els.rateVal.textContent = set.rate.toFixed(1);

      els.voiceModal.showModal();
    }

    function saveVoiceSettings(){
      const lang = state.sourceLang;
      const s = state.tts[lang];
      s.voiceURI = els.voiceSelect.value || null;
      s.pitch = parseFloat(els.voicePitch.value) || 1.0;
      s.rate = parseFloat(els.voiceRate.value) || 1.0;
      storage.set(`tts:${lang}`, s);
      els.voiceModal.close();
    }

    function testVoice(){
      const lang = state.sourceLang;
      const c = state.filtered[state.index];
      const sample = c ? (lang === 'zh' ? `${c.hzWord}. ${c.hzSent}` : `${c.deWord}. ${c.deSent}`) : (lang==='zh' ? '你好。测试语音。' : 'Hallo. Dies ist ein Stimmtest.');
      speak(sample, lang);
    }

    // ---- Load/Save settings ----
    function loadSettings(){
      state.tts.de = storage.get('tts:de', state.tts.de);
      state.tts.zh = storage.get('tts:zh', state.tts.zh);
      const savedOrder = storage.get('orderMode', 'sequential');
      state.order = savedOrder; els.orderMode.value = savedOrder;
      const savedCsv = storage.get('csvFile', state.csvFile); state.csvFile = savedCsv; els.csvSelect.value = savedCsv;
      const src = storage.get('sourceLang', 'de'); const tgt = storage.get('targetLang', 'zh');
      state.sourceLang = src; state.targetLang = tgt; els.sourceLang.value = src; els.targetLang.value = tgt;
    }

    function persistBasics(){
      storage.set('orderMode', state.order);
      storage.set('csvFile', state.csvFile);
      storage.set('sourceLang', state.sourceLang);
      storage.set('targetLang', state.targetLang);
    }

    // ---- CSV loading ----
    async function loadCSV(){
      const file = state.csvFile;
      const urlParamCsv = new URLSearchParams(location.search).get('csv');
      const csvPath = `data/${urlParamCsv || file}`;
      let text = '';
      try {
        const res = await fetch(csvPath + `?t=${Date.now()}`);
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        text = await res.text();
      } catch (e) {
        console.error('CSV laden fehlgeschlagen:', e);
        alert(`Konnte CSV nicht laden: ${csvPath}. Lege eine Datei in /data/ an (z.B. vocab.csv).`);
        return;
      }

      const rows = parseCSV(text).filter(r => r.length > 1);
      if (rows.length <= 1){
        alert('CSV enthält keine Daten (nach Header).');
        return;
      }

      // Ignore header row (first)
      const body = rows.slice(1);
      const filtered = body.filter(r => {
        const first = (r[0]||'').trim();
        return !first.includes('*');
      });

      const cards = filtered.map(r => new Card(r)).filter(c => c.id);
      state.cards = cards;

      // Build lessons list / csv dropdown
      renderLessonsBox();
      buildCsvSelectOptionsIfNew();

      applyFilters();
    }

    function buildCsvSelectOptionsIfNew(){
      // If user provided a different CSV via URL, add it to dropdown for convenience
      const param = new URLSearchParams(location.search).get('csv');
      if (!param) return;
      const exists = Array.from(els.csvSelect.options).some(o => o.value === param);
      if (!exists){
        const opt = document.createElement('option'); opt.value = opt.textContent = param; els.csvSelect.appendChild(opt);
        els.csvSelect.value = param; state.csvFile = param; persistBasics();
      }
    }

    // ---- Event wiring ----
    function wireEvents(){
      els.orderMode.addEventListener('change', () => { state.order = els.orderMode.value; persistBasics(); applyFilters(); });
      els.startTrainingBtn.addEventListener('click', () => { state.index = 0; renderCurrentCard(); });
      els.autoplayToggleBtn.addEventListener('click', () => setAutoplay(!state.autoplay));
      els.prevBtn.addEventListener('click', prevCard);
      els.nextBtn.addEventListener('click', nextCard);
      els.revealBtn.addEventListener('click', revealAnswer);
      els.knownBtn.addEventListener('click', () => { const c = state.filtered[state.index]; if (!c) return; setKnown(c.id, true); nextCard(); });
      els.unknownBtn.addEventListener('click', () => { const c = state.filtered[state.index]; if (!c) return; setKnown(c.id, false); nextCard(); });

      els.speakQuestionBtn.addEventListener('click', () => speakCurrent('question'));
      els.speakAnswerBtn.addEventListener('click', () => speakCurrent('answer'));

      els.switchDirectionBtn.addEventListener('click', () => {
        const oldSrc = state.sourceLang, oldTgt = state.targetLang;
        state.sourceLang = oldTgt; state.targetLang = oldSrc;
        els.sourceLang.value = state.sourceLang; els.targetLang.value = state.targetLang;
        persistBasics();
        renderCurrentCard();
      });

      els.sourceLang.addEventListener('change', () => { state.sourceLang = els.sourceLang.value; if (state.sourceLang === state.targetLang){ state.targetLang = (state.sourceLang === 'de' ? 'zh' : 'de'); els.targetLang.value = state.targetLang; } persistBasics(); renderCurrentCard(); });
      els.targetLang.addEventListener('change', () => { state.targetLang = els.targetLang.value; if (state.sourceLang === state.targetLang){ state.sourceLang = (state.targetLang === 'de' ? 'zh' : 'de'); els.sourceLang.value = state.sourceLang; } persistBasics(); renderCurrentCard(); });

      els.voiceConfigBtn.addEventListener('click', openVoiceModal);
      els.voiceSaveBtn.addEventListener('click', (e) => { e.preventDefault(); saveVoiceSettings(); });
      els.voiceCancelBtn.addEventListener('click', (e) => { e.preventDefault(); els.voiceModal.close(); });
      els.voiceTestBtn.addEventListener('click', (e) => { e.preventDefault(); testVoice(); });

      els.csvSelect.addEventListener('change', () => { state.csvFile = els.csvSelect.value; persistBasics(); loadCSV(); });
      els.reloadCsvBtn.addEventListener('click', () => loadCSV());
      els.resetProgressBtn.addEventListener('click', resetAllProgress);

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { nextCard(); }
        else if (e.key === 'ArrowLeft') { prevCard(); }
        else if (e.key === ' '){ e.preventDefault(); state.revealed ? nextCard() : revealAnswer(); }
        else if (e.key === '1'){ setKnown(state.filtered[state.index]?.id, true); nextCard(); }
        else if (e.key === '2'){ setKnown(state.filtered[state.index]?.id, false); nextCard(); }
      });

      // Voice list ready? Some browsers load asynchronously
      if (typeof speechSynthesis !== 'undefined'){
        speechSynthesis.onvoiceschanged = () => {
          // refresh nothing specific; we populate modal on open
        };
      }
    }

    // ---- Initialization ----
    function init(){
      loadSettings();
      wireEvents();
      loadCSV();
    }

    init();
