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

// ===== DOM refs =====
const saveBtn         = document.getElementById("saveBtn");
const saveOnlyBtn     = document.getElementById("saveOnlyBtn");
const searchBtn       = document.getElementById("searchBtn");
const deleteBtn       = document.getElementById("deleteBtn");
const copyBtn         = document.getElementById("copyBtn");
const copyGreenBtn    = document.getElementById("copyGreenBtn");
const copyRedBtn      = document.getElementById("copyRedBtn");
const copyWhiteBtn    = document.getElementById("copyWhiteBtn");
const copyBlueBtn     = document.getElementById("copyBlueBtn");
const copyBlackBtn    = document.getElementById("copyBlackBtn");
const vehicleList     = document.getElementById("vehicleList");
const dailyList       = document.getElementById("dailyList");
const typeSelect      = document.getElementById("typeSelect");
const typeOther       = document.getElementById("typeOther");
const filterSelect    = document.getElementById("filterSelect");
const filterOther     = document.getElementById("filterOther");
const lastKmSelect    = document.getElementById("lastKmSelect");
const lastKmOther     = document.getElementById("lastKmOther");
const lastKmInput     = document.getElementById("lastKmInput");
const currentKmInput  = document.getElementById("currentKm");
const storedSearch    = document.getElementById("storedSearch");
const exportSortSelect = document.getElementById("exportSortSelect");

const NO_KM_TEXT       = "لا يوجد عداد في آخر تغيير زيت في النظام";
const NO_CURRENT_TEXT  = "لا يوجد ممشى حالي";
const BROKEN_TEXT      = "العداد لا يعمل";

// ===== State =====
// sessionVehicles: { type: [{number, data, kmDiff}] } — المتابعة اليومية
let sessionVehicles  = {};
// dailyRemovedIds: set of ids removed from daily tracking
let dailyRemovedIds  = new Set();
let allVehiclesData  = [];
let currentFilter    = "all";

// ===== Helpers =====
function getCurrentKmMode() {
  return document.querySelector('input[name="currentKmMode"]:checked')?.value || "has";
}

function setCurrentKmMode(mode) {
  const radio = document.querySelector(`input[name="currentKmMode"][value="${mode}"]`);
  if (radio) {
    radio.checked = true;
    handleKmModeChange(mode);
  }
}

function handleKmModeChange(mode) {
  if (mode === "has") {
    currentKmInput.style.display = "block";
    currentKmInput.placeholder = "أدخل الممشى الحالي";
    currentKmInput.value = "";
  } else if (mode === "none") {
    currentKmInput.style.display = "none";
    currentKmInput.value = "";
  } else if (mode === "broken") {
    currentKmInput.style.display = "none";
    currentKmInput.value = "";
  }
}

document.querySelectorAll('input[name="currentKmMode"]').forEach(radio => {
  radio.addEventListener("change", () => handleKmModeChange(radio.value));
});

typeSelect.addEventListener("change", () => {
  typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";
});

filterSelect.addEventListener("change", () => {
  filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";
});

lastKmSelect.addEventListener("change", () => {
  if (lastKmSelect.value === "no") {
    lastKmOther.style.display = "none";
    lastKmInput.style.display = "none";
  } else {
    lastKmOther.style.display = "none";
    lastKmInput.style.display = "block";
  }
});

function isNoKm(lastKm) {
  return !lastKm || lastKm === NO_KM_TEXT || isNaN(Number(lastKm));
}

// الحالة اللونية — تُرجع: green | red | white | blue | black
function getStatusColor(type, kmSinceLastChange, lastKm, currentKmMode) {
  // لا يوجد عداد في آخر تغيير → أسود
  if (isNoKm(lastKm)) return "black";

  // حالات الممشى الحالي
  if (currentKmMode === "none") return "white";
  if (currentKmMode === "broken") return "blue";

  const km = Number(kmSinceLastChange) || 0;
  const volvoTypes  = ["لوبد فولفو", "قلاب فولفو", "وايت فولفو", "فولفو"];
  const heavyTypes  = ["قريدر", "شيول", "بوكلين", "بلدوزر", "بوبكات"];

  if (volvoTypes.includes(type)) {
    return km >= 5500 ? "red" : "green";
  } else if (type === "قلاب مرسيدس") {
    return km >= 9500 ? "red" : "green";
  } else if (heavyTypes.includes(type)) {
    return km >= 250 ? "red" : "green";
  }
  return "green";
}

