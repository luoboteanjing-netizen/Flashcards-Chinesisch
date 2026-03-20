
// Flashcards App (Vanilla JS) - Patched ASCII-only version
// Notes: removed emoji and exotic characters; using ASCII only to avoid encoding issues.

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        else { inQuotes = false; i++; continue; }
      } else { field += c; i++; continue; }
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '
') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (c === '') { if (text[i+1] === '
') { i++; } row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
  }
  row.push(field); rows.push(row); return rows;
}

const storage = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  del(key) { localStorage.removeItem(key); }
};

class Card {
  constructor(row) {
    this.deWord = row[0] ? row[0].trim() : '';
    this.pyWord = row[1] ? row[1].trim() : '';
    this.pos    = row[2] ? row[2].trim() : '';
    this.pySent = row[3] ? row[3].trim() : '';
    this.deSent = row[4] ? row[4].trim() : '';
    this.hzWord = row[5] ? row[5].trim() : '';
    this.hzSent = row[6] ? row[6].trim() : '';
    this.id     = row[7] ? row[7].trim() : '';
    this.lesson = row[8] ? row[8].trim() : '';
  }
}

const state = {
  cards: [], filtered: [], order: 'sequential', index: 0, revealed: false,
  autoplay: false, autoplayTimer: null,
  sourceLang: 'de', targetLang: 'zh',
  tts: { de: { voiceURI: null, pitch: 1.0, rate: 1.0 }, zh: { voiceURI: null, pitch: 1.0, rate: 1.0 } },
  selectedLessons: new Set(), csvFile: 'vocab.csv'
};

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

