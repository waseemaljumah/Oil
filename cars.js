import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc,
  collection, getDocs, addDoc, query, orderBy, deleteField, updateDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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

const WARN_KM = 500;

// =================== مساعدات ===================
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const p = dateStr.split("-");
  return p.length === 3 ? `${p[0]}/${p[1]}/${p[2]}` : dateStr;
}

function getRemaining(car, lastRecord) {
  if (!lastRecord || !car.oilInterval) return null;
  const kmAtChange = Number(lastRecord.km) || 0;
  const currentKm  = Number(car.currentKm) || 0;
  const interval   = Number(car.oilInterval) || 0;
  const nextKm     = kmAtChange + interval;
  const remaining  = nextKm - currentKm;
  return { remaining, nextKm, currentKm, interval, kmAtChange };
}

function buildProgressBar(status) {
  if (!status) return "";
  const { remaining, interval } = status;
  const used = interval - remaining;
  const pct  = Math.min(100, Math.max(0, (used / interval) * 100));
  let cls = remaining <= 0 ? "progress-red" : remaining <= WARN_KM ? "progress-orange" : "progress-green";
  const label = remaining > 0
    ? `المتبقي للتغيير: ${remaining} كم`
    : `⚠️ تجاوز الموعد بـ ${Math.abs(remaining)} كم`;
  return `
    <div class="progress-bar-container">
      <div class="progress-bar ${cls}" style="width:${pct}%"></div>
    </div>
    <div class="progress-label">${label}</div>`;
}

function buildAlert(status) {
  if (!status) return "";
  const { remaining } = status;
  if (remaining <= 0)         return `<div class="alert-danger">🔴 تجاوزت موعد تغيير الزيت! يجب التغيير فوراً.</div>`;
  if (remaining <= WARN_KM)   return `<div class="alert-warning">🟡 اقترب موعد تغيير الزيت! المتبقي ${remaining} كم فقط.</div>`;
  return "";
}

// =================== حفظ / تحديث سيارة ===================
document.getElementById("saveCarBtn").addEventListener("click", async () => {
  const plate     = document.getElementById("carPlate").value.trim();
  const name      = document.getElementById("carName").value.trim();
  const interval  = document.getElementById("carOilInterval").value.trim();
  const currentKm = document.getElementById("carCurrentKm").value.trim();

  if (!plate) { alert("ادخل رقم اللوحة"); return; }
  if (!name)  { alert("ادخل اسم السيارة"); return; }

  const carRef = doc(db, "cars", plate);
  const existing = await getDoc(carRef);
  const oldData = existing.exists() ? existing.data() : {};

  await setDoc(carRef, {
    ...oldData,
    name,
    oilInterval: Number(interval) || oldData.oilInterval || 0,
    currentKm:   Number(currentKm) || oldData.currentKm || 0,
    updatedAt: new Date()
  });

  alert("✅ تم حفظ السيارة");
  clearCarForm();
  loadCars();
});

// =================== إضافة سجل تغيير ===================
document.getElementById("saveRecordBtn").addEventListener("click", async () => {
  const plate       = document.getElementById("recordPlate").value.trim();
  const date        = document.getElementById("recordDate").value;
  const km          = document.getElementById("recordKm").value.trim();
  const oilFilter   = document.getElementById("oilFilterSelect").value;
  const dieselFilter= document.getElementById("dieselFilterSelect").value;
  const notes       = document.getElementById("recordNotes").value.trim();

  if (!plate) { alert("ادخل رقم اللوحة"); return; }
  if (!date)  { alert("ادخل تاريخ التغيير"); return; }
  if (!km)    { alert("ادخل العداد عند التغيير"); return; }

  const carRef = doc(db, "cars", plate);
  const carSnap = await getDoc(carRef);
  if (!carSnap.exists()) { alert("❌ السيارة غير موجودة، أضفها أولاً"); return; }

  const recordsRef = collection(db, "cars", plate, "records");
  await addDoc(recordsRef, {
    date,
    km: Number(km),
    oilFilter,
    dieselFilter,
    notes,
    createdAt: new Date()
  });

  alert("✅ تم إضافة السجل");
  clearRecordForm();
  loadCars();
});