function colorToEmoji(color) {
  const map = { green: "🟢", red: "🔴", white: "⚪", blue: "🔵", black: "⚫" };
  return map[color] || "";
}

// ===== حفظ البيانات =====
async function doSave(addToDaily) {
  const number = document.getElementById("number").value.trim();
  if (!number) { alert("ادخل رقم المعدة"); return; }

  const typeVal   = typeSelect.value === "اخرى" ? typeOther.value : typeSelect.value;
  const filterVal = filterSelect.value === "اخرى" ? filterOther.value : filterSelect.value;
  const lastKmVal = lastKmSelect.value === "no" ? NO_KM_TEXT : (lastKmInput.value || 0);
  const dateVal   = document.getElementById("date").value;

  const mode = getCurrentKmMode();
  let currentKmVal = 0;
  let currentKmDisplay = "";
  if (mode === "none") {
    currentKmDisplay = NO_CURRENT_TEXT;
  } else if (mode === "broken") {
    currentKmDisplay = BROKEN_TEXT;
  } else {
    currentKmVal = Number(currentKmInput.value) || 0;
    currentKmDisplay = String(currentKmVal);
  }

  const kmDiff = (!isNoKm(lastKmVal) && mode === "has")
    ? currentKmVal - Number(lastKmVal)
    : 0;

  const data = {
    type: typeVal,
    date: dateVal,
    currentKm: currentKmDisplay,
    currentKmMode: mode,
    lastKm: lastKmVal,
    kmSinceLastChange: kmDiff,
    filter: filterVal,
    updatedAt: new Date()
  };

  await setDoc(doc(db, "vehicles", number), data);

  if (addToDaily) {
    dailyRemovedIds.delete(number); // إذا أضيف مجدداً، يُزال من قائمة المحذوفات
    if (!sessionVehicles[typeVal]) sessionVehicles[typeVal] = [];
    sessionVehicles[typeVal] = sessionVehicles[typeVal].filter(v => v.number !== number);
    sessionVehicles[typeVal].push({ number, data, kmDiff });
    updateDailyList();
  }

  clearForm();
  loadVehicles();
  alert(addToDaily ? "✅ تم الحفظ والإضافة للمتابعة اليومية" : "✅ تم الحفظ/التحديث");
}

saveBtn.addEventListener("click", () => doSave(true));
saveOnlyBtn.addEventListener("click", () => doSave(false));

// ===== البحث =====
searchBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();
  if (!number) { alert("ادخل رقم المعدة للبحث"); return; }

  const docSnap = await getDoc(doc(db, "vehicles", number));
  if (docSnap.exists()) {
    const data = docSnap.data();
    document.getElementById("number").value = number;
    typeSelect.value = ["قلاب فولفو","لوبد فولفو","وايت فولفو","قلاب مرسيدس","وايت","شيول","بوكلين","بلدوزر","بوبكات"].includes(data.type) ? data.type : "اخرى";
    typeOther.value  = typeSelect.value === "اخرى" ? data.type : "";
    filterSelect.value = ["تم تغييره في آخر تغيير","تم تغييره في التغيير قبل الأخير","لم يتم تغييره في آخر تغييرين"].includes(data.filter) ? data.filter : "اخرى";
    filterOther.value  = filterSelect.value === "اخرى" ? data.filter : "";
    document.getElementById("date").value = data.date;

    // حالة الممشى الحالي
    const mode = data.currentKmMode || "has";
    setCurrentKmMode(mode);
    if (mode === "has") currentKmInput.value = data.currentKm || "";

    if (isNoKm(data.lastKm)) {
      lastKmSelect.value = "no";
      lastKmInput.style.display = "none";
    } else {
      lastKmSelect.value = "";
      lastKmInput.style.display = "block";
      lastKmInput.value = data.lastKm;
    }
    alert("📦 تم تحميل البيانات");
  } else {
    alert("❌ المركبة غير موجودة");
  }
});

