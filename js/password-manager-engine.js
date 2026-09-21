/* password-manager-engine.js — centralized operational/admin password authorization used by
   every password-protected feature (Update Schema, manual CASE/DECODE approval, etc).
   The password is never stored or compared in plaintext — only a SHA-256 hash is kept,
   and only in this browser's localStorage (or an injected storage implementation for tests).
   Default password: P@assw0rd (see schema-tools.js HARDCODED_PASSWORD_SHA256). The Forget
   Password workflow resets to this default hash but never displays the plaintext value. */
(function (root) {
  'use strict';

  var SCHEMA_TOOLS = (typeof module === 'object' && module.exports) ? require('./schema-tools.js') : root.APSQL_SCHEMA_TOOLS;
  var STORAGE_KEY = 'ap_sql_operational_password_hash_v2';

  function createPasswordManager(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);

    function loadCustomHash() {
      if (!storageImpl) return null;
      var raw;
      try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      return raw || null;
    }
    function saveCustomHash(hash) {
      if (!storageImpl) return;
      try { storageImpl.setItem(STORAGE_KEY, hash); } catch (e) {}
    }
    function clearCustomHash() {
      if (!storageImpl) return;
      try {
        if (typeof storageImpl.removeItem === 'function') storageImpl.removeItem(STORAGE_KEY);
        else storageImpl.setItem(STORAGE_KEY, '');
      } catch (e) {}
    }
    function getCurrentHash() { return loadCustomHash() || SCHEMA_TOOLS.HARDCODED_PASSWORD_SHA256; }
    function isCustomPasswordSet() { return !!loadCustomHash(); }

    function verifyCurrentPassword(inputPassword) {
      return SCHEMA_TOOLS.sha256Hex(String(inputPassword || '')).then(function (hash) {
        return hash === getCurrentHash();
      });
    }

    function changePassword(currentPassword, newPassword, confirmPassword) {
      return verifyCurrentPassword(currentPassword).then(function (currentOk) {
        if (!currentOk) return { ok: false, error: 'The current password you entered is incorrect.' };
        if (!newPassword) return { ok: false, error: 'Please enter a new password.' };
        if (newPassword !== confirmPassword) return { ok: false, error: 'The new password and confirmation do not match.' };
        if (String(newPassword).length < 6) return { ok: false, error: 'The new password must be at least 6 characters long.' };
        return SCHEMA_TOOLS.sha256Hex(String(newPassword)).then(function (newHash) {
          saveCustomHash(newHash);
          return { ok: true };
        });
      });
    }

    // "Forgot password?" — resets to the documented default (P@assw0rd) without ever
    // displaying it, and without needing to know the current (possibly forgotten) password.
    function resetToDefault() { clearCustomHash(); }

    return {
      getCurrentHash: getCurrentHash, isCustomPasswordSet: isCustomPasswordSet,
      verifyCurrentPassword: verifyCurrentPassword, changePassword: changePassword, resetToDefault: resetToDefault
    };
  }

  var API = { STORAGE_KEY: STORAGE_KEY, createPasswordManager: createPasswordManager };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_PASSWORD_MANAGER = API;
})(typeof window !== 'undefined' ? window : this);
