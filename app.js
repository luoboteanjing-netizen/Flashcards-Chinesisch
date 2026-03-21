// *** Online-stabile Version (PWA/Offline deaktiviert) ***

// Pfad zur CSV
const CSV_PATH = 'data/Long-Chinesisch_Lektionen.csv';

// Globale Variablen für TTS
let voices = [];

// ---------------- Hilfsfunktionen ----------------
function detectDelimiter(sample){
  const first = (sample.split(/\r?\n/)[0] || '');
  const count = (s, d) => (s ? (s.split(d).length - 1) : 0);
  const cands = [ [','], [';'], ['\t'] ].map(d => ({d:d[0], n:count(first, d[0])}));
  cands.sort((a,b)=>b.n-a.n);
  return cands[0].n>0 ? cands[0].d : ';';
}

function parseCSV(text){
  const delimiter = detectDelimiter(text);
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const rows = [];
  for (const line of lines){
    if (!line) { rows.push([]); continue; }
    const out = [];
    let cur = '';
    let i = 0, inQuotes = false;
    while(i < line.length){
      const ch = line[i];
      if (inQuotes){
        if (ch === '"'){
          if (i+1 < line.length && line[i+1] === '"'){ cur += '"'; i+=2; continue; }
          inQuotes = false; i++; continue;
        }
        cur += ch; i++; continue;
      } else {
        if (ch === '"'){ inQuotes = true; i++; continue; }
        const isDelim = (delimiter === '\t' ? ch === '\t' : ch === delimiter);
        if (isDelim){ out.push(cur); cur=''; i++; continue; }
        cur += ch; i++;
      }
    }
    out.push(cur);
    rows.push(out.map(s => (s ?? '').trim()))
  }
  return { rows, delimiter };
}

function isHeaderRow(cells){
  const cols = cells.map(s => (s||'').toLowerCase());
  const keys = ['deutsch','pinyin','wortart','hanzi','satz','id'];
  let score = 0;
  for (const k of keys){ if (cols.join(' ').includes(k)) score++; }
  return score >= 3; // heuristisch
}

