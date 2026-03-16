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
const saveSilentBtn = document.getElementById("saveSilentBtn");
const searchBtn     = document.getElementById("searchBtn");
const deleteBtn     = document.getElementById("deleteBtn");
const copyBtn       = document.getElementById("copyBtn");
const copyGreenBtn  = document.getElementById("copyGreenBtn");
const copyRedBtn    = document.getElementById("copyRedBtn");
const copyWhiteBtn  = document.getElementById("copyWhiteBtn");
const copyBlueBtn   = document.getElementById("copyBlueBtn");
const copyBlackBtn  = document.getElementById("copyBlackBtn");
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

  if (cur.type === "broken") return "🔵";
  if (cur.type === "none")   return "⚪";
  if (isNoKm(lastKm))        return "⚫";

  const kmDiff = cur.value - Number(lastKm);
  const volvoTypes = ["لوبد فولفو", "قلاب فولفو", "وايت فولفو", "فولفو"];
  const heavyTypes = ["قريدر", "شيول", "بوكلين", "بلدوزر", "بوبكات", "مدحلة"];

  if (volvoTypes.includes(type))    return kmDiff >= 5500 ? "🔴" : "🟢";
  if (type === "قلاب مرسيدس")       return kmDiff >= 9500 ? "🔴" : "🟢";
  if (type === "دينا")               return kmDiff >= 4500 ? "🔴" : "🟢";
  if (heavyTypes.includes(type))    return kmDiff >= 250  ? "🔴" : "🟢";
  return "🟢";
}

// =================== دالة الحفظ المشتركة ===================
async function saveVehicle(addToSession) {
  const number = document.getElementById("number").value.trim();
  if (!number) { alert("ادخل رقم المعدة"); return; }

  const typeVal   = typeSelect.value === "اخرى" ? typeOther.value : typeSelect.value;
  const filterVal = filterSelect.value === "اخرى" ? filterOther.value : filterSelect.value;
  const dateVal   = document.getElementById("date").value;

  let currentKmStored;
  const curSel = currentKmSelect.value;
  if (curSel === "none")        currentKmStored = NO_KM_CURRENT;
  else if (curSel === "broken") currentKmStored = BROKEN_CURRENT;
  else                          currentKmStored = Number(currentKmInput.value) || 0;

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

  if (addToSession) {
    if (!sessionVehicles[typeVal]) sessionVehicles[typeVal] = [];
    sessionVehicles[typeVal] = sessionVehicles[typeVal].filter(v => v.number !== number);
    sessionVehicles[typeVal].push({ number, data, kmDiff });
    updateOutput();
    alert("✅ تم الحفظ والإضافة للمتابعة اليومية");
  } else {
    alert("✅ تم الحفظ / التحديث");
  }

  clearForm();
  loadVehicles();
}

// =================== حفظ + إضافة للمتابعة ===================
saveBtn.addEventListener("click", () => saveVehicle(true));

// =================== حفظ فقط ===================
saveSilentBtn.addEventListener("click", () => saveVehicle(false));