// =================== بحث ===================
document.getElementById("searchCarBtn").addEventListener("click", async () => {
  const plate = document.getElementById("searchPlate").value.trim();
  if (!plate) { alert("ادخل رقم اللوحة"); return; }

  const carSnap = await getDoc(doc(db, "cars", plate));
  if (!carSnap.exists()) { alert("❌ السيارة غير موجودة"); return; }

  const d = carSnap.data();
  document.getElementById("carPlate").value      = plate;
  document.getElementById("carName").value        = d.name || "";
  document.getElementById("carOilInterval").value = d.oilInterval || "";
  document.getElementById("carCurrentKm").value   = d.currentKm || "";
  alert("📦 تم تحميل بيانات السيارة");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// =================== حذف ===================
document.getElementById("deleteCarBtn").addEventListener("click", async () => {
  const plate = document.getElementById("searchPlate").value.trim();
  if (!plate) { alert("ادخل رقم اللوحة للحذف"); return; }
  if (!confirm(`هل تريد حذف السيارة ${plate} وكل سجلاتها؟`)) return;

  // حذف السجلات أولاً
  const recordsSnap = await getDocs(collection(db, "cars", plate, "records"));
  for (const r of recordsSnap.docs) {
    await deleteDoc(doc(db, "cars", plate, "records", r.id));
  }
  await deleteDoc(doc(db, "cars", plate));
  alert("🗑 تم الحذف");
  loadCars();
});

// =================== تحميل وعرض السيارات ===================
async function loadCars() {
  const carList = document.getElementById("carList");
  carList.innerHTML = "<p style='color:#888;text-align:center'>جاري التحميل...</p>";

  const carsSnap = await getDocs(collection(db, "cars"));
  if (carsSnap.empty) {
    carList.innerHTML = "<p style='color:#888;text-align:center'>لا توجد سيارات مضافة بعد</p>";
    return;
  }

  carList.innerHTML = "";

  for (const carDoc of carsSnap.docs) {
    const plate = carDoc.id;
    const car   = carDoc.data();

    // جلب السجلات مرتبة
    const recordsSnap = await getDocs(
      query(collection(db, "cars", plate, "records"), orderBy("km", "desc"))
    );
    const records = recordsSnap.docs.map(r => ({ id: r.id, ...r.data() }));
    const lastRecord = records.length > 0 ? records[0] : null;

    const status = getRemaining(car, lastRecord);

    // تحديد الإيموجي
    let emoji = "";
    if (status) {
      if (status.remaining <= 0)         emoji = "🔴";
      else if (status.remaining <= WARN_KM) emoji = "🟡";
      else                                emoji = "🟢";
    }

    // بناء جدول السجلات
    let recordsHTML = "";
    if (records.length > 0) {
      recordsHTML = `
        <table class="record-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>العداد</th>
              <th>فلتر الزيت</th>
              <th>فلتر الديزل</th>
              <th>ملاحظات</th>
              <th>حذف</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td>${formatDate(r.date)}</td>
                <td>${r.km?.toLocaleString() || "-"}</td>
                <td>${r.oilFilter || "-"}</td>
                <td>${r.dieselFilter || "-"}</td>
                <td>${r.notes || "-"}</td>
                <td><button class="btn-del-record" data-plate="${plate}" data-rid="${r.id}">🗑</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>`;
    } else {
      recordsHTML = "<p style='color:#888;font-size:13px'>لا توجد سجلات بعد</p>";
    }

    const div = document.createElement("div");
    div.className = "car-item";
    div.innerHTML = `
      <div class="car-header-row">
        <span>
          <strong>${emoji} ${plate}</strong> &nbsp;|&nbsp; ${car.name || ""}
          ${status ? `&nbsp;|&nbsp; المتبقي: <strong>${status.remaining > 0 ? status.remaining + " كم" : "تجاوز الموعد"}</strong>` : ""}
        </span>
        <div class="car-btns">
          <button class="btn-view" data-plate="${plate}">👁 عرض</button>
          <button class="btn-edit-car btn-view" data-plate="${plate}" style="background:#f0a500">✏️ تعديل</button>
        </div>
      </div>

      <div class="car-details" id="details-${plate}" style="display:none;">
        ${buildAlert(status)}
        <p><strong>رقم اللوحة:</strong> ${plate}</p>
        <p><strong>اسم السيارة:</strong> ${car.name || "-"}</p>
        <p><strong>الممشى الحالي:</strong> ${Number(car.currentKm)?.toLocaleString() || "-"} كم</p>
        <p><strong>فترة التغيير المطلوبة:</strong> ${Number(car.oilInterval)?.toLocaleString() || "-"} كم</p>
        ${lastRecord ? `
          <p><strong>آخر تغيير زيت:</strong> ${formatDate(lastRecord.date)}</p>
          <p><strong>العداد عند آخر تغيير:</strong> ${lastRecord.km?.toLocaleString() || "-"} كم</p>
          <p><strong>فلتر الزيت في آخر تغيير:</strong> ${lastRecord.oilFilter || "-"}</p>
          <p><strong>فلتر الديزل في آخر تغيير:</strong> ${lastRecord.dieselFilter || "-"}</p>
        ` : "<p style='color:#888'>لا توجد سجلات بعد</p>"}
        ${buildProgressBar(status)}
        <strong>سجل التغييرات:</strong>
        ${recordsHTML}
      </div>
    `;
    carList.appendChild(div);
  }

  // زر عرض / إخفاء
  document.querySelectorAll(".btn-view").forEach(btn => {
    if (btn.classList.contains("btn-edit-car")) return;
    btn.addEventListener("click", () => {
      const plate = btn.dataset.plate;
      const details = document.getElementById(`details-${plate}`);
      const isVisible = details.style.display === "block";
      document.querySelectorAll(".car-details").forEach(d => d.style.display = "none");
      document.querySelectorAll(".btn-view:not(.btn-edit-car)").forEach(b => b.textContent = "👁 عرض");
      if (!isVisible) {
        details.style.display = "block";
        btn.textContent = "🔼 إخفاء";
      }
    });
  });

  // زر تعديل
  document.querySelectorAll(".btn-edit-car").forEach(btn => {
    btn.addEventListener("click", async () => {
      const plate = btn.dataset.plate;
      const snap = await getDoc(doc(db, "cars", plate));
      if (snap.exists()) {
        const d = snap.data();
        document.getElementById("carPlate").value      = plate;
        document.getElementById("carName").value        = d.name || "";
        document.getElementById("carOilInterval").value = d.oilInterval || "";
        document.getElementById("carCurrentKm").value   = d.currentKm || "";
        window.scrollTo({ top: 0, behavior: "smooth" });
        alert("✏️ عدّل البيانات ثم اضغط حفظ/تحديث");
      }
    });
  });

  // زر حذف سجل
  document.querySelectorAll(".btn-del-record").forEach(btn => {
    btn.addEventListener("click", async () => {
      const plate = btn.dataset.plate;
      const rid   = btn.dataset.rid;
      if (!confirm("هل تريد حذف هذا السجل؟")) return;
      await deleteDoc(doc(db, "cars", plate, "records", rid));
      alert("🗑 تم حذف السجل");
      loadCars();
    });
  });
}

// =================== تفريغ النماذج ===================
function clearCarForm() {
  document.getElementById("carPlate").value      = "";
  document.getElementById("carName").value        = "";
  document.getElementById("carOilInterval").value = "";
  document.getElementById("carCurrentKm").value   = "";
}

function clearRecordForm() {
  document.getElementById("recordPlate").value = "";
  document.getElementById("recordDate").value  = "";
  document.getElementById("recordKm").value    = "";
  document.getElementById("recordNotes").value = "";
  document.getElementById("oilFilterSelect").value    = "تم تغييره";
  document.getElementById("dieselFilterSelect").value = "تم تغييره";
}

loadCars();
