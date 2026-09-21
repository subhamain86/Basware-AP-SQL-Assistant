/**
 * credential-vault-engine.js — AP-SQL Assistant V10.7
 * Passphrase-based encryption of the GitHub connection configuration
 * (owner/repo/branch/path/token) using the browser's native Web Crypto API
 * (AES-256-GCM with a PBKDF2-derived key), so the token is never written to
 * the repository, localStorage, or any file in plain text.
 *
 * HONEST SECURITY DISCLOSURE: this is a static, serverless, client-side-only
 * application with no backend secret store. The passphrase itself is the
 * real access-control boundary and must be communicated to authorized users
 * out-of-band (the same way the Update Schema operational password is) —
 * it is intentionally NEVER stored anywhere alongside the vault.
 */
(function (root) {
  'use strict';
  var PBKDF2_ITERATIONS = 210000;
  var SALT_BYTES = 16;
  var IV_BYTES = 12;
  var VAULT_FORMAT_VERSION = 1;
  function getSubtle() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    return null;
  }
  function getRandomBytes(n) {
    var arr = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
    else { for (var i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256); }
    return arr;
  }
  function bytesToBase64(bytes) {
    var bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return (typeof btoa !== 'undefined') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  }
  function base64ToBytes(b64) {
    if (typeof atob !== 'undefined') { var bin = atob(b64); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function isSupported() { return !!getSubtle(); }
  function deriveKey(passphrase, saltBytes) {
    var subtle = getSubtle();
    if (!subtle) return Promise.reject(new Error('This browser does not support the Web Crypto API required for secure credential storage.'));
    var enc = new TextEncoder();
    return subtle.importKey('raw', enc.encode(String(passphrase || '')), { name: 'PBKDF2' }, false, ['deriveKey']).then(function (keyMaterial) {
      return subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
    });
  }
  function encryptConfig(config, passphrase) {
    var subtle = getSubtle();
    if (!subtle) return Promise.reject(new Error('This browser does not support the Web Crypto API required for secure credential storage.'));
    if (!passphrase) return Promise.reject(new Error('A vault passphrase is required to encrypt the configuration.'));
    var salt = getRandomBytes(SALT_BYTES);
    var iv = getRandomBytes(IV_BYTES);
    return deriveKey(passphrase, salt).then(function (key) {
      var enc = new TextEncoder();
      var plaintext = enc.encode(JSON.stringify(config));
      return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext).then(function (cipherBuf) {
        return {
          v: VAULT_FORMAT_VERSION,
          salt: bytesToBase64(salt),
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(new Uint8Array(cipherBuf))
        };
      });
    });
  }
  function decryptConfig(vaultObj, passphrase) {
    var subtle = getSubtle();
    if (!subtle) return Promise.reject(new Error('This browser does not support the Web Crypto API required for secure credential storage.'));
    if (!vaultObj || !vaultObj.salt || !vaultObj.iv || !vaultObj.ciphertext) return Promise.reject(new Error('This does not look like a valid encrypted credential vault.'));
    if (!passphrase) return Promise.reject(new Error('The vault passphrase is required to unlock this configuration.'));
    var salt, iv, ciphertext;
    try {
      salt = base64ToBytes(vaultObj.salt);
      iv = base64ToBytes(vaultObj.iv);
      ciphertext = base64ToBytes(vaultObj.ciphertext);
    } catch (e) { return Promise.reject(new Error('The credential vault is corrupted and could not be read.')); }
    return deriveKey(passphrase, salt).then(function (key) {
      return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext).then(function (plainBuf) {
        var dec = new TextDecoder();
        var text = dec.decode(plainBuf);
        try { return JSON.parse(text); } catch (e) { throw new Error('The credential vault is corrupted and could not be read.'); }
      }).catch(function () {
        throw new Error('Incorrect vault passphrase, or the credential vault is corrupted.');
      });
    });
  }
  function buildVaultBlob(config, passphrase) {
    return encryptConfig(config, passphrase).then(function (vaultObj) {
      return JSON.stringify(Object.assign({ type: 'ap-sql-assistant-credential-vault' }, vaultObj), null, 2);
    });
  }
  function parseVaultBlob(jsonText, passphrase) {
    var parsed;
    try { parsed = JSON.parse(jsonText); } catch (e) { return Promise.reject(new Error('The credential vault file does not contain valid JSON.')); }
    if (!parsed || parsed.type !== 'ap-sql-assistant-credential-vault') return Promise.reject(new Error('This file does not look like an AP-SQL Assistant credential vault.'));
    return decryptConfig(parsed, passphrase);
  }
  var API = {
    PBKDF2_ITERATIONS: PBKDF2_ITERATIONS, VAULT_FORMAT_VERSION: VAULT_FORMAT_VERSION,
    isSupported: isSupported, deriveKey: deriveKey,
    encryptConfig: encryptConfig, decryptConfig: decryptConfig,
    buildVaultBlob: buildVaultBlob, parseVaultBlob: parseVaultBlob,
    bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_VAULT = API;
})(typeof window !== 'undefined' ? window : this);
