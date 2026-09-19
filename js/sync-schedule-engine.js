/**
 * sync-schedule-engine.js — AP-SQL Assistant V10.7
 * ---------------------------------------------------------------------------
 * Provides a small, fixed set of predefined "Schema Synchronization Time"
 * options (a dropdown, per the requirement), persists the selected option,
 * and computes next-run timestamps consistently for every configured
 * schema's automatic synchronization.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'ap_sql_sync_schedule_v1';

  var OPTIONS = [
    { id: 'manual', label: 'Manual only (no automatic synchronization)', minutes: null },
    { id: '30s', label: 'Every 30 seconds', minutes: 0.5 },
    { id: '1m', label: 'Every 1 minute', minutes: 1 },
    { id: '5m', label: 'Every 5 minutes', minutes: 5 },
    { id: '15m', label: 'Every 15 minutes', minutes: 15 },
    { id: '30m', label: 'Every 30 minutes', minutes: 30 },
    { id: '1h', label: 'Every hour', minutes: 60 },
    { id: '6h', label: 'Every 6 hours', minutes: 360 },
    { id: '24h', label: 'Every 24 hours', minutes: 1440 }
  ];
  var DEFAULT_OPTION_ID = '30s';

  function getOption(id) { return OPTIONS.filter(function (o) { return o.id === id; })[0] || null; }
  function getDefaultOption() { return getOption(DEFAULT_OPTION_ID); }

  function loadSelectedOptionId(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storageImpl) return DEFAULT_OPTION_ID;
    var stored; try { stored = storageImpl.getItem(STORAGE_KEY); } catch (e) { stored = null; }
    return (stored && getOption(stored)) ? stored : DEFAULT_OPTION_ID;
  }
  function saveSelectedOptionId(storageImpl, id) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!getOption(id)) return false;
    if (storageImpl) { try { storageImpl.setItem(STORAGE_KEY, id); } catch (e) { return false; } }
    return true;
  }

  /** computeNextRun(optionId, fromDate) — returns an ISO string for the next
   * scheduled run, or null if the schedule is 'manual' (no automatic runs). */
  function computeNextRun(optionId, fromDate) {
    var opt = getOption(optionId);
    if (!opt || opt.minutes == null) return null;
    var base = fromDate instanceof Date ? fromDate : new Date();
    return new Date(base.getTime() + opt.minutes * 60000).toISOString();
  }

  /** toIntervalMs(optionId) — converts a schedule option into a millisecond
   * interval suitable for setInterval; returns null for 'manual'. */
  function toIntervalMs(optionId) {
    var opt = getOption(optionId);
    if (!opt || opt.minutes == null) return null;
    return Math.round(opt.minutes * 60000);
  }

  var API = {
    OPTIONS: OPTIONS, DEFAULT_OPTION_ID: DEFAULT_OPTION_ID,
    getOption: getOption, getDefaultOption: getDefaultOption,
    loadSelectedOptionId: loadSelectedOptionId, saveSelectedOptionId: saveSelectedOptionId,
    computeNextRun: computeNextRun, toIntervalMs: toIntervalMs
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SYNC_SCHEDULE = API;
})(typeof window !== 'undefined' ? window : this);