// ===== حذف =====
deleteBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();
  if (!number) { alert("ادخل رقم المعدة للحذف"); return; }
  await deleteDoc(doc(db, "vehicles", number));
  for (let type in sessionVehicles) {
    sessionVehicles[type] = sessionVehicles[type].filter(v => v.number !== number);
  }
  updateDailyList();
  loadVehicles();
  alert("🗑 تم الحذف");
});

// ===== المتابعة اليومية =====
function updateDailyList() {
  if (!dailyList) return;
  dailyList.innerHTML = "";
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;

  const header = document.createElement("div");
  header.className = "daily-header";
  header.textContent = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}`;
  dailyList.appendChild(header);

  const sortedTypes = Object.keys(sessionVehicles).sort();
  let hasItems = false;

  sortedTypes.forEach(type => {
    const vehicles = sessionVehicles[type].filter(v => !dailyRemovedIds.has(v.number));
    if (vehicles.length === 0) return;
    hasItems = true;

    vehicles.sort((a, b) => (b.kmDiff || 0) - (a.kmDiff || 0));
    vehicles.forEach(v => {
      const color = getStatusColor(v.data.type, v.data.kmSinceLastChange, v.data.lastKm, v.data.currentKmMode || "has");

      const div = document.createElement("div");
      div.className = `daily-item daily-${color}`;
      div.innerHTML = `
        <div class="daily-text-block">
          <div class="daily-remove-row">
            <button class="btn-remove-daily" data-number="${v.number}" title="إزالة من المتابعة اليومية">✕</button>
          </div>
          <pre class="daily-text">${buildVehicleLine(v, type)}</pre>
        </div>
      `;
      dailyList.appendChild(div);
    });
  });

  if (!hasItems) {
    const empty = document.createElement("p");
    empty.style.textAlign = "center";
    empty.style.color = "#888";
    empty.textContent = "لا توجد مركبات في المتابعة اليومية بعد";
    dailyList.appendChild(empty);
  }

  // ربط أزرار الإزالة
  dailyList.querySelectorAll(".btn-remove-daily").forEach(btn => {
    btn.addEventListener("click", () => {
      const num = btn.dataset.number;
      dailyRemovedIds.add(num);
      updateDailyList();
    });
  });

  // تحديث النص المخفي للنسخ
  buildOutputText();
}

function buildVehicleLine(v, type) {
  const color = getStatusColor(v.data.type, v.data.kmSinceLastChange, v.data.lastKm, v.data.currentKmMode || "has");
  const emoji = colorToEmoji(color);
  const dateParts = (v.data.date || "").split("-");
  const formattedDate = dateParts.length === 3 ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}` : v.data.date;
  const lastKmDisplay = isNoKm(v.data.lastKm) ? "لا يوجد عداد في آخر تغيير" : v.data.lastKm;
  const kmSince = isNoKm(v.data.lastKm) ? "-" : (v.data.kmSinceLastChange || 0);
  return `نوع المعدة: ${type}\nرقم المعدة: ${v.number} ${emoji}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${lastKmDisplay}\nالممشى منذ آخر تغيير: ${kmSince}\nتاريخ آخر تغيير زيت: ${formattedDate}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------`;
}

function buildOutputText() {
  const output = document.getElementById("output");
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;

  const lines = [`المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}`, ""];

  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    const vehicles = sessionVehicles[type].filter(v => !dailyRemovedIds.has(v.number));
    if (!vehicles.length) return;
    vehicles.sort((a, b) => (b.kmDiff || 0) - (a.kmDiff || 0));
    vehicles.forEach(v => lines.push(buildVehicleLine(v, type)));
  });

  if (output) output.innerText = lines.join("\n");
}

