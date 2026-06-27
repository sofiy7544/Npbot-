/* ============================================================================
   Stanley · Auth Isolation Patch (v5)
   ============================================================================
   PROBLEM (audit findings):
     • dua_orders, dua_cart, dua_favs, dua_checkout, dua_viewed, dua_last_order
       are global localStorage keys → new user sees previous user's data.
     • Registration only writes {email, firstName, lastName} — no userId,
       no password hash, no users table. Anyone can "log in" as anyone.
     • Email uniqueness not checked. Demo data leaks across sessions.

   FIX:
     • Real users database in dua_users keyed by emailLower → {uid, emailLower,
       email, firstName, lastName, salt, pwHash, createdAt}
     • Each user gets a stable UUID (uid).
     • All per-user storage keys are namespaced: dua_orders__<uid>,
       dua_cart__<uid>, dua_favs__<uid>, etc.
     • Guest writes go to dua_orders__guest. On login → merged into the
       user's namespace (so a guest cart isn't lost).
     • Login validates pwHash(password, salt) === stored hash.
     • Registration rejects duplicate email.
     • Logout clears current-user state but DOES NOT wipe per-user storage —
       so re-login restores everything.
     • Old global keys (dua_orders, dua_cart, dua_favs, etc.) are migrated
       on first run, then removed.

   This patch is loaded BEFORE the main render code, so when the main code
   later asks for "dua_orders", our proxy redirects to dua_orders__<uid>.
   ============================================================================ */