// =================== البحث ===================
searchBtn.addEventListener("click", async () => {
  const number = document.getElementById("number").value.trim();
  if (!number) { alert("ادخل رقم المعدة للبحث"); return; }

  const docSnap = await getDoc(doc(db, "vehicles", number));
  if (docSnap.exists()) {
    const data = docSnap.data();
    document.getElementById("number").value = number;

    const knownTypes = ["قلاب فولفو","لوبد فولفو","وايت فولفو","قلاب مرسيدس","وايت","دينا","شيول","بوكلين","بلدوزر","بوبكات"];
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
  const number = document.getElementById("number").value.trim();
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
  renderVehicles(null, "");
}

// الألوان المفلترة في المركبات المخزنة (Set مشترك)
let storedFilterEmojis = new Set(["🟢","🔴","⚪","🔵","⚫"]);

function renderVehicles(filterColors = null, searchTerm = "") {
  if (filterColors !== null) storedFilterEmojis = filterColors instanceof Set ? filterColors : new Set(filterColors);
  vehicleList.innerHTML = "";

  // شريط التصفية - checkboxes
  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar-checks";
  filterBar.innerHTML = `
    <div class="stored-filter-checks">
      <label class="all-check-label"><input type="checkbox" id="filterAll" ${storedFilterEmojis.size===5?'checked':''}/> 📋 الكل</label>
      <label><input type="checkbox" value="🟢" ${storedFilterEmojis.has("🟢")?'checked':''}/> 🟢</label>
      <label><input type="checkbox" value="🔴" ${storedFilterEmojis.has("🔴")?'checked':''}/> 🔴</label>
      <label><input type="checkbox" value="⚪" ${storedFilterEmojis.has("⚪")?'checked':''}/> ⚪</label>
      <label><input type="checkbox" value="🔵" ${storedFilterEmojis.has("🔵")?'checked':''}/> 🔵</label>
      <label><input type="checkbox" value="⚫" ${storedFilterEmojis.has("⚫")?'checked':''}/> ⚫</label>
    </div>
    <button class="copy-filtered-btn" id="copyFilteredBtn">📋 نسخ المعروض</button>
  `;
  vehicleList.appendChild(filterBar);

  // منطق checkbox الكل
  filterBar.querySelector("#filterAll").addEventListener("change", (e) => {
    const all = e.target.checked;
    filterBar.querySelectorAll(".stored-filter-checks input[value]").forEach(cb => cb.checked = all);
    const term = document.getElementById("storedSearchInput")?.value.trim() || "";
    storedFilterEmojis = all ? new Set(["🟢","🔴","⚪","🔵","⚫"]) : new Set();
    renderVehicles(storedFilterEmojis, term);
  });

  filterBar.querySelectorAll(".stored-filter-checks input[value]").forEach(cb => {
    cb.addEventListener("change", () => {
      const checked = new Set([...filterBar.querySelectorAll(".stored-filter-checks input[value]:checked")].map(c=>c.value));
      const term = document.getElementById("storedSearchInput")?.value.trim() || "";
      renderVehicles(checked, term);
    });
  });

  const filtered = allVehiclesData.filter(v => {
    const emoji = getStatusEmoji(v.data.type, v.data.currentKm, v.data.lastKm);
    const colorOk = storedFilterEmojis.size === 0 || storedFilterEmojis.has(emoji);
    const searchOk = !searchTerm || v.id.includes(searchTerm);
    return colorOk && searchOk;
  });

  const grouped = {};
  filtered.forEach(v => {
    if (!grouped[v.data.type]) grouped[v.data.type] = [];
    grouped[v.data.type].push(v);
  });

  const sortedTypes = Object.keys(grouped).sort();

  sortedTypes.forEach(type => {
    grouped[type].sort((a, b) => (b.data.kmSinceLastChange||0) - (a.data.kmSinceLastChange||0));

    // عداد الألوان في المجموعة
    const counts = { "🟢":0, "🔴":0, "🔵":0, "⚪":0, "⚫":0 };
    grouped[type].forEach(v => { const e = getStatusEmoji(v.data.type, v.data.currentKm, v.data.lastKm); if (counts[e] !== undefined) counts[e]++; });
    const summary = Object.entries(counts).filter(([,n])=>n>0).map(([e,n])=>`${e}${n}`).join(" ");

    const groupHeader = document.createElement("div");
    groupHeader.className = "group-header group-accordion";
    groupHeader.innerHTML = `
      <div class="group-header-row">
        <strong>📂 ${type}</strong>
        <span class="group-summary">${summary}</span>
        <span class="group-arrow">▼</span>
      </div>
    `;
    vehicleList.appendChild(groupHeader);

    // حاوية المركبات — مخفية افتراضياً
    const groupBody = document.createElement("div");
    groupBody.className = "group-body";
    groupBody.style.display = "none";

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
      groupBody.appendChild(div);
    });

    vehicleList.appendChild(groupBody);

    // toggle عند الضغط على العنوان
    groupHeader.addEventListener("click", () => {
      const isOpen = groupBody.style.display !== "none";
      groupBody.style.display = isOpen ? "none" : "block";
      groupHeader.querySelector(".group-arrow").textContent = isOpen ? "▼" : "▲";
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

      const knownTypes = ["قلاب فولفو","لوبد فولفو","وايت فولفو","قلاب مرسيدس","وايت","دينا","شيول","بوكلين","بلدوزر","بوبكات"];
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


// =================== نسخ حسب اللون (متعدد الاختيار) ===================
function copyByColors(selectedEmojis) {
  const emojiSet = new Set(selectedEmojis);
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;
  const sortedTypes = Object.keys(sessionVehicles).sort();
  sortedTypes.forEach(type => {
    const filtered = sessionVehicles[type].filter(v => emojiSet.has(getStatusEmoji(type, v.data.currentKm, v.data.lastKm)));
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

// =================== dropdown النسخ ===================
document.getElementById("copyFilterToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("copyDropdownMenu").classList.toggle("open");
});

document.getElementById("copySelectedColorsBtn").addEventListener("click", () => {
  const checked = [...document.querySelectorAll("#copyDropdownMenu .color-checkboxes input:checked")].map(cb => cb.value);
  if (!checked.length) { alert("اختر لون واحد على الأقل"); return; }
  copyByColors(checked);
  document.getElementById("copyDropdownMenu").classList.remove("open");
});

// =================== بحث المركبات المخزنة ===================
document.getElementById("storedSearchInput").addEventListener("input", () => {
  const term = document.getElementById("storedSearchInput").value.trim();
  renderVehicles(null, term);
});

document.getElementById("storedSearchClearBtn").addEventListener("click", () => {
  document.getElementById("storedSearchInput").value = "";
  renderVehicles(null, "");
});

// =================== فتح/إغلاق قسم المركبات المخزنة ===================
document.getElementById("vehicleListToggle").addEventListener("click", () => {
  const content = document.getElementById("vehicleListContent");
  const arrow   = document.getElementById("vehicleListArrow");
  const isOpen  = content.style.display !== "none";
  content.style.display = isOpen ? "none" : "block";
  arrow.textContent = isOpen ? "▼" : "▲";
});

// إغلاق القوائم عند النقر خارجها
document.addEventListener("click", () => {
  document.getElementById("copyDropdownMenu")?.classList.remove("open");
  document.getElementById("filterDropdownMenu")?.classList.remove("open");
});

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
  const sortMode = document.getElementById("exportSortSelect").value;
  const colorOrder = { "🔴": 0, "🟢": 1, "🔵": 2, "⚪": 3, "⚫": 4 };

  // الألوان المحددة للتصدير
  const exportColors = new Set(
    [...document.querySelectorAll(".export-color-checkboxes input:checked")].map(cb => cb.value)
  );
  if (!exportColors.size) { alert("اختر لون واحد على الأقل للتصدير"); return; }

  let dataArray = [];
  querySnapshot.forEach(docItem => {
    const d = docItem.data();
    const cur = parseCurrentKm(d.currentKm);
    const kmDiff = (!isNoKm(d.lastKm) && cur.type === "value") ? cur.value - Number(d.lastKm) : "-";
    const dp = d.date ? d.date.split("-") : [];
    const fd = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : (d.date || "");
    const emoji = getStatusEmoji(d.type, d.currentKm, d.lastKm);
    if (exportColors.has(emoji)) {
      dataArray.push({ type: d.type, id: docItem.id, currentKm: d.currentKm, lastKm: d.lastKm, kmDiff, date: fd, filter: d.filter, emoji });
    }
  });

  if (!dataArray.length) { alert("لا توجد مركبات بالألوان المحددة"); return; }

  if (sortMode === "type") {
    dataArray.sort((a, b) => a.type.localeCompare(b.type, "ar") || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  } else if (sortMode === "numAsc") {
    dataArray.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  } else if (sortMode === "numDesc") {
    dataArray.sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
  } else if (sortMode === "color") {
    dataArray.sort((a, b) => (colorOrder[a.emoji] ?? 9) - (colorOrder[b.emoji] ?? 9) || a.type.localeCompare(b.type, "ar"));
  }

  const today   = new Date();
  const yyyy    = today.getFullYear();
  const mm      = String(today.getMonth() + 1).padStart(2, "0");
  const dd      = String(today.getDate()).padStart(2, "0");
  const dateStr = `${dd}/${mm}/${yyyy}`;

  const headers   = ["#", "نوع المعدة", "رقم المعدة", "الممشى الحالي", "ممشى آخر تغيير زيت", "الممشى منذ آخر تغيير", "تاريخ آخر تغيير زيت", "حالة فلتر الزيت", "الحالة"];
  const numCols   = headers.length;
  const STATUS_CI = numCols - 1;
  const statusColor = { "🔴": "E74C3C", "🟢": "27AE60", "🔵": "2980B9", "⚪": "D0D3D4", "⚫": "616A6B" };

  const aoa = [];
  aoa.push([`متابعة زيوت المركبات — تاريخ: ${dateStr}`, ...Array(numCols - 1).fill("")]);
  aoa.push(Array(numCols).fill(""));
  aoa.push(headers);
  dataArray.forEach((v, i) => {
    aoa.push([i + 1, v.type, v.id, v.currentKm, v.lastKm, v.kmDiff, v.date, v.filter, ""]); // خلية الحالة فارغة
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  
  // حساب عرض الأعمدة بدقة - على أساس أطول نص في كل عمود
  const colWidths = [];
  for (let ci = 0; ci < numCols; ci++) {
    let maxLen = 0;
    for (let ri = 0; ri < aoa.length; ri++) {
      if (aoa[ri][ci]) {
        const cellLen = String(aoa[ri][ci]).length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
    }
    // نضيف 2 فقط للمسافة البسيطة حول النص
    colWidths.push({ wch: maxLen + 2 });
  }
  ws["!cols"] = colWidths;
  
  ws["!merges"] = [{ s:{ r:0, c:0 }, e:{ r:0, c:numCols-1 } }];
  ws["!rows"]   = [{ hpt:30 }, { hpt:6 }, { hpt:24 }];

  // الحدود
  const borderStyle = {
    top:    { style:"thin", color:{ rgb:"95A5A6" } },
    bottom: { style:"thin", color:{ rgb:"95A5A6" } },
    left:   { style:"thin", color:{ rgb:"95A5A6" } },
    right:  { style:"thin", color:{ rgb:"95A5A6" } }
  };

  // تنسيق الصف الأول (العنوان الرئيسي) - رصاصي فاتح + بولد + محاذاة وسط
  const titleCell = XLSX.utils.encode_cell({ r:0, c:0 });
  if (ws[titleCell]) {
    ws[titleCell].s = {
      font: { bold: true, sz: 14, color: { rgb: "000000" } },
      fill: { fgColor: { rgb: "D0D3D4" } },
      alignment: { horizontal: "center", vertical: "center" }
    };
  }

  // تنسيق الصف الثالث (العناوين) - رصاصي فاتح + بولد + محاذاة وسط
  for (let ci = 0; ci < numCols; ci++) {
    const headerCell = XLSX.utils.encode_cell({ r: 2, c: ci });
    if (ws[headerCell]) {
      ws[headerCell].s = {
        font: { bold: true, sz: 11, color: { rgb: "000000" } },
        fill: { fgColor: { rgb: "D0D3D4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: borderStyle
      };
    }
  }

  // تنسيق صفوف البيانات - كل النصوص في المنتصف
  for (let ri = 0; ri < dataArray.length; ri++) {
    const rowIdx = ri + 3;
    const v = dataArray[ri];
    
    for (let ci = 0; ci < numCols; ci++) {
      const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
      
      if (ci === STATUS_CI) {
        // عمود الحالة - خلية ملونة فارغة
        if (!ws[cellAddr]) ws[cellAddr] = { t: "s", v: "" };
        ws[cellAddr].v = ""; // نص فارغ
        ws[cellAddr].s = {
          fill: { fgColor: { rgb: statusColor[v.emoji] || "FFFFFF" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderStyle
        };
      } else {
        // باقي الأعمدة - نصوص عادية في المنتصف
        if (ws[cellAddr]) {
          ws[cellAddr].s = {
            alignment: { horizontal: "center", vertical: "center" },
            border: borderStyle,
            font: { sz: 11, color: { rgb: "000000" } }
          };
        }
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "المركبات");
  XLSX.writeFile(wb, `متابعة_المركبات_${dd}-${mm}-${yyyy}.xlsx`);
});

// =================== عرض جدول ويب تفاعلي ===================
document.getElementById("viewTableBtn").addEventListener("click", async () => {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  const sortMode = document.getElementById("exportSortSelect").value;
  const colorOrder = { "🔴": 0, "🟢": 1, "🔵": 2, "⚪": 3, "⚫": 4 };

  const exportColors = new Set(
    [...document.querySelectorAll(".export-color-checkboxes input:checked")].map(cb => cb.value)
  );
  if (!exportColors.size) { alert("اختر لون واحد على الأقل"); return; }

  let dataArray = [];
  querySnapshot.forEach(docItem => {
    const d = docItem.data();
    const cur = parseCurrentKm(d.currentKm);
    const kmDiff = (!isNoKm(d.lastKm) && cur.type === "value") ? cur.value - Number(d.lastKm) : "-";
    const dp = d.date ? d.date.split("-") : [];
    const fd = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : (d.date || "");
    const emoji = getStatusEmoji(d.type, d.currentKm, d.lastKm);
    if (exportColors.has(emoji)) {
      dataArray.push({ type: d.type, id: docItem.id, currentKm: d.currentKm, lastKm: d.lastKm, kmDiff, date: fd, filter: d.filter, emoji });
    }
  });

  if (!dataArray.length) { alert("لا توجد مركبات بالألوان المحددة"); return; }

  if (sortMode === "type") {
    dataArray.sort((a, b) => a.type.localeCompare(b.type, "ar") || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  } else if (sortMode === "numAsc") {
    dataArray.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  } else if (sortMode === "numDesc") {
    dataArray.sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
  } else if (sortMode === "color") {
    dataArray.sort((a, b) => (colorOrder[a.emoji] ?? 9) - (colorOrder[b.emoji] ?? 9) || a.type.localeCompare(b.type, "ar"));
  }

  showWebTable(dataArray);
});

function showWebTable(dataArray) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${dd}/${mm}/${yyyy}`;

  const statusColor = { "🔴": "#E74C3C", "🟢": "#27AE60", "🔵": "#2980B9", "⚪": "#D0D3D4", "⚫": "#616A6B" };

  let modalHTML = `
    <div id="tableModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;">
      <div style="background:white; border-radius:12px; width:95%; max-width:1400px; max-height:90vh; overflow:auto; padding:30px; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <h2 style="margin:0; color:#000; font-size:22px; font-weight:bold;">متابعة زيوت المركبات — ${dateStr}</h2>
          <button onclick="document.getElementById('tableModal').remove()" style="background:#e74c3c; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:16px; font-weight:bold;">✕ إغلاق</button>
        </div>
        <div style="margin-bottom:15px;">
          <input type="text" id="tableSearchInput" placeholder="🔍 ابحث في الجدول..." style="width:100%; padding:10px; border:2px solid #ddd; border-radius:6px; font-size:14px; color:#000;" />
        </div>
        <div style="overflow-x:auto;">
          <table id="dataTable" style="width:100%; border-collapse:collapse; font-size:14px; color:#000;">
            <thead>
              <tr style="background:#D0D3D4; font-weight:bold; color:#000;">
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">#</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; cursor:pointer; color:#000;" onclick="sortTable(1)">نوع المعدة ⇅</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; cursor:pointer; color:#000;" onclick="sortTable(2)">رقم المعدة ⇅</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">الممشى الحالي</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">ممشى آخر تغيير زيت</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">الممشى منذ آخر تغيير</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">تاريخ آخر تغيير زيت</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">حالة فلتر الزيت</th>
                <th style="padding:12px; text-align:center; border:1px solid #95A5A6; color:#000;">الحالة</th>
              </tr>
            </thead>
            <tbody>
  `;

  dataArray.forEach((v, i) => {
    const bgColor = statusColor[v.emoji] || "#FFFFFF";
    modalHTML += `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${i + 1}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.type}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.id}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.currentKm}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.lastKm}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.kmDiff}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.date}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; color:#000000; font-weight:600; font-size:14px;">${v.filter}</td>
        <td style="padding:10px; text-align:center; border:1px solid #BDC3C7; background:${bgColor};"></td>
      </tr>
    `;
  });

  modalHTML += `
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // البحث في الجدول
  document.getElementById('tableSearchInput').addEventListener('input', function() {
    const searchTerm = this.value.toLowerCase();
    const rows = document.querySelectorAll('#dataTable tbody tr');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
  });
}

// ترتيب الجدول
window.sortTable = function(columnIndex) {
  const table = document.getElementById('dataTable');
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  const isAscending = table.dataset.sortDir !== 'asc';
  table.dataset.sortDir = isAscending ? 'asc' : 'desc';
  
  rows.sort((a, b) => {
    const aText = a.cells[columnIndex].textContent.trim();
    const bText = b.cells[columnIndex].textContent.trim();
    
    const aNum = parseFloat(aText);
    const bNum = parseFloat(bText);
    
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return isAscending ? aNum - bNum : bNum - aNum;
    }
    
    return isAscending ? aText.localeCompare(bText, 'ar') : bText.localeCompare(aText, 'ar');
  });
  
  rows.forEach(row => tbody.appendChild(row));
  
  // إعادة ترقيم الصفوف
  rows.forEach((row, i) => {
    row.cells[0].textContent = i + 1;
    row.style.background = i % 2 === 0 ? '#ffffff' : '#f8f9fa';
  });
};

loadVehicles();