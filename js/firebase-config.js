// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDVvSnf8pntFYKslZjVASYI0Z59RtRDG0",
  authDomain: "gottools-6e496.firebaseapp.com",
  projectId: "gottools-6e496",
  storageBucket: "gottools-6e496.firebasestorage.app",
  messagingSenderId: "1095699635077",
  appId: "1:1095699635077:web:a39568a4ea37200ea682ec",
  measurementId: "G-4T4VE86WM9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ✅ Force long polling to avoid Listen/channel 400 (works well for localhost / some networks)
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

// (optional) storage for later pages (tools with images etc.)
const storage = getStorage(app);

export { app, auth, db, storage };
