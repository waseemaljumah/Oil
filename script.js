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

const saveBtn       = document.getElementById("saveBtn");
const searchBtn     = document.getElementById("searchBtn");
const deleteBtn     = document.getElementById("deleteBtn");
const copyBtn       = document.getElementById("copyBtn");
const copyGreenBtn  = document.getElementById("copyGreenBtn");
const copyRedBtn    = document.getElementById("copyRedBtn");
const vehicleList   = document.getElementById("vehicleList");
const outputDiv     = document.getElementById("output");

const typeSelect      = document.getElementById("typeSelect");
const typeOther       = document.getElementById("typeOther");
const filterSelect    = document.getElementById("filterSelect");
const filterOther     = document.getElementById("filterOther");
const currentKmSelect = document.getElementById("currentKmSelect");
const currentKmInput  = document.getElementById("currentKm");
const lastKmSelect    = document.getElementById("lastKmSelect");
const lastKmInput     = document.getElementById("lastKmInput");
const lastKmOther     = document.getElementById("lastKmOther");

const NO_KM_CURRENT  = "لا يوجد ممشى حالي";
const BROKEN_CURRENT = "العداد لا يعمل";
const NO_KM_LAST     = "لا يوجد عداد في آخر تغيير زيت في النظام";

// =================== إظهار / إخفاء الحقول ===================
typeSelect.addEventListener("change", () => {
  typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";
});

filterSelect.addEventListener("change", () => {
  filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";
});

currentKmSelect.addEventListener("change", () => {
  const val = currentKmSelect.value;
  currentKmInput.style.display = val === "has" ? "block" : "none";
  if (val !== "has") currentKmInput.value = "";
});

lastKmSelect.addEventListener("change", () => {
  const val = lastKmSelect.value;
  lastKmInput.style.display  = val === "has"   ? "block" : "none";
  lastKmOther.style.display  = val === "other" ? "block" : "none";
  if (val !== "has")   lastKmInput.value = "";
  if (val !== "other") lastKmOther.value = "";
});

// الحالة الابتدائية للحقول
currentKmInput.style.display = "block";
lastKmInput.style.display    = "block";
lastKmOther.style.display    = "none";

let sessionVehicles = {};
let allVehiclesData = [];

// =================== تحليل الممشى الحالي ===================
function parseCurrentKm(currentKmRaw) {
  if (currentKmRaw === NO_KM_CURRENT)  return { type: "none",   value: null };
  if (currentKmRaw === BROKEN_CURRENT) return { type: "broken", value: null };
  const n = Number(currentKmRaw);
  if (currentKmRaw !== "" && currentKmRaw !== null && currentKmRaw !== undefined && !isNaN(n))
    return { type: "value", value: n };
  return { type: "none", value: null };
}

function isNoKm(lastKm) {
  return !lastKm || lastKm === NO_KM_LAST || isNaN(Number(lastKm));
}

// =================== حساب العلامة اللونية ===================
function getStatusEmoji(type, currentKmRaw, lastKm) {
  const cur = parseCurrentKm(currentKmRaw);

  if (isNoKm(lastKm))      return "⚫";
  if (cur.type === "none")   return "⚪";
  if (cur.type === "broken") return "🔵";

  const kmDiff = cur.value - Number(lastKm);
  const volvoTypes = ["لوبد فولفو", "قلاب فولفو", "وايت فولفو", "فولفو"];
  const heavyTypes = ["قريدر", "شيول", "بوكلين", "بلدوزر", "بوبكات"];

  if (volvoTypes.includes(type))    return kmDiff >= 5500 ? "🔴" : "🟢";
  if (type === "قلاب مرسيدس")       return kmDiff >= 9500 ? "🔴" : "🟢";
  if (heavyTypes.includes(type))    return kmDiff >= 250  ? "🔴" : "🟢";
  return "🟢";
}

