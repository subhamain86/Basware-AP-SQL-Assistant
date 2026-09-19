'use strict';
var path = require('path');
if (typeof global.crypto === 'undefined') global.crypto = require('crypto').webcrypto;
var VAULT = require(path.join(__dirname, '..', 'js', 'credential-vault-engine.js'));

var SAMPLE_CONFIG = { owner: 'acme-corp', repo: 'ap-sql-schema-store', branch: 'main', path: 'schema/shared-schema.json', token: 'ghp_SuperSecretToken12345' };

test('isSupported reports true when Web Crypto (SubtleCrypto) is available', function () {
  assertTrue(VAULT.isSupported());
});

test('encryptConfig + decryptConfig round-trips the exact original config object', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, 'correct-horse-battery-staple').then(function (vaultObj) {
    return VAULT.decryptConfig(vaultObj, 'correct-horse-battery-staple');
  }).then(function (decrypted) {
    assertEqual(decrypted, SAMPLE_CONFIG);
  });
});
test('encryptConfig produces a vaultObj whose ciphertext never contains the plaintext token', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, 'pw').then(function (vaultObj) {
    assertFalse(vaultObj.ciphertext.indexOf('SuperSecretToken') !== -1);
    assertFalse(JSON.stringify(vaultObj).indexOf('SuperSecretToken') !== -1);
  });
});
test('encryptConfig includes a version number and base64 salt/iv/ciphertext fields', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, 'pw').then(function (vaultObj) {
    assertEqual(vaultObj.v, 1);
    assertTrue(/^[A-Za-z0-9+/=]+$/.test(vaultObj.salt));
    assertTrue(/^[A-Za-z0-9+/=]+$/.test(vaultObj.iv));
    assertTrue(/^[A-Za-z0-9+/=]+$/.test(vaultObj.ciphertext));
  });
});
test('two encryptions of the same config with the same passphrase produce DIFFERENT ciphertext (random salt/iv each time)', function () {
  return Promise.all([VAULT.encryptConfig(SAMPLE_CONFIG, 'pw'), VAULT.encryptConfig(SAMPLE_CONFIG, 'pw')]).then(function (results) {
    assertFalse(results[0].salt === results[1].salt);
    assertFalse(results[0].iv === results[1].iv);
    assertFalse(results[0].ciphertext === results[1].ciphertext);
  });
});

test('decryptConfig rejects with a clear, user-facing message when the passphrase is wrong (never silently returns garbage)', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, 'right-passphrase').then(function (vaultObj) {
    return VAULT.decryptConfig(vaultObj, 'wrong-passphrase').then(function () { throw new Error('expected rejection'); }, function (err) {
      assertIncludes(err.message, 'Incorrect vault passphrase');
    });
  });
});
test('decryptConfig rejects clearly when given a structurally invalid vault object', function () {
  return VAULT.decryptConfig({ foo: 'bar' }, 'pw').then(function () { throw new Error('expected rejection'); }, function (err) {
    assertIncludes(err.message, 'valid encrypted credential vault');
  });
});
test('decryptConfig rejects clearly when no passphrase is supplied at all', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, 'pw').then(function (vaultObj) {
    return VAULT.decryptConfig(vaultObj, '').then(function () { throw new Error('expected rejection'); }, function (err) {
      assertIncludes(err.message, 'passphrase is required');
    });
  });
});
test('encryptConfig rejects clearly when no passphrase is supplied at all', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, '').then(function () { throw new Error('expected rejection'); }, function (err) {
    assertIncludes(err.message, 'passphrase is required');
  });
});
test('decryptConfig rejects clearly when the ciphertext has been tampered with (AES-GCM authentication fails)', function () {
  return VAULT.encryptConfig(SAMPLE_CONFIG, 'pw').then(function (vaultObj) {
    var tampered = Object.assign({}, vaultObj, { ciphertext: vaultObj.ciphertext.slice(0, -4) + 'AAAA' });
    return VAULT.decryptConfig(tampered, 'pw').then(function () { throw new Error('expected rejection'); }, function (err) {
      assertIncludes(err.message, 'Incorrect vault passphrase');
    });
  });
});

test('buildVaultBlob produces a JSON string with the expected "type" marker and no plaintext token', function () {
  return VAULT.buildVaultBlob(SAMPLE_CONFIG, 'pw').then(function (blobText) {
    var parsed = JSON.parse(blobText);
    assertEqual(parsed.type, 'ap-sql-assistant-credential-vault');
    assertFalse(blobText.indexOf('SuperSecretToken') !== -1);
  });
});
test('parseVaultBlob round-trips buildVaultBlob\u2019s output back to the original config', function () {
  return VAULT.buildVaultBlob(SAMPLE_CONFIG, 'my-passphrase').then(function (blobText) {
    return VAULT.parseVaultBlob(blobText, 'my-passphrase');
  }).then(function (decrypted) {
    assertEqual(decrypted, SAMPLE_CONFIG);
  });
});
test('parseVaultBlob rejects clearly on non-JSON input', function () {
  return VAULT.parseVaultBlob('not json at all {{{', 'pw').then(function () { throw new Error('expected rejection'); }, function (err) {
    assertIncludes(err.message, 'valid JSON');
  });
});
test('parseVaultBlob rejects clearly when the JSON is valid but not a recognizable vault (wrong "type")', function () {
  return VAULT.parseVaultBlob(JSON.stringify({ type: 'something-else', salt: 'x', iv: 'y', ciphertext: 'z' }), 'pw').then(function () { throw new Error('expected rejection'); }, function (err) {
    assertIncludes(err.message, 'does not look like an AP-SQL Assistant credential vault');
  });
});
test('parseVaultBlob with the wrong passphrase rejects with a clear message, not a raw crypto exception', function () {
  return VAULT.buildVaultBlob(SAMPLE_CONFIG, 'correct-pw').then(function (blobText) {
    return VAULT.parseVaultBlob(blobText, 'incorrect-pw').then(function () { throw new Error('expected rejection'); }, function (err) {
      assertIncludes(err.message, 'Incorrect vault passphrase');
    });
  });
});

test('encrypting a config containing unicode characters round-trips correctly', function () {
  var unicodeConfig = { owner: 'acme-corp', repo: 'répô', branch: 'main', path: 'schéma/日本語.json', token: 'ghp_tökén' };
  return VAULT.buildVaultBlob(unicodeConfig, 'pw').then(function (blobText) {
    return VAULT.parseVaultBlob(blobText, 'pw');
  }).then(function (decrypted) {
    assertEqual(decrypted, unicodeConfig);
  });
});

test('bytesToBase64 / base64ToBytes round-trip arbitrary byte sequences', function () {
  var bytes = new Uint8Array([0, 1, 2, 254, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
  var decoded = VAULT.base64ToBytes(VAULT.bytesToBase64(bytes));
  assertEqual(Array.from(decoded), Array.from(bytes));
});
