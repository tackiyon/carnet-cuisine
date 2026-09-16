// Remplace ces valeurs par celles de TON projet Firebase.
// Tu les trouves dans : Firebase console > Paramètres du projet > Tes applications > SDK config
const firebaseConfig = {
  apiKey: "AIzaSyCWN4txLGTvY7QUoBw7HcDPCp3tnqtJtT0",
  authDomain: "carnet-repas.firebaseapp.com",
  projectId: "carnet-repas",
  storageBucket: "carnet-repas.firebasestorage.app",
  messagingSenderId: "112793035805",
  appId: "1:112793035805:web:6b42446f8ab8fa46d112f4"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Liste fixe des appareils disponibles (catégories automatiques dans le menu de gauche,
// en plus des rubriques que tu crées toi-même). Un plat peut utiliser plusieurs appareils.
const APPAREILS = [
  { id: "cookeo", label: "Cookeo" },
  { id: "airfryer", label: "Air fryer" },
  { id: "four", label: "Four" }
];

// Unités disponibles pour quantifier un ingrédient (utilisées dans le formulaire
// de plat et pour l'agrégation de la liste de courses).
const UNITES = [
  { id: "g", label: "g" },
  { id: "kg", label: "kg" },
  { id: "ml", label: "ml" },
  { id: "cl", label: "cl" },
  { id: "l", label: "l" },
  { id: "cas", label: "càs" },
  { id: "cac", label: "càc" },
  { id: "pincee", label: "pincée" },
  { id: "unite", label: "unité(s)" }
];
