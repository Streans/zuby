/* ================================================================
   ZUBY – interaktivní stránka
   Logika: kartáček → pasta → čištění zubů → odměna
   ================================================================ */

// ---- Reference na DOM prvky ----
const kartacek        = document.getElementById('kartacek');
const kartacekHit     = document.getElementById('kartacek-hit');
const kartacekKurzor  = document.getElementById('kartacek-kurzor');
const pasta           = document.getElementById('pasta');
const zubyImg         = document.getElementById('zuby-img');
const spinaCanvas     = document.getElementById('spina');
const spinaCtx        = spinaCanvas.getContext('2d', { willReadFrequently: true });

const prouzekPasty = document.createElement('div');
prouzekPasty.id = 'prouzek-pasty';
document.body.appendChild(prouzekPasty);

// ---- Stav aplikace ----
let drziKartacek   = false;
let maPastu        = false;
let cisteniAktivni = false;
let posledniX      = 0;
let posledniY      = 0;
let odmenaDana     = false;
let framesCisteni  = 0;

let cilX = window.innerWidth  / 2;
let cilY = window.innerHeight / 2;
let aktX = cilX;
let aktY = cilY;


// ================================================================
// ZVUKOVÝ ENGINE
// ================================================================

let audioCtx        = null;
let cisteniSrc      = null;   // aktuálně běžící noise source pro čištění
let cisteniGainNode = null;   // gain node pro fade in/out

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// ---- Zvuk pasty ----
// Vlhký "squirt": noise burst s klesajícím filtrem + nízký "plop"
function zahrajPastu() {
  if (!audioCtx) return;
  const t  = audioCtx.currentTime;
  const sr = audioCtx.sampleRate;

  // 1) Šumový burst (vzduch + guma)
  const bufLen = Math.floor(sr * 0.35);
  const nBuf   = audioCtx.createBuffer(1, bufLen, sr);
  const nData  = nBuf.getChannelData(0);
  // Nakrátko zesílíme pak utlumíme (envelope přes data)
  for (let i = 0; i < bufLen; i++) {
    const env = Math.exp(-i / (bufLen * 0.3));   // rychlý útlum
    nData[i] = (Math.random() * 2 - 1) * env;
  }

  const nSrc  = audioCtx.createBufferSource();
  nSrc.buffer = nBuf;

  // Klesající bandpass: od 1200 → 300 Hz (zvuk vytlačované pasty)
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1200, t);
  bp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
  bp.Q.value = 2;

  const nGain = audioCtx.createGain();
  nGain.gain.setValueAtTime(1.2, t);
  nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

  nSrc.connect(bp);
  bp.connect(nGain);
  nGain.connect(audioCtx.destination);
  nSrc.start(t);
  nSrc.stop(t + 0.35);

  // 2) Nízký "plop" – dojem hustoty
  const osc  = audioCtx.createOscillator();
  osc.type   = 'sine';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.14);

  const oGain = audioCtx.createGain();
  oGain.gain.setValueAtTime(0.4, t);
  oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

  osc.connect(oGain);
  oGain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.2);

  // 3) Krátký "fss" – vzduch z tuby
  const fBuf  = audioCtx.createBuffer(1, Math.floor(sr * 0.12), sr);
  const fData = fBuf.getChannelData(0);
  for (let i = 0; i < fData.length; i++) fData[i] = Math.random() * 2 - 1;

  const fSrc  = audioCtx.createBufferSource();
  fSrc.buffer = fBuf;

  const hp = audioCtx.createBiquadFilter();
  hp.type            = 'highpass';
  hp.frequency.value = 3000;

  const fGain = audioCtx.createGain();
  fGain.gain.setValueAtTime(0.15, t + 0.05);
  fGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

  fSrc.connect(hp);
  hp.connect(fGain);
  fGain.connect(audioCtx.destination);
  fSrc.start(t + 0.05);
  fSrc.stop(t + 0.18);
}