function stripToneMarks(s){
  if (!s) return s;
  try {
    // Entfernt kombinierende Diakritika (u. a. Pinyin-Töne)
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch { return s; }
}

function highlightToneInsensitive(originalText, query){
  if (!query) return originalText;
  const qNorm = stripToneMarks(query).toLowerCase();
  const o = String(originalText);
  let norm = ''; const map = [];
  for (let i=0; i<o.length; i++){
    const stripped = stripToneMarks(o[i]);
    if (stripped == null) continue;
    for (let k=0; k<stripped.length; k++){ norm += stripped[k]; map.push(i); }
  }
  const idx = norm.toLowerCase().indexOf(qNorm);
  if (idx < 0) return originalText;
  const endIdx = idx + qNorm.length - 1;
  const startOrig = map[idx];
  const endOrig = map[endIdx] + 1;
  return (o.slice(0, startOrig) + '<mark>' + o.slice(startOrig, endOrig) + '</mark>' + o.slice(endOrig));
}

// ---------------- TTS ----------------
function loadVoices(){
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); };
}
function getVoicesForLang(lang){
  const prefix = (lang === 'zh') ? 'zh' : 'de';
  return voices.filter(v => (v.lang || '').toLowerCase().startsWith(prefix));
}
function getTTSSettings(lang){
  const pref = (k, def) => {
    const v = localStorage.getItem(k);
    return (v==null||v==='') ? def : v;
  };
  const pitch = parseFloat(pref(`tts_pitch_${lang}`, '1.0'));
  const rate  = parseFloat(pref(`tts_rate_${lang}`,  '0.8'));
  return { voiceName: pref(`tts_voice_${lang}`, ''), pitch, rate };
}
function saveTTSSettings(lang){
  const voice = document.getElementById('voiceSelect').value || '';
  const pitch = document.getElementById('pitchSlider').value;
  const rate  = document.getElementById('rateSlider').value;
  localStorage.setItem(`tts_voice_${lang}`, voice);
  localStorage.setItem(`tts_pitch_${lang}`, pitch);
  localStorage.setItem(`tts_rate_${lang}`,  rate);
}
function updateTTSModal(lang){
  const select = document.getElementById('voiceSelect');
  const list = getVoicesForLang(lang);
  select.innerHTML = '';
  if (list.length === 0){
    select.innerHTML = '<option value="">Keine Stimmen verfügbar (lade Seite neu)</option>';
  } else {
    for(const v of list){
      const opt = document.createElement('option');
      opt.value = v.name; opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    }
  }
  const s = getTTSSettings(lang);
  if (s.voiceName) select.value = s.voiceName; else if (list[0]) select.value = list[0].name;
  document.getElementById('pitchSlider').value = s.pitch;
  document.getElementById('pitchValue').textContent = s.pitch;
  document.getElementById('rateSlider').value  = s.rate;
  document.getElementById('rateValue').textContent  = s.rate;
}
function showTTSSettings(){
  loadVoices();
  updateTTSModal(document.getElementById('side').value);
  document.getElementById('ttsModal').style.display='flex';
}
function testVoice(){
  if (!('speechSynthesis' in window)) return;
  const lang = document.getElementById('side').value;
  const u = new SpeechSynthesisUtterance(lang==='zh'?'Nǐ hǎo':'Hallo');
  u.lang = (lang==='zh')?'zh-CN':'de-DE';
  const s = getTTSSettings(lang);
  const list = getVoicesForLang(lang);
  if (s.voiceName){
    const v = list.find(x=>x.name===s.voiceName);
    if (v) u.voice = v;
  }
  u.pitch = s.pitch; u.rate = s.rate; u.volume = 0.6;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function speak(text, lang, volume=1.0){
  if (!text || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = (lang==='zh')?'zh-CN':'de-DE';
  const s = getTTSSettings(lang); const list = getVoicesForLang(lang);
  if (s.voiceName){
    const v = list.find(x=>x.name===s.voiceName);
    if (v) u.voice = v;
  }
  u.pitch = s.pitch; u.rate = s.rate; u.volume = volume;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function primeTTS(initialLang){
  if (!('speechSynthesis' in window)) return;
  setTimeout(()=>{ const text = initialLang==='zh'?'Nǐ hǎo':'Hallo'; speak(text, initialLang, 0.3); }, 500);
}
function speakCard(c, current){
  let wordText, sentenceText, lang;
  if (current==='zh'){ wordText = c.word.hanzi||''; sentenceText = c.sentence.hanzi||''; lang='zh'; }
  else { wordText = c.word.de; sentenceText = c.sentence.de; lang='de'; }
  if (!('speechSynthesis' in window)) return;
  const s = getTTSSettings(lang); const list = getVoicesForLang(lang);
  const sel = s.voiceName ? list.find(v=>v.name===s.voiceName) : null;

  if (wordText){
    setTimeout(()=>{
      const u = new SpeechSynthesisUtterance(wordText);
      u.lang = (lang==='zh')?'zh-CN':'de-DE';
      if (sel) u.voice = sel;
      u.pitch = s.pitch; u.rate = s.rate; u.volume = 1.0;
      u.onend = ()=>{ if (sentenceText) setTimeout(()=>speak(sentenceText, lang), 200); };
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    }, 200);
  } else if (sentenceText){
    setTimeout(()=>speak(sentenceText, lang), 200);
  }
}

// ---------------- Datenaufbereitung ----------------
function toCards(rows){
  const cards = [];
  let start = 0;
  if (rows.length && isHeaderRow(rows[0])) start = 1;
  for (let i=start; i<rows.length; i++){
    const r = rows[i] || [];
    const c = idx => (r[idx] ?? '').trim();

    // Skip-Markierung in Spalte A: '*'
    const firstCell = c(0);
    if (firstCell.includes('*')) continue;

    const de_word = c(0);
    const py_word = c(1);
    const pos     = c(2);
    const py_sent = c(3);
    const de_sent = c(4);
    const hz_word = c(5);
    const hz_sent = c(6);
    const id_raw  = c(7);
    const lesson_raw = c(8);

    // Falls die Zeile komplett leer ist, überspringen
    if (!(de_word || py_word || pos || py_sent || de_sent || hz_word || hz_sent)) continue;

    const id = id_raw || `row${i+1}`;
    const lesson = lesson_raw || `Lektion ${i - start + 1}`;

    cards.push({
      id,
      lesson,
      word:     { de: de_word, pinyin: py_word, hanzi: hz_word, pos },
      sentence: { de: de_sent, pinyin: py_sent, hanzi: hz_sent }
    });
  }
  return cards;
}

// ---------------- UI ----------------
function updateLanguageDisplay(){
  const side = document.getElementById('side').value;
  const sourceEl = document.getElementById('sourceLang');
  const targetEl = document.getElementById('targetLang');
  if (side==='zh'){ sourceEl.innerHTML = '🇨🇳 Chinesisch'; targetEl.innerHTML='🇩🇪 Deutsch'; }
  else