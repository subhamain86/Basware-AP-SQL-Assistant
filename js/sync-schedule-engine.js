(function (root) {
  'use strict';
  var STORAGE_KEY = 'ap_sql_sync_schedule_v1';
  var OPTIONS = [
    { id: 'manual', label: 'Manual only (no automatic synchronization)', minutes: null },
    { id: '1m', label: 'Every 1 minute', minutes: 1 },
    { id: '5m', label: 'Every 5 minutes', minutes: 5 },
    { id: '15m', label: 'Every 15 minutes', minutes: 15 },
    { id: '30m', label: 'Every 30 minutes', minutes: 30 },
    { id: '1h', label: 'Every hour', minutes: 60 },
    { id: '6h', label: 'Every 6 hours', minutes: 360 },
    { id: '24h', label: 'Every 24 hours', minutes: 1440 }
  ];
  var DEFAULT_OPTION_ID = '15m';
  function getOption(id) { return OPTIONS.filter(function (o) { return o.id === id; })[0] || null; }
  function loadSelectedOptionId(storageImpl) { storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null); if (!storageImpl) return DEFAULT_OPTION_ID; var stored; try { stored = storageImpl.getItem(STORAGE_KEY); } catch (e) { stored = null; } return (stored && getOption(stored)) ? stored : DEFAULT_OPTION_ID; }
  function saveSelectedOptionId(storageImpl, id) { storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null); if (!getOption(id)) return false; if (storageImpl) { try { storageImpl.setItem(STORAGE_KEY, id); } catch (e) { return false; } } return true; }
  function toIntervalMs(optionId) { var opt = getOption(optionId); if (!opt || opt.minutes == null) return null; return Math.round(opt.minutes * 60000); }
  var API = { OPTIONS: OPTIONS, DEFAULT_OPTION_ID: DEFAULT_OPTION_ID, getOption: getOption, loadSelectedOptionId: loadSelectedOptionId, saveSelectedOptionId: saveSelectedOptionId, toIntervalMs: toIntervalMs };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SYNC_SCHEDULE = API;
})(typeof window !== 'undefined' ? window : this);