// ===== نسخ =====
function copyByColorFilter(filterFn) {
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;
  const lines2 = [`المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}`, ""];
  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    const vehicles = sessionVehicles[type].filter(v => {
      if (dailyRemovedIds.has(v.number)) return false;
      const color = getStatusColor(v.data.type, v.data.kmSinceLastChange, v.data.lastKm, v.data.currentKmMode || "has");
      return filterFn(color);
    });
    if (!vehicles.length) return;
    vehicles.sort((a, b) => (b.kmDiff || 0) - (a.kmDiff || 0));
    vehicles.forEach(v => lines2.push(buildVehicleLine(v, type)));
  });
  navigator.clipboard.writeText(lines2.join("\n"));
  alert("✅ تم النسخ");
}

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("output").innerText);
  alert("✅ تم النسخ");
});
copyGreenBtn.addEventListener("click",  () => copyByColorFilter(c => c === "green"));
copyRedBtn.addEventListener("click",    () => copyByColorFilter(c => c === "red"));
copyWhiteBtn.addEventListener("click",  () => copyByColorFilter(c => c === "white"));
copyBlueBtn.addEventListener("click",   () => copyByColorFilter(c => c === "blue"));
copyBlackBtn.addEventListener("click",  () => copyByColorFilter(c => c === "black"));

// ===== تفريغ النموذج =====
function clearForm() {
  document.getElementById("number").value  = "";
  typeSelect.value    = "قلاب مرسيدس";
  typeOther.value     = "";
  document.getElementById("date").value = "";
  currentKmInput.value = "";
  setCurrentKmMode("has");
  lastKmInput.value   = "";
  lastKmOther.value   = "";
  lastKmSelect.value  = "";
  lastKmInput.style.display  = "block";
  lastKmOther.style.display  = "none";
  filterSelect.value  = "تم تغييره في آخر تغيير";
  filterOther.value   = "";
}

// ===== تحميل المركبات المخزنة =====
async function loadVehicles() {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  allVehiclesData = [];
  querySnapshot.forEach(docItem => {
    allVehiclesData.push({ id: docItem.id, data: docItem.data() });
  });
  renderVehicles(currentFilter);
}

