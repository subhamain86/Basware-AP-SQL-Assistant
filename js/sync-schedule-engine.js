/* sync-schedule-engine.js — predefined synchronization schedule options + due-check logic. */
(function (root) {
  'use strict';

  var OPTIONS = [
    { id: 'manual', label: 'Manual only', minutes: 0 },
    { id: '15m', label: 'Every 15 minutes', minutes: 15 },
    { id: '1h', label: 'Every hour', minutes: 60 },
    { id: '6h', label: 'Every 6 hours', minutes: 360 },
    { id: 'daily', label: 'Daily', minutes: 1440 },
    { id: 'weekly', label: 'Weekly', minutes: 10080 }
  ];

  function getOptions() { return OPTIONS.slice(); }

  function isDue(scheduleId, lastSyncIso, nowDate) {
    var opt = OPTIONS.filter(function (o) { return o.id === scheduleId; })[0];
    if (!opt || opt.minutes === 0) return false;
    if (!lastSyncIso) return true;
    var now = nowDate || new Date();
    var last = new Date(lastSyncIso);
    var diffMinutes = (now.getTime() - last.getTime()) / 60000;
    return diffMinutes >= opt.minutes;
  }

  var API = { OPTIONS: OPTIONS, getOptions: getOptions, isDue: isDue };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SYNC_SCHEDULE = API;
})(typeof window !== 'undefined' ? window : this);
