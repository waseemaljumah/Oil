import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Firebase config
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
const outputDiv = document.getElementById("output");

const typeSelect = document.getElementById("typeSelect");
const typeOther = document.getElementById("typeOther");
const filterSelect = document.getElementById("filterSelect");
const filterOther = document.getElementById("filterOther");
const lastKmSelect = document.getElementById("lastKmSelect");
const lastKmOther = document.getElementById("lastKmOther");
const lastKmInput = document.getElementById("lastKmInput");

// التحكم بالحقول الأخرى
typeSelect.addEventListener("change", ()=>{ typeOther.style.display = typeSelect.value==="اخرى"?"block":"none"; });
filterSelect.addEventListener("change", ()=>{ filterOther.style.display = filterSelect.value==="اخرى"?"block":"none"; });
lastKmSelect.addEventListener("change", ()=>{
  if(lastKmSelect.value==="no"){ lastKmOther.style.display="block"; lastKmInput.style.display="none"; }
  else { lastKmOther.style.display="none"; lastKmInput.style.display="block"; }
});

// تخزين بيانات الجلسة اليوم
let sessionVehicles = {};

// =================== حفظ / تحديث ===================
saveBtn.addEventListener("click", async ()=>{
  const number = document.getElementById("number").value.trim();
  if(!number){ alert("ادخل رقم المعدة"); return; }

  const typeVal = typeSelect.value==="اخرى"? typeOther.value : typeSelect.value;
  const filterVal = filterSelect.value==="اخرى"? filterOther.value : filterSelect.value;
  const lastKmVal = lastKmSelect.value==="no"? lastKmOther.value : lastKmInput.value || 0;
  const currentKmVal = Number(document.getElementById("currentKm").value);
  const dateVal = document.getElementById("date").value;

  const data = {
    type: typeVal,
    date: dateVal,
    currentKm: currentKmVal,
    lastKm: lastKmVal,
    filter: filterVal,
    updatedAt: new Date()
  };

  await setDoc(doc(db,"vehicles",number), data);

  // تحديث النص النهائي
  if(!sessionVehicles[typeVal]) sessionVehicles[typeVal]=[];
  // إزالة المعدة إذا موجودة سابقاً
  sessionVehicles[typeVal] = sessionVehicles[typeVal].filter(v=>v.number!==number);
  sessionVehicles[typeVal].push({number, data, km: currentKmVal});

  updateOutput();
  clearForm();
  loadVehicles();
  alert("✅ تم الحفظ أو التحديث");
});

// =================== البحث ===================
searchBtn.addEventListener("click", async ()=>{
  const number = document.getElementById("searchNumber").value.trim();
  if(!number){ alert("ادخل رقم المعدة للبحث"); return; }

  const docSnap = await getDoc(doc(db,"vehicles",number));
  if(docSnap.exists()){
    const data = docSnap.data();
    document.getElementById("number").value = number;
    typeSelect.value = ["قلاب فولفو","قلاب مرسيدس","شيول","بلدوزر","بوبكات"].includes(data.type)? data.type:"اخرى";
    typeOther.value = typeSelect.value==="اخرى"? data.type:"";
    filterSelect.value = ["تم تغييره في آخر تغيير","تم تغييره في التغيير قبل الأخير","لم يتم تغييره في آخر تغييرين"].includes(data.filter)? data.filter:"اخرى";
    filterOther.value = filterSelect.value==="اخرى"? data.filter:"";
    document.getElementById("date").value = data.date;
    document.getElementById("currentKm").value = data.currentKm;
    if(data.lastKm==="-" || isNaN(data.lastKm)){
      lastKmSelect.value="no"; lastKmOther.style.display="block"; lastKmInput.style.display="none"; lastKmOther.value=data.lastKm;
    } else {
      lastKmSelect.value=""; lastKmOther.style.display="none"; lastKmInput.style.display="block"; lastKmInput.value=data.lastKm;
    }
    alert("📦 تم تحميل البيانات");
  } else { alert("❌ المركبة غير موجودة"); }
});

// =================== حذف ===================
deleteBtn.addEventListener("click", async ()=>{
  const number = document.getElementById("searchNumber").value.trim();
  if(!number){ alert("ادخل رقم المعدة للحذف"); return; }

  await deleteDoc(doc(db,"vehicles",number));
  for(let type in sessionVehicles){ sessionVehicles[type] = sessionVehicles[type].filter(v=>v.number!==number); }
  updateOutput();
  loadVehicles();
  alert("🗑 تم الحذف");
});

// =================== عرض كل المركبات ===================
async function loadVehicles(){
  vehicleList.innerHTML="";
  const querySnapshot = await getDocs(collection(db,"vehicles"));
  querySnapshot.forEach(docItem=>{
    const div = document.createElement("div");
    div.className="vehicle-item";
    div.innerHTML=`<strong>رقم المعدة:</strong> ${docItem.id} <strong>النوع:</strong> ${docItem.data().type}`;
    vehicleList.appendChild(div);
  });
}

// =================== تحديث النص النهائي ===================
function updateOutput(){
  let text="";
  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type=>{
    text+=`\n${type}:\n`;
    sessionVehicles[type].sort((a,b)=>b.km-a.km).forEach(v=>{
      const dateParts = v.data.date.split("-"); 
      const formattedDate = dateParts.length===3? `${dateParts[0]}/${new Date(v.data.date).toLocaleString('en-us',{month:'short'})}/${dateParts[2]}` : v.data.date;
      text+=`رقم المعدة: ${v.number}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${v.data.lastKm}\nتاريخ آخر تغيير زيت: ${formattedDate}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------\n`;
    });
  });
  outputDiv.innerText=text.trim();
}

// =================== نسخ النص ===================
copyBtn.addEventListener("click", ()=>{ navigator.clipboard.writeText(outputDiv.innerText); alert("تم النسخ"); });

// =================== تفريغ النموذج ===================
function clearForm(){
  document.getElementById("number").value="";
  typeSelect.value="قلاب فولفو";
  typeOther.value="";
  document.getElementById("date").value="";
  document.getElementById("currentKm").value="";
  lastKmInput.value="";
  lastKmOther.value="";
  lastKmSelect.value="";
  filterSelect.value="تم تغييره في آخر تغيير";
  filterOther.value="";
}

loadVehicles();