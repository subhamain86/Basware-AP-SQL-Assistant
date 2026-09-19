/**
 * password-manager-engine.js — AP-SQL Assistant V10.7
 * ---------------------------------------------------------------------------
 * Replaces the previously hardcoded, unchangeable operational password
 * ("Update Schema" gate) with a genuine change-password mechanism, while
 * remaining fully backward compatible:
 *   - The ORIGINAL hardcoded password hash (schema-tools.js's
 *     HARDCODED_PASSWORD_SHA256) is preserved as the DEFAULT. Any browser
 *     that has never explicitly changed the password continues to accept
 *     exactly the same password as every prior version — nothing breaks.
 *   - Once a user changes the password (from this browser), only the new
 *     password is accepted going forward, in THAT browser (this is a
 *     client-side-only app with no server-side account system, so the
 *     "operational password" is inherently a per-browser/localStorage
 *     concept — this is disclosed clearly in the UI).
 *   - The password is never stored or displayed in plain text — only its
 *     SHA-256 hash is persisted, exactly as the original hardcoded value
 *     always was.
 *   - Changing the password REQUIRES correctly supplying the CURRENT
 *     password first (verified via schema-tools.js's existing hashing
 *     helpers), so an unauthorized user who does not already know the
 *     operational password cannot change it.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var SCHEMA_TOOLS = (typeof module === 'object' && module.exports) ? require('./schema-tools.js') : root.APSQL_SCHEMA_TOOLS;

  var STORAGE_KEY = 'ap_sql_operational_password_hash_v1';

  /**
   * createPasswordManager(storageImpl) — all methods return Promises,
   * consistent with schema-tools.js's own async hashing helpers.
   */
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
    /**
     * changePassword(currentPassword, newPassword, confirmNewPassword) —
     * requires the CORRECT current password (preventing unauthorized
     * changes), a non-empty new password, and a matching confirmation.
     * Resolves { ok: true } on success, or { ok: false, error } with a
     * clear, user-facing message otherwise. Never throws.
     */
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
    /**
     * resetToDefault() — administrative escape hatch used only by tests
     * and by "forget my custom password" style flows; requires the
     * caller to already be authenticated by the surrounding UI.
     */
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
