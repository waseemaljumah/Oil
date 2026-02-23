// Firebase v9 Modular
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// 🔹 إعدادات Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCN4t4vm_w93wV2ZSLHKyzOehXslkTxQCM",
  authDomain: "oil-form.firebaseapp.com",
  projectId: "oil-form",
  storageBucket: "oil-form.firebasestorage.app",
  messagingSenderId: "178062121688",
  appId: "1:178062121688:web:062a2e051918c44a6bd5ad",
  measurementId: "G-EL6DS942NF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// عناصر الصفحة
const saveBtn = document.getElementById("saveBtn");
const searchBtn = document.getElementById("searchBtn");
const deleteBtn = document.getElementById("deleteBtn");
const copyBtn = document.getElementById("copyBtn");
const vehicleList = document.getElementById("vehicleList");

const typeSelect = document.getElementById('type');
const typeOther = document.getElementById('typeOther');
const filterSelect = document.getElementById('filter');
const filterOther = document.getElementById('filterOther');
const lastKmSelect = document.getElementById('lastKmSelect');
const lastKmOther = document.getElementById('lastKmOther');
const lastKmInput = document.getElementById('lastKm');

// قوائم اختيار
typeSelect.addEventListener('change', () => {
  typeOther.style.display = typeSelect.value === 'اخرى' ? 'block' : 'none';
});

filterSelect.addEventListener('change', () => {
  filterOther.style.display = filterSelect.value === 'اخرى' ? 'block' : 'none';
});

lastKmSelect.addEventListener('change', () => {
  if (lastKmSelect.value === 'none') {
    lastKmOther.style.display = 'block';
    lastKmInput.style.display = 'none';
  } else {
    lastKmOther.style.display = 'none';
    lastKmInput.style.display = 'block';
  }
});

// تخزين المركبات محليًا للنص النهائي
let vehicles = {};

// دالة لتنسيق التاريخ
function formatDate(dateStr) {
  if (!dateStr) return '';
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = months[d.getMonth()];
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}/${mm}/${dd}`;
}

// حفظ أو تحديث المركبة
saveBtn.addEventListener("click", async () => {
  const number = document.getElementById("number").value.trim();
  if (!number) { alert("ادخل رقم المعدة"); return; }

  const typeText = typeSelect.value==='اخرى'? typeOther.value : typeSelect.value;
  const filterText = filterSelect.value==='اخرى'? filterOther.value : filterSelect.value;
  const currentKm = Number(document.getElementById("currentKm").value);
  const lastKmVal = lastKmSelect.value==='none'? lastKmOther.value : lastKmInput.value;

  const data = {
    type: typeText,
    date: formatDate(document.getElementById("date").value),
    currentKm,
    lastKm: lastKmVal,
    filter: filterText,
    updatedAt: new Date()
  };

  // حفظ/تحديث Firebase
  await setDoc(doc(db,"vehicles",number), data);

  // تخزين محلي للنص النهائي
  if (!vehicles[typeText]) vehicles[typeText] = [];
  vehicles[typeText].push({ text:data, km: currentKm });

  // ترتيب حسب الممشى
  for (let t in vehicles) vehicles[t].sort((a,b)=>b.km - a.km);

  renderOutput();

  clearForm();
});

// دالة عرض النص النهائي
function renderOutput() {
  let outputText = '';
  for (let type in vehicles) {
    outputText += `\n${type}:\n`;
    vehicles[type].forEach(v=>{
      const diff = v.text.lastKm && !isNaN(v.text.lastKm)? v.text.currentKm - Number(v.text.lastKm) : '';
      outputText += `
رقم المعدة: ${v.text.number||''}
نوع المعدة: ${v.text.type}
الممشى الحالي: ${v.text.currentKm}
ممشى آخر تغيير زيت: ${v.text.lastKm}${diff!==''? '\nالممشى منذ آخر تغيير: '+diff :''}
تاريخ آخر تغيير زيت: ${v.text.date}
حالة فلتر الزيت: ${v.text.filter}
----------------------
`;
    });
  }
  document.getElementById('output').innerText = outputText.trim();
}

// نسخ النص النهائي
copyBtn.addEventListener("click", ()=>{
  navigator.clipboard.writeText(document.getElementById('output').innerText);
  alert('تم النسخ');
});

// بحث وتحميل المركبة
searchBtn.addEventListener("click", async ()=>{
  const number = document.getElementById("searchNumber").value.trim();
  if (!number){ alert("ادخل رقم للبحث"); return; }

  const docRef = doc(db,"vehicles",number);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()){
    const data = docSnap.data();
    document.getElementById("number").value = number;
    if (typeSelect.querySelector(`option[value="${data.type}"]`)) typeSelect.value=data.type;
    else { typeSelect.value='اخرى'; typeOther.value=data.type; typeOther.style.display='block'; }
    document.getElementById("date").value = data.date;
    document.getElementById("currentKm").value = data.currentKm;
    if (data.lastKm && !isNaN(data.lastKm)) { lastKmInput.value=data.lastKm; lastKmInput.style.display='block'; lastKmOther.style.display='none'; }
    else { lastKmOther.value=data.lastKm; lastKmInput.style.display='none'; lastKmOther.style.display='block'; lastKmSelect.value='none'; }
    if (filterSelect.querySelector(`option[value="${data.filter}"]`)) filterSelect.value=data.filter;
    else { filterSelect.value='اخرى'; filterOther.value=data.filter; filterOther.style.display='block'; }

    alert('📦 تم تحميل البيانات');
  } else alert('❌ المركبة غير موجودة');
});

// حذف المركبة
deleteBtn.addEventListener("click", async ()=>{
  const number = document.getElementById("searchNumber").value.trim();
  if (!number){ alert("ادخل رقم للحذف"); return; }
  await deleteDoc(doc(db,"vehicles",number));
  alert('🗑 تم الحذف');
});

// تفريغ النموذج
function clearForm(){
  document.getElementById("number").value='';
  typeSelect.value=typeSelect.options[0].value;
  typeOther.value='';
  typeOther.style.display='none';
  document.getElementById("date").value='';
  document.getElementById("currentKm").value='';
  lastKmInput.value=''; lastKmInput.style.display='block';
  lastKmOther.value=''; lastKmOther.style.display='none';
  filterSelect.value=filterSelect.options[0].value;
  filterOther.value='';
  filterOther.style.display='none';
}