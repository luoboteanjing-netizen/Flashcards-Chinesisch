let data = [];
let currentIndex = 0;
let showAnswer = false;
let direction = 'de-zh';
let autoplay = false;

async function loadCSV() {
  const res = await fetch('./data/data.csv');
  const text = await res.text();

  const rows = text.split('\n').slice(1);

  data = rows
    .map(r => r.split(','))
    .filter(r => r.length > 5 && !r[0].includes('*'))
    .map(r => ({
      de: r[0],
      pinyin: r[1],
      pos: r[2],
      sentencePinyin: r[3],
      sentenceDe: r[4],
      hanzi: r[5],
      sentenceHanzi: r[6],
      id: r[7],
      lesson: r[8]
    }));

  renderQuestion();
}

function renderQuestion() {
  const q = data[currentIndex];
  const box = document.getElementById('questionBox');

  if (direction === 'de-zh') {
    box.innerHTML = `<b>${q.id}</b><br>${q.de}<br><span class="small-gray">${q.pos}</span><br>${q.sentenceDe}`;
  } else {
    box.innerHTML = `<b>${q.id}</b><br>${q.hanzi}<br>${q.pinyin} <span class="small-gray">${q.pos}</span><br>${q.sentenceHanzi}<br>${q.sentencePinyin}`;
  }

  document.getElementById('answerBox').innerHTML = '';
  document.getElementById('resultButtons').classList.add('hidden');
}

function renderAnswer() {
  const q = data[currentIndex];
  const box = document.getElementById('answerBox');

  if (direction === 'de-zh') {
    box.innerHTML = `${q.hanzi}<br>${q.pinyin} <span class="small-gray">${q.pos}</span><br>${q.sentenceHanzi}<br>${q.sentencePinyin}`;
  } else {
    box.innerHTML = `${q.de}<br><span class="small-gray">${q.pos}</span><br>${q.sentenceDe}`;
  }

  document.getElementById('resultButtons').classList.remove('hidden');
}

document.getElementById('nextBtn').onclick = () => {
  currentIndex = (currentIndex + 1) % data.length;
  renderQuestion();
};

document.getElementById('prevBtn').onclick = () => {
  currentIndex = (currentIndex - 1 + data.length) % data.length;
  renderQuestion();
};

document.getElementById('showBtn').onclick = renderAnswer;

document.getElementById('switchLang').onclick = () => {
  direction = direction === 'de-zh' ? 'zh-de' : 'de-zh';
  renderQuestion();
};

loadCSV();
