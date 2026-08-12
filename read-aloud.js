/* Human Flag — read-aloud control for the CCW GGE statement.
 *
 * Native Web Speech API only: no library, no external service, no key.
 * The spoken text is read from the DOM at the moment the button is pressed,
 * so editing the statement in statement.html also updates the audio.
 *
 * Languages are declared by elements in the page:
 *   #statement-en  the statement as displayed
 *   #statement-it  the Italian translation, hidden, may be empty
 * A language is offered only when its element holds text, so the control can
 * never present a button that produces nothing.
 */
(function () {
  'use strict';

  var synth = window.speechSynthesis;

  var root = document.getElementById('read-aloud');
  var fallback = document.getElementById('ra-fallback');
  var btn = document.getElementById('ra-play');
  var label = document.getElementById('ra-label');
  var status = document.getElementById('ra-status');
  var langBox = document.getElementById('ra-langs');

  if (!root || !btn) { return; }

  // Unsupported browser: the markup already shows the fallback line and keeps
  // the control hidden, so there is nothing to do but leave it that way.
  if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') { return; }

  var LOCALE = { en: 'en-US', it: 'it-IT' };

  // Words that end in a full stop without ending a sentence. Without this the
  // statement would break after "Mr." on its opening line.
  var ABBREVIATIONS = [
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'art', 'arts', 'no', 'nos', 'vs',
    'etc', 'cf', 'ibid', 'para', 'paras', 'pp', 'vol', 'ed', 'edn', 'al',
    'jr', 'sr', 'sig', 'sigg', 'dott', 'avv', 'on', 'sec', 'secs'
  ];

  // Some engines silently truncate a long utterance, so the text is spoken in
  // sentence-sized pieces and this is the ceiling for any one of them.
  var MAX_CHARS = 200;

  var sources = {
    en: document.getElementById('statement-en'),
    it: document.getElementById('statement-it')
  };

  var voices = [];
  var lang = 'en';
  var speaking = false;
  var queue = [];
  var cursor = 0;
  var keepAlive = null;

  function textFor(code) {
    var el = sources[code];
    if (!el) { return ''; }
    return normalize(el.textContent || '');
  }

  function normalize(s) {
    return s
      .replace(/ /g, ' ')
      // Dashes set off an aside in writing but are mute to a speech engine,
      // which runs the words together; a comma restores the intended pause.
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
      var w = words[i];
      buf = buf ? buf + ' ' + w : w;
      if (/[.!?][")’”\]]?$/.test(w) && !isAbbreviation(w)) {
        pieces.push(buf);
        buf = '';
      }
    }
    if (buf) { pieces.push(buf); }

    return capLength(pieces);
  }

  // Break anything still over the ceiling, preferring comma boundaries and
  // falling back to whole words so a piece never splits mid-word.
  function capLength(pieces) {
    var out = [];

    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (piece.length <= MAX_CHARS) { out.push(piece); continue; }

      var units = piece.split(/,\s+/);
      for (var u = 0; u < units.length; u++) {
        if (u < units.length - 1) { units[u] += ','; }
      }

      var cur = '';
      for (var j = 0; j < units.length; j++) {
        var unit = units[j];
        if (unit.length > MAX_CHARS) {
          if (cur) { out.push(cur); cur = ''; }
          var ws = unit.split(' ');
          var line = '';
          for (var k = 0; k < ws.length; k++) {
            if (line && (line.length + 1 + ws[k].length) > MAX_CHARS) {
              out.push(line);
              line = ws[k];
            } else {
              line = line ? line + ' ' + ws[k] : ws[k];
            }
          }
          if (line) { cur = line; }
        } else if (cur && (cur.length + 1 + unit.length) > MAX_CHARS) {
          out.push(cur);
          cur = unit;
        } else {
          cur = cur ? cur + ' ' + unit : unit;
        }
      }
      if (cur) { out.push(cur); }
    }

    return out;
  }

  // Chrome populates the voice list asynchronously and reports an empty array
  // on first call, so the list is re-read on the event and on a short retry.
  function loadVoices() {
    voices = synth.getVoices() || [];
  }

  function pickVoice(code) {
    var prefix = code === 'it' ? 'it' : 'en';
    var matching = [];
    var i;

    for (i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (v.lang && v.lang.toLowerCase().indexOf(prefix) === 0) { matching.push(v); }
    }
    if (!matching.length) { return null; }

    var local = [];
    for (i = 0; i < matching.length; i++) {
      if (matching[i].localService) { local.push(matching[i]); }
    }
    var pool = local.length ? local : matching;

    for (i = 0; i < pool.length; i++) {
      if (pool[i].default) { return pool[i]; }
    }
    return pool[0];
  }

  function setSpeakingState(on) {
    speaking = on;
    root.className = on ? 'read-aloud is-speaking' : 'read-aloud';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    label.textContent = on ? 'Stop' : 'Read aloud';
    status.textContent = on ? 'Reading the statement aloud.' : '';
  }

  function stop() {
    queue = [];
    cursor = 0;
    stopKeepAlive();
    setSpeakingState(false);
    synth.cancel();
  }

  function start() {
    var text = textFor(lang);
    if (!text) { return; }

    synth.cancel();
    queue = splitSentences(text);
    cursor = 0;
    setSpeakingState(true);
    startKeepAlive();
    speakNext();
  }

  function speakNext() {
    if (!speaking) { return; }
    if (cursor >= queue.length) { stop(); return; }

    var u = new SpeechSynthesisUtterance(queue[cursor]);
    var voice = pickVoice(lang);

    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = LOCALE[lang];
    }

    u.rate = 0.95;
    u.pitch = 1;

    u.onend = function () {
      if (!speaking) { return; }
      cursor++;
      speakNext();
    };

    u.onerror = function (e) {
      // Cancelling to stop, or to switch language, surfaces here as an error.
      var reason = e && e.error;
      if (reason === 'interrupted' || reason === 'canceled') { return; }
      stop();
    };

    synth.speak(u);
  }

  // Long readings can be suspended by the browser; resuming only when the
  // engine reports itself paused avoids the clicks a blind pause/resume causes.
  function startKeepAlive() {
    stopKeepAlive();
    keepAlive = setInterval(function () {
      if (!speaking) { stopKeepAlive(); return; }
      if (synth.paused) { synth.resume(); }
    }, 5000);
  }

  function stopKeepAlive() {
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  }

  function selectLang(code) {
    if (code === lang) { return; }
    if (speaking) { stop(); }
    lang = code;

    var buttons = langBox.getElementsByTagName('button');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-lang') === code;
      buttons[i].className = on ? 'ra-lang is-active' : 'ra-lang';
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function buildLangs() {
    if (!langBox) { return; }

    var available = [];
    for (var code in LOCALE) {
      if (Object.prototype.hasOwnProperty.call(LOCALE, code) && textFor(code)) {
        available.push(code);
      }
    }

    // A selector with a single choice is not a choice: while the translation
    // element is empty the page simply offers English and shows no selector.
    if (available.length < 2) {
      langBox.hidden = true;
      return;
    }

    langBox.hidden = false;
    var buttons = langBox.getElementsByTagName('button');
    for (var i = 0; i < buttons.length; i++) {
      var code = buttons[i].getAttribute('data-lang');
      buttons[i].hidden = available.indexOf(code) === -1;
    }
  }

  btn.addEventListener('click', function () {
    if (speaking) { stop(); } else { start(); }
  });

  if (langBox) {
    langBox.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== langBox && t.nodeName !== 'BUTTON') { t = t.parentNode; }
      if (t && t.nodeName === 'BUTTON') { selectLang(t.getAttribute('data-lang')); }
    });
  }

  // Speech outlives the document in several browsers unless it is cancelled.
  window.addEventListener('pagehide', stop);
  window.addEventListener('beforeunload', stop);

  loadVoices();
  if (typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = loadVoices;
  }
  setTimeout(loadVoices, 500);

  buildLangs();
  setSpeakingState(false);

  fallback.hidden = true;
  root.hidden = false;
})();