function shuffleInPlace(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function progressKey(cardId){ return 'progress:' + state.csvFile + ':' + cardId; }
function setKnown(cardId, known){
  const rec = storage.get(progressKey(cardId), { known: false, seen: 0, correct: 0, wrong: 0 });
  rec.seen += 1; if (known) { rec.known = true; rec.correct += 1; } else { rec.known = false; rec.wrong += 1; }
  storage.set(progressKey(cardId), rec); updateLessonsProgressUI();
}
function getKnown(cardId){ const rec = storage.get(progressKey(cardId), null); return (rec && rec.known) || false; }

function resetAllProgress(){ if (!confirm('Gesamten Lernfortschritt wirklich loeschen?')) return; Object.keys(localStorage).forEach(k=>{ if (k.indexOf('progress:')===0) localStorage.removeItem(k); }); updateLessonsProgressUI(); alert('Fortschritt zurueckgesetzt.'); }

function computeLessonProgress(lesson, cards) {
  const list = cards.filter(c => c.lesson === lesson);
  if (list.length === 0) return { pct: 0, known: 0, total: 0 };
  const known = list.filter(c => getKnown(c.id)).length;
  return { pct: Math.round(100 * known / list.length), known, total: list.length };
}

function getUniqueLessons(cards){ const s = new Set(); for (const c of cards) if (c.lesson) s.add(c.lesson); return Array.from(s).sort((a,b)=> a.localeCompare(b, 'de', {numeric:true})); }

function renderLessonsBox(){
  const lessons = getUniqueLessons(state.cards); els.lessonsList.innerHTML = '';
  lessons.forEach(lesson => {
    const prog = computeLessonProgress(lesson, state.cards);
    const item = document.createElement('div'); item.className = 'lesson-item';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selectedLessons.size === 0 || state.selectedLessons.has(lesson);
    checkbox.addEventListener('change', () => { if (checkbox.checked) state.selectedLessons.add(lesson); else state.selectedLessons.delete(lesson); applyFilters(); });
    const title = document.createElement('div'); title.className = 'lesson-title'; title.textContent = 'Lektion ' + lesson;
    const progress = document.createElement('div'); progress.className = 'progress'; const bar = document.createElement('span'); bar.style.width = prog.pct + '%'; progress.appendChild(bar);
    const ptxt = document.createElement('div'); ptxt.className = 'progress-text'; ptxt.textContent = prog.pct + '% (' + prog.known + '/' + prog.total + ')';
    item.append(checkbox, title, progress, ptxt); els.lessonsList.appendChild(item);
  });
  if (state.selectedLessons.size === 0) lessons.forEach(l => state.selectedLessons.add(l));
}

function updateLessonsProgressUI(){ renderLessonsBox(); }

function applyFilters(){ const selected = state.selectedLessons; state.filtered = state.cards.filter(c => selected.has(c.lesson)); if (state.order === 'random') shuffleInPlace(state.filtered); state.index = 0; renderCurrentCard(); }

function renderCurrentCard(){
  const c = state.filtered[state.index];
  els.resultButtons.hidden = true; els.answerContent.innerHTML = '<em>Druecke "Anzeige", um die Loesung einzublenden.</em>'; state.revealed = false;
  if (!c){ els.cardId.textContent = ''; els.questionContent.innerHTML = '<em>Keine Karten in den gewaehlten Lektionen gefunden.</em>'; return; }
  els.cardId.textContent = c.id || ''; els.questionContent.innerHTML = buildQAHTML(c, true);
}

function revealAnswer(){ const c = state.filtered[state.index]; if (!c) return; els.answerContent.innerHTML = buildQAHTML(c, false); state.revealed = true; els.resultButtons.hidden = false; }

function buildQAHTML(card, isQuestion){
  const src = state.sourceLang; const tgt = state.targetLang;
  function span(cls, txt){ return '<span class="' + cls + '">' + escapeHTML(txt) + '</span>'; }
  if (isQuestion){
    if (src === 'zh'){
      const pos = card.pos ? '&nbsp;&nbsp;&nbsp;<span class="pos">' + escapeHTML(card.pos) + '</span>' : '';
      return [ span('hanzi', card.hzWord), '<div class="pinyin">' + escapeHTML(card.pyWord) + pos + '</div>', span('hanzi', card.hzSent), '<div class="pinyin">' + escapeHTML(card.pySent) + '</div>' ].join('');
    } else {
      return [ '<div class="de">' + escapeHTML(card.deWord) + '</div>', card.pos ? '<div class="pos">' + escapeHTML(card.pos) + '</div>' : '', '<div class="de">' + escapeHTML(card.deSent) + '</div>' ].join('');
    }
  } else {
    if (tgt === 'zh'){
      const pos = card.pos ? '&nbsp;&nbsp;&nbsp;<span class="pos">' + escapeHTML(card.pos) + '</span>' : '';
      return [ span('hanzi', card.hzWord), '<div class="pinyin">' + escapeHTML(card.pyWord) + pos + '</div>', span('hanzi', card.hzSent), '<div class="pinyin">' + escapeHTML(card.pySent) + '</div>' ].join('');
    } else {
      return [ '<div class="de">' + escapeHTML(card.deWord) + '</div>', card.pos ? '<div class="pos">' + escapeHTML(card.pos) + '</div>' : '', '<div class="de">' + escapeHTML(card.deSent) + '</div>' ].join('');
    }
  }
}

function escapeHTML(s){ return String(s || '').replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',''':'&#39;'}[m]; }); }

function nextCard(){ if (state.filtered.length === 0) return; state.index = (state.index + 1) % state.filtered.length; renderCurrentCard(); }
function prevCard(){ if (state.filtered.length === 0) return; state.index = (state.index - 1 + state.filtered.length) % state.filtered.length; renderCurrentCard(); }

function setAutoplay(on){ state.autoplay = on; els.autoplayToggleBtn.textContent = on ? 'Autoplay: AN' : 'Autoplay: AUS'; if (!on && state.autoplayTimer){ clearTimeout(state.autoplayTimer); state.autoplayTimer = null; } if (on) runAutoplayCycle(); }
function runAutoplayCycle(){ if (!state.autoplay) return; const delay = clamp(parseInt(els.autoplayDelay.value||'4',10),1,15) * 1000; speakCurrent('question'); state.autoplayTimer = setTimeout(function(){ revealAnswer(); speakCurrent('answer'); state.autoplayTimer = setTimeout(function(){ nextCard(); runAutoplayCycle(); }, delay); }, delay); }

function preferredVoiceFor(lang){ const voices = window.speechSynthesis.getVoices(); const candidates = voices.filter(v => (v.lang||'').toLowerCase().indexOf(lang)===0); return candidates[0] || voices[0] || null; }
function getVoiceSettings(lang){ return state.tts[lang]; }
function getVoiceByURI(uri){ return window.speechSynthesis.getVoices().find(v => v.voiceURI === uri) || null; }

