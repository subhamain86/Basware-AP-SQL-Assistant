/**
 * password-manager-engine.js — AP-SQL Assistant
 * Manages the single operational password used to unlock Update Schema
 * actions in this browser. The password is never stored in plain text —
 * only its SHA-256 hash is persisted. A hardcoded default password
 * ("P@assw0rd") is always available as a fallback via resetToDefault().
 */
(function (root) {
  'use strict';
  var STORAGE_KEY = 'ap_sql_password_hash_v1';
  var TOOLS = (typeof module === 'object' && module.exports) ? require('./schema-tools.js') : root.APSQL_SCHEMA_TOOLS;
  var DEFAULT_HASH = TOOLS.HARDCODED_PASSWORD_SHA256;

  function createPasswordManager(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);

    function currentHash() {
      if (!storageImpl) return DEFAULT_HASH;
      var stored = null;
      try { stored = storageImpl.getItem(STORAGE_KEY); } catch (e) { stored = null; }
      return stored || DEFAULT_HASH;
    }

    function isCustomPasswordSet() {
      return currentHash() !== DEFAULT_HASH;
    }

    function verifyCurrentPassword(inputPassword) {
      return TOOLS.sha256Hex(String(inputPassword || '')).then(function (hash) {
        return hash === currentHash();
      });
    }

    function changePassword(currentPassword, newPassword, confirmPassword) {
      return verifyCurrentPassword(currentPassword).then(function (ok) {
        if (!ok) return { ok: false, error: 'The current password entered is incorrect.' };
        if (!newPassword || newPassword.length < 6) return { ok: false, error: 'The new password must be at least 6 characters long.' };
        if (newPassword !== confirmPassword) return { ok: false, error: 'The new password and confirmation do not match.' };
        return TOOLS.sha256Hex(newPassword).then(function (hash) {
          if (storageImpl) { try { storageImpl.setItem(STORAGE_KEY, hash); } catch (e) {} }
          return { ok: true };
        });
      });
    }

    function resetToDefault() {
      if (storageImpl) { try { storageImpl.removeItem(STORAGE_KEY); } catch (e) { try { storageImpl.setItem(STORAGE_KEY, ''); } catch (e2) {} } }
      return { ok: true };
    }

    return {
      isCustomPasswordSet: isCustomPasswordSet,
      verifyCurrentPassword: verifyCurrentPassword,
      changePassword: changePassword,
      resetToDefault: resetToDefault
    };
  }

  var API = { STORAGE_KEY: STORAGE_KEY, createPasswordManager: createPasswordManager };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_PASSWORD_MANAGER = API;
})(typeof window !== 'undefined' ? window : this);
