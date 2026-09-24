// Configuración pública de Firebase para Prevenir PSST.
// Proyecto compartido por la página pública y el panel administrativo: alfredosst.
// Esta versión usa Authentication + Firestore directamente y NO usa Cloud Functions ni Cloud Storage.
export const firebaseConfig = {
  apiKey: "AIzaSyB3Uz0cpEZEB3j4ymqxh-lid5XdjI1J6f4",
  authDomain: "alfredosst.firebaseapp.com",
  projectId: "alfredosst",
  messagingSenderId: "863154096435",
  appId: "1:863154096435:web:1cf443f1e915fd90095646",
  measurementId: "G-GF0KQM59C1"
};

export const prevenirConfig = {
  publicSiteUrl: "https://alfredosst.web.app/",
  adminSiteUrl: "https://mike-jnt.github.io/alfredoSSTadmin/",
  useEmulators: false,
  emulatorHost: "127.0.0.1",
  authEmulatorPort: 9099,
  firestoreEmulatorPort: 8080
};
