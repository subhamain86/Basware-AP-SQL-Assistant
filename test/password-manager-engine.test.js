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

test('a fresh password manager (no prior change) accepts the ORIGINAL hardcoded password — full backward compatibility', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.verifyCurrentPassword('P@assw0rd').then(function (ok) { assertTrue(ok); });
});
test('a fresh password manager rejects an incorrect password', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.verifyCurrentPassword('totally-wrong').then(function (ok) { assertFalse(ok); });
});
test('isCustomPasswordSet is false until a change has actually been made', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  assertFalse(pm.isCustomPasswordSet());
});
test('getCurrentHash returns the original hardcoded hash before any change', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  assertEqual(pm.getCurrentHash(), SCHEMA_TOOLS.HARDCODED_PASSWORD_SHA256);
});

test('changePassword rejects when the supplied CURRENT password is wrong, and does not alter the active password', function () {
  var storage = makeFakeStorage();
  var pm = PWM.createPasswordManager(storage);
  return pm.changePassword('wrong-current-password', 'BrandNewPass1', 'BrandNewPass1').then(function (result) {
    assertFalse(result.ok);
    assertIncludes(result.error, 'current password you entered is incorrect');
    return pm.verifyCurrentPassword('P@assw0rd');
  }).then(function (stillOriginal) { assertTrue(stillOriginal); });
});
test('changePassword rejects when the new password and confirmation do not match', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'NewPass123', 'Mismatch456').then(function (result) {
    assertFalse(result.ok);
    assertIncludes(result.error, 'do not match');
  });
});
test('changePassword rejects an empty new password', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', '', '').then(function (result) {
    assertFalse(result.ok);
    assertIncludes(result.error, 'enter a new password');
  });
});
test('changePassword rejects a new password shorter than 6 characters', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'abc', 'abc').then(function (result) {
    assertFalse(result.ok);
    assertIncludes(result.error, 'at least 6 characters');
  });
});
test('changePassword succeeds with the correct current password and a valid new password, and the new password subsequently verifies as correct', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'MyNewSecurePass1', 'MyNewSecurePass1').then(function (result) {
    assertTrue(result.ok);
    return pm.verifyCurrentPassword('MyNewSecurePass1');
  }).then(function (worksNow) { assertTrue(worksNow); });
});
test('after a successful change, the OLD (original hardcoded) password no longer works', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'MyNewSecurePass1', 'MyNewSecurePass1').then(function () {
    return pm.verifyCurrentPassword('P@assw0rd');
  }).then(function (oldStillWorks) { assertFalse(oldStillWorks); });
});
test('isCustomPasswordSet becomes true immediately after a successful change', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'MyNewSecurePass1', 'MyNewSecurePass1').then(function () {
    assertTrue(pm.isCustomPasswordSet());
  });
});
test('the new password is chained correctly: after one change, a SECOND change requires the (new) current password, not the original', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'FirstNewPass1', 'FirstNewPass1').then(function () {
    return pm.changePassword('P@assw0rd', 'SecondNewPass1', 'SecondNewPass1');
  }).then(function (result) {
    assertFalse(result.ok, 'the original password should no longer authorize a further change');
    return pm.changePassword('FirstNewPass1', 'SecondNewPass1', 'SecondNewPass1');
  }).then(function (result2) {
    assertTrue(result2.ok);
    return pm.verifyCurrentPassword('SecondNewPass1');
  }).then(function (works) { assertTrue(works); });
});

test('the changed password never appears in plain text anywhere in storage — only its SHA-256 hash is persisted', function () {
  var storage = makeFakeStorage();
  var pm = PWM.createPasswordManager(storage);
  return pm.changePassword('P@assw0rd', 'PlainTextCheck1', 'PlainTextCheck1').then(function () {
    var stored = storage.getItem(PWM.STORAGE_KEY);
    assertTrue(!!stored);
    assertFalse(stored.indexOf('PlainTextCheck1') !== -1);
    assertEqual(stored.length, 64);
  });
});

test('resetToDefault removes any custom password, reverting to accepting the original hardcoded password again', function () {
  var pm = PWM.createPasswordManager(makeFakeStorage());
  return pm.changePassword('P@assw0rd', 'TempPass123', 'TempPass123').then(function () {
    pm.resetToDefault();
    assertFalse(pm.isCustomPasswordSet());
    return pm.verifyCurrentPassword('P@assw0rd');
  }).then(function (works) { assertTrue(works); });
});

test('a password manager with no storage implementation at all still falls back correctly to the hardcoded default', function () {
  var pm = PWM.createPasswordManager(null);
  return pm.verifyCurrentPassword('P@assw0rd').then(function (ok) { assertTrue(ok); });
});

test('two separate browsers (two separate storage instances) are entirely independent: changing the password in one does not affect the other', function () {
  var pmBrowserA = PWM.createPasswordManager(makeFakeStorage());
  var pmBrowserB = PWM.createPasswordManager(makeFakeStorage());
  return pmBrowserA.changePassword('P@assw0rd', 'OnlyOnBrowserA1', 'OnlyOnBrowserA1').then(function () {
    return pmBrowserB.verifyCurrentPassword('P@assw0rd');
  }).then(function (browserBStillOriginal) { assertTrue(browserBStillOriginal); });
});
