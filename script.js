import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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

const saveBtn = document.getElementById("saveBtn");
const searchBtn = document.getElementById("searchBtn");
const deleteBtn = document.getElementById("deleteBtn");
const copyBtn = document.getElementById("copyBtn");
const copyGreenBtn = document.getElementById("copyGreenBtn");
const copyRedBtn = document.getElementById("copyRedBtn");
const vehicleList = document.getElementById("vehicleList");
const outputDiv = document.getElementById("output");

const typeSelect = document.getElementById("typeSelect");
const typeOther = document.getElementById("typeOther");
const filterSelect = document.getElementById("filterSelect");
const filterOther = document.getElementById("filterOther");
const lastKmSelect = document.getElementById("lastKmSelect");
const lastKmOther = document.getElementById("lastKmOther");
const lastKmInput = document.getElementById("lastKmInput");

typeSelect.addEventListener("change", () => {
  typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";
});

filterSelect.addEventListener("change", () => {
  filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";
});

// ===== التعديل 1: إخفاء حقل الكتابة وتعيين القيمة تلقائياً =====
lastKmSelect.addEventListener("change", () => {
  if (lastKmSelect.value === "no") {
    lastKmOther.style.display = "none";
    lastKmInput.style.display = "none";
  } else {
    lastKmOther.style.display = "none";
    lastKmInput.style.display = "block";
  }
});

let sessionVehicles = {};
let allVehiclesData = [];

// ===== التعديل 2: لا لون إذا لا يوجد عداد =====
function getStatusEmoji(type, kmSinceLastChange, lastKm) {
  if (!lastKm || lastKm === "لا يوجد عداد" || isNaN(Number(lastKm))) return "";

  const km = Number(kmSinceLastChange) || 0;
  const volvoTypes = ["لوبد فولفو", "قلاب فولفو", "وايت فولفو", "فولفو"];
  const heavyTypes = ["قريدر", "شيول", "بوكلين", "بلدوزر", "بوبكات"];

  if (volvoTypes.includes(type)) {
    return km >= 5500 ? "🔴" : "🟢";
  } else if (type === "قلاب مرسيدس") {
    return km >= 9500 ? "🔴" : "🟢";
  } else if (heavyTypes.includes(type)) {
    return km >= 250 ? "🔴" : "🟢";
  }
  return "";
}

// =================== حفظ / تحديث ===================
saveBtn.addEventListener("click", async () => {
  const number = document.getElementById("number").value.trim();
  if (!number) { alert("ادخل رقم المعدة"); return; }

  const typeVal = typeSelect.value === "اخرى" ? typeOther.value : typeSelect.value;
  const filterVal = filterSelect.value === "اخرى" ? filterOther.value : filterSelect.value;

  // ===== التعديل 3: تعيين "لا يوجد عداد" تلقائياً =====
  const lastKmVal = lastKmSelect.value === "no" ? "لا يوجد عداد" : (lastKmInput.value || 0);

  const currentKmVal = Number(document.getElementById("currentKm").value);
  const dateVal = document.getElementById("date").value;

  const kmDiff = (lastKmVal && lastKmVal !== "لا يوجد عداد" && !isNaN(lastKmVal))
    ? currentKmVal - Number(lastKmVal)
    : 0;

  const data = {
    type: typeVal,
    date: dateVal,
    currentKm: currentKmVal,
    lastKm: lastKmVal,
    kmSinceLastChange: kmDiff,
    filter: filterVal,
    updatedAt: new Date()
  };

  await setDoc(doc(db, "vehicles", number), data);

  if (!sessionVehicles[typeVal]) sessionVehicles[typeVal] = [];
  sessionVehicles[typeVal] = sessionVehicles[typeVal].filter(v => v.number !== number);
  sessionVehicles[typeVal].push({ number, data, kmDiff });

  updateOutput();
  clearForm();
  loadVehicles();
  alert("✅ تم الحفظ أو التحديث والإضافة للمتابعة اليومية");
});

