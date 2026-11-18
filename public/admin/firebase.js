/* Firebase-Anbindung der Verwaltung: Anmeldung (E-Mail/Passwort) und Bild-Upload in Firebase Storage.
   Stellt window.XP_FB bereit und meldet sich mit dem Ereignis "xp-fb-ready". */
import config from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence,
  browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const ready = !!(config.apiKey && config.projectId);
let auth = null, storage = null;
if (ready) {
  const app = initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = 'de';
  storage = getStorage(app);
}

window.XP_FB = {
  ready,
  onUser(cb) { if (!ready) return cb(null); onAuthStateChanged(auth, cb); },
  async login(email, password, remember) {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    return signInWithEmailAndPassword(auth, email, password);
  },
  logout() { return ready ? signOut(auth) : Promise.resolve(); },
  resetPassword(email) { return sendPasswordResetEmail(auth, email); },
  async token() {
    if (!auth || !auth.currentUser) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
    return auth.currentUser.getIdToken();
  },
  user() { return auth && auth.currentUser; },
  /** Bild hochladen, liefert die öffentliche Adresse */
  async upload(path, blob) {
    const r = ref(storage, path);
    await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' });
    return getDownloadURL(r);
  },
};
window.dispatchEvent(new Event('xp-fb-ready'));