function renderVehicles(filterColor = "all") {
  currentFilter = filterColor;
  vehicleList.innerHTML = "";
  const searchVal = (storedSearch ? storedSearch.value.trim() : "").toLowerCase();

  // تحديث حالة أزرار الفلتر
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === filterColor);
  });

  let filtered = allVehiclesData.filter(v => {
    if (searchVal && !v.id.toLowerCase().includes(searchVal)) return false;
    const color = getStatusColor(v.data.type, v.data.kmSinceLastChange, v.data.lastKm, v.data.currentKmMode || "has");
    if (filterColor === "green")  return color === "green";
    if (filterColor === "red")    return color === "red";
    if (filterColor === "white")  return color === "white";
    if (filterColor === "blue")   return color === "blue";
    if (filterColor === "black")  return color === "black";
    return true;
  });

  // تجميع حسب النوع
  const grouped = {};
  filtered.forEach(v => {
    if (!grouped[v.data.type]) grouped[v.data.type] = [];
    grouped[v.data.type].push(v);
  });

  const sortedTypes = Object.keys(grouped).sort();
  sortedTypes.forEach(type => {
    grouped[type].sort((a, b) => (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0));

    const groupHeader = document.createElement("div");
    groupHeader.className = "group-header";
    groupHeader.innerHTML = `<strong>📂 ${type}</strong>`;
    vehicleList.appendChild(groupHeader);

    grouped[type].forEach(v => {
      const color = getStatusColor(v.data.type, v.data.kmSinceLastChange, v.data.lastKm, v.data.currentKmMode || "has");
      const emoji = colorToEmoji(color);
      const div = document.createElement("div");
      div.className = "vehicle-item";
      div.innerHTML = `
        <div class="item-row">
          <span><strong>رقم المعدة:</strong> ${v.id} ${emoji} &nbsp;|&nbsp; <strong>الممشى منذ آخر تغيير:</strong> ${isNoKm(v.data.lastKm) ? "-" : (v.data.kmSinceLastChange || 0)}</span>
          <div class="item-btns">
            <button class="btn-view" data-id="${v.id}">👁 عرض</button>
            <button class="btn-delete" data-id="${v.id}">🗑 حذف</button>
          </div>
        </div>
        <div class="vehicle-details" id="details-${v.id}" style="display:none;">
          <p><strong>نوع المعدة:</strong> ${v.data.type}</p>
          <p><strong>الممشى الحالي:</strong> ${v.data.currentKm}</p>
          <p><strong>ممشى آخر تغيير زيت:</strong> ${v.data.lastKm}</p>
          <p><strong>الممشى منذ آخر تغيير:</strong> ${isNoKm(v.data.lastKm) ? "-" : (v.data.kmSinceLastChange || 0)}</p>
          <p><strong>تاريخ آخر تغيير زيت:</strong> ${v.data.date}</p>
          <p><strong>حالة فلتر الزيت:</strong> ${v.data.filter}</p>
          <button class="btn-edit" data-id="${v.id}">✏️ تعديل</button>
        </div>
      `;
      vehicleList.appendChild(div);
    });
  });

  // أزرار عرض
  vehicleList.querySelectorAll(".btn-view").forEach(btn => {
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

  // أزرار حذف
  vehicleList.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!confirm(`هل تريد حذف المعدة رقم ${id}؟`)) return;
      await deleteDoc(doc(db, "vehicles", id));
      for (let type in sessionVehicles) {
        sessionVehicles[type] = sessionVehicles[type].filter(v => v.number !== id);
      }
      updateDailyList();
      loadVehicles();
      alert("🗑 تم الحذف");
    });
  });

  // أزرار تعديل
  vehicleList.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const docSnap = await getDoc(doc(db, "vehicles", id));
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      document.getElementById("number").value = id;
      typeSelect.value = ["قلاب فولفو","لوبد فولفو","وايت فولفو","قلاب مرسيدس","وايت","شيول","بوكلين","بلدوزر","بوبكات"].includes(data.type) ? data.type : "اخرى";
      typeOther.value = typeSelect.value === "اخرى" ? data.type : "";
      typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";
      filterSelect.value = ["تم تغييره في آخر تغيير","تم تغييره في التغيير قبل الأخير","لم يتم تغييره في آخر تغييرين"].includes(data.filter) ? data.filter : "اخرى";
      filterOther.value = filterSelect.value === "اخرى" ? data.filter : "";
      filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";
      document.getElementById("date").value = data.date;

      const mode = data.currentKmMode || "has";
      setCurrentKmMode(mode);
      if (mode === "has") currentKmInput.value = data.currentKm || "";

      if (isNoKm(data.lastKm)) {
        lastKmSelect.value = "no";
        lastKmInput.style.display = "none";
      } else {
        lastKmSelect.value = "";
        lastKmInput.style.display = "block";
        lastKmInput.value = data.lastKm;
      }

      // الانتقال لتاب الإضافة
      document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelector('.nav-btn[data-tab="form-tab"]').classList.add('active');
      document.getElementById('form-tab').classList.add('active');
      window.scrollTo({ top: 0, behavior: "smooth" });
      alert("✏️ تم تحميل البيانات للتعديل، عدّل ثم اضغط حفظ");
    });
  });
}

// ===== فلتر المركبات المخزنة =====
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => renderVehicles(btn.dataset.filter));
});

// ===== البحث في المخزنة =====
if (storedSearch) {
  storedSearch.addEventListener("input", () => renderVehicles(currentFilter));
}

