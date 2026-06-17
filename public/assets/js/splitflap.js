/**
 * splitflap.js — a dependency-free split-flap ("Solari board") component.
 *
 * Each character is a tile that flips through the charset from its current
 * glyph to the target glyph, giving the classic airport-board cascade.
 *
 * Public API:
 *   const cell = new FlapCell();           // a single character tile
 *   cell.set('A');                          // animate to 'A'
 *
 *   const row = new FlapText(el, 9);        // a fixed-width text field
 *   row.set('AA1234');                      // animate the whole field
 *
 *   SplitFlap.diffRows(oldRows, newRows)    // helper for board.js
 */
(function (global) {
  'use strict';

  // Glyph order the flaps roll through. Space first so blanks look clean.
  const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/-+.';
  const INDEX = {};
  for (let i = 0; i < CHARSET.length; i++) INDEX[CHARSET[i]] = i;

  const STEP_MS = 55;     // time per single flip
  const MAX_STEPS = 8;    // cap flips per cell so a fresh tile doesn't roll the whole charset
  const reduceMotion = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function normChar(ch) {
    if (ch == null) return ' ';
    ch = String(ch).toUpperCase();
    return INDEX[ch] === undefined ? ' ' : ch;
  }

  class FlapCell {
    constructor() {
      this.current = ' ';
      this.queueTarget = ' ';
      this.animating = false;

      const el = document.createElement('span');
      el.className = 'sf-cell';
      el.innerHTML =
        '<span class="sf-half sf-top"><span class="sf-ch"> </span></span>' +
        '<span class="sf-half sf-bottom"><span class="sf-ch"> </span></span>' +
        '<span class="sf-flap sf-flap-front"><span class="sf-ch"> </span></span>' +
        '<span class="sf-flap sf-flap-back"><span class="sf-ch"> </span></span>';
      this.el = el;
      this.topCh   = el.querySelector('.sf-top .sf-ch');
      this.botCh   = el.querySelector('.sf-bottom .sf-ch');
      this.frontCh = el.querySelector('.sf-flap-front .sf-ch');
      this.backEl  = el.querySelector('.sf-flap-back');
      this.backCh  = el.querySelector('.sf-flap-back .sf-ch');
      this._paint(' ');
    }

    _paint(ch) {
      this.topCh.textContent = ch;
      this.botCh.textContent = ch;
      this.frontCh.textContent = ch;
      this.backCh.textContent = ch;
    }

    set(target, immediate) {
      target = normChar(target);
      this.queueTarget = target;
      if (this.current === target) return;
      if (immediate || reduceMotion) {
        this.current = target;
        this.animating = false;
        this._paint(target);
        return;
      }
      if (!this.animating) {
        // Jump instantly to within MAX_STEPS of the target, then animate the
        // last few flips — keeps the rolling feel without the long spin-up.
        const N = CHARSET.length;
        const dist = (INDEX[target] - INDEX[this.current] + N) % N;
        if (dist > MAX_STEPS) {
          const jump = CHARSET[(INDEX[target] - MAX_STEPS + N) % N];
          this.current = jump;
          this._paint(jump);
        }
        this._run();
      }
    }

    _run() {
      if (this.current === this.queueTarget) { this.animating = false; return; }
      this.animating = true;

      const from = this.current;
      const next = CHARSET[(INDEX[from] + 1) % CHARSET.length];

      // Static halves: top already shows the upcoming glyph, bottom shows old.
      this.topCh.textContent = next;
      this.botCh.textContent = from;
      // Flap: front (upper) shows old glyph, back (lower, pre-rotated) shows new.
      this.frontCh.textContent = from;
      this.backCh.textContent = next;

      this.el.classList.remove('sf-flip');
      // force reflow so the animation restarts each step
      void this.el.offsetWidth;
      this.el.classList.add('sf-flip');

      // The back leaf lands last, so its animationend marks the step complete.
      const done = () => {
        this.backEl.removeEventListener('animationend', done);
        this.current = next;
        this.botCh.textContent = next;     // settle bottom to the new glyph
        this.el.classList.remove('sf-flip');
        this._run();                        // continue toward target
      };
      this.backEl.addEventListener('animationend', done);
    }
  }

  class FlapText {
    constructor(host, width) {
      this.cells = [];
      host.classList.add('sf-field');
      host.innerHTML = '';
      this.width = width;
      for (let i = 0; i < width; i++) {
        const c = new FlapCell();
        this.cells.push(c);
        host.appendChild(c.el);
      }
    }
    set(text, immediate) {
      text = (text == null ? '' : String(text)).toUpperCase();
      for (let i = 0; i < this.width; i++) {
        this.cells[i].set(text[i] || ' ', immediate);
      }
    }
  }

  global.FlapCell = FlapCell;
  global.FlapText = FlapText;
  global.SplitFlap = { CHARSET, normChar };
})(window);