// =================== البحث ===================
searchBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();
  if (!number) { alert("ادخل رقم المعدة للبحث"); return; }

  const docSnap = await getDoc(doc(db, "vehicles", number));
  if (docSnap.exists()) {
    const data = docSnap.data();
    document.getElementById("number").value = number;
    typeSelect.value = ["قلاب فولفو", "لوبد فولفو", "وايت فولفو", "قلاب مرسيدس", "وايت", "شيول", "بوكلين", "بلدوزر", "بوبكات"].includes(data.type) ? data.type : "اخرى";
    typeOther.value = typeSelect.value === "اخرى" ? data.type : "";
    filterSelect.value = ["تم تغييره في آخر تغيير", "تم تغييره في التغيير قبل الأخير", "لم يتم تغييره في آخر تغييرين"].includes(data.filter) ? data.filter : "اخرى";
    filterOther.value = filterSelect.value === "اخرى" ? data.filter : "";
    document.getElementById("date").value = data.date;
    document.getElementById("currentKm").value = data.currentKm;

    if (data.lastKm === "لا يوجد عداد" || isNaN(Number(data.lastKm))) {
      lastKmSelect.value = "no";
      lastKmOther.style.display = "none";
      lastKmInput.style.display = "none";
    } else {
      lastKmSelect.value = "";
      lastKmOther.style.display = "none";
      lastKmInput.style.display = "block";
      lastKmInput.value = data.lastKm;
    }
    alert("📦 تم تحميل البيانات");
  } else { alert("❌ المركبة غير موجودة"); }
});

// =================== حذف ===================
deleteBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();
  if (!number) { alert("ادخل رقم المعدة للحذف"); return; }

  await deleteDoc(doc(db, "vehicles", number));
  for (let type in sessionVehicles) { sessionVehicles[type] = sessionVehicles[type].filter(v => v.number !== number); }
  updateOutput();
  loadVehicles();
  alert("🗑 تم الحذف");
});

// =================== عرض كل المركبات ===================
async function loadVehicles() {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  allVehiclesData = [];
  querySnapshot.forEach(docItem => {
    allVehiclesData.push({ id: docItem.id, data: docItem.data() });
  });
  renderVehicles("all");
}