// =================== حفظ / تحديث ===================
saveBtn.addEventListener("click", async () => {
  const number = document.getElementById("number").value.trim();
  if (!number) { alert("ادخل رقم المعدة"); return; }

  const typeVal   = typeSelect.value === "اخرى" ? typeOther.value : typeSelect.value;
  const filterVal = filterSelect.value === "اخرى" ? filterOther.value : filterSelect.value;
  const dateVal   = document.getElementById("date").value;

  // الممشى الحالي
  let currentKmStored;
  const curSel = currentKmSelect.value;
  if (curSel === "none")        currentKmStored = NO_KM_CURRENT;
  else if (curSel === "broken") currentKmStored = BROKEN_CURRENT;
  else                          currentKmStored = Number(currentKmInput.value) || 0;

  // ممشى آخر تغيير زيت
  let lastKmStored;
  const lkSel = lastKmSelect.value;
  if (lkSel === "no")          lastKmStored = NO_KM_LAST;
  else if (lkSel === "other")  lastKmStored = lastKmOther.value || NO_KM_LAST;
  else                         lastKmStored = Number(lastKmInput.value) || 0;

  const cur = parseCurrentKm(currentKmStored);
  const kmDiff = (!isNoKm(lastKmStored) && cur.type === "value")
    ? cur.value - Number(lastKmStored)
    : 0;

  const data = {
    type: typeVal,
    date: dateVal,
    currentKm: currentKmStored,
    lastKm: lastKmStored,
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

    const knownTypes = ["قلاب فولفو","لوبد فولفو","وايت فولفو","قلاب مرسيدس","وايت","شيول","بوكلين","بلدوزر","بوبكات"];
    typeSelect.value = knownTypes.includes(data.type) ? data.type : "اخرى";
    typeOther.value  = typeSelect.value === "اخرى" ? data.type : "";
    typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";

    const knownFilters = ["تم تغييره في آخر تغيير","تم تغييره في التغيير قبل الأخير","لم يتم تغييره في آخر تغييرين"];
    filterSelect.value = knownFilters.includes(data.filter) ? data.filter : "اخرى";
    filterOther.value  = filterSelect.value === "اخرى" ? data.filter : "";
    filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";

    document.getElementById("date").value = data.date;

    if (data.currentKm === NO_KM_CURRENT) {
      currentKmSelect.value        = "none";
      currentKmInput.style.display = "none";
    } else if (data.currentKm === BROKEN_CURRENT) {
      currentKmSelect.value        = "broken";
      currentKmInput.style.display = "none";
    } else {
      currentKmSelect.value        = "has";
      currentKmInput.style.display = "block";
      currentKmInput.value         = data.currentKm;
    }

    if (data.lastKm === NO_KM_LAST) {
      lastKmSelect.value        = "no";
      lastKmInput.style.display = "none";
      lastKmOther.style.display = "none";
    } else if (!isNaN(Number(data.lastKm)) && data.lastKm !== "") {
      lastKmSelect.value        = "has";
      lastKmInput.style.display = "block";
      lastKmOther.style.display = "none";
      lastKmInput.value         = data.lastKm;
    } else {
      lastKmSelect.value        = "other";
      lastKmInput.style.display = "none";
      lastKmOther.style.display = "block";
      lastKmOther.value         = data.lastKm;
    }

    alert("📦 تم تحميل البيانات");
  } else {
    alert("❌ المركبة غير موجودة");
  }
});

// =================== حذف ===================
deleteBtn.addEventListener("click", async () => {
  const number = document.getElementById("searchNumber").value.trim();
  if (!number) { alert("ادخل رقم المعدة للحذف"); return; }
  await deleteDoc(doc(db, "vehicles", number));
  for (let type in sessionVehicles) {
    sessionVehicles[type] = sessionVehicles[type].filter(v => v.number !== number);
  }
  updateOutput();
  loadVehicles();
  alert("🗑 تم الحذف");
});

