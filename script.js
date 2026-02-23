// Firebase v9 Modular
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCN4t4vm_w93wV2ZSLHKyzOehXslkTxQCM",
  authDomain: "oil-form.firebaseapp.com",
  projectId: "oil-form",
  storageBucket: "oil-form.firebasestorage.app",
  messagingSenderId: "178062121688",
  appId: "1:178062121688:web:062a2e051918c44a6bd5ad",
  measurementId: "G-EL6DS942NF"
};

// Init
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// عناصر الصفحة
const typeSelect = document.getElementById("type");
const typeOther = document.getElementById("typeOther");
const filterSelect = document.getElementById("filter");
const filterOther = document.getElementById("filterOther");
const lastKmSelect = document.getElementById("lastKmSelect");
const lastKmOther = document.getElementById("lastKmOther");
const lastKmInput = document.getElementById("lastKm");

const saveBtn = document.getElementById("saveBtn");
const copyBtn = document.getElementById("copyBtn");
const vehicleList = document.getElementById("vehicleList");
const output = document.getElementById("output");

let sessionVehicles = {}; // بيانات الجلسة للنص النهائي

// إظهار خانة "أخرى"
typeSelect.addEventListener("change",()=>typeOther.style.display=typeSelect.value==="اخرى"?"block":"none");
filterSelect.addEventListener("change",()=>filterOther.style.display=filterSelect.value==="اخرى"?"block":"none");
lastKmSelect.addEventListener("change",()=>{
  if(lastKmSelect.value==="no"){
    lastKmOther.style.display="block";
    lastKmInput.style.display="none";
  } else {
    lastKmOther.style.display="none";
    lastKmInput.style.display="block";
  }
});

// تحويل التاريخ لشهر بالنص
function formatDate(dateStr){
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date(dateStr);
  if(isNaN(d)) return "";
  return `${d.getFullYear()}/${months[d.getMonth()]}/${("0"+d.getDate()).slice(-2)}`;
}

// ===================== حفظ / تحديث =====================
saveBtn.addEventListener("click", async()=>{
  const number = document.getElementById("number").value.trim();
  if(!number){alert("ادخل رقم المعدة"); return;}

  const typeText = typeSelect.value==="اخرى"?typeOther.value:typeSelect.value;
  const filterText = filterSelect.value==="اخرى"?filterOther.value:filterSelect.value;
  const currentKm = Number(document.getElementById("currentKm").value);
  let lastKmVal = lastKmSelect.value==="no"?lastKmOther.value:Number(lastKmInput.value);
  let kmDiff = lastKmSelect.value==="no"? "-": currentKm - Number(lastKmInput.value);
  const dateFormatted = formatDate(document.getElementById("date").value);

  const data = {
    type:typeText,
    filter:filterText,
    date:dateFormatted,
    currentKm,
    lastKm:lastKmVal,
    updatedAt:new Date()
  };

  // حفظ أو تحديث في Firebase
  await setDoc(doc(db,"vehicles",number),data);

  // إضافة / تحديث في النص النهائي
  if(!sessionVehicles[typeText]) sessionVehicles[typeText]=[];
  // إزالة إذا الرقم موجود مسبقًا
  sessionVehicles[typeText]=sessionVehicles[typeText].filter(v=>v.number!==number);
  sessionVehicles[typeText].push({...data, number, kmDiff});

  updateOutput();
  clearForm();
  loadVehicles();
});

// ===================== نسخ النص =====================
copyBtn.addEventListener("click",()=>{
  navigator.clipboard.writeText(output.innerText);
  alert("تم النسخ ✅");
});

// ===================== عرض النص النهائي =====================
function updateOutput(){
  let text="";
  for(let type in sessionVehicles){
    text+=`\n${type}:\n`;
    // ترتيب حسب الممشى منذ آخر تغيير
    sessionVehicles[type].sort((a,b)=>b.kmDiff - a.kmDiff);
    sessionVehicles[type].forEach(v=>{
      text+=`رقم المعدة: ${v.number}
${v.kmDiff!=="-"?`الممشى الحالي: ${v.currentKm}\nممشى آخر تغيير زيت: ${v.lastKm}\nالممشى منذ آخر تغيير: ${v.kmDiff}`:`ملاحظة: ${v.lastKm}`}
تاريخ آخر تغيير زيت: ${v.date}
حالة فلتر الزيت: ${v.filter}
----------------------\n`;
    });
  }
  output.innerText=text.trim();
}

// ===================== عرض المركبات المخزنة =====================
async function loadVehicles(){
  vehicleList.innerHTML="";
  const snapshot = await getDocs(collection(db,"vehicles"));
  snapshot.forEach(docItem=>{
    const div=document.createElement("div");
    div.className="vehicle-item";
    div.innerHTML=`<strong>رقم المعدة:</strong> ${docItem.id}<hr>`;
    vehicleList.appendChild(div);
  });
}

// ===================== تفريغ النموذج =====================
function clearForm(){
  document.getElementById("number").value="";
  typeSelect.value=typeSelect.options[0].value;
  typeOther.value="";
  document.getElementById("date").value="";
  document.getElementById("currentKm").value="";
  lastKmInput.value="";
  lastKmOther.value="";
  lastKmSelect.value="";
  filterSelect.value=filterSelect.options[0].value;
  filterOther.value="";
}

// تحميل البيانات المخزنة عند البداية
loadVehicles();