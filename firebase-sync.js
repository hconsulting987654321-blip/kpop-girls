/**
 * K-Pop Star Academy — Firebase Sync Layer
 * Offline-first: localStorage is always primary, Firebase syncs in background.
 *
 * Usage: include this script AFTER Firebase SDK scripts in each HTML page.
 * Call KPopSync.init() on page load. That's it — the rest is automatic.
 */

const KPopSync = (function() {
  'use strict';

  // ===== CONFIG =====
  // Replace with your Firebase project config
  const FIREBASE_CONFIG = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  };

  // Keys to sync (prefixes). Everything starting with 'kpop_' gets synced.
  const SYNC_PREFIX = 'kpop_';

  // Keys that should NOT be synced (device-specific)
  const SKIP_KEYS = new Set([
    'kpop_play_time_today',
    'kpop_play_date',
    'kpop_parental_pin',
    'kpop_time_limit'
  ]);

  // Debounce delay for writes (ms)
  const WRITE_DEBOUNCE = 2000;

  let db = null;
  let auth = null;
  let userId = null;
  let initialized = false;
  let writeTimers = {};
  let syncing = false;

  // ===== HELPERS =====

  function shouldSync(key) {
    return key.startsWith(SYNC_PREFIX) && !SKIP_KEYS.has(key);
  }

  function getDocPath() {
    return 'users/' + userId;
  }

  // ===== AUTH =====

  async function authenticate() {
    try {
      // Try to sign in anonymously (no email needed for kids)
      const result = await firebase.auth().signInAnonymously();
      userId = result.user.uid;

      // Check if there's a linked device code
      const deviceLink = localStorage.getItem('kpop_device_uid');
      if (deviceLink && deviceLink !== userId) {
        // User linked from another device, use that UID
        // This is handled by the link-device flow
      }

      localStorage.setItem('kpop_device_uid', userId);
      console.log('[KPopSync] Authenticated:', userId);
      return true;
    } catch (e) {
      console.warn('[KPopSync] Auth failed, offline mode:', e.message);
      return false;
    }
  }

  // ===== SYNC: LOCAL → FIREBASE =====

  function pushToFirebase(key, value) {
    if (!db || !userId) return;

    // Debounce writes per key
    if (writeTimers[key]) clearTimeout(writeTimers[key]);
    writeTimers[key] = setTimeout(() => {
      const docRef = db.collection('users').doc(userId).collection('data').doc(encodeKey(key));
      docRef.set({
        key: key,
        value: value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(e => {
        console.warn('[KPopSync] Write failed for', key, e.message);
      });
    }, WRITE_DEBOUNCE);
  }

  // Firestore doc IDs can't have / so encode keys
  function encodeKey(key) {
    return key.replace(/\//g, '__SLASH__');
  }

  function decodeKey(encoded) {
    return encoded.replace(/__SLASH__/g, '/');
  }

  // ===== SYNC: FIREBASE → LOCAL =====

  async function pullFromFirebase() {
    if (!db || !userId) return;
    syncing = true;

    try {
      const snapshot = await db.collection('users').doc(userId).collection('data').get();
      let updates = 0;

      snapshot.forEach(doc => {
        const data = doc.data();
        const key = data.key || decodeKey(doc.id);
        const remoteValue = data.value;
        const localValue = localStorage.getItem(key);

        if (remoteValue !== null && remoteValue !== undefined) {
          // Merge strategy: prefer the one with more data (higher stars, more items, etc.)
          if (localValue === null) {
            // Local doesn't have it, take remote
            localStorage.setItem(key, remoteValue);
            updates++;
          } else if (localValue !== remoteValue) {
            // Conflict: use smart merge
            const merged = smartMerge(key, localValue, remoteValue);
            if (merged !== localValue) {
              localStorage.setItem(key, merged);
              updates++;
            }
          }
        }
      });

      if (updates > 0) {
        console.log('[KPopSync] Pulled', updates, 'updates from cloud');
        // Reload page to reflect changes if significant updates
        if (updates > 5) {
          window.dispatchEvent(new CustomEvent('kpop-sync-updated', { detail: { count: updates } }));
        }
      }
    } catch (e) {
      console.warn('[KPopSync] Pull failed:', e.message);
    }

    syncing = false;
  }

  // Push ALL local kpop_ data to Firebase (initial sync)
  async function pushAllToFirebase() {
    if (!db || !userId) return;

    const batch = db.batch();
    let count = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!shouldSync(key)) continue;

      const value = localStorage.getItem(key);
      const docRef = db.collection('users').doc(userId).collection('data').doc(encodeKey(key));
      batch.set(docRef, {
        key: key,
        value: value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      count++;

      // Firestore batch limit is 500
      if (count >= 450) {
        await batch.commit();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    console.log('[KPopSync] Pushed all local data to cloud');
  }

  // ===== SMART MERGE =====

  function smartMerge(key, localVal, remoteVal) {
    // Stars: take the higher value
    if (key.includes('_stars_') || key.includes('_hs_') || key.includes('_streak_')) {
      const localNum = parseInt(localVal) || 0;
      const remoteNum = parseInt(remoteVal) || 0;
      return String(Math.max(localNum, remoteNum));
    }

    // Arrays (trophies, stickers, visitors): merge unique items
    if (key.includes('_trophies_') || key.includes('_stickers_') || key.includes('_visitors')) {
      try {
        const localArr = JSON.parse(localVal) || [];
        const remoteArr = JSON.parse(remoteVal) || [];
        const merged = [...new Set([...localArr, ...remoteArr])];
        return JSON.stringify(merged);
      } catch (e) {
        return localVal; // Parse failed, keep local
      }
    }

    // JSON objects (pet, avatar, card): take the one with more recent timestamp or more data
    try {
      const localObj = JSON.parse(localVal);
      const remoteObj = JSON.parse(remoteVal);

      // If both are objects, take the one with more keys (more data = more progress)
      if (typeof localObj === 'object' && typeof remoteObj === 'object' &&
          !Array.isArray(localObj) && !Array.isArray(remoteObj)) {
        const localKeys = Object.keys(localObj).length;
        const remoteKeys = Object.keys(remoteObj).length;
        return remoteKeys > localKeys ? remoteVal : localVal;
      }

      // Arrays: take the longer one
      if (Array.isArray(localObj) && Array.isArray(remoteObj)) {
        return remoteObj.length > localObj.length ? remoteVal : localVal;
      }
    } catch (e) {
      // Not JSON
    }

    // Default: keep local (offline-first)
    return localVal;
  }

  // ===== LOCALSTORAGE INTERCEPTION =====

  function interceptLocalStorage() {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);

    localStorage.setItem = function(key, value) {
      originalSetItem(key, value);
      if (shouldSync(key) && !syncing) {
        pushToFirebase(key, value);
      }
    };

    localStorage.removeItem = function(key) {
      originalRemoveItem(key);
      if (shouldSync(key) && db && userId) {
        const docRef = db.collection('users').doc(userId).collection('data').doc(encodeKey(key));
        docRef.delete().catch(() => {});
      }
    };
  }

  // ===== DEVICE LINKING =====
  // Generate a short code to link devices (share progress between phone/tablet/PC)

  function generateLinkCode() {
    if (!userId) return null;
    const code = userId.substring(0, 8).toUpperCase();
    // Store the link code in Firestore for lookup
    if (db) {
      db.collection('links').doc(code).set({
        uid: userId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    return code;
  }

  async function linkDevice(code) {
    if (!db) return false;
    try {
      const doc = await db.collection('links').doc(code.toUpperCase()).get();
      if (doc.exists) {
        const linkedUid = doc.data().uid;
        localStorage.setItem('kpop_device_uid', linkedUid);
        // Re-init with linked UID
        userId = linkedUid;
        await pullFromFirebase();
        return true;
      }
    } catch (e) {
      console.warn('[KPopSync] Link failed:', e.message);
    }
    return false;
  }

  // ===== INIT =====

  async function init() {
    if (initialized) return;
    initialized = true;

    // Check if Firebase config is set
    if (!FIREBASE_CONFIG.apiKey) {
      console.log('[KPopSync] No Firebase config — running in local-only mode');
      return;
    }

    try {
      // Initialize Firebase
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }

      db = firebase.firestore();
      auth = firebase.auth();

      // Enable offline persistence
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch (e) {
        // Multi-tab persistence might fail, that's OK
        console.warn('[KPopSync] Persistence:', e.message);
      }

      // Intercept localStorage writes
      interceptLocalStorage();

      // Authenticate
      const authed = await authenticate();
      if (!authed) return;

      // Initial sync: pull remote first, then push local
      await pullFromFirebase();
      await pushAllToFirebase();

      // Listen for online/offline
      window.addEventListener('online', () => {
        console.log('[KPopSync] Back online, syncing...');
        pushAllToFirebase();
      });

      console.log('[KPopSync] Ready! Cloud sync active.');
    } catch (e) {
      console.warn('[KPopSync] Init failed, offline mode:', e.message);
    }
  }

  // ===== PUBLIC API =====

  return {
    init: init,
    generateLinkCode: generateLinkCode,
    linkDevice: linkDevice,
    get isConnected() { return !!db && !!userId; },
    get userId() { return userId; }
  };

})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KPopSync.init());
} else {
  KPopSync.init();
}
