import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDcXl86uUiljk2niKwtAqNqFGZVGD9Oc7Q",
    authDomain: "seniorkatusa-aa594.firebaseapp.com",
    projectId: "seniorkatusa-aa594",
    storageBucket: "seniorkatusa-aa594.firebasestorage.app",
    messagingSenderId: "572601133671",
    appId: "1:572601133671:web:13f090ee5d779f309e42c2",
    measurementId: "G-WNNKJ4ZJ9H"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
    console.log("Querying all movements...");
    const q = query(collection(db, "movements"));
    const snap = await getDocs(q);
    console.log("Total movements found:", snap.size);
    snap.forEach(doc => {
        const data = doc.data();
        console.log(doc.id, "=> name:", data.name, "type:", data.type, "dates:", data.startDate, "~", data.endDate, "reason:", data.reason);
    });
}

run().catch(console.error);
