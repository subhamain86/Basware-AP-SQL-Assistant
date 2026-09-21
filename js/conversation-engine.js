/* conversation-engine.js — conversation-based query refinement (spec section 17).
   Keeps the last interpreted plan for a builder session and merges follow-up
   instructions into it via nl-query-engine.refinePlan, so a sequence like:
     "Show invoices from supplier ABC" -> "Only show the last three months"
     -> "Add supplier name" -> "Sort by highest amount"
   progressively narrows/extends the same underlying plan instead of starting over. */
(function (root) {
  'use strict';

  var NLQ = (typeof module === 'object' && module.exports) ? require('./nl-query-engine.js') : root.APSQL_NLQ;

  function createConversation() {
    var history = []; // [{ text, plan }]
    var currentPlan = null;

    function isFollowUp(text) {
      var t = text.toLowerCase().trim();
      return /^(only |also |add |include |remove |exclude |sort by|order by|and |then |now |limit |show only|filter )/.test(t) && !!currentPlan;
    }

    function submit(text, engine) {
      var plan;
      if (isFollowUp(text)) {
        plan = NLQ.refinePlan(currentPlan, text, engine);
      } else {
        plan = NLQ.interpretRequirement(text, engine, {});
      }
      currentPlan = plan;
      history.push({ text: text, plan: plan });
      return plan;
    }

    function getCurrentPlan() { return currentPlan; }
    function getHistory() { return history.slice(); }
    function reset() { history = []; currentPlan = null; }

    return { submit: submit, getCurrentPlan: getCurrentPlan, getHistory: getHistory, reset: reset, isFollowUp: isFollowUp };
  }

  var API = { createConversation: createConversation };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_CONVERSATION = API;
})(typeof window !== 'undefined' ? window : this);