// =================== تحميل المركبات ===================
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
    <button class="filter-btn ${filterColor==='all'   ?'active':''}" data-filter="all">📋 الكل</button>
    <button class="filter-btn ${filterColor==='green' ?'active':''}" data-filter="green">🟢 الأخضر</button>
    <button class="filter-btn ${filterColor==='red'   ?'active':''}" data-filter="red">🔴 الأحمر</button>
    <button class="filter-btn ${filterColor==='white' ?'active':''}" data-filter="white">⚪ لا يوجد ممشى</button>
    <button class="filter-btn ${filterColor==='blue'  ?'active':''}" data-filter="blue">🔵 العداد لا يعمل</button>
    <button class="filter-btn ${filterColor==='black' ?'active':''}" data-filter="black">⚫ بدون عداد سابق</button>
    <button class="copy-filtered-btn" id="copyFilteredBtn">📋 نسخ المعروض</button>
  `;
  vehicleList.appendChild(filterBar);

  filterBar.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => { renderVehicles(btn.dataset.filter); });
  });

  const emojiMap = { green:"🟢", red:"🔴", white:"⚪", blue:"🔵", black:"⚫" };

  const filtered = allVehiclesData.filter(v => {
    if (filterColor === "all") return true;
    return getStatusEmoji(v.data.type, v.data.currentKm, v.data.lastKm) === emojiMap[filterColor];
  });

  const grouped = {};
  filtered.forEach(v => {
    if (!grouped[v.data.type]) grouped[v.data.type] = [];
    grouped[v.data.type].push(v);
  });

  const sortedTypes = Object.keys(grouped).sort();

  sortedTypes.forEach(type => {
    grouped[type].sort((a, b) => (b.data.kmSinceLastChange||0) - (a.data.kmSinceLastChange||0));

    const groupHeader = document.createElement("div");
    groupHeader.className = "group-header";
    groupHeader.innerHTML = `<strong>📂 ${type}</strong>`;
    vehicleList.appendChild(groupHeader);

    grouped[type].forEach(v => {
      const emoji = getStatusEmoji(v.data.type, v.data.currentKm, v.data.lastKm);
      const kmDisplay = (v.data.currentKm === NO_KM_CURRENT || v.data.currentKm === BROKEN_CURRENT || isNoKm(v.data.lastKm))
        ? "-" : (v.data.kmSinceLastChange || 0);

      const div = document.createElement("div");
      div.className = "vehicle-item";
      div.innerHTML = `
        <div class="item-row">
          <span><strong>رقم المعدة:</strong> ${v.id} ${emoji} &nbsp;|&nbsp; <strong>الممشى منذ آخر تغيير:</strong> ${kmDisplay}</span>
          <div class="item-btns">
            <button class="btn-view" data-id="${v.id}">👁 عرض</button>
            <button class="btn-delete" data-id="${v.id}">🗑 حذف</button>
          </div>
        </div>
        <div class="vehicle-details" id="details-${v.id}" style="display:none;">
          <p><strong>نوع المعدة:</strong> ${v.data.type}</p>
          <p><strong>الممشى الحالي:</strong> ${v.data.currentKm}</p>
          <p><strong>ممشى آخر تغيير زيت:</strong> ${v.data.lastKm}</p>
          <p><strong>الممشى منذ آخر تغيير:</strong> ${kmDisplay}</p>
          <p><strong>تاريخ آخر تغيير زيت:</strong> ${v.data.date}</p>
          <p><strong>حالة فلتر الزيت:</strong> ${v.data.filter}</p>
          <button class="btn-edit" data-id="${v.id}">✏️ تعديل</button>
        </div>
      `;
      vehicleList.appendChild(div);
    });
  });

  document.getElementById("copyFilteredBtn").addEventListener("click", () => {
    const text = buildReportText(sortedTypes, grouped);
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
      if (!isVisible) { details.style.display = "block"; btn.textContent = "🔼 إخفاء"; }
    });
  });

  document.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!confirm(`هل تريد حذف المعدة رقم ${id}؟`)) return;
      await deleteDoc(doc(db, "vehicles", id));
      for (let type in sessionVehicles) {
        sessionVehicles[type] = sessionVehicles[type].filter(v => v.number !== id);
      }
      updateOutput();
      loadVehicles();
      alert("🗑 تم الحذف");
    });
  });

  document.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const docSnap = await getDoc(doc(db, "vehicles", id));
      if (!docSnap.exists()) return;
      const data = docSnap.data();

      document.getElementById("number").value = id;

      const knownTypes = ["قلاب فولفو","لوبد فولفو","وايت فولفو","قلاب مرسيدس","وايت","شيول","بوكلين","بلدوزر","بوبكات"];
      typeSelect.value = knownTypes.includes(data.type) ? data.type : "اخرى";
      typeOther.value  = typeSelect.value === "اخرى" ? data.type : "";
      typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";

      const knownFilters = ["تم تغييره في آخر تغيير","تم تغييره في التغيير قبل الأخير","لم يتم تغييره في آخر تغييرين"];
      filterSelect.value = knownFilters.includes(data.filter) ? data.filter : "اخرى";
      filterOther.value  = filterSelect.value === "اخرى" ? data.filter : "";
      filterOther.style.display = filterSelect.value === "اخرى" ? "block" : "none";

      document.getElementById("date").value = data.date;

      if (data.currentKm === NO_KM_CURRENT) {
        currentKmSelect.value        = "none";
        currentKmInput.style.display = "none";
      } else if (data.currentKm === BROKEN_CURRENT) {
        currentKmSelect.value        = "broken";
        currentKmInput.style.display = "none";
      } else {
        currentKmSelect.value        = "has";
        currentKmInput.style.display = "block";
        currentKmInput.value         = data.currentKm;
      }

      if (data.lastKm === NO_KM_LAST) {
        lastKmSelect.value        = "no";
        lastKmInput.style.display = "none";
        lastKmOther.style.display = "none";
      } else if (!isNaN(Number(data.lastKm)) && data.lastKm !== "") {
        lastKmSelect.value        = "has";
        lastKmInput.style.display = "block";
        lastKmOther.style.display = "none";
        lastKmInput.value         = data.lastKm;
      } else {
        lastKmSelect.value        = "other";
        lastKmInput.style.display = "none";
        lastKmOther.style.display = "block";
        lastKmOther.value         = data.lastKm;
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
      alert("✏️ تم تحميل البيانات للتعديل، عدّل ثم اضغط حفظ/تحديث");
    });
  });
}

// =================== بناء نص التقرير ===================
function buildReportText(sortedTypes, grouped) {
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;
  sortedTypes.forEach(type => {
    grouped[type].forEach(v => {
      const dp = v.data.date ? v.data.date.split("-") : [];
      const fd = dp.length === 3 ? `${dp[0]}/${dp[1]}/${dp[2]}` : v.data.date;
      const emoji = getStatusEmoji(type, v.data.currentKm, v.data.lastKm);
      const kmDisplay = (v.data.currentKm === NO_KM_CURRENT || v.data.currentKm === BROKEN_CURRENT || isNoKm(v.data.lastKm))
        ? "-" : (v.data.kmSinceLastChange || 0);
      text += `نوع المعدة: ${type}\nرقم المعدة: ${v.id} ${emoji}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${v.data.lastKm}\nالممشى منذ آخر تغيير: ${kmDisplay}\nتاريخ آخر تغيير زيت: ${fd}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------\n`;
    });
  });
  return text;
}

// =================== تحديث المتابعة اليومية ===================
function updateOutput() {
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;
  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    sessionVehicles[type].sort((a,b) => (b.data.kmSinceLastChange||0) - (a.data.kmSinceLastChange||0));
    sessionVehicles[type].forEach(v => {
      const dp = v.data.date ? v.data.date.split("-") : [];
      const fd = dp.length === 3 ? `${dp[0]}/${dp[1]}/${dp[2]}` : v.data.date;
      const emoji = getStatusEmoji(type, v.data.currentKm, v.data.lastKm);
      const kmDisplay = (v.data.currentKm === NO_KM_CURRENT || v.data.currentKm === BROKEN_CURRENT || isNoKm(v.data.lastKm))
        ? "-" : (v.data.kmSinceLastChange || 0);
      text += `نوع المعدة: ${type}\nرقم المعدة: ${v.number} ${emoji}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${v.data.lastKm}\nالممشى منذ آخر تغيير: ${kmDisplay}\nتاريخ آخر تغيير زيت: ${fd}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------\n`;
    });
  });
  outputDiv.innerText = text.trim();
}

// =================== نسخ حسب اللون ===================
function copyByColor(filterFn) {
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;
  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    const filtered = sessionVehicles[type].filter(v => filterFn(getStatusEmoji(type, v.data.currentKm, v.data.lastKm)));
    filtered.sort((a,b) => (b.data.kmSinceLastChange||0) - (a.data.kmSinceLastChange||0));
    filtered.forEach(v => {
      const dp = v.data.date ? v.data.date.split("-") : [];
      const fd = dp.length === 3 ? `${dp[0]}/${dp[1]}/${dp[2]}` : v.data.date;
      const emoji = getStatusEmoji(type, v.data.currentKm, v.data.lastKm);
      const kmDisplay = (v.data.currentKm === NO_KM_CURRENT || v.data.currentKm === BROKEN_CURRENT || isNoKm(v.data.lastKm))
        ? "-" : (v.data.kmSinceLastChange || 0);
      text += `نوع المعدة: ${type}\nرقم المعدة: ${v.number} ${emoji}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${v.data.lastKm}\nالممشى منذ آخر تغيير: ${kmDisplay}\nتاريخ آخر تغيير زيت: ${fd}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------\n`;
    });
  });
  navigator.clipboard.writeText(text.trim());
  alert("تم النسخ");
}

copyBtn.addEventListener("click", () => { navigator.clipboard.writeText(outputDiv.innerText); alert("تم النسخ"); });
copyGreenBtn.addEventListener("click", () => { copyByColor(e => e === "🟢"); });
copyRedBtn.addEventListener("click",   () => { copyByColor(e => e === "🔴"); });

// =================== تفريغ النموذج ===================
function clearForm() {
  document.getElementById("number").value  = "";
  typeSelect.value   = "قلاب مرسيدس";
  typeOther.value    = "";
  typeOther.style.display = "none";
  document.getElementById("date").value    = "";
  currentKmSelect.value        = "has";
  currentKmInput.value         = "";
  currentKmInput.style.display = "block";
  lastKmSelect.value        = "has";
  lastKmInput.value         = "";
  lastKmInput.style.display = "block";
  lastKmOther.value         = "";
  lastKmOther.style.display = "none";
  filterSelect.value = "تم تغييره في آخر تغيير";
  filterOther.value  = "";
  filterOther.style.display = "none";
}

// =================== تصدير Excel ===================
document.getElementById("exportBtn").addEventListener("click", async () => {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  let dataArray = [];
  querySnapshot.forEach(docItem => {
    const d = docItem.data();
    const cur = parseCurrentKm(d.currentKm);
    const kmDiff = (!isNoKm(d.lastKm) && cur.type === "value") ? cur.value - Number(d.lastKm) : "-";
    const dp = d.date ? d.date.split("-") : [];
    const fd = dp.length === 3 ? `${dp[0]}/${dp[1]}/${dp[2]}` : d.date;
    const emoji = getStatusEmoji(d.type, d.currentKm, d.lastKm);
    dataArray.push({
      "نوع المعدة": d.type,
      "رقم المعدة": docItem.id + " " + emoji,
      "الممشى الحالي": d.currentKm,
      "ممشى آخر تغيير زيت": d.lastKm,
      "الممشى منذ آخر تغيير": kmDiff,
      "تاريخ آخر تغيير زيت": fd,
      "حالة فلتر الزيت": d.filter
    });
  });
  dataArray.sort((a,b) => a["نوع المعدة"] < b["نوع المعدة"] ? -1 : a["نوع المعدة"] > b["نوع المعدة"] ? 1 : 0);
  const worksheet = XLSX.utils.json_to_sheet(dataArray, { origin: 1 });
  const today = new Date();
  const yyyy = today.getFullYear(), mm = String(today.getMonth()+1).padStart(2,"0"), dd = String(today.getDate()).padStart(2,"0");
  XLSX.utils.sheet_add_aoa(worksheet, [[`المتابعة اليومية للزيوت / تاريخ: ${yyyy}/${mm}/${dd}`]], { origin: 0 });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "المركبات");
  XLSX.writeFile(workbook, "متابعة_المركبات.xlsx");
});

loadVehicles();