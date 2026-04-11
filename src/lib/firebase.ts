import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyDcXl86uUiljk2niKwtAqNqFGZVGD9Oc7Q",
    authDomain: "seniorkatusa-aa594.firebaseapp.com",
    projectId: "seniorkatusa-aa594",
    storageBucket: "seniorkatusa-aa594.firebasestorage.app",
    messagingSenderId: "572601133671",
    appId: "1:572601133671:web:13f090ee5d779f309e42c2",
    measurementId: "G-WNNKJ4ZJ9H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
