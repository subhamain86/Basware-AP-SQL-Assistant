(function (root) {
  'use strict';
  // ============================================================================
  // AP-SQL Assistant — Operational Password Manager (V11.3.1)
  // ----------------------------------------------------------------------------
  // Thin, storage-aware wrapper around password-auth-engine.js. This is the
  // SINGLE object instantiated once in app.js and shared by every password-
  // protected feature (Update Schema unlock gate, Change Operational Password,
  // Forgot Password recovery, and every re-authentication modal such as Delete
  // Schema / Delete Stored Schema / Save Relationship / Apply Schema Update) —
  // ensuring one consistent authentication behavior everywhere, with no
  // divergent or duplicate password logic anywhere else in the application.
  //
  // Storage: only an opaque, non-reversible credential record (algorithm name,
  // iteration count, base64 salt, base64 hash) is ever persisted — never a
  // plaintext password, at rest or in transit through this module.
  // ============================================================================
  var PASSWORD_AUTH = (typeof module === 'object' && module.exports) ? require('./password-auth-engine.js') : root.APSQL_PASSWORD_AUTH;
  var STORAGE_KEY = 'ap_sql_operational_credential_v2';
  var MIN_PASSWORD_LENGTH = 6;

  function createPasswordManager(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);

    function loadCustomCredential() {
      if (!storageImpl) return null;
      var raw; try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (!raw) return null;
      var parsed; try { parsed = JSON.parse(raw); } catch (e) { return null; }
      return PASSWORD_AUTH.isValidCredentialShape(parsed) ? parsed : null;
    }
    function saveCustomCredential(credential) { if (!storageImpl) return; try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(credential)); } catch (e) {} }
    function clearCustomCredential() { if (!storageImpl) return; try { if (typeof storageImpl.removeItem === 'function') storageImpl.removeItem(STORAGE_KEY); else storageImpl.setItem(STORAGE_KEY, ''); } catch (e) {} }

    function getCurrentCredential() { return loadCustomCredential() || PASSWORD_AUTH.DEFAULT_CREDENTIAL; }
    function isCustomPasswordSet() { return !!loadCustomCredential(); }

    function verifyCurrentPassword(inputPassword) { return PASSWORD_AUTH.verifyPassword(String(inputPassword || ''), getCurrentCredential()); }

    // Standard change flow: Current Password → New Password → Confirm New Password → Validate → Securely Save.
    function changePassword(currentPassword, newPassword, confirmPassword) {
      return verifyCurrentPassword(currentPassword).then(function (currentOk) {
        if (!currentOk) return { ok: false, error: 'The current password you entered is incorrect.' };
        if (!newPassword) return { ok: false, error: 'Please enter a new password.' };
        if (newPassword !== confirmPassword) return { ok: false, error: 'The new password and confirmation do not match.' };
        if (String(newPassword).length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'The new password must be at least ' + MIN_PASSWORD_LENGTH + ' characters long.' };
        return PASSWORD_AUTH.hashPassword(newPassword).then(function (credential) { saveCustomCredential(credential); return { ok: true }; });
      });
    }

    // Forgot Password recovery flow: does NOT require the current password (the whole point of
    // "forgot"), and never reveals, restores, or displays any previous or default password value.
    // It simply lets the user set and securely save a brand-new credential, replacing whatever
    // was stored before (custom or default). Flow: Forgot Password → Set New Password → Confirm →
    // Securely Save New Password → new password is used for all subsequent authentication.
    function resetForgottenPassword(newPassword, confirmPassword) {
      if (!newPassword) return Promise.resolve({ ok: false, error: 'Please enter a new password.' });
      if (newPassword !== confirmPassword) return Promise.resolve({ ok: false, error: 'The new password and confirmation do not match.' });
      if (String(newPassword).length < MIN_PASSWORD_LENGTH) return Promise.resolve({ ok: false, error: 'The new password must be at least ' + MIN_PASSWORD_LENGTH + ' characters long.' });
      return PASSWORD_AUTH.hashPassword(newPassword).then(function (credential) { saveCustomCredential(credential); return { ok: true }; });
    }

    // Retained for completeness/testability: clears any custom credential, reverting to the
    // application's built-in default credential. Not exposed anywhere in the UI, and never
    // reveals the default password's plaintext value — it only removes the stored override.
    function resetToDefault() { clearCustomCredential(); return true; }

    return {
      isCustomPasswordSet: isCustomPasswordSet,
      verifyCurrentPassword: verifyCurrentPassword,
      changePassword: changePassword,
      resetForgottenPassword: resetForgottenPassword,
      resetToDefault: resetToDefault
    };
  }
  var API = { STORAGE_KEY: STORAGE_KEY, MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH, createPasswordManager: createPasswordManager };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_PASSWORD_MANAGER = API;
})(typeof window !== 'undefined' ? window : this);