function speak(text, lang){ if (!text) return; const utter = new SpeechSynthesisUtterance(text); const set = getVoiceSettings(lang); let voice = set.voiceURI ? getVoiceByURI(set.voiceURI) : null; if (!voice){ voice = preferredVoiceFor(lang); if (voice) set.voiceURI = voice.voiceURI; } if (voice) utter.voice = voice; utter.lang = (voice && voice.lang) ? voice.lang : (lang === 'zh' ? 'zh-CN' : 'de-DE'); utter.pitch = set.pitch || 1.0; utter.rate = set.rate || 1.0; window.speechSynthesis.cancel(); window.speechSynthesis.speak(utter); }

function speakCurrent(which){ const c = state.filtered[state.index]; if (!c) return; if (which === 'question'){ if (state.sourceLang === 'zh'){ speak((c.hzWord + '. ' + c.hzSent), 'zh'); } else { speak((c.deWord + '. ' + c.deSent), 'de'); } } else { if (state.targetLang === 'zh'){ speak((c.hzWord + '. ' + c.hzSent), 'zh'); } else { speak((c.deWord + '. ' + c.deSent), 'de'); } } }

function openVoiceModal(){ const lang = state.sourceLang; const voices = window.speechSynthesis.getVoices(); const filtered = voices.filter(v => (v.lang||'').toLowerCase().indexOf(lang)===0); const list = filtered.length ? filtered : voices; els.voiceSelect.innerHTML = ''; const set = getVoiceSettings(lang); list.forEach(v => { const opt = document.createElement('option'); opt.value = v.voiceURI; opt.textContent = v.name + '  ' + v.lang; if (set.voiceURI && set.voiceURI === v.voiceURI) opt.selected = true; els.voiceSelect.appendChild(opt); }); els.voicePitch.value = String(set.pitch); els.voiceRate.value = String(set.rate); els.pitchVal.textContent = set.pitch.toFixed(1); els.rateVal.textContent = set.rate.toFixed(1); els.voiceModal.showModal(); }

function saveVoiceSettings(){ const lang = state.sourceLang; const s = state.tts[lang]; s.voiceURI = els.voiceSelect.value || null; s.pitch = parseFloat(els.voicePitch.value) || 1.0; s.rate = parseFloat(els.voiceRate.value) || 1.0; storage.set('tts:' + lang, s); els.voiceModal.close(); }
function testVoice(){ const lang = state.sourceLang; const c = state.filtered[state.index]; const sample = c ? (lang === 'zh' ? (c.hzWord + '. ' + c.hzSent) : (c.deWord + '. ' + c.deSent)) : (lang==='zh' ? 'Ni hao. Ce shi yu yin.' : 'Hallo. Dies ist ein Stimmtest.'); speak(sample, lang); }

function loadSettings(){ state.tts.de = storage.get('tts:de', state.tts.de); state.tts.zh = storage.get('tts:zh', state.tts.zh); const savedOrder = storage.get('orderMode', 'sequential'); state.order = savedOrder; els.orderMode.value = savedOrder; const savedCsv = storage.get('csvFile', state.csvFile); state.csvFile = savedCsv; els.csvSelect.value = savedCsv; const src = storage.get('sourceLang', 'de'); const tgt = storage.get('targetLang', 'zh'); state.sourceLang = src; state.targetLang = tgt; els.sourceLang.value = src; els.targetLang.value = tgt; }
function persistBasics(){ storage.set('orderMode', state.order); storage.set('csvFile', state.csvFile); storage.set('sourceLang', state.sourceLang); storage.set('targetLang', state.targetLang); }

async function loadCSV(){ const file = state.csvFile; const urlParamCsv = new URLSearchParams(location.search).get('csv'); const csvPath = 'data/' + (urlParamCsv || file); let text = ''; try { const res = await fetch(csvPath + '?t=' + Date.now()); if (!res.ok) throw new Error(res.status + ' ' + res.statusText); text = await res.text(); } catch (e) { console.error('CSV laden fehlgeschlagen:', e); alert('Konnte CSV nicht laden: ' + csvPath + '. Lege eine Datei in /data/ an (z.B. vocab.csv).'); return; } const rows = parseCSV(text).filter(r => r.length > 1); if (rows.length <= 1){ alert('CSV enthaelt keine Daten (nach Header).'); return; } const body = rows.slice(1); const filtered = body.filter(r => { const first = (r[0]||'').trim(); return first.indexOf('*') === -1; }); const cards = filtered.map(r => new Card(r)).filter(c => c.id); state.cards = cards; renderLessonsBox(); buildCsvSelectOptionsIfNew(); applyFilters(); }

