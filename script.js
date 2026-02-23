// Firebase v9 Modular
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* 🔹 إعدادات مشروعك */
const firebaseConfig = {
  apiKey: "AIzaSyCN4t4vm_w93wV2ZSLHKyzOehXslkTxQCM",
  authDomain: "oil-form.firebaseapp.com",
  projectId: "oil-form",
  storageBucket: "oil-form.firebasestorage.app",
  messagingSenderId: "178062121688",
  appId: "1:178062121688:web:062a2e051918c44a6bd5ad",
  measurementId: "G-EL6DS942NF"
};

// 🔹 تشغيل Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// عناصر الصفحة
const saveBtn = document.getElementById("saveBtn");
const searchBtn = document.getElementById("searchBtn");
const deleteBtn = document.getElementById("deleteBtn");
const vehicleList = document.getElementById("vehicleList");

// =============================
// حفظ أو تحديث
// =============================
saveBtn.addEventListener("click", async () => {
  const number = document.getElementById("number").value.trim();

  if (!number) {
    alert("ادخل رقم المعدة");
    return;
  }

  const data = {
    type: document.getElementById("type").value,
    date: document.getElementById("date").value,
    currentKm: Number(document.getElementById("currentKm").value),
    lastKm: Number(document.getElementById("lastKm").value),
    filter: document.getElementById("filter").value,
    updatedAt: new Date()
  };

  await setDoc(doc(db, "vehicles", number), data);

  alert("✅ تم الحفظ أو التحديث بنجاح");
  clearForm();
  loadVehicles();
});

// =============================
// بحث
// =============================
searchBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();

  if (!number) {
    alert("ادخل رقم للبحث");
    return;
  }

  const docRef = doc(db, "vehicles", number);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data();

    document.getElementById("number").value = number;
    document.getElementById("type").value = data.type;
    document.getElementById("date").value = data.date;
    document.getElementById("currentKm").value = data.currentKm;
    document.getElementById("lastKm").value = data.lastKm;
    document.getElementById("filter").value = data.filter;

    alert("📦 تم تحميل البيانات");
  } else {
    alert("❌ المركبة غير موجودة");
  }
});

// =============================
// حذف
// =============================
deleteBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();

  if (!number) {
    alert("ادخل رقم للحذف");
    return;
  }

  await deleteDoc(doc(db, "vehicles", number));
  alert("🗑 تم الحذف");
  loadVehicles();
});

// =============================
// عرض كل المركبات
// =============================
async function loadVehicles() {
  vehicleList.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "vehicles"));

  querySnapshot.forEach((docItem) => {
    const div = document.createElement("div");
    div.className = "vehicle-item";
    div.innerHTML = `
      <strong>رقم المعدة:</strong> ${docItem.id}
      <hr>
    `;
    vehicleList.appendChild(div);
  });
}

// =============================
// تفريغ النموذج
// =============================
function clearForm() {
  document.getElementById("number").value = "";
  document.getElementById("type").value = "";
  document.getElementById("date").value = "";
  document.getElementById("currentKm").value = "";
  document.getElementById("lastKm").value = "";
  document.getElementById("filter").value = "";
}

loadVehicles();