(function () {
  "use strict";

  /* ────────────────────────────────────────────────────────────────────────
     Constants
     ────────────────────────────────────────────────────────────────────── */
  const USERS_KEY = "dua_users";            // { emailLower → user }
  const CURRENT_USER_KEY = "dua_user";       // legacy key — kept for compat;
                                             // now holds {uid, email, firstName, lastName}
  const SESSION_TOKEN_KEY = "dua_session";   // signed token: nonce.sig

  /* Per-user-namespaced keys. When the main app reads/writes these,
     we transparently redirect them to "<key>__<uid>". */
  const NS_KEYS = new Set([
    "dua_orders",
    "dua_cart",
    "dua_favs",
    "dua_checkout",
    "dua_viewed",
    "dua_last_order",
  ]);

  /* Keys that stay global (settings, lang, admin data, etc.) */
  const GLOBAL_KEYS_PREFIXES = [
    "dua_lang", "dua_admin_", "dua_reviews", "dua_users", "dua_user",
    "dua_session", "dua_session_salt", "dua_tg_chat_id",
    "dua_orders_sent_tg",  /* idempotency map for TG dispatch — global is fine */
  ];

  /* ────────────────────────────────────────────────────────────────────────
     Crypto helpers (Web Crypto API)
     ────────────────────────────────────────────────────────────────────── */
  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, salt) {
    /* Note: SHA-256 with salt is significantly weaker than scrypt/argon2,
       but Web Crypto in browsers doesn't expose those without an external
       library. This is meaningfully better than the previous "no hash at all".
       For real production: move auth to backend. */
    return sha256Hex("stanley-pw-v1::" + salt + "::" + password);
  }

  /* ────────────────────────────────────────────────────────────────────────
     Users storage
     ────────────────────────────────────────────────────────────────────── */
  function readUsersMap() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function writeUsersMap(map) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function getUserByEmail(email) {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return null;
    const users = readUsersMap();
    return users[key] || null;
  }

  /* ────────────────────────────────────────────────────────────────────────
     Session signing — prevents trivial localStorage tampering
     ("dua_user just sets uid=X" gives no session token, so isAuthed=false)
     ────────────────────────────────────────────────────────────────────── */
  async function getSessionSalt() {
    let s = localStorage.getItem("dua_session_salt");
    if (!s) {
      s = randomHex(16);
      localStorage.setItem("dua_session_salt", s);
    }
    return s;
  }

  async function signSession(uid) {
    const salt = await getSessionSalt();
    const nonce = randomHex(8);
    const sig = await sha256Hex("session-v1::" + salt + "::" + uid + "::" + nonce);
    return nonce + "." + sig;
  }

  async function verifySession(uid, token) {
    if (!uid || !token || !token.includes(".")) return false;
    const [nonce, sig] = token.split(".");
    const salt = await getSessionSalt();
    const expected = await sha256Hex("session-v1::" + salt + "::" + uid + "::" + nonce);
    return sig === expected;
  }

  /* ────────────────────────────────────────────────────────────────────────
     Storage namespacing
     We wrap localStorage so reads/writes to namespaced keys go to
     <key>__<uid> when a user is logged in, or <key>__guest when not.

     We do NOT use a Proxy/setter override on localStorage itself —
     that would break other patches that expect raw localStorage to work.
     Instead we expose Storage.prototype methods that route based on
     current user, AND we run a migration on init to move legacy data
     into the right namespace.
     ────────────────────────────────────────────────────────────────────── */

  function getCurrentUid() {
    try {
      const u = JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || "null");
      return u && u.uid ? u.uid : null;
    } catch {
      return null;
    }
  }

  function namespacedKey(rawKey) {
    if (!NS_KEYS.has(rawKey)) return rawKey;
    const uid = getCurrentUid();
    return uid ? rawKey + "__" + uid : rawKey + "__guest";
  }

  /* Patch Storage.prototype.getItem / setItem / removeItem to redirect
     namespaced keys. We preserve the original methods because other
     code (premium-patch.js's Storage.setItem hook on dua_orders) needs
     to still fire — we route BOTH the namespaced write AND a notification
     to the original key. */
  const origGet = Storage.prototype.getItem;
  const origSet = Storage.prototype.setItem;
  const origRemove = Storage.prototype.removeItem;

  Storage.prototype.getItem = function (key) {
    if (this === window.localStorage && NS_KEYS.has(key)) {
      const nk = namespacedKey(key);
      const val = origGet.call(this, nk);
      if (val !== null) return val;
      /* Fallback to legacy key (one-time during migration window) */
      return origGet.call(this, key);
    }
    return origGet.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === window.localStorage && NS_KEYS.has(key)) {
      const nk = namespacedKey(key);
      const r = origSet.call(this, nk, value);
      /* Also write the original key so legacy listeners (e.g. premium-patch
         dispatch hook on "dua_orders") still fire as expected.
         The legacy key is treated as ephemeral — gets overwritten on each
         user switch, but the source of truth is the namespaced one. */
      if (key === "dua_orders") {
        /* Only mirror dua_orders because premium-patch hooks it for TG
           dispatch. Other namespaced keys don't need mirroring. */
        try { origSet.call(this, key, value); } catch (e) {}
      }
      return r;
    }
    return origSet.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (this === window.localStorage && NS_KEYS.has(key)) {
      origRemove.call(this, namespacedKey(key));
      /* Also remove the legacy mirror */
      if (key === "dua_orders") origRemove.call(this, key);
      return;
    }
    return origRemove.call(this, key);
  };

  /* ────────────────────────────────────────────────────────────────────────
     Migration — one-time move of legacy global keys into "guest" namespace.
     If user is already logged in at migration time, data goes to their uid.
     ────────────────────────────────────────────────────────────────────── */
  function migrateLegacy() {
    if (origGet.call(localStorage, "dua_v5_migrated") === "1") return;
    const uid = getCurrentUid();
    const target = uid || "guest";
    NS_KEYS.forEach((k) => {
      const legacyVal = origGet.call(localStorage, k);
      if (legacyVal === null) return;
      const nk = k + "__" + target;
      /* Don't overwrite namespaced data if it already exists */
      if (origGet.call(localStorage, nk) !== null) return;
      origSet.call(localStorage, nk, legacyVal);
      /* For dua_orders we KEEP the legacy key (premium-patch hooks it),
         but it'll be the same content as the namespaced one. */
      if (k !== "dua_orders") origRemove.call(localStorage, k);
    });
    origSet.call(localStorage, "dua_v5_migrated", "1");
  }

  /* Reload Cart.items and Favs.items from (now possibly different)
     namespaced storage. Called after login / register / logout. */
  function reloadInMemoryStores() {
    try {
      if (window.Cart && typeof window.Cart.items !== "undefined") {
        const raw = window.localStorage.getItem("dua_cart");
        window.Cart.items = raw ? JSON.parse(raw) : [];
        window.dispatchEvent(new CustomEvent("cartchange"));
      }
    } catch (e) {}
    try {
      if (window.Favs && typeof window.Favs.items !== "undefined") {
        const raw = window.localStorage.getItem("dua_favs");
        window.Favs.items = raw ? JSON.parse(raw) : [];
        window.dispatchEvent(new CustomEvent("favchange"));
      }
    } catch (e) {}
  }

  /* On user login, merge guest data into user namespace (so a guest who
     adds to cart and then signs up keeps their cart). */
  function mergeGuestIntoUser(uid) {
    NS_KEYS.forEach((k) => {
      const guestKey = k + "__guest";
      const userKey = k + "__" + uid;
      const guestVal = origGet.call(localStorage, guestKey);
      const userVal = origGet.call(localStorage, userKey);

      if (guestVal === null) return;

      if (userVal === null) {
        /* User had nothing yet — adopt guest value */
        origSet.call(localStorage, userKey, guestVal);
      } else {
        /* User has prior data. Merge intelligently:
           - dua_orders / dua_favs / dua_viewed: array union (dedup)
           - dua_cart: prefer user's (their saved cart); keep theirs
           - dua_checkout / dua_last_order: prefer user's */
        if (k === "dua_orders" || k === "dua_favs" || k === "dua_viewed") {
          try {
            const a = JSON.parse(guestVal) || [];
            const b = JSON.parse(userVal) || [];
            const seen = new Set();
            const merged = [];
            for (const item of b.concat(a)) {
              const id = typeof item === "string" ? item : item && item.id;
              if (id && seen.has(id)) continue;
              if (id) seen.add(id);
              merged.push(item);
            }
            origSet.call(localStorage, userKey, JSON.stringify(merged));
          } catch (e) { /* keep user's */ }
        }
        /* For cart/checkout/last_order — user's value wins (already set) */
      }

      /* Wipe guest namespace after merge */
      origRemove.call(localStorage, guestKey);
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     Auth API (exposed on window.AUTH for the main app to use)
     ────────────────────────────────────────────────────────────────────── */
  window.AUTH = {
    /** Register a new user. Returns {ok, error?, user?}. */
    async register({ email, password, firstName, lastName }) {
      email = String(email || "").trim();
      const emailLower = email.toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "BAD_EMAIL" };
      if (!password || password.length < 8) return { ok: false, error: "WEAK_PASSWORD" };
      if (!firstName || !lastName) return { ok: false, error: "NAME_REQUIRED" };

      const users = readUsersMap();
      if (users[emailLower]) return { ok: false, error: "EMAIL_TAKEN" };

      const uid = "u_" + randomHex(8);
      const salt = randomHex(16);
      const pwHash = await hashPassword(password, salt);

      const user = {
        uid,
        emailLower,
        email,
        firstName,
        lastName,
        salt,
        pwHash,
        createdAt: new Date().toISOString(),
      };
      users[emailLower] = user;
      writeUsersMap(users);

      /* Set current session */
      const publicUser = { uid, email, firstName, lastName };
      origSet.call(localStorage, CURRENT_USER_KEY, JSON.stringify(publicUser));
      origSet.call(localStorage, SESSION_TOKEN_KEY, await signSession(uid));

      /* Merge guest namespace into this new user (so checkout state, cart, etc.
         that they accumulated as guest survive into their account) */
      mergeGuestIntoUser(uid);

      /* Refresh in-memory caches in the main app — Cart.items, Favs.items
         are initialised at script load time and cached. After login, they
         must reload from the (now user-namespaced) storage. */
      reloadInMemoryStores();

      return { ok: true, user: publicUser };
    },

    /** Login. Returns {ok, error?, user?}. Email/password are validated. */
    async login({ email, password }) {
      const emailLower = String(email || "").trim().toLowerCase();
      if (!emailLower || !password) return { ok: false, error: "BAD_INPUT" };

      const user = getUserByEmail(emailLower);
      /* Anti-enumeration: same generic error for unknown email + bad password */
      if (!user) {
        /* Fake compare to avoid timing oracle */
        await hashPassword(password, "fake-salt-0000000000000000");
        return { ok: false, error: "BAD_CREDS" };
      }
      const candidate = await hashPassword(password, user.salt);
      if (candidate !== user.pwHash) return { ok: false, error: "BAD_CREDS" };

      const publicUser = {
        uid: user.uid,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      };
      origSet.call(localStorage, CURRENT_USER_KEY, JSON.stringify(publicUser));
      origSet.call(localStorage, SESSION_TOKEN_KEY, await signSession(user.uid));

      mergeGuestIntoUser(user.uid);
      reloadInMemoryStores();

      return { ok: true, user: publicUser };
    },

    /** Logout — clears current session only, keeps per-user data intact. */
    logout() {
      origRemove.call(localStorage, CURRENT_USER_KEY);
      origRemove.call(localStorage, SESSION_TOKEN_KEY);
      /* Clear the legacy mirror so a stale view doesn't show prior user's
         orders during the brief render before User.data nulls out. */
      origRemove.call(localStorage, "dua_orders");
      reloadInMemoryStores();
    },

    /** Returns current user object or null. Validates session signature. */
    async currentUser() {
      const rawUser = origGet.call(localStorage, CURRENT_USER_KEY);
      const token = origGet.call(localStorage, SESSION_TOKEN_KEY);
      if (!rawUser || !token) return null;
      try {
        const u = JSON.parse(rawUser);
        if (!u || !u.uid) return null;
        const ok = await verifySession(u.uid, token);
        if (!ok) {
          /* Session forged or stale — clear it */
          origRemove.call(localStorage, CURRENT_USER_KEY);
          origRemove.call(localStorage, SESSION_TOKEN_KEY);
          return null;
        }
        return u;
      } catch (e) {
        return null;
      }
    },

    /** Synchronous check used by main app's User.data. Doesn't verify the
        token signature — that's done at startup once. Returns user or null. */
    currentUserSync() {
      try {
        return JSON.parse(origGet.call(localStorage, CURRENT_USER_KEY) || "null");
      } catch {
        return null;
      }
    },
  };

  /* ────────────────────────────────────────────────────────────────────────
     Startup: migrate legacy → validate any existing session
     This MUST run before main render reads dua_user.
     ────────────────────────────────────────────────────────────────────── */
  migrateLegacy();

  /* Validate the session synchronously-ish: we do an async verify and if
     it fails, we wipe dua_user before the main render is likely to read it.
     This is best-effort — for browsers that have an immediately-resolving
     subtle.digest (all modern), the verification completes inside one
     microtask tick. */
  (async () => {
    const rawUser = origGet.call(localStorage, CURRENT_USER_KEY);
    const token = origGet.call(localStorage, SESSION_TOKEN_KEY);
    if (rawUser && token) {
      try {
        const u = JSON.parse(rawUser);
        if (u && u.uid) {
          const ok = await verifySession(u.uid, token);
          if (!ok) {
            origRemove.call(localStorage, CURRENT_USER_KEY);
            origRemove.call(localStorage, SESSION_TOKEN_KEY);
            console.warn("[AUTH] Invalid session token — cleared.");
          }
        }
      } catch (e) {
        origRemove.call(localStorage, CURRENT_USER_KEY);
        origRemove.call(localStorage, SESSION_TOKEN_KEY);
      }
    } else if (rawUser && !token) {
      /* Legacy session created before v5 — no signed token. Wipe it.
         User has to log in again. This is one-time pain in exchange for
         real auth. */
      origRemove.call(localStorage, CURRENT_USER_KEY);
      console.warn("[AUTH] Legacy unsigned session — cleared. Please log in.");
    }
  })();
})();
