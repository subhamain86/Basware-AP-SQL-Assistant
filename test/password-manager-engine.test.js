'use strict';
var path = require('path');
if (typeof global.crypto === 'undefined') global.crypto = require('crypto').webcrypto;
var SCHEMA_TOOLS = require(path.join(__dirname, '..', 'js', 'schema-tools.js'));
global.APSQL_SCHEMA_TOOLS = SCHEMA_TOOLS;
var PWM = require(path.join(__dirname, '..', 'js', 'password-manager-engine.js'));
function makeFakeStorage() {
  var data = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; } };
}
test('a fresh password manager accepts the documented default password', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.verifyCurrentPassword('P@assw0rd').then(function (ok) { assertTrue(ok); });
});
test('a fresh password manager rejects an incorrect password', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.verifyCurrentPassword('wrong').then(function (ok) { assertFalse(ok); });
});
test('changePassword rejects a wrong current password without altering the active password', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('wrong-current', 'NewPass1', 'NewPass1').then(function (result) {
    assertFalse(result.ok);
    return pm.verifyCurrentPassword('P@assw0rd');
  }).then(function (stillOriginal) { assertTrue(stillOriginal); });
});
test('changePassword succeeds and the new password subsequently verifies, the old one no longer works', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'MyNewSecurePass1', 'MyNewSecurePass1').then(function (result) {
    assertTrue(result.ok);
    return pm.verifyCurrentPassword('MyNewSecurePass1');
  }).then(function (works) {
    assertTrue(works);
    return pm.verifyCurrentPassword('P@assw0rd');
  }).then(function (oldWorks) { assertFalse(oldWorks); });
});
test('resetToDefault restores the original hardcoded password, never displaying it', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'TempPass123', 'TempPass123').then(function () {
    pm.resetToDefault();
    return pm.verifyCurrentPassword('P@assw0rd');
  }).then(function (works) { assertTrue(works); });
});
test('the changed password is never stored in plain text \u2014 only its SHA-256 hash', function () {
  var storage = makeFakeStorage();
  var pm = PWM.createPasswordManager(storage);
  return pm.changePassword('P@assw0rd', 'PlainTextCheck1', 'PlainTextCheck1').then(function () {
    var stored = storage.getItem(PWM.STORAGE_KEY);
    assertFalse(stored.indexOf('PlainTextCheck1') !== -1);
    assertEqual(stored.length, 64);
  });
});
