(function (root) {
  'use strict';
  // ============================================================================
  // AP-SQL Assistant — Centralized Password Authentication Engine (V11.3.1)
  // ----------------------------------------------------------------------------
  // This is the SINGLE, consistent password-validation mechanism used by every
  // password-protected feature in the application (Update Schema unlock, the
  // Operational Password change flow, the Forgot Password recovery flow, and
  // every re-authentication modal such as Delete Schema / Delete Stored Schema /
  // Save Relationship / Apply Schema Update).
  //
  // Security design:
  //   - Passwords are NEVER stored or compared in plain text.
  //   - A modern, salted, one-way password hash (PBKDF2-HMAC-SHA256, 150,000
  //     iterations, 16-byte random salt, 32-byte derived key) is used for
  //     verification — this is a one-way function, so even this application's
  //     own source code cannot recover the original password from a stored
  //     credential.
  //   - Every stored credential (the built-in default, and any password the
  //     user changes it to) is represented ONLY as { algo, iterations, salt,
  //     hash } — an opaque, non-reversible record. No plaintext password is
  //     ever written to localStorage, logged, echoed in an error message, or
  //     embedded anywhere in this source code.
  //   - Uses the browser's native Web Crypto API (crypto.subtle) when available
  //     for hashing; falls back to an equivalent pure-JavaScript PBKDF2-SHA256
  //     implementation in environments where SubtleCrypto is unavailable, so
  //     behavior is identical either way.
  // ============================================================================

  var ALGO = 'PBKDF2-SHA256';
  var ITERATIONS = 150000;
  var SALT_BYTES = 16;
  var DERIVED_KEY_BYTES = 32;

  // ---- Base64 helpers (byte array <-> base64 string) ----
  function bytesToBase64(bytes) {
    var bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return (typeof btoa !== 'undefined') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  }
  function base64ToBytes(b64) {
    if (typeof atob !== 'undefined') { var bin = atob(b64); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
    var s = unescape(encodeURIComponent(String(str))); var out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
  }
  function getRandomBytes(n) {
    var arr = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (var i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  }
  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0; for (var i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]); return diff === 0;
  }

  // ---- Pure-JS SHA-256 + HMAC-SHA256 + PBKDF2 fallback (used only when SubtleCrypto is unavailable) ----
  function sha256Core(bytes) {
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bitLen = bytes.length * 8;
    var withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withOne.set(bytes); withOne[bytes.length] = 0x80;
    var dv = new DataView(withOne.buffer);
    dv.setUint32(withOne.length - 4, bitLen >>> 0, false);
    dv.setUint32(withOne.length - 8, Math.floor(bitLen / 4294967296), false);
    var w = new Array(64);
    for (var chunk = 0; chunk < withOne.length; chunk += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(chunk + t * 4, false);
      for (t = 16; t < 64; t++) { var s0 = rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15] >>> 3); var s1 = rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2] >>> 10); w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0; }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) { var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25); var ch = (e & f) ^ ((~e) & g); var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0; var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22); var maj = (a & b) ^ (a & c) ^ (b & c); var temp2 = (S0 + maj) >>> 0; h=g; g=f; f=e; e=(d+temp1)>>>0; d=c; c=b; b=a; a=(temp1+temp2)>>>0; }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0; H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    var out = new Uint8Array(32);
    for (var i2 = 0; i2 < 8; i2++) { out[i2*4] = (H[i2] >>> 24) & 0xFF; out[i2*4+1] = (H[i2] >>> 16) & 0xFF; out[i2*4+2] = (H[i2] >>> 8) & 0xFF; out[i2*4+3] = H[i2] & 0xFF; }
    return out;
  }
  function hmacSha256(keyBytes, msgBytes) {
    var blockSize = 64;
    if (keyBytes.length > blockSize) keyBytes = sha256Core(keyBytes);
    var padded = new Uint8Array(blockSize); padded.set(keyBytes);
    var ipad = new Uint8Array(blockSize), opad = new Uint8Array(blockSize);
    for (var i = 0; i < blockSize; i++) { ipad[i] = padded[i] ^ 0x36; opad[i] = padded[i] ^ 0x5c; }
    var inner = new Uint8Array(ipad.length + msgBytes.length); inner.set(ipad); inner.set(msgBytes, ipad.length);
    var innerHash = sha256Core(inner);
    var outer = new Uint8Array(opad.length + innerHash.length); outer.set(opad); outer.set(innerHash, opad.length);
    return sha256Core(outer);
  }
  function pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations, dkLen) {
    var hLen = 32; var numBlocks = Math.ceil(dkLen / hLen); var output = new Uint8Array(numBlocks * hLen);
    for (var blockIndex = 1; blockIndex <= numBlocks; blockIndex++) {
      var blockIndexBytes = new Uint8Array(4);
      blockIndexBytes[0] = (blockIndex >>> 24) & 0xFF; blockIndexBytes[1] = (blockIndex >>> 16) & 0xFF; blockIndexBytes[2] = (blockIndex >>> 8) & 0xFF; blockIndexBytes[3] = blockIndex & 0xFF;
      var saltAndIndex = new Uint8Array(saltBytes.length + 4); saltAndIndex.set(saltBytes); saltAndIndex.set(blockIndexBytes, saltBytes.length);
      var u = hmacSha256(passwordBytes, saltAndIndex);
      var t = new Uint8Array(u);
      for (var iter = 1; iter < iterations; iter++) { u = hmacSha256(passwordBytes, u); for (var k = 0; k < t.length; k++) t[k] ^= u[k]; }
      output.set(t, (blockIndex - 1) * hLen);
    }
    return output.slice(0, dkLen);
  }

  function hasSubtleCrypto() { return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.importKey === 'function' && typeof crypto.subtle.deriveBits === 'function'; }

  function deriveBytes(password, saltBytes, iterations, dkLenBytes) {
    var passwordBytes = utf8Bytes(password);
    if (hasSubtleCrypto()) {
      return crypto.subtle.importKey('raw', passwordBytes, { name: 'PBKDF2' }, false, ['deriveBits'])
        .then(function (keyMaterial) { return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' }, keyMaterial, dkLenBytes * 8); })
        .then(function (bits) { return new Uint8Array(bits); })
        .catch(function () { return pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations, dkLenBytes); });
    }
    return Promise.resolve(pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations, dkLenBytes));
  }

  // Build a brand-new credential record (random salt) for the given password.
  function hashPassword(password) {
    var salt = getRandomBytes(SALT_BYTES);
    return deriveBytes(password, salt, ITERATIONS, DERIVED_KEY_BYTES).then(function (derived) {
      return { algo: ALGO, iterations: ITERATIONS, salt: bytesToBase64(salt), hash: bytesToBase64(derived) };
    });
  }

  // Verify a candidate password against an existing stored credential record.
  function verifyPassword(password, credential) {
    if (!credential || !credential.salt || !credential.hash || !credential.iterations) return Promise.resolve(false);
    var saltBytes = base64ToBytes(credential.salt);
    return deriveBytes(password, saltBytes, credential.iterations, base64ToBytes(credential.hash).length).then(function (derived) {
      return constantTimeEqual(derived, base64ToBytes(credential.hash));
    }).catch(function () { return false; });
  }

  function isValidCredentialShape(cred) { return !!(cred && cred.algo === ALGO && typeof cred.iterations === 'number' && typeof cred.salt === 'string' && typeof cred.hash === 'string'); }

  // ----------------------------------------------------------------------------
  // Default operational credential.
  // This is a precomputed, one-way PBKDF2-SHA256 credential for the application's
  // documented default operational password. The salt and derived hash below are
  // opaque, non-reversible values — the original password cannot be recovered
  // from them, and the plaintext password itself does not appear anywhere in
  // this file, in any other application source file, in the UI, in logs, or in
  // error messages. The default password is documented separately (out of band)
  // for administrators; the application never displays, stores, or transmits it
  // in plain text under any circumstance.
  // ----------------------------------------------------------------------------
  var DEFAULT_CREDENTIAL = {
    algo: ALGO,
    iterations: 150000,
    salt: 'jzosEX1kmwJe0apMkD9rdw==',
    hash: 'qKSVIG63N6VRlqADiVOpcmEuPgJT2a8BPDNSeRBW+GE='
  };

  var API = {
    ALGO: ALGO, ITERATIONS: ITERATIONS, SALT_BYTES: SALT_BYTES, DERIVED_KEY_BYTES: DERIVED_KEY_BYTES,
    hashPassword: hashPassword, verifyPassword: verifyPassword, isValidCredentialShape: isValidCredentialShape,
    DEFAULT_CREDENTIAL: DEFAULT_CREDENTIAL,
    _internal: { sha256Core: sha256Core, hmacSha256: hmacSha256, pbkdf2Sha256Fallback: pbkdf2Sha256Fallback, hasSubtleCrypto: hasSubtleCrypto, bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes, utf8Bytes: utf8Bytes }
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_PASSWORD_AUTH = API;
})(typeof window !== 'undefined' ? window : this);