function buildCsvSelectOptionsIfNew(){ const param = new URLSearchParams(location.search).get('csv'); if (!param) return; const exists = Array.from(els.csvSelect.options).some(o => o.value === param); if (!exists){ const opt = document.createElement('option'); opt.value = param; opt.textContent = param; els.csvSelect.appendChild(opt); els.csvSelect.value = param; state.csvFile = param; persistBasics(); } }

function wireEvents(){
  els.orderMode.addEventListener('change', function(){ state.order = els.orderMode.value; persistBasics(); applyFilters(); });
  els.startTrainingBtn.addEventListener('click', function(){ state.index = 0; renderCurrentCard(); });
  els.autoplayToggleBtn.addEventListener('click', function(){ setAutoplay(!state.autoplay); });
  els.prevBtn.addEventListener('click', prevCard);
  els.nextBtn.addEventListener('click', nextCard);
  els.revealBtn.addEventListener('click', revealAnswer);
  els.knownBtn.addEventListener('click', function(){ const c = state.filtered[state.index]; if (!c) return; setKnown(c.id, true); nextCard(); });
  els.unknownBtn.addEventListener('click', function(){ const c = state.filtered[state.index]; if (!c) return; setKnown(c.id, false); nextCard(); });
  els.speakQuestionBtn.addEventListener('click', function(){ speakCurrent('question'); });
  els.speakAnswerBtn.addEventListener('click', function(){ speakCurrent('answer'); });
  els.switchDirectionBtn.addEventListener('click', function(){ const oldSrc = state.sourceLang, oldTgt = state.targetLang; state.sourceLang = oldTgt; state.targetLang = oldSrc; els.sourceLang.value = state.sourceLang; els.targetLang.value = state.targetLang; persistBasics(); renderCurrentCard(); });
  els.sourceLang.addEventListener('change', function(){ state.sourceLang = els.sourceLang.value; if (state.sourceLang === state.targetLang){ state.targetLang = (state.sourceLang === 'de' ? 'zh' : 'de'); els.targetLang.value = state.targetLang; } persistBasics(); renderCurrentCard(); });
  els.targetLang.addEventListener('change', function(){ state.targetLang = els.targetLang.value; if (state.sourceLang === state.targetLang){ state.sourceLang = (state.targetLang === 'de' ? 'zh' : 'de'); els.sourceLang.value = state.sourceLang; } persistBasics(); renderCurrentCard(); });
  els.voiceConfigBtn.addEventListener('click', openVoiceModal);
  els.voiceSaveBtn.addEventListener('click', function(e){ e.preventDefault(); saveVoiceSettings(); });
  els.voiceCancelBtn.addEventListener('click', function(e){ e.preventDefault(); els.voiceModal.close(); });
  els.voiceTestBtn.addEventListener('click', function(e){ e.preventDefault(); testVoice(); });
  els.csvSelect.addEventListener('change', function(){ state.csvFile = els.csvSelect.value; persistBasics(); loadCSV(); });
  els.reloadCsvBtn.addEventListener('click', function(){ loadCSV(); });
  els.resetProgressBtn.addEventListener('click', resetAllProgress);
  window.addEventListener('keydown', function(e){ if (e.key === 'ArrowRight') { nextCard(); } else if (e.key === 'ArrowLeft') { prevCard(); } else if (e.key === ' '){ e.preventDefault(); state.revealed ? nextCard() : revealAnswer(); } else if (e.key === '1'){ const id = (state.filtered[state.index]||{}).id; if (id) { setKnown(id, true); nextCard(); } } else if (e.key === '2'){ const id = (state.filtered[state.index]||{}).id; if (id) { setKnown(id, false); nextCard(); } } });
  if (typeof speechSynthesis !== 'undefined'){ speechSynthesis.onvoiceschanged = function(){}; }
}

function init(){ loadSettings(); wireEvents(); loadCSV(); }
init();
