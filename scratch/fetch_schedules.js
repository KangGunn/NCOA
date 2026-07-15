import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

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

const getSchedules = async () => {
    const querySnapshot = await getDocs(collection(db, "schedules"));
    const list = [];
    querySnapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort by startDate
    list.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    
    console.log("=== BLC Events ===");
    list.filter(e => e.type === 'blc').forEach(e => {
        console.log(`[${e.id}] BLC: ${e.startDate} ~ ${e.endDate} - ${e.memo} (batch: ${e.batch})`);
    });

    console.log("\n=== KTA Events ===");
    list.filter(e => e.type === 'kta').forEach(e => {
        console.log(`[${e.id}] KTA: ${e.startDate} ~ ${e.endDate} - ${e.memo} (batch: ${e.batch})`);
    });
};

getSchedules().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