// ---- Zvuk čištění – start (vytvoří nový source) ----
function zapniCisteni() {
  if (!audioCtx || cisteniSrc) return; // už běží

  const sr  = audioCtx.sampleRate;
  const len = sr * 3; // 3s smyčka

  // Růžový šum (hřejivější než bílý)
  const buf  = audioCtx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.07;
  }

  cisteniSrc        = audioCtx.createBufferSource();
  cisteniSrc.buffer = buf;
  cisteniSrc.loop   = true;

  // Bandpass imitující štětiny na smaltě: ~2–4 kHz
  const bp = audioCtx.createBiquadFilter();
  bp.type            = 'bandpass';
  bp.frequency.value = 2800;
  bp.Q.value         = 1.2;

  // Lehký tremolo (pohyb tam a zpátky)
  const lfo     = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.value  = 5;
  lfoGain.gain.value   = 200; // ±200 Hz na centrovém kmitočtu
  lfo.connect(lfoGain);
  lfoGain.connect(bp.frequency);
  lfo.start();

  cisteniGainNode = audioCtx.createGain();
  cisteniGainNode.gain.value = 0; // začínáme v tichu

  cisteniSrc.connect(bp);
  bp.connect(cisteniGainNode);
  cisteniGainNode.connect(audioCtx.destination);
  cisteniSrc.start();

  // Fade in – ztlumená hlasitost
  cisteniGainNode.gain.setTargetAtTime(0.22, audioCtx.currentTime, 0.04);
}

// ---- Zvuk čištění – stop (fade out + destroy) ----
function vypniCisteni() {
  if (!audioCtx || !cisteniSrc) return;

  const src  = cisteniSrc;
  const gain = cisteniGainNode;
  cisteniSrc      = null;
  cisteniGainNode = null;

  // Fade out, pak zastav source
  gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.06);
  setTimeout(() => {
    try { src.stop(); } catch (_) {}
  }, 400); // 400ms = cca 7× časová konstanta → < 0.1 % hlasitosti
}

// ---- Odměna: vzestupný "ding" ----
function zahrajOdmenu() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [[523, 0], [659, 0.13], [784, 0.26], [1047, 0.40]].forEach(([freq, delay]) => {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.22, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.45);
  });
}


// ================================================================
// INICIALIZACE CANVAS ŠPÍNY
// ================================================================

function inicializujSpinu() {
  const rect = zubyImg.getBoundingClientRect();

  // Pokud layout ještě není připravený, zkusíme příště
  if (rect.width === 0 || rect.height === 0) {
    requestAnimationFrame(inicializujSpinu);
    return;
  }

  spinaCanvas.width  = Math.round(rect.width);
  spinaCanvas.height = Math.round(rect.height);
  spinaCanvas.style.width  = rect.width  + 'px';
  spinaCanvas.style.height = rect.height + 'px';

  // Alfa maska ze zubů → žlutý povlak jen uvnitř tvaru
  const tmp    = document.createElement('canvas');
  tmp.width    = spinaCanvas.width;
  tmp.height   = spinaCanvas.height;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.drawImage(zubyImg, 0, 0, tmp.width, tmp.height);

  spinaCtx.clearRect(0, 0, spinaCanvas.width, spinaCanvas.height);
  spinaCtx.drawImage(tmp, 0, 0);
  spinaCtx.globalCompositeOperation = 'source-in';
  spinaCtx.fillStyle = 'rgba(210, 180, 40, 0.85)';
  spinaCtx.fillRect(0, 0, spinaCanvas.width, spinaCanvas.height);
  spinaCtx.globalCompositeOperation = 'source-over';

  odmenaDana = false;
}

// Defer až má prohlížeč hotový layout
zubyImg.addEventListener('load', () => requestAnimationFrame(inicializujSpinu));
if (zubyImg.complete) requestAnimationFrame(inicializujSpinu);
window.addEventListener('resize', inicializujSpinu);


// ================================================================
// INTERAKCE
// ================================================================

kartacekHit.addEventListener('click', () => {
  initAudio();
  drziKartacek = true;
  document.body.classList.add('drzi-kartacek');
  kartacekHit.style.display = 'none';
});

pasta.addEventListener('click', () => {
  if (!drziKartacek) return;
  if (maPastu) return; // pastu nanášíme jen jednou

  maPastu = true;
  pasta.classList.add('ma-pastu');
  zahrajPastu();

  pasta.style.transform = 'rotate(-10deg) scale(0.92)';
  setTimeout(() => { pasta.style.transform = ''; }, 200);
});

