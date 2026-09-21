/* credential-vault-engine.js — Secure GitHub Connection Vault.
   Encrypts the GitHub owner/repo/path/token using AES-256-GCM with a key derived via
   PBKDF2 (210,000 iterations) from the operational password, so the token is never
   stored or transmitted in plaintext. Works in-browser (Web Crypto) and in Node (for
   smoke tests) via the `crypto` module fallback. */
(function (root) {
  'use strict';

  var PBKDF2_ITERATIONS = 210000;

  function hasWebCrypto() { return typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined'; }

  function toBase64(buf) {
    var bytes = new Uint8Array(buf);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var bin = ''; bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function fromBase64(str) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    var bin = atob(str); var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function randomBytes(n) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) return crypto.getRandomValues(new Uint8Array(n));
    var nodeCrypto = require('crypto');
    return new Uint8Array(nodeCrypto.randomBytes(n));
  }

  // ---- Web Crypto implementation ----
  function webEncrypt(plaintextObj, password) {
    var enc = new TextEncoder();
    var salt = randomBytes(16);
    var iv = randomBytes(12);
    return crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']).then(function (baseKey) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
      );
    }).then(function (key) {
      var data = enc.encode(JSON.stringify(plaintextObj));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
    }).then(function (cipherBuf) {
      return {
        v: 1, kdf: 'PBKDF2', iterations: PBKDF2_ITERATIONS, alg: 'AES-256-GCM',
        salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(cipherBuf)
      };
    });
  }

  function webDecrypt(vault, password) {
    var dec = new TextDecoder();
    var salt = fromBase64(vault.salt), iv = fromBase64(vault.iv), ct = fromBase64(vault.ciphertext);
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']).then(function (baseKey) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: vault.iterations || PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      );
    }).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (plainBuf) {
      return JSON.parse(dec.decode(plainBuf));
    });
  }

  // ---- Node fallback (used only by smoke tests) ----
  function nodeEncrypt(plaintextObj, password) {
    var nodeCrypto = require('crypto');
    var salt = nodeCrypto.randomBytes(16);
    var iv = nodeCrypto.randomBytes(12);
    var key = nodeCrypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    var cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    var enc = Buffer.concat([cipher.update(JSON.stringify(plaintextObj), 'utf8'), cipher.final()]);
    var tag = cipher.getAuthTag();
    return Promise.resolve({
      v: 1, kdf: 'PBKDF2', iterations: PBKDF2_ITERATIONS, alg: 'AES-256-GCM',
      salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: Buffer.concat([enc, tag]).toString('base64')
    });
  }
  function nodeDecrypt(vault, password) {
    var nodeCrypto = require('crypto');
    var salt = Buffer.from(vault.salt, 'base64');
    var iv = Buffer.from(vault.iv, 'base64');
    var raw = Buffer.from(vault.ciphertext, 'base64');
    var tag = raw.slice(raw.length - 16);
    var data = raw.slice(0, raw.length - 16);
    var key = nodeCrypto.pbkdf2Sync(password, salt, vault.iterations || PBKDF2_ITERATIONS, 32, 'sha256');
    var decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    var dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return Promise.resolve(JSON.parse(dec.toString('utf8')));
  }

  function encryptVault(plaintextObj, password) {
    return hasWebCrypto() ? webEncrypt(plaintextObj, password) : nodeEncrypt(plaintextObj, password);
  }
  function decryptVault(vault, password) {
    if (!vault || !vault.ciphertext || !vault.salt || !vault.iv) {
      return Promise.reject(new Error('This does not look like a valid encrypted credential vault.'));
    }
    var p = hasWebCrypto() ? webDecrypt(vault, password) : nodeDecrypt(vault, password);
    return p.catch(function () { throw new Error('Unable to unlock the vault. The password may be wrong, or the vault file may be corrupted.'); });
  }

  function isVaultShape(obj) {
    return !!(obj && obj.v && obj.alg === 'AES-256-GCM' && obj.salt && obj.iv && obj.ciphertext);
  }

  var API = {
    PBKDF2_ITERATIONS: PBKDF2_ITERATIONS,
    encryptVault: encryptVault, decryptVault: decryptVault, isVaultShape: isVaultShape
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_VAULT = API;
})(typeof window !== 'undefined' ? window : this);
