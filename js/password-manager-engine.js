/**
 * password-manager-engine.js — AP-SQL Assistant V10.7
 * ---------------------------------------------------------------------------
 * Replaces the previously hardcoded, unchangeable operational password
 * ("Update Schema" gate) with a genuine change-password mechanism, while
 * remaining fully backward compatible:
 *   - The ORIGINAL hardcoded password hash is preserved as the DEFAULT.
 *     Any browser that has never explicitly changed the password
 *     continues to accept exactly the same password as every prior
 *     version — nothing breaks.
 *   - Once a user changes the password, only the new password is
 *     accepted going forward, in THAT browser.
 *   - The password is never stored or displayed in plain text — only its
 *     SHA-256 hash is persisted.
 *   - Changing the password REQUIRES correctly supplying the CURRENT
 *     password first, so an unauthorized user cannot change it.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var SCHEMA_TOOLS = (typeof module === 'object' && module.exports) ? require('./schema-tools.js') : root.APSQL_SCHEMA_TOOLS;

  var STORAGE_KEY = 'ap_sql_operational_password_hash_v1';

  function createPasswordManager(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);

    function getCurrentHash() {
      if (!storageImpl) return SCHEMA_TOOLS.HARDCODED_PASSWORD_SHA256;
      var stored;
      try { stored = storageImpl.getItem(STORAGE_KEY); } catch (e) { stored = null; }
      return stored || SCHEMA_TOOLS.HARDCODED_PASSWORD_SHA256;
    }
    function isCustomPasswordSet() {
      if (!storageImpl) return false;
      var stored; try { stored = storageImpl.getItem(STORAGE_KEY); } catch (e) { stored = null; }
      return !!stored;
    }
    function verifyCurrentPassword(inputPassword) {
      return SCHEMA_TOOLS.sha256Hex(String(inputPassword || '')).then(function (hash) { return hash === getCurrentHash(); });
    }
    function changePassword(currentPassword, newPassword, confirmNewPassword) {
      if (!newPassword || !String(newPassword).trim()) return Promise.resolve({ ok: false, error: 'Please enter a new password.' });
      if (newPassword !== confirmNewPassword) return Promise.resolve({ ok: false, error: 'The new password and confirmation do not match.' });
      if (String(newPassword).length < 6) return Promise.resolve({ ok: false, error: 'The new password must be at least 6 characters long.' });
      return verifyCurrentPassword(currentPassword).then(function (ok) {
        if (!ok) return { ok: false, error: 'The current password you entered is incorrect. The operational password was not changed.' };
        return SCHEMA_TOOLS.sha256Hex(String(newPassword)).then(function (newHash) {
          if (storageImpl) { try { storageImpl.setItem(STORAGE_KEY, newHash); } catch (e) { return { ok: false, error: 'Could not save the new password in this browser (storage unavailable).' }; } }
          return { ok: true };
        });
      });
    }
    function resetToDefault() {
      if (storageImpl) { try { storageImpl.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ } }
    }

    return {
      getCurrentHash: getCurrentHash,
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
