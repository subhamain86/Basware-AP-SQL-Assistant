'use strict';
var path = require('path');
var SCHED = require(path.join(__dirname, '..', 'js', 'sync-schedule-engine.js'));

function makeFakeStorage() {
  var data = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); } };
}

test('OPTIONS is a non-empty, predefined dropdown list including a manual-only option', function () {
  assertTrue(SCHED.OPTIONS.length >= 5);
  assertTrue(SCHED.OPTIONS.some(function (o) { return o.id === 'manual' && o.minutes === null; }));
});
test('every option has a distinct id and a human-readable label', function () {
  var ids = {};
  SCHED.OPTIONS.forEach(function (o) {
    assertTrue(!!o.label);
    assertFalse(!!ids[o.id]);
    ids[o.id] = true;
  });
});
test('getOption resolves a known id and returns null for an unknown one', function () {
  assertEqual(SCHED.getOption('5m').label, 'Every 5 minutes');
  assertEqual(SCHED.getOption('does-not-exist'), null);
});
test('getDefaultOption matches DEFAULT_OPTION_ID', function () {
  assertEqual(SCHED.getDefaultOption().id, SCHED.DEFAULT_OPTION_ID);
});

test('loadSelectedOptionId returns the default when nothing has been saved yet', function () {
  var storage = makeFakeStorage();
  assertEqual(SCHED.loadSelectedOptionId(storage), SCHED.DEFAULT_OPTION_ID);
});
test('saveSelectedOptionId + loadSelectedOptionId round-trips a valid selection', function () {
  var storage = makeFakeStorage();
  var ok = SCHED.saveSelectedOptionId(storage, '1h');
  assertTrue(ok);
  assertEqual(SCHED.loadSelectedOptionId(storage), '1h');
});
test('saveSelectedOptionId rejects an unknown option id and does not corrupt the stored value', function () {
  var storage = makeFakeStorage();
  SCHED.saveSelectedOptionId(storage, '5m');
  var ok = SCHED.saveSelectedOptionId(storage, 'not-a-real-option');
  assertFalse(ok);
  assertEqual(SCHED.loadSelectedOptionId(storage), '5m');
});
test('loadSelectedOptionId falls back to the default if the stored value is corrupted/unrecognized', function () {
  var storage = makeFakeStorage();
  storage.setItem(SCHED.STORAGE_KEY || 'ap_sql_sync_schedule_v1', 'garbage-value');
  assertEqual(SCHED.loadSelectedOptionId(storage), SCHED.DEFAULT_OPTION_ID);
});
test('loadSelectedOptionId with no storage implementation at all falls back to the default without throwing', function () {
  assertEqual(SCHED.loadSelectedOptionId(null), SCHED.DEFAULT_OPTION_ID);
});

test('toIntervalMs converts each timed option to the correct millisecond value', function () {
  assertEqual(SCHED.toIntervalMs('30s'), 30000);
  assertEqual(SCHED.toIntervalMs('1m'), 60000);
  assertEqual(SCHED.toIntervalMs('5m'), 300000);
  assertEqual(SCHED.toIntervalMs('1h'), 3600000);
  assertEqual(SCHED.toIntervalMs('24h'), 86400000);
});
test('toIntervalMs returns null for the manual-only option (no automatic interval)', function () {
  assertEqual(SCHED.toIntervalMs('manual'), null);
});
test('toIntervalMs returns null for an unknown option id rather than throwing', function () {
  assertEqual(SCHED.toIntervalMs('nonexistent'), null);
});

test('computeNextRun adds the correct offset to a given reference date', function () {
  var next = SCHED.computeNextRun('15m', new Date('2026-01-01T00:00:00.000Z'));
  assertEqual(next, '2026-01-01T00:15:00.000Z');
});
test('computeNextRun defaults to "now" when no reference date is supplied', function () {
  var before = Date.now();
  var next = SCHED.computeNextRun('1m');
  var nextMs = new Date(next).getTime();
  assertTrue(nextMs >= before + 59000 && nextMs <= before + 61000);
});
test('computeNextRun returns null for the manual-only schedule (no next run is ever scheduled)', function () {
  assertEqual(SCHED.computeNextRun('manual', new Date()), null);
});
test('computeNextRun returns null for an unrecognized option id', function () {
  assertEqual(SCHED.computeNextRun('bogus', new Date()), null);
});
