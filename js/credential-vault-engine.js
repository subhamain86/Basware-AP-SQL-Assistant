/**
 * credential-vault-engine.js — AP-SQL Assistant V10.7
 * ---------------------------------------------------------------------------
 * Implements passphrase-based encryption of the GitHub connection
 * configuration (owner/repo/branch/path/token) using the browser's native
 * Web Crypto API (AES-256-GCM with a PBKDF2-derived key), so that:
 *   - The token is never written to the repository, localStorage, or any
 *     generated file in plain text.
 *   - An encrypted "vault" blob can be safely committed to the project
 *     repository itself (the same public location the Live Shared Schema
 *     already uses), and any authorized user on any machine can recover
 *     the full GitHub connection by supplying the shared passphrase —
 *     without re-typing the token, repo, or path by hand.
 *
 * IMPORTANT — HONEST SECURITY DISCLOSURE (this is a static, serverless,
 * client-side-only application with no backend secret store):
 *   Because this app has no server component, the SAME browser JavaScript
 *   that reads the encrypted vault must also decrypt it locally in order
 *   to make authenticated GitHub API calls. This means:
 *     1. The encryption here is a genuine, real cryptographic barrier
 *        against casual exposure (the token is never sitting in plain
 *        text in the repo, in localStorage, in the UI, or in any log —
 *        someone who only sees the vault file sees random-looking bytes).
 *     2. It is NOT a barrier against a determined attacker who has both
 *        (a) the encrypted vault contents AND (b) the passphrase — since
 *        anyone with both can decrypt it exactly as the app does. This is
 *        unavoidable in a pure static-hosting architecture with no
 *        server-side secret; it is the same fundamental limitation as
 *        any "encrypted at rest, decrypted client-side" design.
 *   The passphrase itself is therefore the real access-control boundary
 *   and must be communicated to authorized users out-of-band (e.g. the
 *   same way the existing Update Schema operational password already is)
 *   — it is intentionally NEVER stored anywhere alongside the vault.
 * ---------------------------------------------------------------------------
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

  /**
   * isSupported() — Web Crypto's SubtleCrypto (AES-GCM + PBKDF2) is
   * available in every modern browser (Chrome, Edge, Firefox, Safari) —
   * unlike the Chromium-only File System Access API — so this feature has
   * broad cross-browser reach.
   */
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

  /**
   * encryptConfig(config, passphrase) — encrypts an arbitrary JSON-
   * serializable config object (e.g. { owner, repo, branch, path, token })
   * with AES-256-GCM under a key derived from `passphrase` via PBKDF2.
   * Returns a plain object { v, salt, iv, ciphertext } (all base64 except
   * `v`, the format version number) suitable for JSON.stringify-ing
   * directly into a vault file.
   */
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

  /**
   * decryptConfig(vaultObj, passphrase) — reverses encryptConfig(). Rejects
   * with a clear, user-facing error (never a raw crypto exception) when the
   * passphrase is wrong or the vault is corrupted — AES-GCM's built-in
   * authentication tag means a wrong passphrase reliably fails decryption
   * rather than silently returning garbage.
   */
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

  /**
   * buildVaultBlob(config, passphrase) — convenience wrapper producing a
   * ready-to-store JSON string (pretty-printed) for the vault file.
   */
  function buildVaultBlob(config, passphrase) {
    return encryptConfig(config, passphrase).then(function (vaultObj) {
      return JSON.stringify(Object.assign({ type: 'ap-sql-assistant-credential-vault' }, vaultObj), null, 2);
    });
  }
  /**
   * parseVaultBlob(jsonText, passphrase) — parses a vault JSON string and
   * decrypts it in one step. Rejects with a clear message if the text is
   * not valid JSON, is not a recognizable vault, or the passphrase is wrong.
   */
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
