(function () {
  'use strict';

  var synth = window.speechSynthesis;
  var btn = document.getElementById('ra-play');
  var fallback = document.getElementById('ra-fallback');
  var source = document.getElementById('statement-en');

  if (!btn || !source) { return; }
  if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') { return; }

  // Words that end in a full stop without ending a sentence. Without this the
  // statement breaks after "Mr." on its opening line.
  var ABBREVIATIONS = ['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'art', 'no', 'vs',
    'etc', 'cf', 'para', 'pp', 'vol', 'ed', 'al', 'jr', 'sr'];

  // Some engines truncate a long utterance, so the text is spoken in pieces.
  var MAX_CHARS = 200;

  var voices = [];
  var speaking = false;
  var queue = [];
  var cursor = 0;
  var keepAlive = null;

  function statementText() {
    return (source.textContent || '')
      .replace(/ /g, ' ')
      // Dashes are mute to a speech engine, which runs the words together.
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/\s*,\s*(?=,)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isAbbreviation(word) {
    var m = word.match(/([A-Za-z]+)\.$/);
    if (!m) { return false; }
    for (var i = 0; i < ABBREVIATIONS.length; i++) {
      if (ABBREVIATIONS[i] === m[1].toLowerCase()) { return true; }
    }
    return false;
  }

  function splitSentences(text) {
    var words = text.split(' ');
    var pieces = [];
    var buf = '';

    for (var i = 0; i < words.length; i++) {
      buf = buf ? buf + ' ' + words[i] : words[i];
      if (/[.!?][")’”\]]?$/.test(words[i]) && !isAbbreviation(words[i])) {
        pieces.push(buf);
        buf = '';
      }
    }
    if (buf) { pieces.push(buf); }

    return capLength(pieces);
  }

  function capLength(pieces) {
    var out = [];

    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].length <= MAX_CHARS) { out.push(pieces[i]); continue; }

      var words = pieces[i].split(' ');
      var line = '';
      for (var j = 0; j < words.length; j++) {
        if (line && (line.length + 1 + words[j].length) > MAX_CHARS) {
          out.push(line);
          line = words[j];
        } else {
          line = line ? line + ' ' + words[j] : words[j];
        }
      }
      if (line) { out.push(line); }
    }

    return out;
  }

  // Chrome fills the voice list asynchronously and returns an empty array on
  // the first call.
  function loadVoices() {
    voices = synth.getVoices() || [];
  }

  function pickVoice() {
    var english = [];
    var i;

    for (i = 0; i < voices.length; i++) {
      if (voices[i].lang && voices[i].lang.toLowerCase().indexOf('en') === 0) {
        english.push(voices[i]);
      }
    }
    if (!english.length) { return null; }

    var local = [];
    for (i = 0; i < english.length; i++) {
      if (english[i].localService) { local.push(english[i]); }
    }
    var pool = local.length ? local : english;

    for (i = 0; i < pool.length; i++) {
      if (pool[i].default) { return pool[i]; }
    }
    return pool[0];
  }

  function setSpeaking(on) {
    speaking = on;
    btn.textContent = on ? '⏹ Stop' : '🔊 Read aloud';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function stop() {
    queue = [];
    cursor = 0;
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    setSpeaking(false);
    synth.cancel();
  }

  function start() {
    var text = statementText();
    if (!text) { return; }

    synth.cancel();
    queue = splitSentences(text);
    cursor = 0;
    setSpeaking(true);

    keepAlive = setInterval(function () {
      if (!speaking) { clearInterval(keepAlive); keepAlive = null; return; }
      if (synth.paused) { synth.resume(); }
    }, 5000);

    speakNext();
  }

  function speakNext() {
    if (!speaking) { return; }
    if (cursor >= queue.length) { stop(); return; }

    var u = new SpeechSynthesisUtterance(queue[cursor]);
    var voice = pickVoice();

    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = 'en-US';
    }

    u.rate = 0.95;

    u.onend = function () {
      if (!speaking) { return; }
      cursor++;
      speakNext();
    };

    u.onerror = function (e) {
      var reason = e && e.error;
      if (reason === 'interrupted' || reason === 'canceled') { return; }
      stop();
    };

    synth.speak(u);
  }

  btn.addEventListener('click', function () {
    if (speaking) { stop(); } else { start(); }
  });

  // Speech outlives the page in several browsers unless it is cancelled.
  window.addEventListener('pagehide', stop);
  window.addEventListener('beforeunload', stop);

  loadVoices();
  if (typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = loadVoices;
  }
  setTimeout(loadVoices, 500);

  setSpeaking(false);
  if (fallback) { fallback.hidden = true; }
  btn.hidden = false;
})();
