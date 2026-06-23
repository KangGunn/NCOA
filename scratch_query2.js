import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDcXl86uUiljk2niKwtAqNqFGZVGD9Oc7Q",
    authDomain: "seniorkatusa-80bb6.firebaseapp.com",
    projectId: "seniorkatusa-80bb6",
    storageBucket: "seniorkatusa-80bb6.appspot.com",
    messagingSenderId: "367123164478",
    appId: "1:367123164478:web:1ec44e99f01bc4c599b50e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
    console.log("Querying movements for 윤하늘...");
    const q = query(collection(db, "movements"), where("name", "==", "윤하늘"));
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
        console.log(doc.id, doc.data());
    });
    console.log("Query completed.");
}

run();
