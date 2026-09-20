/* ==========================================================================
   AP-SQL Assistant — Guided Walkthrough Engine (V10.8)
   --------------------------------------------------------------------------
   A dependency-free, fully responsive guided-tour engine that replaces the
   V10.7/V10.7.1 fixed-position tour (#tourOverlay/#tourPopup with a single,
   generic step list shared loosely across pages).

   V10.8 redesign goals:
   - Page-specific tours (registered per view) instead of one generic tour.
   - Every step explains: what it does, why it helps, what to do, and what
     happens after completing the step.
   - The tooltip/dialog card ALWAYS stays completely inside the viewport, on
     any screen size, window size, or browser zoom level — it never covers
     the element it is describing, and its own Next/Previous/Skip/Finish
     controls are always reachable without scrolling the page.
   - Automatically flips to whichever side of the target has the most room,
     and drops into a full-width "bottom sheet" layout on narrow screens so
     nothing is ever cut off.
   - Clear step-by-step progress indicator (Step X of Y + progress dots).
   - Can be restarted at any time, from any page, for that page's tour.
   ========================================================================== */
(function (root) {
  'use strict';

  var MARGIN = 14;               // minimum gap kept between the tour card and the viewport edge
  var GAP = 12;                  // gap between the target spotlight and the tour card
  var MOBILE_BREAKPOINT = 576;   // below this width, use the docked bottom-sheet layout

  var registry = {};              // viewId -> [steps]
  var state = {
    active: false,
    viewId: null,
    stepIndex: 0,
    steps: [],
    onFinish: null
  };

  var els = {};
  var reflowScheduled = false;
  var seenKey = 'ap_sql_tour_seen_v1';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ensureDom() {
    if (els.root) return;
    var root_ = document.createElement('div');
    root_.id = 'apTourRoot';
    root_.setAttribute('aria-live', 'polite');
    root_.innerHTML =
      '<div id="apTourBackdrop" class="ap-tour-backdrop" data-ap-tour-dismiss="skip"></div>' +
      '<div id="apTourSpotlight" class="ap-tour-spotlight"></div>' +
      '<div id="apTourCard" class="ap-tour-card" role="dialog" aria-modal="true" aria-labelledby="apTourTitle">' +
      '  <div class="ap-tour-arrow" id="apTourArrow"></div>' +
      '  <div class="ap-tour-card-header">' +
      '    <div class="ap-tour-progress-wrap">' +
      '      <span class="ap-tour-step-count" id="apTourStepCount"></span>' +
      '      <div class="ap-tour-dots" id="apTourDots"></div>' +
      '    </div>' +
      '    <button type="button" class="ap-tour-close" id="apTourCloseBtn" aria-label="Close walkthrough"><i class="bi bi-x-lg"></i></button>' +
      '  </div>' +
      '  <div class="ap-tour-card-body">' +
      '    <h5 class="ap-tour-title" id="apTourTitle"></h5>' +
      '    <div class="ap-tour-section ap-tour-what"><i class="bi bi-info-circle-fill"></i><div><span class="ap-tour-label">What it does</span><div id="apTourWhat"></div></div></div>' +
      '    <div class="ap-tour-section ap-tour-why"><i class="bi bi-lightbulb-fill"></i><div><span class="ap-tour-label">Why it helps</span><div id="apTourWhy"></div></div></div>' +
      '    <div class="ap-tour-section ap-tour-do"><i class="bi bi-cursor-fill"></i><div><span class="ap-tour-label">What to do</span><div id="apTourDo"></div></div></div>' +
      '    <div class="ap-tour-section ap-tour-then"><i class="bi bi-arrow-right-circle-fill"></i><div><span class="ap-tour-label">What happens next</span><div id="apTourThen"></div></div></div>' +
      '  </div>' +
      '  <div class="ap-tour-card-footer">' +
      '    <button type="button" class="btn btn-outline-secondary btn-sm" id="apTourSkipBtn">Skip</button>' +
      '    <div class="ap-tour-footer-nav">' +
      '      <button type="button" class="btn btn-outline-primary btn-sm" id="apTourPrevBtn"><i class="bi bi-chevron-left"></i> Previous</button>' +
      '      <button type="button" class="btn btn-primary btn-sm" id="apTourNextBtn">Next <i class="bi bi-chevron-right"></i></button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(root_);
    els.root = root_;
    els.backdrop = root_.querySelector('#apTourBackdrop');
    els.spotlight = root_.querySelector('#apTourSpotlight');
    els.card = root_.querySelector('#apTourCard');
    els.arrow = root_.querySelector('#apTourArrow');
    els.stepCount = root_.querySelector('#apTourStepCount');
    els.dots = root_.querySelector('#apTourDots');
    els.title = root_.querySelector('#apTourTitle');
    els.what = root_.querySelector('#apTourWhat');
    els.why = root_.querySelector('#apTourWhy');
    els.doThis = root_.querySelector('#apTourDo');
    els.then = root_.querySelector('#apTourThen');
    els.closeBtn = root_.querySelector('#apTourCloseBtn');
    els.skipBtn = root_.querySelector('#apTourSkipBtn');
    els.prevBtn = root_.querySelector('#apTourPrevBtn');
    els.nextBtn = root_.querySelector('#apTourNextBtn');

    els.backdrop.addEventListener('click', function () { end(true); });
    els.closeBtn.addEventListener('click', function () { end(true); });
    els.skipBtn.addEventListener('click', function () { end(true); });
    els.prevBtn.addEventListener('click', function () { goTo(state.stepIndex - 1); });
    els.nextBtn.addEventListener('click', function () {
      if (state.stepIndex >= state.steps.length - 1) end(false);
      else goTo(state.stepIndex + 1);
    });
    window.addEventListener('resize', scheduleReflow);
    window.addEventListener('scroll', scheduleReflow, true);
    document.addEventListener('keydown', function (e) {
      if (!state.active) return;
      if (e.key === 'Escape') { end(true); }
      else if (e.key === 'ArrowRight') { els.nextBtn.click(); }
      else if (e.key === 'ArrowLeft' && state.stepIndex > 0) { goTo(state.stepIndex - 1); }
    });
  }

  function registerTour(viewId, steps) { registry[viewId] = steps || []; }
  function getTour(viewId) { return registry[viewId] || []; }
  function hasTour(viewId) { return !!(registry[viewId] && registry[viewId].length); }

  function markSeen(viewId) {
    try {
      var seen = JSON.parse(localStorage.getItem(seenKey) || '{}');
      seen[viewId] = true;
      localStorage.setItem(seenKey, JSON.stringify(seen));
    } catch (e) {}
  }
  function hasSeen(viewId) {
    try { var seen = JSON.parse(localStorage.getItem(seenKey) || '{}'); return !!seen[viewId]; } catch (e) { return false; }
  }

  function start(viewId, opts) {
    opts = opts || {};
    var steps = getTour(viewId);
    if (!steps.length) return false;
    ensureDom();
    state.active = true;
    state.viewId = viewId;
    state.steps = steps;
    state.stepIndex = 0;
    state.onFinish = opts.onFinish || null;
    document.body.classList.add('ap-tour-open');
    els.root.classList.add('open');
    render();
    return true;
  }

  function end(skipped) {
    if (!state.active) return;
    state.active = false;
    document.body.classList.remove('ap-tour-open');
    if (els.root) els.root.classList.remove('open');
    clearTargetHighlight();
    markSeen(state.viewId);
    var cb = state.onFinish;
    state.onFinish = null;
    if (cb) cb({ skipped: !!skipped, viewId: state.viewId });
  }

  function goTo(idx) {
    if (idx < 0 || idx >= state.steps.length) return;
    state.stepIndex = idx;
    render();
  }

  var lastTargetEl = null;
  function clearTargetHighlight() {
    if (lastTargetEl) { lastTargetEl.classList.remove('ap-tour-target-active'); lastTargetEl = null; }
  }

  function resolveTarget(step) {
    if (!step.selector) return null;
    try { return document.querySelector(step.selector); } catch (e) { return null; }
  }

  function render() {
    var step = state.steps[state.stepIndex];
    if (!step) return end(false);
    clearTargetHighlight();

    els.title.textContent = step.title || '';
    els.what.innerHTML = esc(step.what || '');
    els.why.innerHTML = esc(step.why || '');
    els.doThis.innerHTML = esc(step.doThis || '');
    els.then.innerHTML = esc(step.then || '');

    els.stepCount.textContent = 'Step ' + (state.stepIndex + 1) + ' of ' + state.steps.length;
    els.dots.innerHTML = state.steps.map(function (s, i) {
      return '<span class="ap-tour-dot' + (i === state.stepIndex ? ' active' : (i < state.stepIndex ? ' done' : '')) + '"></span>';
    }).join('');

    els.prevBtn.disabled = state.stepIndex === 0;
    els.nextBtn.innerHTML = (state.stepIndex === state.steps.length - 1)
      ? 'Finish <i class="bi bi-check2"></i>'
      : 'Next <i class="bi bi-chevron-right"></i>';

    var target = resolveTarget(step);
    if (target) {
      try { target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (e) {}
      target.classList.add('ap-tour-target-active');
      lastTargetEl = target;
    }

    // allow scroll-into-view + layout to settle before measuring
    setTimeout(function () { position(target, step); }, 60);
    scheduleReflow();
  }

  function scheduleReflow() {
    if (!state.active || reflowScheduled) return;
    reflowScheduled = true;
    requestAnimationFrame(function () {
      reflowScheduled = false;
      if (!state.active) return;
      var step = state.steps[state.stepIndex];
      var target = step ? resolveTarget(step) : null;
      position(target, step);
    });
  }

  function position(target, step) {
    if (!els.card) return;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    // Narrow screens: dock as a full-width bottom sheet so nothing can ever
    // be clipped, overlap a target, or fall outside the viewport.
    if (vw < MOBILE_BREAKPOINT) {
      els.card.classList.add('ap-tour-docked');
      els.card.style.top = '';
      els.card.style.left = '';
      els.card.style.right = '';
      els.card.style.bottom = '0px';
      els.arrow.style.display = 'none';
      positionSpotlight(target, vw, vh);
      return;
    }
    els.card.classList.remove('ap-tour-docked');
    els.card.style.bottom = '';

    if (!target) {
      // No specific element to anchor to (e.g. a page-level intro step) — center the card.
      els.spotlight.style.display = 'none';
      els.arrow.style.display = 'none';
      var cw = els.card.offsetWidth, ch = els.card.offsetHeight;
      els.card.style.left = Math.max(MARGIN, (vw - cw) / 2) + 'px';
      els.card.style.top = Math.max(MARGIN, (vh - ch) / 2) + 'px';
      return;
    }

    var rect = target.getBoundingClientRect();
    positionSpotlight(target, vw, vh);

    var cardW = els.card.offsetWidth || 340;
    var cardH = els.card.offsetHeight || 220;

    var placements = buildPlacements(rect, cardW, cardH, vw, vh);
    var chosen = placements.filter(function (p) { return p.fits; })[0] || placements[0];

    els.card.style.left = chosen.left + 'px';
    els.card.style.top = chosen.top + 'px';
    els.arrow.style.display = '';
    els.arrow.className = 'ap-tour-arrow ap-tour-arrow-' + chosen.side;
    positionArrow(chosen, rect);
  }

  function buildPlacements(rect, cardW, cardH, vw, vh) {
    var out = [];
    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
    function evalPlacement(side) {
      var top, left;
      switch (side) {
        case 'bottom':
          top = rect.bottom + GAP; left = clamp(rect.left + rect.width / 2 - cardW / 2, MARGIN, vw - cardW - MARGIN);
          break;
        case 'top':
          top = rect.top - GAP - cardH; left = clamp(rect.left + rect.width / 2 - cardW / 2, MARGIN, vw - cardW - MARGIN);
          break;
        case 'right':
          top = clamp(rect.top + rect.height / 2 - cardH / 2, MARGIN, vh - cardH - MARGIN); left = rect.right + GAP;
          break;
        case 'left':
          top = clamp(rect.top + rect.height / 2 - cardH / 2, MARGIN, vh - cardH - MARGIN); left = rect.left - GAP - cardW;
          break;
      }
      var fits = (top >= MARGIN && top + cardH <= vh - MARGIN && left >= MARGIN && left + cardW <= vw - MARGIN);
      return { side: side, top: top, left: left, fits: fits };
    }
    // Prefer whichever side of the target actually has the most room, so the
    // card never needs to overlap the element it is describing.
    var spaceBelow = vh - rect.bottom, spaceAbove = rect.top, spaceRight = vw - rect.right, spaceLeft = rect.left;
    var order = [spaceBelow, spaceAbove, spaceRight, spaceLeft];
    var sides = ['bottom', 'top', 'right', 'left'];
    var indices = [0, 1, 2, 3].sort(function (a, b) { return order[b] - order[a]; });
    indices.forEach(function (i) { out.push(evalPlacement(sides[i])); });
    // Final guaranteed-fit fallback: clamp fully inside the viewport near the target.
    var fallbackTop = clamp(rect.bottom + GAP, MARGIN, vh - cardH - MARGIN);
    var fallbackLeft = clamp(rect.left, MARGIN, vw - cardW - MARGIN);
    out.push({ side: 'bottom', top: fallbackTop, left: fallbackLeft, fits: true });
    return out;
  }

  function positionArrow(chosen, rect) {
    var size = 9;
    if (chosen.side === 'bottom' || chosen.side === 'top') {
      var arrowLeft = clamp(rect.left + rect.width / 2 - chosen.left - size, 12, (els.card.offsetWidth || 340) - size * 2 - 12);
      els.arrow.style.left = arrowLeft + 'px';
      els.arrow.style.top = '';
    } else {
      var arrowTop = clamp(rect.top + rect.height / 2 - chosen.top - size, 12, (els.card.offsetHeight || 220) - size * 2 - 12);
      els.arrow.style.top = arrowTop + 'px';
      els.arrow.style.left = '';
    }
    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  }

  function positionSpotlight(target, vw, vh) {
    if (!target) { els.spotlight.style.display = 'none'; return; }
    var rect = target.getBoundingClientRect();
    var pad = 6;
    var top = Math.max(0, rect.top - pad), left = Math.max(0, rect.left - pad);
    var width = Math.min(vw, rect.width + pad * 2), height = Math.min(vh, rect.height + pad * 2);
    els.spotlight.style.display = '';
    els.spotlight.style.top = top + 'px';
    els.spotlight.style.left = left + 'px';
    els.spotlight.style.width = width + 'px';
    els.spotlight.style.height = height + 'px';
  }

  var API = {
    registerTour: registerTour,
    hasTour: hasTour,
    start: start,
    end: end,
    hasSeen: hasSeen,
    markSeen: markSeen,
    isActive: function () { return state.active; }
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_TOUR = API;
})(typeof window !== 'undefined' ? window : this);
