import { firebaseConfig, prevenirConfig } from "./firebase-config.js";

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  !String(firebaseConfig.apiKey).startsWith("REEMPLAZAR_") &&
  !String(firebaseConfig.projectId).startsWith("REEMPLAZAR_")
);

let app = null;
let auth = null;
let db = null;
let analytics = null;
let authSdk = null;
let firestoreSdk = null;
let initPromise = null;

async function initializeAnalytics() {
  if (!firebaseConfig.measurementId || typeof window === "undefined") return null;
  try {
    const analyticsSdk = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js");
    const supported = await analyticsSdk.isSupported();
    if (!supported) return null;
    return analyticsSdk.getAnalytics(app);
  } catch (error) {
    console.warn("Firebase Analytics no pudo inicializarse en este entorno.", error);
    return null;
  }
}

async function ensureFirebase() {
  if (!firebaseConfigured) throw new Error("firebase_not_configured");
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const [appSdk, loadedAuthSdk, loadedFirestoreSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")
    ]);

    authSdk = loadedAuthSdk;
    firestoreSdk = loadedFirestoreSdk;
    app = appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(app);
    db = firestoreSdk.getFirestore(app);

    if (prevenirConfig.useEmulators) {
      authSdk.connectAuthEmulator(
        auth,
        `http://${prevenirConfig.emulatorHost}:${prevenirConfig.authEmulatorPort}`,
        { disableWarnings: true }
      );
      firestoreSdk.connectFirestoreEmulator(
        db,
        prevenirConfig.emulatorHost,
        prevenirConfig.firestoreEmulatorPort
      );
    }

    analytics = await initializeAnalytics();
    return { app, auth, db, analytics, authSdk, firestoreSdk };
  })();

  return initPromise;
}

export function watchAuth(callback) {
  let unsubscribe = () => {};
  ensureFirebase()
    .then(() => { unsubscribe = authSdk.onAuthStateChanged(auth, callback); })
    .catch(() => callback(null));
  return () => unsubscribe();
}

export async function currentUser() {
  await ensureFirebase();
  return auth?.currentUser || null;
}

export async function signIn(email, password) {
  await ensureFirebase();
  return authSdk.signInWithEmailAndPassword(auth, email, password);
}

export async function signOut() {
  if (!firebaseConfigured) return;
  await ensureFirebase();
  await authSdk.signOut(auth);
}

export async function idToken(forceRefresh = false) {
  if (!firebaseConfigured) return "";
  await ensureFirebase();
  const user = auth?.currentUser;
  if (!user) return "";
  return user.getIdToken(forceRefresh);
}

export async function firebaseServices() {
  return ensureFirebase();
}