// ---- Sledování myši / dotyku ----
document.addEventListener('mousemove', e => { cilX = e.clientX; cilY = e.clientY; });

document.addEventListener('touchmove', e => {
  e.preventDefault();
  cilX = e.touches[0].clientX;
  cilY = e.touches[0].clientY;
}, { passive: false });

document.addEventListener('touchstart', e => {
  cilX = aktX = e.touches[0].clientX;
  cilY = aktY = e.touches[0].clientY;
}, { passive: true });


// ================================================================
// ČIŠTĚNÍ ZUBŮ
// ================================================================

function jeNadZuby(x, y) {
  const r = spinaCanvas.getBoundingClientRect();
  return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function cistZuby(x, y) {
  const r = spinaCanvas.getBoundingClientRect();
  if (r.width === 0) return;

  const cx = (x - r.left) * (spinaCanvas.width  / r.width);
  const cy = (y - r.top)  * (spinaCanvas.height / r.height);

  spinaCtx.globalCompositeOperation = 'destination-out';
  spinaCtx.lineWidth = Math.max(spinaCanvas.width * 0.13, 4);
  spinaCtx.strokeStyle = 'rgba(0,0,0,1)';
  spinaCtx.lineCap  = 'round';
  spinaCtx.lineJoin = 'round';

  spinaCtx.beginPath();
  spinaCtx.moveTo(posledniX, posledniY);
  spinaCtx.lineTo(cx, cy);
  spinaCtx.stroke();

  spinaCtx.globalCompositeOperation = 'source-over';

  posledniX = cx;
  posledniY = cy;

  framesCisteni++;
  if (framesCisteni % 20 === 0) zkontrolujCistotu();
}

function zkontrolujCistotu() {
  if (odmenaDana || spinaCanvas.width === 0) return;

  const data    = spinaCtx.getImageData(0, 0, spinaCanvas.width, spinaCanvas.height).data;
  let celkem    = 0;
  let cistych   = 0;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 10) celkem++;
    else cistych++;
  }

  if ((cistych / (celkem + cistych)) > 0.95) {
    odmenaDana = true;
    vypniCisteni();
    zobrazOdmenu();
    zahrajOdmenu();
  }
}

/** Odměna: nápis ZUBY se roztančí (letter-by-letter CSS animace). */
function zobrazOdmenu() {
  const nadpis = document.querySelector('.nadpis');
  nadpis.classList.remove('slavit'); // reset pro případ opakování
  // Malý timeout zajistí restart animace i při opakovaném spuštění
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nadpis.classList.add('slavit');
    });
  });
}


// ================================================================
// ANIMAČNÍ SMYČKA – kartáček sleduje myš přes lerp
// ================================================================

function animacniSmycka() {
  if (drziKartacek) {
    aktX += (cilX - aktX) * 0.18;
    aktY += (cilY - aktY) * 0.18;

    const sirka = kartacekKurzor.offsetWidth  || 22;
    const vyska = kartacekKurzor.offsetHeight || 220;

    kartacekKurzor.style.transform =
      `translate(${aktX - sirka / 2}px, ${aktY - vyska * 0.25}px)`;

    if (maPastu) {
      prouzekPasty.style.left = (aktX - 10) + 'px';
      prouzekPasty.style.top  = (aktY - vyska * 0.18) + 'px';
    }

    if (maPastu && jeNadZuby(aktX, aktY)) {
      if (!cisteniAktivni) {
        // Nastav výchozí bod linky (aby nevznikl skok z (0,0))
        const r  = spinaCanvas.getBoundingClientRect();
        posledniX = (aktX - r.left) * (spinaCanvas.width  / r.width);
        posledniY = (aktY - r.top)  * (spinaCanvas.height / r.height);
        cisteniAktivni = true;
        zapniCisteni();
      }
      cistZuby(aktX, aktY);
    } else {
      if (cisteniAktivni) {
        cisteniAktivni = false;
        vypniCisteni();
      }
    }
  }

  requestAnimationFrame(animacniSmycka);
}

requestAnimationFrame(animacniSmycka);