function renderVehicles(filterColor = "all") {
  vehicleList.innerHTML = "";

  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";
  filterBar.innerHTML = `
    <button class="filter-btn ${filterColor === 'all' ? 'active' : ''}" data-filter="all">📋 الكل</button>
    <button class="filter-btn ${filterColor === 'green' ? 'active' : ''}" data-filter="green">🟢 الأخضر</button>
    <button class="filter-btn ${filterColor === 'red' ? 'active' : ''}" data-filter="red">🔴 الأحمر</button>
    <button class="copy-filtered-btn" id="copyFilteredBtn">📋 نسخ المعروض</button>
  `;
  vehicleList.appendChild(filterBar);

  filterBar.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => { renderVehicles(btn.dataset.filter); });
  });

  const filtered = allVehiclesData.filter(v => {
    const emoji = getStatusEmoji(v.data.type, v.data.kmSinceLastChange, v.data.lastKm);
    if (filterColor === "green") return emoji === "🟢";
    if (filterColor === "red")   return emoji === "🔴";
    return true;
  });

  const grouped = {};
  filtered.forEach(v => {
    const type = v.data.type;
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(v);
  });

  const sortedTypes = Object.keys(grouped).sort();

  sortedTypes.forEach(type => {
    grouped[type].sort((a, b) => (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0));

    const groupHeader = document.createElement("div");
    groupHeader.className = "group-header";
    groupHeader.innerHTML = `<strong>📂 ${type}</strong>`;
    vehicleList.appendChild(groupHeader);

    grouped[type].forEach(v => {
      const emoji = getStatusEmoji(v.data.type, v.data.kmSinceLastChange, v.data.lastKm);
      const div = document.createElement("div");
      div.className = "vehicle-item";
      div.innerHTML = `
        <div class="item-row">
          <span><strong>رقم المعدة:</strong> ${v.id} ${emoji} &nbsp;|&nbsp; <strong>الممشى منذ آخر تغيير:</strong> ${v.data.kmSinceLastChange || 0}</span>
          <div class="item-btns">
            <button class="btn-view" data-id="${v.id}">👁 عرض</button>
            <button class="btn-delete" data-id="${v.id}">🗑 حذف</button>
          </div>
        </div>
        <div class="vehicle-details" id="details-${v.id}" style="display:none;">
          <p><strong>نوع المعدة:</strong> ${v.data.type}</p>
          <p><strong>الممشى الحالي:</strong> ${v.data.currentKm}</p>
          <p><strong>ممشى آخر تغيير زيت:</strong> ${v.data.lastKm}</p>
          <p><strong>الممشى منذ آخر تغيير:</strong> ${v.data.kmSinceLastChange || 0}</p>
          <p><strong>تاريخ آخر تغيير زيت:</strong> ${v.data.date}</p>
          <p><strong>حالة فلتر الزيت:</strong> ${v.data.filter}</p>
          <button class="btn-edit" data-id="${v.id}">✏️ تعديل</button>
        </div>
      `;
      vehicleList.appendChild(div);
    });
  });

  document.getElementById("copyFilteredBtn").addEventListener("click", () => {
    const today = new Date();
    const todayFormatted = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
    let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;

    sortedTypes.forEach(type => {
      grouped[type].forEach(v => {
        const dateParts = v.data.date.split("-");
        const formattedDate = dateParts.length === 3 ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}` : v.data.date;
        const emoji = getStatusEmoji(type, v.data.kmSinceLastChange, v.data.lastKm);
        text += `نوع المعدة: ${type}
رقم المعدة: ${v.id} ${emoji}
الممشى الحالي: ${v.data.currentKm}
ممشى آخر تغيير زيت: ${v.data.lastKm}
الممشى منذ آخر تغيير: ${v.data.kmSinceLastChange}
تاريخ آخر تغيير زيت: ${formattedDate}
حالة فلتر الزيت: ${v.data.filter}
----------------------\n`;
      });
    });

    navigator.clipboard.writeText(text.trim());
    alert("✅ تم النسخ");
  });

  document.querySelectorAll(".btn-view").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const details = document.getElementById(`details-${id}`);
      const isVisible = details.style.display === "block";
      document.querySelectorAll(".vehicle-details").forEach(d => d.style.display = "none");
      document.querySelectorAll(".btn-view").forEach(b => b.textContent = "👁 عرض");
      if (!isVisible) {
        details.style.display = "block";
        btn.textContent = "🔼 إخفاء";
      }
    });
  });

  document.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!confirm(`هل تريد حذف المعدة رقم ${id}؟`)) return;
      await deleteDoc(doc(db, "vehicles", id));
      for (let type in sessionVehicles) { sessionVehicles[type] = sessionVehicles[type].filter(v => v.number !== id); }
      updateOutput();
      loadVehicles();
      alert("🗑 تم الحذف");
    });
  });

  document.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const docSnap = await getDoc(doc(db, "vehicles", id));
      if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById("number").value = id;
        typeSelect.value = ["قلاب فولفو", "لوبد فولفو", "وايت فولفو", "قلاب مرسيدس", "وايت", "شيول", "بوكلين", "بلدوزر", "بوبكات"].includes(data.type) ? data.type : "اخرى";
        typeOther.value = typeSelect.value === "اخرى" ? data.type : "";
        typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";
        filterSelect.value = ["تم تغييره في آخر تغيير", "تم تغييره في التغيير قبل الأخير", "لم يتم تغييره في آخر تغييرين"].includes(data.filter) ? data.filter : "اخرى";
        filterOther.value = filterSelect.value === "اخرى" ? data.filter : "";
        filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";
        document.getElementById("date").value = data.date;
        document.getElementById("currentKm").value = data.currentKm;

        if (data.lastKm === "لا يوجد عداد" || isNaN(Number(data.lastKm))) {
          lastKmSelect.value = "no";
          lastKmOther.style.display = "none";
          lastKmInput.style.display = "none";
        } else {
          lastKmSelect.value = "";
          lastKmOther.style.display = "none";
          lastKmInput.style.display = "block";
          lastKmInput.value = data.lastKm;
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        alert("✏️ تم تحميل البيانات للتعديل، عدّل ثم اضغط حفظ/تحديث");
      }
    });
  });
}

// =================== تحديث النص النهائي ===================
function updateOutput() {
  let text = "";
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
  text += `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;

  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    sessionVehicles[type].sort((a, b) => (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0));
    sessionVehicles[type].forEach(v => {
      const dateParts = v.data.date.split("-");
      const formattedDate = dateParts.length === 3 ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}` : v.data.date;
      const emoji = getStatusEmoji(type, v.data.kmSinceLastChange, v.data.lastKm);
      text += `نوع المعدة: ${type}
رقم المعدة: ${v.number} ${emoji}
الممشى الحالي: ${v.data.currentKm}
ممشى آخر تغيير زيت: ${v.data.lastKm}
الممشى منذ آخر تغيير: ${v.data.kmSinceLastChange}
تاريخ آخر تغيير زيت: ${formattedDate}
حالة فلتر الزيت: ${v.data.filter}
----------------------\n`;
    });
  });

  outputDiv.innerText = text.trim();
}

// =================== نسخ حسب اللون ===================
function copyByColor(filterFn) {
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;

  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    const filtered = sessionVehicles[type].filter(v => {
      const emoji = getStatusEmoji(type, v.data.kmSinceLastChange, v.data.lastKm);
      return filterFn(emoji);
    });

    filtered.sort((a, b) => (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0));

    filtered.forEach(v => {
      const dateParts = v.data.date.split("-");
      const formattedDate = dateParts.length === 3 ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}` : v.data.date;
      const emoji = getStatusEmoji(type, v.data.kmSinceLastChange, v.data.lastKm);
      text += `نوع المعدة: ${type}
رقم المعدة: ${v.number} ${emoji}
الممشى الحالي: ${v.data.currentKm}
ممشى آخر تغيير زيت: ${v.data.lastKm}
الممشى منذ آخر تغيير: ${v.data.kmSinceLastChange}
تاريخ آخر تغيير زيت: ${formattedDate}
حالة فلتر الزيت: ${v.data.filter}
----------------------\n`;
    });
  });

  navigator.clipboard.writeText(text.trim());
  alert("تم النسخ");
}

copyBtn.addEventListener("click", () => { navigator.clipboard.writeText(outputDiv.innerText); alert("تم النسخ"); });
copyGreenBtn.addEventListener("click", () => { copyByColor(e => e === "🟢"); });
copyRedBtn.addEventListener("click", () => { copyByColor(e => e === "🔴"); });

// =================== تفريغ النموذج ===================
function clearForm() {
  document.getElementById("number").value = "";
  typeSelect.value = "قلاب مرسيدس";
  typeOther.value = "";
  document.getElementById("date").value = "";
  document.getElementById("currentKm").value = "";
  lastKmInput.value = "";
  lastKmOther.value = "";
  lastKmSelect.value = "";
  lastKmInput.style.display = "block";
  lastKmOther.style.display = "none";
  filterSelect.value = "تم تغييره في آخر تغيير";
  filterOther.value = "";
}

// =================== تصدير Excel ===================
const exportBtn = document.getElementById("exportBtn");

exportBtn.addEventListener("click", async () => {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  let dataArray = [];

  querySnapshot.forEach(docItem => {
    const d = docItem.data();
    const currentKm = Number(d.currentKm) || 0;
    const lastKm = Number(d.lastKm) || 0;
    const kmDiff = currentKm - lastKm;

    const dateParts = d.date.split("-");
    const formattedDate = dateParts.length === 3 ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}` : d.date;

    dataArray.push({
      "نوع المعدة": d.type,
      "رقم المعدة": docItem.id,
      "الممشى الحالي": currentKm,
      "ممشى آخر تغيير زيت": d.lastKm,
      "الممشى منذ آخر تغيير": d.lastKm === "لا يوجد عداد" ? "-" : kmDiff,
      "تاريخ آخر تغيير زيت": formattedDate,
      "حالة فلتر الزيت": d.filter
    });
  });

  dataArray.sort((a, b) => {
    if (a["نوع المعدة"] < b["نوع المعدة"]) return -1;
    if (a["نوع المعدة"] > b["نوع المعدة"]) return 1;
    return b["الممشى الحالي"] - a["الممشى الحالي"];
  });

  const worksheet = XLSX.utils.json_to_sheet(dataArray, { origin: 1 });

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  XLSX.utils.sheet_add_aoa(worksheet, [[`المتابعة اليومية للزيوت / تاريخ: ${yyyy}/${mm}/${dd}`]], { origin: 0 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "المركبات");

  XLSX.writeFile(workbook, "متابعة_المركبات.xlsx");
});

loadVehicles();