// ===== تصدير Excel =====
document.getElementById("exportBtn").addEventListener("click", async () => {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  let dataArray = [];

  querySnapshot.forEach(docItem => {
    const d = docItem.data();
    const color = getStatusColor(d.type, d.kmSinceLastChange, d.lastKm, d.currentKmMode || "has");
    const emoji = colorToEmoji(color);
    const kmDiff = isNoKm(d.lastKm) ? "-" : (d.kmSinceLastChange || 0);
    const dateParts = (d.date || "").split("-");
    const formattedDate = dateParts.length === 3 ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}` : d.date;

    dataArray.push({
      "نوع المعدة": d.type,
      "رقم المعدة": docItem.id,
      "الحالة": emoji,
      "الممشى الحالي": d.currentKm,
      "ممشى آخر تغيير زيت": d.lastKm,
      "الممشى منذ آخر تغيير": kmDiff,
      "تاريخ آخر تغيير زيت": formattedDate,
      "حالة فلتر الزيت": d.filter
    });
  });

  // الترتيب
  const sortMode = exportSortSelect ? exportSortSelect.value : "type";
  if (sortMode === "numAsc") {
    dataArray.sort((a, b) => {
      const na = parseInt(a["رقم المعدة"]) || 0;
      const nb = parseInt(b["رقم المعدة"]) || 0;
      return na - nb;
    });
  } else if (sortMode === "numDesc") {
    dataArray.sort((a, b) => {
      const na = parseInt(a["رقم المعدة"]) || 0;
      const nb = parseInt(b["رقم المعدة"]) || 0;
      return nb - na;
    });
  } else {
    // حسب النوع ثم الممشى
    dataArray.sort((a, b) => {
      if (a["نوع المعدة"] < b["نوع المعدة"]) return -1;
      if (a["نوع المعدة"] > b["نوع المعدة"]) return 1;
      const ka = parseInt(a["الممشى منذ آخر تغيير"]) || 0;
      const kb = parseInt(b["الممشى منذ آخر تغيير"]) || 0;
      return kb - ka;
    });
  }

  // بناء الـ worksheet مع دمج خلايا حسب النوع
  const wb = XLSX.utils.book_new();
  const today = new Date();
  const todayStr = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;

  // بناء البيانات يدويًا للدمج
  const wsData = [];
  wsData.push([`المتابعة اليومية للزيوت - تاريخ: ${todayStr}`, "", "", "", "", "", "", ""]);
  wsData.push(["نوع المعدة", "رقم المعدة", "الحالة", "الممشى الحالي", "ممشى آخر تغيير", "الممشى منذ آخر تغيير", "تاريخ آخر تغيير", "حالة فلتر الزيت"]);

  const merges = [];
  // دمج خلية العنوان
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } });

  if (sortMode === "type") {
    // تجميع حسب النوع مع دمج
    const groups = {};
    dataArray.forEach(row => {
      const t = row["نوع المعدة"];
      if (!groups[t]) groups[t] = [];
      groups[t].push(row);
    });

    Object.keys(groups).sort().forEach(type => {
      const startRow = wsData.length;
      groups[type].forEach((row, i) => {
        wsData.push([
          i === 0 ? type : "",
          row["رقم المعدة"],
          row["الحالة"],
          row["الممشى الحالي"],
          row["ممشى آخر تغيير زيت"],
          row["الممشى منذ آخر تغيير"],
          row["تاريخ آخر تغيير زيت"],
          row["حالة فلتر الزيت"]
        ]);
      });
      const endRow = wsData.length - 1;
      if (groups[type].length > 1) {
        merges.push({ s: { r: startRow, c: 0 }, e: { r: endRow, c: 0 } });
      }
    });
  } else {
    dataArray.forEach(row => {
      wsData.push([
        row["نوع المعدة"],
        row["رقم المعدة"],
        row["الحالة"],
        row["الممشى الحالي"],
        row["ممشى آخر تغيير زيت"],
        row["الممشى منذ آخر تغيير"],
        row["تاريخ آخر تغيير زيت"],
        row["حالة فلتر الزيت"]
      ]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!merges"] = merges;

  // عرض الأعمدة
  ws["!cols"] = [
    { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 16 },
    { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 28 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, "المركبات");
  XLSX.writeFile(wb, "متابعة_المركبات.xlsx");
});

// ===== تحميل أولي =====
loadVehicles();
updateDailyList();
