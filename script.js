import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  onSnapshot,
  arrayUnion,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
// نسخ setDoc / updateDoc / deleteDoc / writeBatch اللي تكتب سجل التعديلات تلقائيًا
import { setDoc, updateDoc, deleteDoc, writeBatch, initAudit } from "./audit.js";
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCN4t4vm_w93wV2ZSLHKyzOehXslkTxQCM",
  authDomain: "oil-form.firebaseapp.com",
  projectId: "oil-form",
  storageBucket: "oil-form.firebasestorage.app",
  messagingSenderId: "178062121688",
  appId: "1:178062121688:web:062a2e051918c44a6bd5ad",
  measurementId: "G-EL6DS942NF",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// =================== الأدوار والصلاحيات ===================
// المالك: نفس قائمة الإيميلات الموجودة في قواعد Firestore (firestore.rules → isOwner)
const OWNER_EMAILS = ["waseem.w133@gmail.com"];
// أقسام الموقع (لكل مستخدم: مخفي / مشاهدة / تعديل)
const SECTIONS = [
  { key: "home", label: "الرئيسية" },
  { key: "vehicles", label: "المركبات المخزنة" },
  { key: "followups", label: "المتابعات المحفوظة" },
  { key: "meters", label: "وصول العدادات" },
  { key: "types", label: "أنواع المعدات" },
  { key: "export", label: "التصدير" },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);
const OWNER_PAGES = new Set(["users", "audit"]); // لوحة الإدارة: للمالك فقط
const PAGE_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.key, s.label]));
PAGE_LABELS.users = "إدارة المستخدمين";
PAGE_LABELS.audit = "سجل التعديلات";
const PERM_LABELS = { hidden: "مخفي", view: "مشاهدة", edit: "تعديل" };

let authUser = null; // المستخدم المسجّل في Firebase Auth
let isOwner = false; // المالك
let userProfile = null; // ملف المستخدم من users/{uid} (لغير المالك)
let currentPage = "home";
let ownerName = ""; // اسم المالك (يظهر في السجل بدل الإيميل)
let auditEnabled = true; // settings/audit.enabled

// داخل أي قسم: isAdmin = "يقدر يعدّل هذا القسم". خارج الأقسام (لوحة الإدارة): المالك فقط.
// يتحدّث تلقائيًا في applyScope() عند تغيير القسم أو الصلاحيات، فكل الأزرار والشروط
// الموجودة اللي تعتمد على isAdmin تشتغل حسب صلاحية القسم بدون تعديل كل صفحة.
let isAdmin = false;

// صلاحية القسم للمستخدم الحالي: "hidden" | "view" | "edit"
function perm(section) {
  if (isOwner) return "edit";
  if (authUser) {
    if (!userProfile || userProfile.disabled) return "hidden";
    const p = userProfile.permissions?.[section];
    return p === "edit" || p === "view" ? p : "hidden";
  }
  return section === "home" ? "view" : "hidden"; // الزائر: مثل قبل بالضبط
}
const canEdit = (section) => perm(section) === "edit";
const canView = (section) => perm(section) !== "hidden";
// حساب مسجّل وله وصول (المالك أو مستخدم مفعّل)
const isStaff = () => isOwner || (!!authUser && !!userProfile && !userProfile.disabled);
// من يقدر يحدّث statusColor للمعدات (يكتب في vehicles)
const canSyncColors = () => isOwner || canEdit("home") || canEdit("vehicles") || canEdit("types");

function currentActorName() {
  if (!authUser) return "";
  if (isOwner) return ownerName || authUser.email || "المالك";
  return userProfile?.name || authUser.email || "";
}

// =================== إعداد سجل التعديلات ===================
const FIELD_LABELS = {
  type: "نوع المعدة",
  date: "تاريخ آخر تغيير زيت",
  currentKm: "الممشى الحالي",
  lastKm: "ممشى آخر تغيير زيت",
  kmSinceLastChange: "الممشى منذ آخر تغيير",
  kmDiff: "الممشى منذ آخر تغيير",
  filter: "حالة فلتر الزيت",
  manualColor: "اللون اليدوي",
  name: "الاسم",
  items: "المعدات",
  count: "العدد",
  number: "رقم المعدة",
  meterAvailable: "يوجد عداد",
  lastReceivedDate: "آخر وصول للعداد",
  dates: "تواريخ وصول العداد",
  types: "أنواع المعدات",
  interval: "الممشى لتغيير الزيت",
  email: "الإيميل",
  disabled: "الحساب موقوف",
  enabled: "تشغيل السجل",
  ownerName: "اسم المالك",
  permissions: "الصلاحيات",
};
function auditFieldLabel(path) {
  if (!path) return "—";
  const segs = String(path).split(".");
  const i = segs.indexOf("permissions");
  if (i !== -1 && segs[i + 1]) return `صلاحية: ${PAGE_LABELS[segs[i + 1]] || segs[i + 1]}`;
  const last = segs[segs.length - 1];
  return FIELD_LABELS[last] || last;
}
function auditFormatValue(path, v) {
  if (String(path).includes("permissions") && typeof v === "string" && PERM_LABELS[v]) return PERM_LABELS[v];
  if (String(path).endsWith("manualColor") && v === "auto") return "تلقائي";
  return undefined;
}
function auditRecordName(col, id, before, after) {
  const d = after || before || {};
  switch (col) {
    case "vehicles":
      return `معدة ${id}`;
    case "dailyFollowups":
      return `متابعة: ${d.name || id}`;
    case "equipment":
      return `عداد معدة ${id}`;
    case "meterReceipts":
      return `وصول عداد ${id}`;
    case "users":
      return `مستخدم: ${d.name || d.email || id}`;
    case "settings":
      return id === "equipmentTypes" ? "أنواع المعدات" : id === "audit" ? "إعدادات السجل" : `الإعدادات: ${id}`;
    default:
      return `${col}/${id}`;
  }
}
initAudit({
  db,
  actor: () =>
    authUser && isStaff()
      ? { uid: authUser.uid, name: currentActorName(), email: authUser.email || "" }
      : null,
  section: () => currentPage,
  sectionLabel: (k) => PAGE_LABELS[k] || k,
  enabled: () => auditEnabled,
  recordName: auditRecordName,
  fieldLabel: auditFieldLabel,
  formatValue: auditFormatValue,
});
// وعد يتحقق بـ true إذا تم تحميل الأنواع من قاعدة البيانات بنجاح (يستخدمه تحديث statusColor)
let typesReady = Promise.resolve(false);

const saveBtn = document.getElementById("saveBtn");
const saveSilentBtn = document.getElementById("saveSilentBtn");
const searchBtn = document.getElementById("searchBtn");
const deleteBtn = document.getElementById("deleteBtn");
const copyBtn = document.getElementById("copyBtn");
const copyGreenBtn = document.getElementById("copyGreenBtn");
const copyRedBtn = document.getElementById("copyRedBtn");
const copyWhiteBtn = document.getElementById("copyWhiteBtn");
const copyBlueBtn = document.getElementById("copyBlueBtn");
const copyBlackBtn = document.getElementById("copyBlackBtn");
const vehicleList = document.getElementById("vehicleList");
const outputDiv = document.getElementById("output");

const typeSelect = document.getElementById("typeSelect");
const typeOther = document.getElementById("typeOther");
const filterSelect = document.getElementById("filterSelect");
const filterOther = document.getElementById("filterOther");
const currentKmSelect = document.getElementById("currentKmSelect");
const currentKmInput = document.getElementById("currentKm");
const lastKmSelect = document.getElementById("lastKmSelect");
const lastKmInput = document.getElementById("lastKmInput");
const lastKmOther = document.getElementById("lastKmOther");
const colorSelect = document.getElementById("colorSelect");

const NO_KM_CURRENT = "لا يوجد ممشى حالي";
const BROKEN_CURRENT = "العداد لا يعمل";
const NO_KM_LAST = "لا يوجد عداد في آخر تغيير زيت في النظام";
const NEVER_CHANGED = "لم يتم تغيير الزيت";

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
  lastKmInput.style.display = val === "has" ? "block" : "none";
  lastKmOther.style.display = val === "other" ? "block" : "none";
  if (val !== "has") lastKmInput.value = "";
  if (val !== "other") lastKmOther.value = "";
});

// الحالة الابتدائية للحقول
currentKmInput.style.display = "block";
lastKmInput.style.display = "block";
lastKmOther.style.display = "none";

// أنواع المعدات + الممشى لتغيير الزيت (تُحمَّل من Firestore وتُعدَّل من قسم "أنواع المعدات")
const DEFAULT_EQUIPMENT_TYPES = [
  { name: "قلاب مرسيدس", interval: 10000 },
  { name: "قلاب فولفو", interval: 5500 },
  { name: "لوبد فولفو", interval: 5500 },
  { name: "وايت فولفو", interval: 5500 },
  { name: "لوبد مرسيدس", interval: 5500 },
  { name: "لوبد", interval: 5500 },
  { name: "وايت", interval: 0 },
  { name: "دينا", interval: 4500 },
  { name: "سطحة", interval: 4500 },
  { name: "دينا سطحة", interval: 4500 },
  { name: "ونش", interval: 4500 },
  { name: "دينا ونش", interval: 4500 },
  { name: "حافلة", interval: 4500 },
  { name: "شيول", interval: 250 },
  { name: "شيول جي سي بي", interval: 250 },
  { name: "جي سي بي", interval: 250 },
  { name: "قريدر", interval: 250 },
  { name: "بوكلين", interval: 250 },
  { name: "بلدوزر", interval: 250 },
  { name: "بوبكات", interval: 250 },
  { name: "فولفو", interval: 5500 },
  { name: "مدحلة", interval: 250 },
];
let equipmentTypes = DEFAULT_EQUIPMENT_TYPES.map((t) => ({ ...t }));
function isKnownType(name) {
  return equipmentTypes.some((t) => t.name === name);
}

let sessionVehicles = {};
let allVehiclesData = [];
let loadedKmInfo = null; // {currentKm, date} للمعدة المحمّلة في النموذج (لعرض تاريخ آخر تعديل للممشى)
const selectedSession = new Set(); // أرقام المعدات المحددة بالـ checkbox في المتابعة اليومية

// =================== المدة منذ آخر تغيير زيت (للعرض فقط) ===================
function arUnit(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
function durationSince(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - start) / 86400000);
  if (days < 0) return "تاريخ مستقبلي";
  if (days === 0) return "اليوم";

  let yy = today.getFullYear() - start.getFullYear();
  let mm = today.getMonth() - start.getMonth();
  let dd = today.getDate() - start.getDate();
  if (dd < 0) {
    mm--;
    dd += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  }
  if (mm < 0) {
    yy--;
    mm += 12;
  }
  const parts = [];
  if (yy) parts.push(arUnit(yy, "سنة", "سنتين", "سنوات", "سنة"));
  if (mm) parts.push(arUnit(mm, "شهر", "شهرين", "أشهر", "شهر"));
  if (dd) parts.push(arUnit(dd, "يوم", "يومين", "أيام", "يومًا"));
  return `${days} يوم` + (yy || mm ? ` (${parts.join(" و")})` : "");
}

// =================== الممشى منذ آخر تغيير + اللون (مباشر) ===================
function updateKmDiffLive() {
  const diffEl = document.getElementById("kmDiffLive");
  const colorEl = document.getElementById("colorLive");
  if (!diffEl) return;

  // الممشى منذ آخر تغيير
  if (
    currentKmSelect.value !== "has" ||
    lastKmSelect.value !== "has" ||
    currentKmInput.value === "" ||
    lastKmInput.value === "" ||
    !Number(lastKmInput.value)
  ) {
    diffEl.textContent = "-";
  } else {
    diffEl.textContent = Number(currentKmInput.value) - Number(lastKmInput.value);
  }

  // اللون (نفس منطق الحفظ)
  const typeVal =
    typeSelect.value === "اخرى" ? typeOther.value : typeSelect.value;
  let curStored;
  if (currentKmSelect.value === "none") curStored = NO_KM_CURRENT;
  else if (currentKmSelect.value === "broken") curStored = BROKEN_CURRENT;
  else curStored = Number(currentKmInput.value) || 0;

  let lastStored;
  const lk = lastKmSelect.value;
  if (lk === "no") lastStored = NO_KM_LAST;
  else if (lk === "never") lastStored = NEVER_CHANGED;
  else if (lk === "other") lastStored = lastKmOther.value || NO_KM_LAST;
  else lastStored = Number(lastKmInput.value) || 0;

  const autoEmojis = getStatusEmoji(typeVal, curStored, lastStored, "auto").join("");
  // خيار "تلقائي" يعرض اللون المحسوب
  colorSelect.options[0].textContent = `تلقائي ${autoEmojis}`;
  // اللون النهائي (اليدوي إن وُجد)
  if (colorEl) {
    colorEl.textContent =
      colorSelect.value === "auto" ? autoEmojis : colorSelect.value;
  }

  // المدة منذ آخر تغيير زيت (للعرض فقط ولا تُكتب في المتابعة)
  const durEl = document.getElementById("durLive");
  if (durEl) durEl.textContent = durationSince(document.getElementById("date").value);

  // تاريخ آخر تعديل للممشى الحالي (للعرض فقط)
  const kmDateEl = document.getElementById("kmUpdatedLive");
  if (kmDateEl) {
    const changed = !loadedKmInfo || String(loadedKmInfo.currentKm) !== String(curStored);
    kmDateEl.textContent = changed
      ? `${meterFmtDate(meterDateKey())} (عند الحفظ)`
      : meterFmtDate(loadedKmInfo.date);
  }
}
[
  document.getElementById("date"),
  typeSelect,
  typeOther,
  currentKmSelect,
  currentKmInput,
  lastKmSelect,
  lastKmInput,
  lastKmOther,
  colorSelect,
].forEach((el) => {
  el.addEventListener("input", updateKmDiffLive);
  el.addEventListener("change", updateKmDiffLive);
});
updateKmDiffLive();

// =================== تحليل الممشى الحالي ===================
function parseCurrentKm(currentKmRaw) {
  if (currentKmRaw === NO_KM_CURRENT) return { type: "none", value: null };
  if (currentKmRaw === BROKEN_CURRENT) return { type: "broken", value: null };
  const n = Number(currentKmRaw);
  if (
    currentKmRaw !== "" &&
    currentKmRaw !== null &&
    currentKmRaw !== undefined &&
    !isNaN(n)
  )
    return { type: "value", value: n };
  return { type: "none", value: null };
}

function isNoKm(lastKm) {
  return (
    !lastKm ||
    lastKm === NO_KM_LAST ||
    lastKm === NEVER_CHANGED ||
    isNaN(Number(lastKm))
  );
}

// =================== حساب العلامة اللونية ===================
function getStatusEmoji(type, currentKmRaw, lastKm, manualColor) {
  // لون يدوي يتجاوز الحساب التلقائي
  if (manualColor && manualColor !== "auto") return [manualColor];

  const emojis = [];
  const cur = parseCurrentKm(currentKmRaw);

  // اللون الأزرق للعداد المعطل
  if (cur.type === "broken") emojis.push("🔵");

  // اللون الأبيض لعدم وجود ممشى حالي
  if (cur.type === "none") emojis.push("⚪");

  // اللون البرتقالي لعدم تغيير الزيت
  if (lastKm === NEVER_CHANGED) emojis.push("🟠");

  // اللون الأسود لعدم وجود عداد سابق (ولكن ليس "لم يتم تغيير الزيت")
  if (isNoKm(lastKm) && lastKm !== NEVER_CHANGED) emojis.push("⚫");

  // حساب الحالة بناءً على الممشى (أحمر أو أخضر) - فقط إذا كان هناك قيمة رقمية
  if (cur.type === "value" && !isNoKm(lastKm)) {
    const kmDiff = cur.value - Number(lastKm);
    // الحد (كم) لتغيير الزيت حسب نوع المعدة من إعدادات "أنواع المعدات"
    const cfg = equipmentTypes.find((t) => t.name === type);
    emojis.push(cfg && cfg.interval > 0 && kmDiff >= cfg.interval ? "🔴" : "🟢");
  }

  // إذا لم يكن هناك أي ألوان، نرجع أخضر افتراضي
  return emojis.length > 0 ? emojis : ["🟢"];
}

// =================== لون الحالة المحفوظ في قاعدة البيانات (statusColor) ===================
// نفس اللون المعروض على الشاشة بالضبط (يشمل اللون اليدوي)، كنص واحد مثل "🔴" أو "🔵⚫"
function statusColorOf(d) {
  return getStatusEmoji(d.type, d.currentKm, d.lastKm, d.manualColor).join("");
}

// تحديث جماعي: يكتب statusColor فقط للمعدات اللي لونها المحسوب يختلف عن المحفوظ (للأدمن فقط)
let syncingStatusColors = false;
async function syncStatusColors() {
  if (!canSyncColors() || syncingStatusColors) return;
  // لا نحدّث إلا بعد تحميل أنواع المعدات من قاعدة البيانات بنجاح، عشان الحدود تكون الصحيحة
  if (!(await typesReady)) {
    console.warn("تم تخطي تحديث statusColor: لم يتم تحميل أنواع المعدات");
    return;
  }
  syncingStatusColors = true;
  try {
    const changes = allVehiclesData
      .map((v) => ({ v, color: statusColorOf(v.data) }))
      .filter(({ v, color }) => v.data.statusColor !== color);
    for (let i = 0; i < changes.length; i += 400) {
      if (!canSyncColors()) return; // تم تسجيل الخروج أو تغيّرت الصلاحيات أثناء التحديث
      const batch = writeBatch(db);
      changes
        .slice(i, i + 400)
        .forEach(({ v, color }) => batch.update(doc(db, "vehicles", v.id), { statusColor: color }));
      await batch.commit();
      changes.slice(i, i + 400).forEach(({ v, color }) => (v.data.statusColor = color));
    }
    if (changes.length) console.info(`تم تحديث statusColor لـ ${changes.length} معدة`);
  } catch (err) {
    console.error("تعذر تحديث statusColor", err);
  } finally {
    syncingStatusColors = false;
  }
}

// =================== دالة الحفظ المشتركة ===================
// قراءة قيم النموذج بنفس صيغة الحفظ (تُستخدم للحفظ ولنسخ المعدة الحالية)
function readFormVehicle() {
  const number = document.getElementById("number").value.trim();
  const typeVal =
    typeSelect.value === "اخرى" ? typeOther.value : typeSelect.value;
  const filterVal =
    filterSelect.value === "اخرى" ? filterOther.value : filterSelect.value;
  const dateVal = document.getElementById("date").value;

  let currentKmStored;
  const curSel = currentKmSelect.value;
  if (curSel === "none") currentKmStored = NO_KM_CURRENT;
  else if (curSel === "broken") currentKmStored = BROKEN_CURRENT;
  else currentKmStored = Number(currentKmInput.value) || 0;

  let lastKmStored;
  const lkSel = lastKmSelect.value;
  if (lkSel === "no") lastKmStored = NO_KM_LAST;
  else if (lkSel === "never") lastKmStored = NEVER_CHANGED;
  else if (lkSel === "other") lastKmStored = lastKmOther.value || NO_KM_LAST;
  else lastKmStored = Number(lastKmInput.value) || 0;

  const cur = parseCurrentKm(currentKmStored);
  const kmDiff =
    !isNoKm(lastKmStored) && cur.type === "value"
      ? cur.value - Number(lastKmStored)
      : 0;

  return { number, typeVal, filterVal, dateVal, currentKmStored, lastKmStored, kmDiff };
}

let savingVehicle = false;
async function saveVehicle(addToSession) {
  if (savingVehicle) return; // منع الضغط المتكرر أثناء الحفظ
  const {
    number,
    typeVal,
    filterVal,
    dateVal,
    currentKmStored,
    lastKmStored,
    kmDiff,
  } = readFormVehicle();
  if (!number) {
    alert("ادخل رقم المعدة");
    return;
  }
  savingVehicle = true;
  document.querySelectorAll(".form-actions button").forEach((b) => (b.disabled = true));
  try {
    await saveVehicleCore(addToSession, {
      number,
      typeVal,
      filterVal,
      dateVal,
      currentKmStored,
      lastKmStored,
      kmDiff,
    });
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحفظ: " + (err.code || err.message));
  } finally {
    savingVehicle = false;
    document.querySelectorAll(".form-actions button").forEach((b) => (b.disabled = false));
  }
}

async function saveVehicleCore(
  addToSession,
  { number, typeVal, filterVal, dateVal, currentKmStored, lastKmStored, kmDiff },
) {
  // تاريخ آخر تعديل للممشى الحالي: يتحدث تلقائيًا فقط إذا تغيّر الممشى الحالي (أو معدة جديدة)
  let prevData = null;
  try {
    const prevSnap = await getDoc(doc(db, "vehicles", number));
    if (prevSnap.exists()) prevData = prevSnap.data();
  } catch (err) {
    console.error(err);
  }

  // تنبيه إذا كان الممشى الحالي أو ممشى آخر تغيير زيت أقل من المسجل حاليًا
  if (prevData) {
    const toNum = (v) =>
      v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v);
    const warnings = [];
    const prevCur = toNum(prevData.currentKm);
    const newCur = toNum(currentKmStored);
    if (prevCur !== null && newCur !== null && newCur < prevCur) {
      warnings.push(`• الممشى الحالي المدخل (${newCur}) أقل من المسجل حاليًا (${prevCur})`);
    }
    const prevLast = toNum(prevData.lastKm);
    const newLast = toNum(lastKmStored);
    if (prevLast !== null && newLast !== null && newLast < prevLast) {
      warnings.push(`• ممشى آخر تغيير زيت المدخل (${newLast}) أقل من المسجل حاليًا (${prevLast})`);
    }
    if (warnings.length) {
      const ok = confirm(
        `⚠️ تنبيه للمعدة رقم ${number}:\n\n${warnings.join("\n")}\n\nهل تريد المتابعة والحفظ؟`,
      );
      if (!ok) return; // رفض: لا يتم الحفظ وتبقى البيانات في النموذج للتعديل
    }
  }

  let currentKmUpdatedAt;
  if (!prevData || String(prevData.currentKm) !== String(currentKmStored)) {
    currentKmUpdatedAt = meterDateKey();
  } else {
    currentKmUpdatedAt = prevData.currentKmUpdatedAt || "";
  }

  const data = {
    type: typeVal,
    date: dateVal,
    currentKm: currentKmStored,
    currentKmUpdatedAt,
    lastKm: lastKmStored,
    kmSinceLastChange: kmDiff,
    filter: filterVal,
    manualColor: colorSelect.value || "auto",
    updatedAt: new Date(),
  };
  await typesReady; // التأكد من تحميل حدود الأنواع قبل حساب اللون
  data.statusColor = statusColorOf(data);

  await setDoc(doc(db, "vehicles", number), data);

  if (addToSession) {
    // إزالة أي نسخة سابقة بنفس رقم المعدة من كل الأنواع (منع التكرار)
    removeFromSession(number);
    if (!sessionVehicles[typeVal]) sessionVehicles[typeVal] = [];
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

// نسخ المعدة الحالية في النموذج (بدون حفظ) بنفس صيغة المتابعة
document.getElementById("copyFormBtn").addEventListener("click", () => {
  const f = readFormVehicle();
  if (!f.number) {
    alert("ادخل رقم المعدة");
    return;
  }
  const data = {
    type: f.typeVal,
    date: f.dateVal,
    currentKm: f.currentKmStored,
    lastKm: f.lastKmStored,
    kmSinceLastChange: f.kmDiff,
    filter: f.filterVal,
    manualColor: colorSelect.value || "auto",
  };
  navigator.clipboard.writeText(entryCopyText(f.typeVal, { number: f.number, data }));
  const btn = document.getElementById("copyFormBtn");
  const old = btn.textContent;
  btn.textContent = "✔ تم النسخ";
  setTimeout(() => (btn.textContent = old), 1200);
});

// =================== حفظ فقط ===================
saveSilentBtn.addEventListener("click", () => saveVehicle(false));

// =================== البحث ===================
// تحميل بيانات معدة في النموذج. silent = بدون رسائل (للتحميل التلقائي). يرجع true إذا وُجدت.
async function loadVehicle(number, silent) {
  const docSnap = await getDoc(doc(db, "vehicles", number));
  if (silent && document.getElementById("number").value.trim() !== number) {
    return null; // تغيّر الرقم أثناء الانتظار
  }
  if (docSnap.exists()) {
    const data = docSnap.data();
    document.getElementById("number").value = number;

    typeSelect.value = isKnownType(data.type) ? data.type : "اخرى";
    typeOther.value = typeSelect.value === "اخرى" ? data.type : "";
    typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";

    const knownFilters = [
      "تم تغييره في آخر تغيير",
      "تم تغييره في التغيير قبل الأخير",
      "لم يتم تغييره في آخر تغييرين",
      "لم يتم تغيير فلتر الزيت سابقاً",
    ];
    filterSelect.value = knownFilters.includes(data.filter)
      ? data.filter
      : "اخرى";
    filterOther.value = filterSelect.value === "اخرى" ? data.filter : "";
    filterOther.style.display =
      filterSelect.value === "اخرى" ? "block" : "none";

    document.getElementById("date").value = data.date;
    colorSelect.value = data.manualColor || "auto";
    loadedKmInfo = { currentKm: data.currentKm, date: data.currentKmUpdatedAt || "" };

    if (data.currentKm === NO_KM_CURRENT) {
      currentKmSelect.value = "none";
      currentKmInput.style.display = "none";
    } else if (data.currentKm === BROKEN_CURRENT) {
      currentKmSelect.value = "broken";
      currentKmInput.style.display = "none";
    } else {
      currentKmSelect.value = "has";
      currentKmInput.style.display = "block";
      currentKmInput.value = data.currentKm;
    }

    if (data.lastKm === NO_KM_LAST) {
      lastKmSelect.value = "no";
      lastKmInput.style.display = "none";
      lastKmOther.style.display = "none";
    } else if (data.lastKm === NEVER_CHANGED) {
      lastKmSelect.value = "never";
      lastKmInput.style.display = "none";
      lastKmOther.style.display = "none";
    } else if (!isNaN(Number(data.lastKm)) && data.lastKm !== "") {
      lastKmSelect.value = "has";
      lastKmInput.style.display = "block";
      lastKmOther.style.display = "none";
      lastKmInput.value = data.lastKm;
    } else {
      lastKmSelect.value = "other";
      lastKmInput.style.display = "none";
      lastKmOther.style.display = "block";
      lastKmOther.value = data.lastKm;
    }

    updateKmDiffLive();
    if (!silent) alert("📦 تم تحميل البيانات");
    return true;
  } else {
    if (!silent) alert("❌ المركبة غير موجودة");
    return false;
  }
}

searchBtn.addEventListener("click", () => {
  const number = document.getElementById("number").value.trim();
  if (!number) {
    alert("ادخل رقم المعدة للبحث");
    return;
  }
  loadVehicle(number, false);
});

// =================== تحميل تلقائي عند كتابة رقم المعدة ===================
let autoLoadTimer = null;
let autoLoaded = false; // هل البيانات الحالية في النموذج جاءت من تحميل تلقائي؟
document.getElementById("number").addEventListener("input", () => {
  clearTimeout(autoLoadTimer);
  autoLoadTimer = setTimeout(async () => {
    const numberEl = document.getElementById("number");
    const number = numberEl.value.trim();
    if (!number) {
      if (autoLoaded) {
        clearForm();
        autoLoaded = false;
      }
      return;
    }
    try {
      const found = await loadVehicle(number, true);
      if (found === false) {
        loadedKmInfo = null;
        updateKmDiffLive();
      }
      if (found === true) {
        autoLoaded = true;
      } else if (found === false && autoLoaded) {
        // رقم جديد غير موجود: نفرّغ بيانات المعدة السابقة ونُبقي الرقم
        clearForm();
        numberEl.value = number;
        autoLoaded = false;
      }
    } catch (err) {
      console.error(err);
    }
  }, 0);
});

// =================== حذف ===================
deleteBtn.addEventListener("click", async () => {
  const number = document.getElementById("number").value.trim();

  if (!number) {
    alert("ادخل رقم المعدة للحذف");
    return;
  }

  // تأكيد قبل الحذف
  const confirmed = confirm(
    `⚠️ هل أنت متأكد من حذف المعدة رقم ${number}؟\n\nلا يمكن التراجع عن هذا الإجراء.`
  );

  if (!confirmed) return;

  await deleteDoc(doc(db, "vehicles", number));

  removeFromSession(number);

  updateOutput();
  loadVehicles();

  alert("🗑 تم الحذف");
});

// =================== تحميل المركبات ===================
async function loadVehicles() {
  if (!isStaff()) return;
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  allVehiclesData = [];
  querySnapshot.forEach((docItem) => {
    allVehiclesData.push({ id: docItem.id, data: docItem.data() });
  });
  renderVehicles(null, "");
}

// الألوان المفلترة في المركبات المخزنة (Set مشترك)
let storedFilterEmojis = new Set(["🟢", "🔴", "🟠", "⚪", "🔵", "⚫"]);

function renderVehicles(filterColors = null, searchTerm = "") {
  if (filterColors !== null)
    storedFilterEmojis =
      filterColors instanceof Set ? filterColors : new Set(filterColors);
  vehicleList.innerHTML = "";

  // شريط التصفية - checkboxes
  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar-checks";
  filterBar.innerHTML = `
    <div class="stored-filter-checks">
      <label class="all-check-label"><input type="checkbox" id="filterAll" ${storedFilterEmojis.size === 6 ? "checked" : ""}/> 📋 الكل</label>
      <label><input type="checkbox" value="🟢" ${storedFilterEmojis.has("🟢") ? "checked" : ""}/> 🟢 الزيت جديد</label>
      <label><input type="checkbox" value="🔴" ${storedFilterEmojis.has("🔴") ? "checked" : ""}/> 🔴 تحتاج تغيير زيت</label>
      <label><input type="checkbox" value="🟠" ${storedFilterEmojis.has("🟠") ? "checked" : ""}/> 🟠 لايوجد تغيير زيت</label>
      <label><input type="checkbox" value="⚪" ${storedFilterEmojis.has("⚪") ? "checked" : ""}/> ⚪ لايوجد ممشى حالي</label>
      <label><input type="checkbox" value="🔵" ${storedFilterEmojis.has("🔵") ? "checked" : ""}/> 🔵 العداد لا يعمل</label>
      <label><input type="checkbox" value="⚫" ${storedFilterEmojis.has("⚫") ? "checked" : ""}/> ⚫ لايوجد ممشى في اخر تغيير</label>
    </div>
    <button class="copy-filtered-btn" id="copyFilteredBtn">📋 نسخ المعروض</button>
  `;
  vehicleList.appendChild(filterBar);

  // منطق checkbox الكل
  filterBar.querySelector("#filterAll").addEventListener("change", (e) => {
    const all = e.target.checked;
    filterBar
      .querySelectorAll(".stored-filter-checks input[value]")
      .forEach((cb) => (cb.checked = all));
    const term =
      document.getElementById("storedSearchInput")?.value.trim() || "";
    storedFilterEmojis = all
      ? new Set(["🟢", "🔴", "🟠", "⚪", "🔵", "⚫"])
      : new Set();
    renderVehicles(storedFilterEmojis, term);
  });

  filterBar
    .querySelectorAll(".stored-filter-checks input[value]")
    .forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = new Set(
          [
            ...filterBar.querySelectorAll(
              ".stored-filter-checks input[value]:checked",
            ),
          ].map((c) => c.value),
        );
        const term =
          document.getElementById("storedSearchInput")?.value.trim() || "";
        renderVehicles(checked, term);
      });
    });

  const filtered = allVehiclesData.filter((v) => {
    const emojis = getStatusEmoji(v.data.type, v.data.currentKm, v.data.lastKm, v.data.manualColor);
    // المعدة تظهر إذا كان أي من ألوانها في الفلتر
    const colorOk =
      storedFilterEmojis.size === 0 ||
      emojis.some((e) => storedFilterEmojis.has(e));
    const searchOk = !searchTerm || v.id.includes(searchTerm);
    return colorOk && searchOk;
  });

  const grouped = {};
  filtered.forEach((v) => {
    if (!grouped[v.data.type]) grouped[v.data.type] = [];
    grouped[v.data.type].push(v);
  });

  const sortedTypes = Object.keys(grouped).sort();

  sortedTypes.forEach((type) => {
    grouped[type].sort(
      (a, b) =>
        (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0),
    );

    // عداد الألوان في المجموعة
    const counts = { "🟢": 0, "🔴": 0, "🟠": 0, "🔵": 0, "⚪": 0, "⚫": 0 };
    grouped[type].forEach((v) => {
      const emojis = getStatusEmoji(
        v.data.type,
        v.data.currentKm,
        v.data.lastKm, v.data.manualColor
      );
      emojis.forEach((e) => {
        if (counts[e] !== undefined) counts[e]++;
      });
    });
    const summary = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([e, n]) => `${e}${n}`)
      .join(" ");

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

    grouped[type].forEach((v) => {
      const emojis = getStatusEmoji(
        v.data.type,
        v.data.currentKm,
        v.data.lastKm, v.data.manualColor
      );
      const emojiDisplay = emojis.join(" ");
      const kmDisplay =
        v.data.currentKm === NO_KM_CURRENT ||
        v.data.currentKm === BROKEN_CURRENT ||
        isNoKm(v.data.lastKm)
          ? "-"
          : v.data.kmSinceLastChange || 0;

      const div = document.createElement("div");
      div.className = "vehicle-item";
      div.innerHTML = `
        <div class="item-row">
          <span><strong>رقم المعدة:</strong> ${v.id} ${emojiDisplay} &nbsp;|&nbsp; <strong>الممشى منذ آخر تغيير:</strong> ${kmDisplay}</span>
          <div class="item-btns">
            <button class="btn-view" data-id="${v.id}">👁 عرض</button>
            <button class="btn-delete admin-only" data-id="${v.id}">🗑 حذف</button>
          </div>
        </div>
        <div class="vehicle-details" id="details-${v.id}" style="display:none;">
          <p><strong>نوع المعدة:</strong> ${v.data.type}</p>
          <p><strong>الممشى الحالي:</strong> ${v.data.currentKm}</p>
          <p><strong>ممشى آخر تغيير زيت:</strong> ${v.data.lastKm}</p>
          <p><strong>الممشى منذ آخر تغيير:</strong> ${kmDisplay}</p>
          <p><strong>تاريخ آخر تغيير زيت:</strong> ${v.data.date}</p>
          <p><strong>حالة فلتر الزيت:</strong> ${v.data.filter}</p>
          ${canEdit("home") ? `<button class="btn-edit" data-id="${v.id}">✏️ تعديل</button>` : ""}
        </div>
      `;
      groupBody.appendChild(div);
    });

    vehicleList.appendChild(groupBody);

    // toggle عند الضغط على العنوان
    groupHeader.addEventListener("click", () => {
      const isOpen = groupBody.style.display !== "none";
      groupBody.style.display = isOpen ? "none" : "block";
      groupHeader.querySelector(".group-arrow").textContent = isOpen
        ? "▼"
        : "▲";
    });
  });

  document.getElementById("copyFilteredBtn").addEventListener("click", () => {
    const text = buildReportText(sortedTypes, grouped);
    navigator.clipboard.writeText(text.trim());
    alert("✅ تم النسخ");
  });

  document.querySelectorAll(".btn-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const details = document.getElementById(`details-${id}`);
      const isVisible = details.style.display === "block";
      document
        .querySelectorAll(".vehicle-details")
        .forEach((d) => (d.style.display = "none"));
      document
        .querySelectorAll(".btn-view")
        .forEach((b) => (b.textContent = "👁 عرض"));
      if (!isVisible) {
        details.style.display = "block";
        btn.textContent = "🔼 إخفاء";
      }
    });
  });

  document.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!confirm(`هل تريد حذف المعدة رقم ${id}؟`)) return;
      await deleteDoc(doc(db, "vehicles", id));
      removeFromSession(id);
      updateOutput();
      loadVehicles();
      alert("🗑 تم الحذف");
    });
  });

  document.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const docSnap = await getDoc(doc(db, "vehicles", id));
      if (!docSnap.exists()) return;
      const data = docSnap.data();

      document.getElementById("number").value = id;

      typeSelect.value = isKnownType(data.type) ? data.type : "اخرى";
      typeOther.value = typeSelect.value === "اخرى" ? data.type : "";
      typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";

      const knownFilters = [
        "تم تغييره في آخر تغيير",
        "تم تغييره في التغيير قبل الأخير",
        "لم يتم تغييره في آخر تغييرين",
        "لم يتم تغيير فلتر الزيت سابقاً",
      ];
      filterSelect.value = knownFilters.includes(data.filter)
        ? data.filter
        : "اخرى";
      filterOther.value = filterSelect.value === "اخرى" ? data.filter : "";
      filterOther.style.display =
        filterSelect.value === "اخرى" ? "block" : "none";

      document.getElementById("date").value = data.date;
    colorSelect.value = data.manualColor || "auto";
    loadedKmInfo = { currentKm: data.currentKm, date: data.currentKmUpdatedAt || "" };

      if (data.currentKm === NO_KM_CURRENT) {
        currentKmSelect.value = "none";
        currentKmInput.style.display = "none";
      } else if (data.currentKm === BROKEN_CURRENT) {
        currentKmSelect.value = "broken";
        currentKmInput.style.display = "none";
      } else {
        currentKmSelect.value = "has";
        currentKmInput.style.display = "block";
        currentKmInput.value = data.currentKm;
      }

      if (data.lastKm === NO_KM_LAST) {
        lastKmSelect.value = "no";
        lastKmInput.style.display = "none";
        lastKmOther.style.display = "none";
      } else if (data.lastKm === NEVER_CHANGED) {
        lastKmSelect.value = "never";
        lastKmInput.style.display = "none";
        lastKmOther.style.display = "none";
      } else if (!isNaN(Number(data.lastKm)) && data.lastKm !== "") {
        lastKmSelect.value = "has";
        lastKmInput.style.display = "block";
        lastKmOther.style.display = "none";
        lastKmInput.value = data.lastKm;
      } else {
        lastKmSelect.value = "other";
        lastKmInput.style.display = "none";
        lastKmOther.style.display = "block";
        lastKmOther.value = data.lastKm;
      }

      updateKmDiffLive();
      window.scrollTo({ top: 0, behavior: "smooth" });
      alert("✏️ تم تحميل البيانات للتعديل، عدّل ثم اضغط حفظ/تحديث");
    });
  });
}

// =================== بناء نص التقرير ===================
function buildReportText(sortedTypes, grouped) {
  const today = new Date();
  const todayFormatted = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayFormatted}\n\n`;
  sortedTypes.forEach((type) => {
    grouped[type].forEach((v) => {
      const dp = v.data.date ? v.data.date.split("-") : [];
      const fd = dp.length === 3 ? `${dp[0]}/${dp[1]}/${dp[2]}` : v.data.date;
      const emojis = getStatusEmoji(type, v.data.currentKm, v.data.lastKm, v.data.manualColor);
      const emojiDisplay = emojis.join(" ");
      const kmDisplay =
        v.data.currentKm === NO_KM_CURRENT ||
        v.data.currentKm === BROKEN_CURRENT ||
        isNoKm(v.data.lastKm)
          ? "-"
          : v.data.kmSinceLastChange || 0;
      text += `نوع المعدة: ${type}\nرقم المعدة: ${v.id} ${emojiDisplay}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${v.data.lastKm}\nالممشى منذ آخر تغيير: ${kmDisplay}\nتاريخ آخر تغيير زيت: ${fd}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------\n`;
    });
  });
  return text;
}

// =================== المتابعة اليومية ===================
function removeFromSession(number) {
  selectedSession.delete(String(number));
  for (const type in sessionVehicles) {
    sessionVehicles[type] = sessionVehicles[type].filter(
      (v) => String(v.number) !== String(number),
    );
    if (!sessionVehicles[type].length) delete sessionVehicles[type];
  }
}

function todayText() {
  const t = new Date();
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`;
}

function buildEntryText(type, v) {
  const dp = v.data.date ? v.data.date.split("-") : [];
  const fd = dp.length === 3 ? `${dp[0]}/${dp[1]}/${dp[2]}` : v.data.date;
  const emojis = getStatusEmoji(type, v.data.currentKm, v.data.lastKm, v.data.manualColor);
  const emojiDisplay = emojis.join(" ");
  const kmDisplay =
    v.data.currentKm === NO_KM_CURRENT ||
    v.data.currentKm === BROKEN_CURRENT ||
    isNoKm(v.data.lastKm)
      ? "-"
      : v.data.kmSinceLastChange || 0;
  return `نوع المعدة: ${type}\nرقم المعدة: ${v.number} ${emojiDisplay}\nالممشى الحالي: ${v.data.currentKm}\nممشى آخر تغيير زيت: ${v.data.lastKm}\nالممشى منذ آخر تغيير: ${kmDisplay}\nتاريخ آخر تغيير زيت: ${fd}\nحالة فلتر الزيت: ${v.data.filter}\n----------------------\n`;
}

// يرجع قائمة مرتبة [{type, v}] للمتابعة اليومية (مع تصفية اختيارية بالألوان)
function getSessionEntries(emojiSet = null) {
  const entries = [];
  Object.keys(sessionVehicles)
    .sort()
    .forEach((type) => {
      let list = [...sessionVehicles[type]];
      if (emojiSet) {
        list = list.filter((v) =>
          getStatusEmoji(type, v.data.currentKm, v.data.lastKm, v.data.manualColor).some((e) => emojiSet.has(e)),
        );
      }
      list.sort(
        (a, b) => (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0),
      );
      list.forEach((v) => entries.push({ type, v }));
    });
  return entries;
}

function buildSessionText(emojiSet = null) {
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayText()}\n\n`;
  getSessionEntries(emojiSet).forEach(({ type, v }) => {
    text += buildEntryText(type, v);
  });
  return text.trim();
}

function entryCopyText(type, v) {
  return buildEntryText(type, v).replace(/-{5,}\n?$/, "").trim();
}

function updateOutput() {
  if (typeof scheduleAutosave === "function") scheduleAutosave();
  outputDiv.innerHTML = "";
  const head = document.createElement("div");
  head.className = "session-head";
  head.textContent = `المتابعة اليومية للزيوت / تاريخ: ${todayText()}`;
  outputDiv.appendChild(head);

  getSessionEntries().forEach(({ type, v }) => {
    const item = document.createElement("div");
    item.className = "session-item";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "session-check";
    chk.title = "تحديد للنسخ";
    chk.checked = selectedSession.has(String(v.number));
    chk.addEventListener("change", () => {
      if (chk.checked) selectedSession.add(String(v.number));
      else selectedSession.delete(String(v.number));
    });

    const txt = document.createElement("div");
    txt.className = "session-text";
    txt.textContent = entryCopyText(type, v);

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const copyOne = document.createElement("button");
    copyOne.className = "session-mini session-copy";
    copyOne.textContent = "📋";
    copyOne.title = "نسخ هذه المعدة";
    copyOne.addEventListener("click", () => {
      navigator.clipboard.writeText(entryCopyText(type, v));
      copyOne.textContent = "✔";
      setTimeout(() => (copyOne.textContent = "📋"), 1000);
    });

    const del = document.createElement("button");
    del.className = "session-mini btn-delete session-del";
    del.textContent = "🗑";
    del.title = "حذف من المتابعة";
    del.addEventListener("click", () => {
      removeFromSession(v.number);
      updateOutput();
    });

    actions.appendChild(copyOne);
    actions.appendChild(del);

    item.appendChild(chk);
    item.appendChild(txt);
    item.appendChild(actions);
    outputDiv.appendChild(item);
  });
}

// =================== نسخ المحدد (checkbox) ===================
document.getElementById("copyCheckedBtn").addEventListener("click", () => {
  const entries = getSessionEntries().filter(({ v }) =>
    selectedSession.has(String(v.number)),
  );
  if (!entries.length) {
    alert("حدد معدة واحدة على الأقل");
    return;
  }
  let text = `المتابعة اليومية للزيوت / تاريخ: ${todayText()}\n\n`;
  entries.forEach(({ type, v }) => {
    text += buildEntryText(type, v);
  });
  navigator.clipboard.writeText(text.trim());
  alert("تم النسخ");
});

// =================== نسخ حسب اللون (متعدد الاختيار) ===================
function copyByColors(selectedEmojis) {
  navigator.clipboard.writeText(buildSessionText(new Set(selectedEmojis)));
  alert("تم النسخ");
}

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(buildSessionText());
  alert("تم النسخ");
});

// =================== dropdown النسخ ===================
document.getElementById("copyFilterToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("copyDropdownMenu").classList.toggle("open");
});

// النقر داخل القائمة (على الألوان) لا يغلقها؛ تُغلق فقط بزر النسخ أو بالنقر خارجها
document.getElementById("copyDropdownMenu").addEventListener("click", (e) => {
  e.stopPropagation();
});

document
  .getElementById("copySelectedColorsBtn")
  .addEventListener("click", () => {
    const checked = [
      ...document.querySelectorAll(
        "#copyDropdownMenu .color-checkboxes input:checked",
      ),
    ].map((cb) => cb.value);
    if (!checked.length) {
      alert("اختر لون واحد على الأقل");
      return;
    }
    copyByColors(checked);
    document.getElementById("copyDropdownMenu").classList.remove("open");
  });

// =================== بحث المركبات المخزنة ===================
document.getElementById("storedSearchInput").addEventListener("input", () => {
  const term = document.getElementById("storedSearchInput").value.trim();
  renderVehicles(null, term);
});

document
  .getElementById("storedSearchClearBtn")
  .addEventListener("click", () => {
    document.getElementById("storedSearchInput").value = "";
    renderVehicles(null, "");
  });

// =================== فتح/إغلاق قسم المركبات المخزنة ===================
document.getElementById("vehicleListToggle").addEventListener("click", () => {
  const content = document.getElementById("vehicleListContent");
  const arrow = document.getElementById("vehicleListArrow");
  const isOpen = content.style.display !== "none";
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
  document.getElementById("number").value = "";
  typeSelect.value = equipmentTypes.length ? equipmentTypes[0].name : "اخرى";
  typeOther.value = "";
  typeOther.style.display = "none";
  document.getElementById("date").value = "";
  currentKmSelect.value = "has";
  currentKmInput.value = "";
  currentKmInput.style.display = "block";
  lastKmSelect.value = "has";
  lastKmInput.value = "";
  lastKmInput.style.display = "block";
  lastKmOther.value = "";
  lastKmOther.style.display = "none";
  filterSelect.value = "تم تغييره في آخر تغيير";
  filterOther.value = "";
  filterOther.style.display = "none";
  colorSelect.value = "auto";
  loadedKmInfo = null;
  updateKmDiffLive();
}

// =================== تصدير Excel ===================
document.getElementById("exportBtn").addEventListener("click", async () => {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  const sortMode = document.getElementById("exportSortSelect").value;
  const colorOrder = { "🔴": 0, "🟠": 1, "🟢": 2, "🔵": 3, "⚪": 4, "⚫": 5 };

  // الألوان المحددة للتصدير
  const exportColors = new Set(
    [
      ...document.querySelectorAll(".export-color-checkboxes input:checked"),
    ].map((cb) => cb.value),
  );
  if (!exportColors.size) {
    alert("اختر لون واحد على الأقل للتصدير");
    return;
  }

  let dataArray = [];
  querySnapshot.forEach((docItem) => {
    const d = docItem.data();
    const cur = parseCurrentKm(d.currentKm);
    const kmDiff =
      !isNoKm(d.lastKm) && cur.type === "value"
        ? cur.value - Number(d.lastKm)
        : "-";
    const dp = d.date ? d.date.split("-") : [];
    const fd = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : d.date || "";
    const emojis = getStatusEmoji(d.type, d.currentKm, d.lastKm, d.manualColor);

    // المعدة تظهر إذا كان أي من ألوانها في الفلتر
    const hasMatchingColor = emojis.some((e) => exportColors.has(e));
    if (hasMatchingColor) {
      dataArray.push({
        type: d.type,
        id: docItem.id,
        currentKm: d.currentKm,
        lastKm: d.lastKm,
        kmDiff,
        date: fd,
        filter: d.filter,
        emojis: emojis,
        primaryEmoji: emojis[0], // للترتيب
      });
    }
  });

  if (!dataArray.length) {
    alert("لا توجد مركبات بالألوان المحددة");
    return;
  }

  if (sortMode === "type") {
    dataArray.sort(
      (a, b) =>
        a.type.localeCompare(b.type, "ar") ||
        String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
  } else if (sortMode === "numAsc") {
    dataArray.sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
  } else if (sortMode === "numDesc") {
    dataArray.sort((a, b) =>
      String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
    );
  } else if (sortMode === "color") {
    dataArray.sort(
      (a, b) =>
        (colorOrder[a.primaryEmoji] ?? 9) - (colorOrder[b.primaryEmoji] ?? 9) ||
        a.type.localeCompare(b.type, "ar"),
    );
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${dd}/${mm}/${yyyy}`;

  const headers = [
    "#",
    "نوع المعدة",
    "رقم المعدة",
    "الممشى الحالي",
    "ممشى آخر تغيير زيت",
    "الممشى منذ آخر تغيير",
    "تاريخ آخر تغيير زيت",
    "حالة فلتر الزيت",
    "الحالة",
  ];
  const numCols = headers.length;
  const STATUS_CI = numCols - 1;
  const statusColor = {
    "🔴": "E74C3C",
    "🟠": "E67E22",
    "🟢": "27AE60",
    "🔵": "2980B9",
    "⚪": "D0D3D4",
    "⚫": "616A6B",
  };
  const statusText = {
    "🔴": "احمر",
    "🟠": "برتقالي",
    "🟢": "اخضر",
    "🔵": "ازرق",
    "⚪": "ابيض",
    "⚫": "اسود",
  };

  const aoa = [];
  aoa.push([
    `متابعة زيوت المركبات — تاريخ: ${dateStr}`,
    ...Array(numCols - 1).fill(""),
  ]);
  aoa.push(Array(numCols).fill(""));
  aoa.push(headers);
  dataArray.forEach((v, i) => {
    const statusDisplay = v.emojis.map((e) => statusText[e] || "").join(" + ");
    aoa.push([
      i + 1,
      v.type,
      v.id,
      v.currentKm,
      v.lastKm,
      v.kmDiff,
      v.date,
      v.filter,
      statusDisplay,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 4 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 30 },
    { wch: 18 },
    { wch: 18 },
    { wch: 40 },
    { wch: 12 },
  ];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } }];
  ws["!rows"] = [{ hpt: 28 }, { hpt: 6 }, { hpt: 20 }];

  ws[XLSX.utils.encode_cell({ r: 0, c: 0 })].s = {
    font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A5276" } },
    alignment: { horizontal: "center", vertical: "center" },
  };

  const bW = { style: "thin", color: { rgb: "FFFFFF" } };
  headers.forEach((_, ci) => {
    const c = XLSX.utils.encode_cell({ r: 2, c: ci });
    if (!ws[c]) ws[c] = { v: headers[ci], t: "s" };
    ws[c].s = {
      font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "2471A3" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: { top: bW, bottom: bW, left: bW, right: bW },
    };
  });

  const bThin = {
    top: { style: "thin", color: { rgb: "BDC3C7" } },
    bottom: { style: "thin", color: { rgb: "BDC3C7" } },
    left: { style: "thin", color: { rgb: "BDC3C7" } },
    right: { style: "thin", color: { rgb: "BDC3C7" } },
  };

  dataArray.forEach((v, ri) => {
    const rowIdx = ri + 3;
    // لون الخلية بناءً على اللون الأساسي
    const cellColor = statusColor[v.primaryEmoji] || "FFFFFF";
    const isDark = ["🔴", "🟠", "🟢", "🔵", "⚫"].includes(v.primaryEmoji);

    for (let ci = 0; ci < numCols; ci++) {
      const c = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
      if (!ws[c]) ws[c] = { v: "", t: "s" };
      ws[c].s =
        ci === STATUS_CI
          ? {
              fill: { fgColor: { rgb: cellColor } },
              alignment: { horizontal: "center", vertical: "center" },
              border: bThin,
              font: {
                bold: true,
                color: { rgb: isDark ? "FFFFFF" : "333333" },
              },
            }
          : {
              fill: { fgColor: { rgb: "FFFFFF" } },
              alignment: { horizontal: "center", vertical: "center" },
              border: bThin,
              font: { sz: 10 },
            };
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "المركبات");
  XLSX.writeFile(wb, `متابعة_المركبات_${dd}-${mm}-${yyyy}.xlsx`);
});

// =================== عرض في صفحة ويب ===================
document.getElementById("viewTableBtn").addEventListener("click", async () => {
  const querySnapshot = await getDocs(collection(db, "vehicles"));
  const sortMode = document.getElementById("exportSortSelect").value;
  const colorOrder = { "🔴": 0, "🟠": 1, "🟢": 2, "🔵": 3, "⚪": 4, "⚫": 5 };

  const exportColors = new Set(
    [
      ...document.querySelectorAll(".export-color-checkboxes input:checked"),
    ].map((cb) => cb.value),
  );
  if (!exportColors.size) {
    alert("اختر لون واحد على الأقل للعرض");
    return;
  }

  let dataArray = [];
  querySnapshot.forEach((docItem) => {
    const d = docItem.data();
    const cur = parseCurrentKm(d.currentKm);
    const kmDiff =
      !isNoKm(d.lastKm) && cur.type === "value"
        ? cur.value - Number(d.lastKm)
        : "-";
    const dp = d.date ? d.date.split("-") : [];
    const fd = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : d.date || "";
    const emojis = getStatusEmoji(d.type, d.currentKm, d.lastKm, d.manualColor);

    const hasMatchingColor = emojis.some((e) => exportColors.has(e));
    if (hasMatchingColor) {
      dataArray.push({
        type: d.type,
        id: docItem.id,
        currentKm: d.currentKm,
        lastKm: d.lastKm,
        kmDiff,
        date: fd,
        filter: d.filter,
        emojis: emojis,
      });
    }
  });

  if (!dataArray.length) {
    alert("لا توجد مركبات بالألوان المحددة");
    return;
  }

  if (sortMode === "type") {
    dataArray.sort(
      (a, b) =>
        a.type.localeCompare(b.type, "ar") ||
        String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
  } else if (sortMode === "numAsc") {
    dataArray.sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
  } else if (sortMode === "numDesc") {
    dataArray.sort((a, b) =>
      String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
    );
  } else if (sortMode === "color") {
    dataArray.sort(
      (a, b) =>
        (colorOrder[a.emojis[0]] ?? 9) - (colorOrder[b.emojis[0]] ?? 9) ||
        a.type.localeCompare(b.type, "ar"),
    );
  }

  // حفظ البيانات في localStorage للصفحة الجديدة
  localStorage.setItem("tableViewData", JSON.stringify(dataArray));

  // فتح صفحة جديدة
  window.open("table-view.html", "_blank");
});

// =====================================================================
//                    الصفحات (Navbar) + تسجيل الدخول
// =====================================================================
let authReady = false;
const PAGES = [...SECTION_KEYS, "users", "audit"];

function pageAllowed(page) {
  if (OWNER_PAGES.has(page)) return isOwner;
  return canView(page);
}

// يطبّق صلاحية القسم الحالي: isAdmin + كلاسات الصفحة + روابط القائمة + اسم المستخدم
function applyScope(page) {
  currentPage = page;
  isAdmin = OWNER_PAGES.has(page) ? isOwner : canEdit(page);
  const cl = document.body.classList;
  cl.toggle("is-admin", isAdmin);
  cl.toggle("signed-in", !!authUser);
  cl.toggle("is-owner", isOwner);
  document.querySelectorAll(".nav-links a[data-page]").forEach((a) => {
    a.hidden = !pageAllowed(a.dataset.page);
  });
  // زر تسجيل وصول العدادات (في الرئيسية) يحتاج صلاحية تعديل وصول العدادات
  const reg = document.getElementById("registerMetersBtn");
  if (reg) reg.style.display = canEdit("meters") ? "" : "none";
  const nameEl = document.getElementById("navUserName");
  if (nameEl) nameEl.textContent = authUser ? `👤 ${currentActorName()}` : "";
}

function route(opts = {}) {
  let page = (location.hash || "#home").slice(1);
  if (!PAGES.includes(page)) page = "home";
  const pending = !authReady || (authUser && !isOwner && !userProfile);
  if (!pageAllowed(page)) {
    // مخفي: يتحول لأول قسم مسموح. (قبل اكتمال التحقق ما نغيّر الرابط عشان إعادة التحميل ترجع لنفس القسم)
    const first = PAGES.find(pageAllowed) || "home";
    if (!pending && page !== first) history.replaceState(null, "", "#" + first);
    page = first;
  }
  applyScope(page);
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  document
    .querySelectorAll(".nav-links a")
    .forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  if (isStaff() && page === "vehicles") loadVehicles();
  if (isStaff() && page === "followups") loadFollowups();
  if (isStaff() && page === "types") resetTypesDraft();
  if (isOwner && page === "users") renderUsersPage();
  if (isOwner && page === "audit") loadAuditPage(true);
  if (!opts.keepScroll) {
    closeNavMenu();
    window.scrollTo({ top: 0 });
  }
}
window.addEventListener("hashchange", () => route());

// ---------- نافذة الدخول ----------
const loginModal = document.getElementById("loginModal");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");

function openLogin() {
  loginError.textContent = "";
  loginModal.hidden = false;
  loginEmail.focus();
}
function closeLogin() {
  loginModal.hidden = true;
  loginPassword.value = "";
  loginError.textContent = "";
}

function authErrorText(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "البريد أو كلمة المرور غير صحيحة";
    case "auth/invalid-email":
      return "صيغة البريد الإلكتروني غير صحيحة";
    case "auth/too-many-requests":
      return "محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة";
    case "auth/network-request-failed":
      return "تعذر الاتصال بالإنترنت";
    default:
      return "تعذر تسجيل الدخول";
  }
}

async function doLogin() {
  const email = loginEmail.value.trim();
  const pass = loginPassword.value;
  if (!email || !pass) {
    loginError.textContent = "ادخل البريد وكلمة المرور";
    return;
  }
  loginSubmitBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    closeLogin();
  } catch (err) {
    loginError.textContent = authErrorText(err.code);
  } finally {
    loginSubmitBtn.disabled = false;
  }
}

document.getElementById("loginNavBtn").addEventListener("click", openLogin);
document.getElementById("loginCancelBtn").addEventListener("click", closeLogin);
loginSubmitBtn.addEventListener("click", doLogin);
[loginEmail, loginPassword].forEach((el) =>
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  }),
);
loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal) closeLogin();
});
document.getElementById("logoutNavBtn").addEventListener("click", () => {
  if (confirm("تسجيل الخروج؟")) doSignOut();
});

// ---------- مراقبة ملف المستخدم + إعدادات السجل ----------
let profileUnsub = null;
let auditSettingsUnsub = null;
let signingOut = false;

function stopWatchers() {
  profileUnsub?.();
  profileUnsub = null;
  auditSettingsUnsub?.();
  auditSettingsUnsub = null;
  stopUsersWatch();
}

async function doSignOut(message) {
  if (signingOut) return;
  signingOut = true;
  stopWatchers();
  stopMetersSync();
  if (message) alert(message);
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
  } finally {
    signingOut = false;
  }
}

function watchAuditSettings() {
  auditSettingsUnsub = onSnapshot(
    doc(db, "settings", "audit"),
    (snap) => {
      const d = snap.exists() ? snap.data() : {};
      auditEnabled = d.enabled !== false; // افتراضيًا: السجل شغّال
      ownerName = typeof d.ownerName === "string" ? d.ownerName : "";
      applyScope(currentPage);
      renderAuditToggle();
      const on = document.getElementById("ownerNameInput");
      if (on && document.activeElement !== on) on.value = ownerName;
    },
    (err) => console.warn("تعذر قراءة إعدادات السجل", err),
  );
}

// العدادات تلزم من يشوف قسمها، ومن يعدّل الرئيسية (زر تسجيل وصول العدادات)
function ensureMetersSync() {
  const need = isOwner || canView("meters") || canEdit("home");
  if (need && !meterUnsubs.length) startMetersSync();
  else if (!need && meterUnsubs.length) stopMetersSync();
}

// أول ما تتأكد صلاحيات الحساب
function onAccessReady() {
  // بعد تحميل المعدات: تحديث جماعي لـ statusColor (ينتظر تحميل الأنواع داخليًا)
  loadVehicles()
    .then(() => (canSyncColors() ? syncStatusColors() : null))
    .catch((err) => console.error(err));
  ensureMetersSync();
  if (isOwner) startUsersWatch();
  route();
}
// تغيّرت صلاحيات المستخدم وهو داخل الموقع: تطبيق فوري بدون خروج ودخول
function onAccessChanged() {
  ensureMetersSync();
  route({ keepScroll: true });
}

onAuthStateChanged(auth, (user) => {
  stopWatchers();
  authUser = user;
  isOwner = !!user && OWNER_EMAILS.includes(String(user.email || "").toLowerCase());
  userProfile = null;
  authReady = true;
  typesReady = loadEquipmentTypes();

  if (user) {
    watchAuditSettings();
    if (isOwner) {
      document.body.classList.remove("auth-pending");
      onAccessReady();
      return;
    }
    // مستخدم عادي: ننتظر ملفه من users/{uid} ونراقبه لحظيًا
    document.body.classList.add("auth-pending");
    profileUnsub = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (!snap.exists()) {
          doSignOut("⚠️ حسابك غير مفعّل في النظام. تواصل مع المالك.");
          return;
        }
        const p = snap.data();
        if (p.disabled) {
          doSignOut("⛔ تم إيقاف حسابك. تواصل مع المالك.");
          return;
        }
        const first = !userProfile;
        userProfile = p;
        document.body.classList.remove("auth-pending");
        if (first) onAccessReady();
        else onAccessChanged();
      },
      (err) => {
        if (signingOut || !auth.currentUser) return;
        console.error(err);
        doSignOut("تعذر التحقق من صلاحيات حسابك. حاول مرة ثانية.");
      },
    );
    return;
  }

  {
    document.body.classList.remove("auth-pending");
    stopMetersSync();
    // تنظيف أي بيانات عند الخروج
    allVehiclesData = [];
    sessionVehicles = {};
    selectedSession.clear();
    clearTimeout(autosaveTimer);
    autosavePending = false;
    currentFollowupId = null;
    currentFollowupName = "";
    followupSaveState = "";
    autosaveSkipOnce = true;
    document.getElementById("vehicleList").innerHTML = "";
    document.getElementById("followupsList").innerHTML = "";
    localStorage.removeItem("tableViewData");
    clearForm();
    updateOutput();
    updateFollowupStatus();
  }
  route();
});

// =====================================================================
//              بحث الزائر (عرض فقط بدون تعديل)
// =====================================================================
const guestNumberEl = document.getElementById("guestNumber");
const guestResultEl = document.getElementById("guestResult");
let guestReq = 0;

guestNumberEl.addEventListener("input", async () => {
  const number = guestNumberEl.value.trim();
  const req = ++guestReq;
  if (!number) {
    guestResultEl.innerHTML = "";
    return;
  }
  try {
    const snap = await getDoc(doc(db, "vehicles", number));
    if (req !== guestReq) return; // تغيّر الرقم أثناء الانتظار
    guestResultEl.innerHTML = "";
    const box = document.createElement("div");
    if (!snap.exists()) {
      box.className = "guest-empty";
      box.textContent = "لا يوجد سجل لهذا الرقم";
    } else {
      box.className = "session-item guest-record";
      const txt = document.createElement("div");
      txt.className = "session-text";
      txt.textContent = entryCopyText(snap.data().type, {
        number,
        data: snap.data(),
      });
      box.appendChild(txt);
    }
    guestResultEl.appendChild(box);
  } catch (err) {
    if (req !== guestReq) return;
    guestResultEl.innerHTML = "";
    const box = document.createElement("div");
    box.className = "guest-empty";
    box.textContent = "تعذر جلب البيانات";
    guestResultEl.appendChild(box);
  }
});

// =====================================================================
//                    المتابعات اليومية المحفوظة
// =====================================================================
let currentFollowupId = null; // المتابعة المفتوحة حاليًا (إن كانت محمّلة من المحفوظات)
let currentFollowupName = "";

let followupSaveState = ""; // "" | "saving" | "saved" | "error"
let followupSavedAt = null;

function updateFollowupStatus() {
  const el = document.getElementById("followupStatus");
  if (!currentFollowupId && !followupSaveState) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  let t = currentFollowupId ? `📂 ${currentFollowupName}` : "";
  if (followupSaveState === "saving") t += " — ⏳ جاري الحفظ...";
  else if (followupSaveState === "saved")
    t += ` — ✔ حُفظت تلقائيًا ${String(followupSavedAt.getHours()).padStart(2, "0")}:${String(followupSavedAt.getMinutes()).padStart(2, "0")}`;
  else if (followupSaveState === "error") t += " — ⚠ تعذر الحفظ التلقائي";
  el.textContent = t.trim();
  el.style.display = "block";
}

function sessionToItems() {
  const items = [];
  Object.keys(sessionVehicles).forEach((type) => {
    sessionVehicles[type].forEach((v) =>
      items.push({ type, number: v.number, kmDiff: v.kmDiff || 0, data: v.data }),
    );
  });
  return JSON.parse(JSON.stringify(items)); // تنظيف (تواريخ → نص)
}

function itemsToSession(items) {
  sessionVehicles = {};
  items.forEach((it) => {
    if (!sessionVehicles[it.type]) sessionVehicles[it.type] = [];
    sessionVehicles[it.type].push({
      number: it.number,
      data: it.data,
      kmDiff: it.kmDiff || 0,
    });
  });
}

function sessionIsEmpty() {
  return Object.values(sessionVehicles).every((l) => !l.length);
}

function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function tsToDate(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
}

function buildTextFromItems(items, createdAt, title) {
  const d = createdAt || new Date();
  const dateText = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  let text = `${title || "المتابعة اليومية للزيوت"} / تاريخ: ${dateText}\n\n`;
  const byType = {};
  items.forEach((it) => (byType[it.type] = (byType[it.type] || []).concat(it)));
  Object.keys(byType)
    .sort()
    .forEach((type) => {
      byType[type]
        .sort(
          (a, b) =>
            (b.data.kmSinceLastChange || 0) - (a.data.kmSinceLastChange || 0),
        )
        .forEach((it) => {
          text += buildEntryText(type, { number: it.number, data: it.data });
        });
    });
  return text.trim();
}

// ---------- الحفظ التلقائي للمتابعة اليومية ----------
let autosaveTimer = null;
let autosavePending = false;
let autosaveSkipOnce = false; // لتجاهل أول تحديث بعد فتح متابعة محفوظة

function scheduleAutosave() {
  if (autosaveSkipOnce) {
    autosaveSkipOnce = false;
    return;
  }
  if (!canEdit("home")) return;
  clearTimeout(autosaveTimer);
  autosavePending = false;
  if (sessionIsEmpty()) return; // لا نكتب متابعة فارغة فوق المحفوظة
  followupSaveState = "saving";
  updateFollowupStatus();
  autosavePending = true;
  autosaveTimer = setTimeout(autosaveFollowup, 700);
}

async function autosaveFollowup() {
  clearTimeout(autosaveTimer);
  autosavePending = false;
  if (!canEdit("home") || sessionIsEmpty()) return;

  const items = sessionToItems();
  const isNew = !currentFollowupId;
  if (isNew) {
    currentFollowupId = doc(collection(db, "dailyFollowups")).id;
    if (!currentFollowupName) currentFollowupName = `متابعة ${todayText()}`;
  }
  const payload = {
    name: currentFollowupName,
    items,
    count: items.length,
    updatedAt: new Date(),
  };
  if (isNew) payload.createdAt = new Date();

  try {
    await setDoc(doc(db, "dailyFollowups", currentFollowupId), payload, {
      merge: true,
    });
    followupSaveState = "saved";
    followupSavedAt = new Date();
  } catch (err) {
    console.error(err);
    followupSaveState = "error";
  }
  updateFollowupStatus();
}

// حفظ فوري لو تم إخفاء الصفحة/إغلاقها قبل انتهاء المهلة
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && autosavePending) autosaveFollowup();
});

// ---------- تسمية المتابعة (يدويًا) ----------
document.getElementById("saveFollowupBtn").addEventListener("click", () => {
  if (sessionIsEmpty()) {
    alert("المتابعة اليومية فارغة");
    return;
  }
  const input = prompt(
    "اسم المتابعة:",
    currentFollowupName || `متابعة ${todayText()}`,
  );
  if (input === null) return;
  currentFollowupName = input.trim() || `متابعة ${todayText()}`;
  autosaveFollowup();
});

// ---------- متابعة جديدة ----------
document.getElementById("newFollowupBtn").addEventListener("click", () => {
  if (
    !sessionIsEmpty() &&
    !confirm(
      "سيتم تفريغ المتابعة اليومية الحالية.\nالمتابعة غير المحفوظة ستضيع. هل تريد المتابعة؟",
    )
  )
    return;
  sessionVehicles = {};
  selectedSession.clear();
  clearTimeout(autosaveTimer);
  autosavePending = false;
  currentFollowupId = null;
  currentFollowupName = "";
  followupSaveState = "";
  autosaveSkipOnce = true;
  updateOutput();
  updateFollowupStatus();
});

// ---------- قائمة المتابعات المحفوظة ----------
async function loadFollowups() {
  const listEl = document.getElementById("followupsList");
  listEl.textContent = "جاري التحميل...";
  let rows = [];
  try {
    const snap = await getDocs(collection(db, "dailyFollowups"));
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    listEl.textContent = "تعذر تحميل المتابعات";
    return;
  }
  rows.sort(
    (a, b) =>
      (tsToDate(b.createdAt || b.updatedAt)?.getTime() || 0) -
      (tsToDate(a.createdAt || a.updatedAt)?.getTime() || 0),
  );

  listEl.innerHTML = "";
  if (!rows.length) {
    listEl.innerHTML = '<div class="guest-empty">لا توجد متابعات محفوظة بعد</div>';
    return;
  }

  rows.forEach((r) => {
    const created = tsToDate(r.createdAt);
    const updated = tsToDate(r.updatedAt);
    const items = r.items || [];

    const card = document.createElement("div");
    card.className = "followup-card";

    const info = document.createElement("div");
    info.className = "followup-info";
    const title = document.createElement("div");
    title.className = "followup-title";
    title.textContent = r.name || "متابعة";
    const meta = document.createElement("div");
    meta.className = "followup-meta";
    meta.textContent =
      `${items.length} معدة` +
      (created ? ` · أُنشئت ${fmtDateTime(created)}` : "") +
      (updated && created && updated - created > 60000
        ? ` · آخر تعديل ${fmtDateTime(updated)}`
        : "");
    const nums = document.createElement("div");
    nums.className = "followup-nums";
    const numList = items.map((i) => i.number);
    nums.textContent =
      "الأرقام: " +
      numList.slice(0, 30).join("، ") +
      (numList.length > 30 ? " ..." : "");
    info.append(title, meta, nums);

    const actions = document.createElement("div");
    actions.className = "followup-btns";

    const openBtn = document.createElement("button");
    openBtn.className = "btn-sm btn-blue";
    openBtn.textContent = "📂 فتح للتعديل";
    openBtn.addEventListener("click", () => {
      if (
        !sessionIsEmpty() &&
        !confirm(
          "سيتم استبدال المتابعة اليومية الحالية بهذه المتابعة.\nهل تريد المتابعة؟",
        )
      )
        return;
      clearTimeout(autosaveTimer);
      autosavePending = false;
      itemsToSession(items);
      selectedSession.clear();
      currentFollowupId = r.id;
      currentFollowupName = r.name || "متابعة";
      followupSaveState = "";
      autosaveSkipOnce = true;
      updateOutput();
      updateFollowupStatus();
      location.hash = "#home";
    });

    const copyBtn2 = document.createElement("button");
    copyBtn2.className = "btn-sm btn-gray";
    copyBtn2.textContent = "📋 نسخ";
    copyBtn2.addEventListener("click", () => {
      navigator.clipboard.writeText(buildTextFromItems(items, created));
      copyBtn2.textContent = "✔ تم";
      setTimeout(() => (copyBtn2.textContent = "📋 نسخ"), 1200);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-sm btn-red";
    delBtn.textContent = "🗑 حذف";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`حذف المتابعة «${r.name || ""}» نهائيًا؟\nلا يمكن التراجع.`)) return;
      try {
        await deleteDoc(doc(db, "dailyFollowups", r.id));
        if (currentFollowupId === r.id) {
          currentFollowupId = null;
          currentFollowupName = "";
          updateFollowupStatus();
        }
        loadFollowups();
      } catch (err) {
        console.error(err);
        alert("❌ تعذر الحذف");
      }
    });

    delBtn.classList.add("admin-only"); // الحذف: صلاحية تعديل المتابعات
    // فتح للتعديل ينقلها للمتابعة اليومية في الرئيسية: يحتاج صلاحية تعديل الرئيسية
    if (canEdit("home")) actions.append(openBtn);
    actions.append(copyBtn2, delBtn);
    card.append(info, actions);
    listEl.appendChild(card);
  });
}

// =====================================================================
//                         قسم: وصول العدادات
// =====================================================================
// إعدادات مشروع Firebase القديم (نظام متابعة ممشى المعدات) — تُستخدم فقط لزر الاستيراد
const OLD_METERS_FIREBASE = {"apiKey": "AIzaSyBjkTIDiByJP-57hLzUwtDcB95834O8Bgc", "authDomain": "killometer.firebaseapp.com", "projectId": "killometer", "storageBucket": "killometer.firebasestorage.app", "messagingSenderId": "606355517115", "appId": "1:606355517115:web:399935bed02c0fd16a839e"};

let meterEquipment = []; // [{id, number, meterAvailable, lastReceivedDate}]
let meterReceipts = {}; // { "1234": ["2026-11-01", ...] }
let meterUnsubs = [];
let meterEquipReady = false;
let meterStatus = "all"; // all | received | missing
let meterSearch = "";

const mEl = (id) => document.getElementById(id);

function meterDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function meterFmtDate(v) {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return `${y}/${m}/${d}`;
}
function toEnglishDigits(value) {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
function parseNumbers(value) {
  const norm = toEnglishDigits(value)
    .replace(/[\u060C,;\s\n\r]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return [
    ...new Set(
      norm
        .split("-")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}
// يدعم: نص تقرير كامل (يلتقط الأرقام بعد "رقم المعدة:") أو أرقام مفصولة بـ - أو فاصلة أو مسافة
function extractEquipmentNumbers(value) {
  const text = toEnglishDigits(value);
  const re = /رقم\s*(?:ال)?معدة\s*[:：=\-]?\s*(\d+)/g;
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) found.push(n);
  }
  if (found.length) return [...new Set(found)];
  return parseNumbers(text);
}

function showMetersMessage(msg) {
  mEl("metersMsgText").textContent = msg;
  mEl("metersMsg").hidden = false;
}
mEl("metersMsgClose").addEventListener("click", () => (mEl("metersMsg").hidden = true));

// ---------- المزامنة اللحظية ----------
function startMetersSync() {
  stopMetersSync();
  meterUnsubs.push(
    onSnapshot(
      collection(db, "equipment"),
      (snap) => {
        meterEquipment = snap.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              number: Number(x.number),
              meterAvailable: x.meterAvailable !== false,
              lastReceivedDate:
                typeof x.lastReceivedDate === "string" ? x.lastReceivedDate : undefined,
            };
          })
          .filter((e) => Number.isInteger(e.number))
          .sort((a, b) => a.number - b.number);
        meterEquipReady = true;
        renderMeters();
      },
      (err) => {
        console.error(err);
        showMetersMessage("تعذر الوصول إلى قائمة المعدات في قاعدة البيانات.");
      },
    ),
  );
  meterUnsubs.push(
    onSnapshot(
      collection(db, "meterReceipts"),
      (snap) => {
        const out = {};
        snap.docs.forEach((d) => {
          const x = d.data();
          out[d.id] = Array.isArray(x.dates)
            ? x.dates.filter((v) => typeof v === "string")
            : [];
        });
        meterReceipts = out;
        renderMeters();
      },
      (err) => {
        console.error(err);
        showMetersMessage("تعذر تحميل سجل وصول العدادات.");
      },
    ),
  );
}

function stopMetersSync() {
  meterUnsubs.forEach((u) => u());
  meterUnsubs = [];
  meterEquipment = [];
  meterReceipts = {};
  meterEquipReady = false;
  renderMeters();
}

// ---------- الحسابات ----------
function meterRange() {
  return { from: mEl("mFrom").value, to: mEl("mTo").value };
}
function isReceivedInRange(number) {
  const { from, to } = meterRange();
  return (meterReceipts[String(number)] || []).some(
    (d) => (!from || d >= from) && (!to || d <= to),
  );
}
function getLastDate(item) {
  if (item.lastReceivedDate) return item.lastReceivedDate;
  const dates = meterReceipts[String(item.number)] || [];
  return dates.length ? [...dates].sort().at(-1) : undefined;
}
function meterFiltered() {
  return meterEquipment.filter((e) => {
    const matchSearch = !meterSearch || String(e.number).includes(meterSearch);
    const rec = e.meterAvailable && isReceivedInRange(e.number);
    const matchStatus =
      meterStatus === "all" ||
      (meterStatus === "received" && rec) ||
      (meterStatus === "missing" && !rec);
    return matchSearch && matchStatus;
  });
}

// ---------- العرض ----------
function renderMeters() {
  const total = meterEquipment.length;
  const received = meterEquipment.filter(
    (e) => e.meterAvailable && isReceivedInRange(e.number),
  ).length;
  const { from, to } = meterRange();

  mEl("mStatAll").textContent = total;
  mEl("mStatRec").textContent = received;
  mEl("mStatMiss").textContent = total - received;
  mEl("mRangeTitle").textContent = `متابعة من ${meterFmtDate(from)} إلى ${meterFmtDate(to)}`;
  mEl("mManageCount").textContent = `— ${total} معدة`;
  mEl("mEmptyNotice").hidden = !(meterEquipReady && !total);

  document
    .querySelectorAll(".meter-stats button, .meter-filters button")
    .forEach((b) => {
      const on = b.dataset.status === meterStatus;
      b.classList.toggle(b.closest(".meter-stats") ? "active" : "selected", on);
    });

  const filtered = meterFiltered();
  mEl("mListCount").textContent = `— ${filtered.length} من ${total}`;

  const table = mEl("mTable");
  if (mEl("mListContent").style.display === "none") return; // لا نرسم الجدول وهو مخفي
  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "meter-row th";
  ["رقم المعدة", "الحالة في الفترة", "آخر تاريخ للعداد", "", ""].forEach((t) => {
    const sp = document.createElement("span");
    sp.textContent = t;
    head.appendChild(sp);
  });
  table.appendChild(head);

  const frag = document.createDocumentFragment();
  filtered.forEach((e) => {
    const rec = e.meterAvailable && isReceivedInRange(e.number);
    const row = document.createElement("div");
    row.className = "meter-row";

    const num = document.createElement("b");
    num.textContent = e.number;

    const st = document.createElement("span");
    st.className = rec ? "ok" : "bad";
    st.textContent = rec
      ? "✓ جاء عدادها"
      : e.meterAvailable
        ? "× ما جاء عدادها"
        : "× لا يوجد عداد";

    const last = document.createElement("span");
    last.className = "last-date";
    last.textContent = meterFmtDate(getLastDate(e));

    const edit = document.createElement("button");
    edit.className = "meter-icon admin-only";
    edit.dataset.act = "toggle";
    edit.dataset.num = e.number;
    edit.title = "تعديل حالة العداد (يوجد / لا يوجد عداد)";
    edit.textContent = "✏️";

    const del = document.createElement("button");
    del.className = "meter-icon danger admin-only";
    del.dataset.act = "delete";
    del.dataset.num = e.number;
    del.title = "حذف من القائمة الأساسية";
    del.textContent = "🗑";

    row.append(num, st, last, edit, del);
    frag.appendChild(row);
  });
  table.appendChild(frag);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "guest-empty";
    empty.textContent = "لا توجد نتائج مطابقة للفترة أو التصفية المحددة.";
    table.appendChild(empty);
  }
}

// ---------- تسجيل وصول العدادات (يُستخدم من الصفحة ومن زر المتابعة اليومية) ----------
async function registerMeterArrivals(nums) {
  if (!meterEquipReady) {
    return { ok: false, msg: "جاري تحميل قائمة المعدات، حاول بعد لحظات." };
  }
  const byNum = new Map(meterEquipment.map((e) => [e.number, e]));
  const fresh = nums.filter((n) => byNum.get(n)?.meterAvailable === true);
  const unavailable = nums.filter((n) => byNum.get(n)?.meterAvailable === false);
  const unknown = nums.filter((n) => !byNum.has(n));

  let extra = "";
  if (unavailable.length) extra += ` — لا يوجد عداد لها: ${unavailable.join("، ")}`;
  if (unknown.length) extra += ` — أرقام غير موجودة في قائمة العدادات: ${unknown.join("، ")}`;

  if (!fresh.length) {
    return {
      ok: false,
      msg: "لا توجد معدات قابلة للتسجيل (تأكد أنها في القائمة وحالتها «يوجد عداد»)." + extra,
    };
  }

  const date = meterDateKey();
  try {
    await Promise.all(
      fresh.map((number) =>
        Promise.all([
          setDoc(
            doc(db, "meterReceipts", String(number)),
            { dates: arrayUnion(date), updatedAt: new Date().toISOString() },
            { merge: true },
          ),
          setDoc(
            doc(db, "equipment", String(number)),
            { number, meterAvailable: true, lastReceivedDate: date },
            { merge: true },
          ),
        ]),
      ),
    );
  } catch (err) {
    console.error(err);
    return { ok: false, msg: "حدث خطأ أثناء حفظ وصول العداد." };
  }
  return {
    ok: true,
    msg: `تم تسجيل وصول العداد لـ ${fresh.length} معدة بتاريخ ${meterFmtDate(date)}${extra}`,
  };
}

// زر "تسجيل وصول العدادات" تحت المتابعة اليومية
mEl("registerMetersBtn").addEventListener("click", async () => {
  const nums = [
    ...new Set(
      Object.values(sessionVehicles)
        .flat()
        .map((v) => Number(v.number))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (!nums.length) {
    alert("المتابعة اليومية فارغة");
    return;
  }
  const btn = mEl("registerMetersBtn");
  btn.disabled = true;
  const r = await registerMeterArrivals(nums);
  btn.disabled = false;
  showMetersMessage(r.msg);
  alert((r.ok ? "✅ " : "⚠️ ") + r.msg);
});

// زر التسجيل داخل صفحة وصول العدادات
mEl("mSubmitBtn").addEventListener("click", async () => {
  const nums = extractEquipmentNumbers(mEl("mInput").value);
  if (!nums.length) {
    showMetersMessage("اكتب رقمًا أو مجموعة أرقام صحيحة.");
    return;
  }
  const r = await registerMeterArrivals(nums);
  showMetersMessage(r.msg);
  if (r.ok) {
    mEl("mInput").value = "";
    mEl("mDetected").textContent = "";
  }
});
mEl("mInput").addEventListener("input", () => {
  const nums = extractEquipmentNumbers(mEl("mInput").value);
  mEl("mDetected").innerHTML = "";
  if (nums.length) {
    const b = document.createElement("b");
    b.textContent = nums.length;
    mEl("mDetected").append("تم التعرف على ", b, ` معدة: ${nums.join("-")}`);
  }
});

// ---------- التواريخ والفلاتر ----------
mEl("mFrom").value = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return meterDateKey(d);
})();
mEl("mTo").value = meterDateKey();
["mFrom", "mTo"].forEach((id) =>
  mEl(id).addEventListener("change", () => {
    meterStatus = "all";
    renderMeters();
  }),
);
document
  .querySelectorAll(".meter-stats button, .meter-filters button")
  .forEach((b) =>
    b.addEventListener("click", () => {
      meterStatus = b.dataset.status;
      renderMeters();
    }),
  );
mEl("mSearch").addEventListener("input", (e) => {
  meterSearch = toEnglishDigits(e.target.value.trim());
  renderMeters();
});

// أقسام قابلة للطي
document.querySelectorAll("#page-meters .toggle-head").forEach((h) =>
  h.addEventListener("click", () => {
    const box = mEl(h.dataset.target);
    const open = box.style.display === "none";
    box.style.display = open ? "block" : "none";
    h.querySelector(".arrow").textContent = open ? "▲" : "▼";
    if (open) renderMeters();
  }),
);

// ---------- نسخ وCSV ----------
mEl("mCopyBtn").addEventListener("click", async () => {
  const list = meterFiltered();
  if (!list.length) {
    showMetersMessage("لا توجد أرقام لنسخها.");
    return;
  }
  try {
    await navigator.clipboard.writeText(list.map((e) => e.number).join("-"));
    showMetersMessage(`تم نسخ ${list.length} رقم.`);
  } catch {
    showMetersMessage("تعذر النسخ تلقائيًا. حاول مرة أخرى.");
  }
});
mEl("mCsvBtn").addEventListener("click", () => {
  const { from, to } = meterRange();
  const rows = [
    ["الرقم", "الحالة في الفترة", "آخر تاريخ للعداد"],
    ...meterFiltered().map((e) => [
      String(e.number),
      e.meterAvailable && isReceivedInRange(e.number) ? "جاء عدادها" : "ما جاء عدادها",
      meterFmtDate(getLastDate(e)),
    ]),
  ];
  const blob = new Blob(["\ufeff" + rows.map((r) => r.join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `معدات-${from}-الى-${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- تعديل / حذف معدة من الجدول ----------
mEl("mTable").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const number = Number(btn.dataset.num);
  if (btn.dataset.act === "toggle") await toggleMeterStatus(number);
  else if (btn.dataset.act === "delete") await removeMeterEquipment(number);
});

async function toggleMeterStatus(number) {
  const item = meterEquipment.find((e) => e.number === number);
  if (!item) return;
  const next = !item.meterAvailable;
  try {
    if (!next) {
      await Promise.all([
        setDoc(
          doc(db, "equipment", String(number)),
          { number, meterAvailable: false, lastReceivedDate: null },
          { merge: true },
        ),
        deleteDoc(doc(db, "meterReceipts", String(number))),
      ]);
      showMetersMessage(`تم تعديل المعدة ${number} إلى "لا يوجد عداد" وحذف تاريخ العداد.`);
    } else {
      await setDoc(
        doc(db, "equipment", String(number)),
        { number, meterAvailable: true, lastReceivedDate: null },
        { merge: true },
      );
      showMetersMessage(`تم تعديل المعدة ${number} إلى "يوجد عداد".`);
    }
  } catch (err) {
    console.error(err);
    showMetersMessage("تعذر تعديل حالة المعدة.");
  }
}

async function removeMeterEquipment(number) {
  if (!confirm(`حذف المعدة ${number} من القائمة الأساسية؟`)) return;
  try {
    await Promise.all([
      deleteDoc(doc(db, "equipment", String(number))),
      deleteDoc(doc(db, "meterReceipts", String(number))),
    ]);
    showMetersMessage(`تم حذف ${number}`);
  } catch (err) {
    console.error(err);
    showMetersMessage("حدث خطأ أثناء حذف المعدة.");
  }
}

// ---------- إدارة القائمة الأساسية (إضافة / حذف مجموعة) ----------
mEl("mAddBtn").addEventListener("click", async () => {
  const nums = parseNumbers(mEl("mManageInput").value);
  if (!nums.length) {
    showMetersMessage("اكتب رقمًا أو مجموعة أرقام لإضافتها.");
    return;
  }
  const existing = new Set(meterEquipment.map((e) => e.number));
  const already = nums.filter((n) => existing.has(n));
  const fresh = nums.filter((n) => !existing.has(n));
  if (!fresh.length) {
    mEl("mManageInput").value = "";
    showMetersMessage(`جميع الأرقام المدخلة موجودة مسبقًا: ${already.join("، ")}`);
    return;
  }
  try {
    await Promise.all(
      fresh.map((number) =>
        setDoc(
          doc(db, "equipment", String(number)),
          { number, meterAvailable: true },
          { merge: true },
        ),
      ),
    );
  } catch (err) {
    console.error(err);
    showMetersMessage("تعذر حفظ المعدات في قاعدة البيانات.");
    return;
  }
  mEl("mManageInput").value = "";
  showMetersMessage(
    `تمت إضافة ${fresh.length} معدة` +
      (already.length ? ` — موجودة مسبقًا: ${already.join("، ")}` : ""),
  );
});

mEl("mRemoveBtn").addEventListener("click", async () => {
  const nums = parseNumbers(mEl("mManageInput").value);
  if (!nums.length) {
    showMetersMessage("اكتب رقمًا أو مجموعة أرقام للحذف.");
    return;
  }
  const existing = new Set(meterEquipment.map((e) => e.number));
  const found = nums.filter((n) => existing.has(n));
  const notFound = nums.filter((n) => !existing.has(n));
  if (!found.length) {
    mEl("mManageInput").value = "";
    showMetersMessage(`الأرقام المدخلة غير موجودة في القائمة: ${notFound.join("، ")}`);
    return;
  }
  if (!confirm(`هل أنت متأكد من حذف ${found.length} معدة من القائمة الأساسية؟\n\n${found.join(" - ")}`)) return;
  try {
    await Promise.all(
      found.flatMap((number) => [
        deleteDoc(doc(db, "equipment", String(number))),
        deleteDoc(doc(db, "meterReceipts", String(number))),
      ]),
    );
  } catch (err) {
    console.error(err);
    showMetersMessage("حدث خطأ أثناء حفظ عملية الحذف.");
    return;
  }
  mEl("mManageInput").value = "";
  showMetersMessage(
    `تم حذف ${found.length} معدة` +
      (notFound.length ? ` — غير موجودة: ${notFound.join("، ")}` : ""),
  );
});

// ---------- استيراد البيانات من النظام القديم (مرة واحدة) ----------
mEl("mImportBtn").addEventListener("click", async () => {
  if (
    !confirm(
      "سيتم نسخ قائمة المعدات وسجل وصول العدادات من النظام القديم إلى هذا النظام.\n" +
        "العملية آمنة ويمكن تكرارها (لا تحذف شيئًا من النظام القديم).\n\nهل تريد المتابعة؟",
    )
  )
    return;

  const btn = mEl("mImportBtn");
  btn.disabled = true;
  btn.textContent = "⏳ جاري الاستيراد...";
  try {
    const oldApp =
      getApps().find((a) => a.name === "oldMeters") ||
      initializeApp(OLD_METERS_FIREBASE, "oldMeters");
    await signInAnonymously(getAuth(oldApp));
    const oldDb = getFirestore(oldApp);

    const [eqSnap, rcSnap] = await Promise.all([
      getDocs(collection(oldDb, "equipment")),
      getDocs(collection(oldDb, "meterReceipts")),
    ]);

    const ops = [];
    eqSnap.forEach((d) => {
      const x = d.data();
      const n = Number(x.number);
      if (!Number.isInteger(n)) return;
      const data = { number: n, meterAvailable: x.meterAvailable !== false };
      if (typeof x.lastReceivedDate === "string") data.lastReceivedDate = x.lastReceivedDate;
      ops.push([doc(db, "equipment", String(n)), data]);
    });
    rcSnap.forEach((d) => {
      const dates = Array.isArray(d.data().dates)
        ? d.data().dates.filter((v) => typeof v === "string")
        : [];
      if (!dates.length) return;
      ops.push([
        doc(db, "meterReceipts", d.id),
        { dates: arrayUnion(...dates), updatedAt: new Date().toISOString() },
      ]);
    });

    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data, { merge: true }));
      await batch.commit();
    }
    showMetersMessage(
      `✅ تم الاستيراد: ${eqSnap.size} معدة و${rcSnap.size} سجل وصول عدادات.`,
    );
  } catch (err) {
    console.error(err);
    showMetersMessage("❌ تعذر الاستيراد من النظام القديم: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = "📥 استيراد البيانات من النظام القديم";
  }
});

// =====================================================================
//                     الناف بار الذكي (☰ في الشاشات الصغيرة)
// =====================================================================
const navToggle = document.getElementById("navToggle");
const navMenu = document.getElementById("navMenu");

function closeNavMenu() {
  navMenu.classList.remove("open");
  navToggle.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
}
navToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = navMenu.classList.toggle("open");
  navToggle.classList.toggle("open", open);
  navToggle.setAttribute("aria-expanded", String(open));
});
navMenu.addEventListener("click", (e) => {
  // إغلاق القائمة عند اختيار قسم أو زر (دخول/خروج)
  if (e.target.closest("a, button")) closeNavMenu();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#navbar")) closeNavMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNavMenu();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeNavMenu();
});

renderMeters();

// =====================================================================
//        الرئيسية: شاشتان (النموذج / التقرير) + نقاط التنقل على اليمين
// =====================================================================
(function setupHomeDots() {
  const navbar = document.getElementById("navbar");
  const dots = [...document.querySelectorAll("#homeDots button")];
  const sectionDots = dots.filter((d) => !d.dataset.block);
  const rowDot = dots.find((d) => d.dataset.block);
  const sections = sectionDots.map((d) => document.getElementById(d.dataset.target));
  const rowEl = rowDot ? document.getElementById(rowDot.dataset.target) : null;

  // ارتفاع الناف بار يُستخدم لضبط ارتفاع الشاشة وموضع التمرير
  const setNavH = () =>
    document.documentElement.style.setProperty("--nav-h", navbar.offsetHeight + "px");
  setNavH();
  window.addEventListener("resize", setNavH);

  dots.forEach((d) =>
    d.addEventListener("click", () =>
      document
        .getElementById(d.dataset.target)
        .scrollIntoView({ behavior: "smooth", block: d.dataset.block || "start" }),
    ),
  );

  // تمييز النقطة الخاصة بالمكان الظاهر
  let sectionActive = sections[0].id;
  let rowActive = false;
  const refresh = () => {
    const activeId = rowActive && rowDot ? rowDot.dataset.target : sectionActive;
    dots.forEach((d) => d.classList.toggle("active", d.dataset.target === activeId));
  };
  const opts = { rootMargin: "-45% 0px -50% 0px" };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) sectionActive = en.target.id;
    });
    refresh();
  }, opts);
  sections.forEach((sec) => io.observe(sec));
  if (rowEl) {
    new IntersectionObserver((entries) => {
      entries.forEach((en) => (rowActive = en.isIntersecting));
      refresh();
    }, opts).observe(rowEl);
  }
})();

// =====================================================================
//                     أنواع المعدات (إضافة / تعديل / حذف + الممشى)
// =====================================================================
function renderTypeSelect() {
  const cur = typeSelect.value;
  typeSelect.innerHTML = "";
  equipmentTypes.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.name;
    o.textContent = t.name;
    typeSelect.appendChild(o);
  });
  const other = document.createElement("option");
  other.value = "اخرى";
  other.textContent = "أخرى";
  typeSelect.appendChild(other);
  if ([...typeSelect.options].some((o) => o.value === cur)) typeSelect.value = cur;
  typeOther.style.display = typeSelect.value === "اخرى" ? "block" : "none";
}

function sanitizeTypes(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((t) => {
    const name = String(t?.name ?? "").trim();
    if (!name || name === "اخرى" || name === "أخرى" || seen.has(name)) return;
    seen.add(name);
    out.push({ name, interval: Math.max(0, Number(t.interval) || 0) });
  });
  return out;
}

// تحديث كل ما يعتمد على الأنواع (القائمة + الألوان المحسوبة)
function afterTypesChanged() {
  renderTypeSelect();
  updateKmDiffLive();
  autosaveSkipOnce = true; // إعادة الرسم لا تعني تعديل المتابعة
  updateOutput();
  if (isStaff() && allVehiclesData.length) renderVehicles(null, "");
}

async function loadEquipmentTypes() {
  let ok = false;
  try {
    const snap = await getDoc(doc(db, "settings", "equipmentTypes"));
    if (snap.exists() && Array.isArray(snap.data().types)) {
      const list = sanitizeTypes(snap.data().types);
      if (list.length) equipmentTypes = list;
    }
    ok = true;
  } catch (err) {
    console.warn("تعذر تحميل أنواع المعدات، سيتم استخدام القائمة الافتراضية", err);
  }
  afterTypesChanged();
  return ok;
}

// ---------- صفحة إدارة الأنواع ----------
let typesDraft = []; // [{orig, name, interval}]

function resetTypesDraft() {
  typesDraft = equipmentTypes.map((t) => ({ orig: t.name, name: t.name, interval: t.interval }));
  renderTypesManager();
}

function renderTypesManager() {
  const list = document.getElementById("typesList");
  if (!list) return;
  list.innerHTML = "";
  typesDraft.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "type-row";

    const nameIn = document.createElement("input");
    nameIn.value = row.name;
    nameIn.placeholder = "اسم النوع";
    nameIn.disabled = !isAdmin; // مشاهدة فقط
    nameIn.addEventListener("input", () => (row.name = nameIn.value));

    const kmIn = document.createElement("input");
    kmIn.type = "number";
    kmIn.min = "0";
    kmIn.value = row.interval;
    kmIn.placeholder = "مثال: 5000";
    kmIn.disabled = !isAdmin;
    kmIn.addEventListener("input", () => (row.interval = kmIn.value));

    const count = document.createElement("span");
    count.className = "type-count";
    const n = row.orig ? allVehiclesData.filter((v) => v.data.type === row.orig).length : 0;
    count.textContent = row.orig ? n : "جديد";

    const del = document.createElement("button");
    del.className = "meter-icon danger admin-only";
    del.title = "حذف النوع";
    del.textContent = "🗑";
    del.addEventListener("click", () => {
      typesDraft.splice(i, 1);
      renderTypesManager();
    });

    div.append(nameIn, kmIn, count, del);
    list.appendChild(div);
  });
}

document.getElementById("typeAddRowBtn").addEventListener("click", () => {
  typesDraft.push({ orig: null, name: "", interval: 0 });
  renderTypesManager();
  const inputs = document.querySelectorAll("#typesList .type-row input");
  inputs[inputs.length - 2]?.focus();
});

document.getElementById("typesSaveBtn").addEventListener("click", async () => {
  const rows = typesDraft.map((r) => ({
    orig: r.orig,
    name: String(r.name).trim(),
    interval: Math.max(0, Number(r.interval) || 0),
  }));

  // تحقق
  if (rows.some((r) => !r.name)) {
    alert("يوجد نوع بدون اسم. اكتب الاسم أو احذف السطر.");
    return;
  }
  if (rows.some((r) => r.name === "اخرى" || r.name === "أخرى")) {
    alert("الاسم «أخرى» محجوز للنظام، اختر اسمًا ثانيًا.");
    return;
  }
  const names = rows.map((r) => r.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) {
    alert(`الاسم «${dup}» مكرر.`);
    return;
  }

  // تغيير الأسماء → ننقل المعدات المسجلة للاسم الجديد
  const renames = rows
    .filter((r) => r.orig && r.orig !== r.name)
    .map((r) => ({
      from: r.orig,
      to: r.name,
      ids: allVehiclesData.filter((v) => v.data.type === r.orig).map((v) => v.id),
    }));
  const renamedCount = renames.reduce((a, r) => a + r.ids.length, 0);

  // أنواع محذوفة ما زالت عليها معدات
  const keptOrigs = new Set(rows.map((r) => r.orig).filter(Boolean));
  const removed = equipmentTypes
    .filter((t) => !keptOrigs.has(t.name))
    .map((t) => ({ name: t.name, n: allVehiclesData.filter((v) => v.data.type === t.name).length }))
    .filter((r) => r.n > 0);

  let msg = "حفظ تغييرات أنواع المعدات؟";
  if (renamedCount) msg += `\n\n✏️ سيتم تحديث نوع ${renamedCount} معدة مسجلة للأسماء الجديدة.`;
  if (removed.length)
    msg +=
      "\n\n🗑 أنواع محذوفة عليها معدات (ستبقى المعدات باسمها القديم وتظهر تحت «أخرى» عند التعديل):\n" +
      removed.map((r) => `• ${r.name} (${r.n})`).join("\n");
  if (!confirm(msg)) return;

  const btn = document.getElementById("typesSaveBtn");
  btn.disabled = true;
  try {
    // 1) نقل المعدات للأسماء الجديدة
    const ops = renames.flatMap((r) => r.ids.map((id) => ({ id, to: r.to })));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach((o) => batch.update(doc(db, "vehicles", o.id), { type: o.to }));
      await batch.commit();
    }
    // 2) حفظ قائمة الأنواع
    const list = sanitizeTypes(rows);
    await setDoc(doc(db, "settings", "equipmentTypes"), { types: list, updatedAt: new Date() });
    equipmentTypes = list;
    typesReady = Promise.resolve(true);
    await loadVehicles();
    afterTypesChanged();
    await syncStatusColors(); // الحدود أو الأسماء تغيّرت: تحديث ألوان المعدات المتأثرة
    resetTypesDraft();
    alert("✅ تم حفظ أنواع المعدات");
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحفظ: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
//         زر: نسخ المعدات الحمراء (من المركبات المخزنة وليس المتابعة)
// =====================================================================
document.getElementById("copyRedStoredBtn").addEventListener("click", () => {
  const btn = document.getElementById("copyRedStoredBtn");
  if (!allVehiclesData.length) {
    alert("قائمة المركبات المخزنة غير محمّلة أو فارغة");
    return;
  }
  const reds = allVehiclesData.filter((v) =>
    getStatusEmoji(v.data.type, v.data.currentKm, v.data.lastKm, v.data.manualColor).includes("🔴"),
  );
  if (!reds.length) {
    alert("لا توجد معدات حمراء (تحتاج تغيير زيت) في المركبات المخزنة");
    return;
  }
  const items = reds.map((v) => ({ type: v.data.type, number: v.id, data: v.data }));
  navigator.clipboard.writeText(
    buildTextFromItems(items, new Date(), "المعدات التي تحتاج تغيير زيت 🔴"),
  );
  const old = btn.textContent;
  btn.textContent = `✔ تم نسخ ${reds.length} معدة`;
  setTimeout(() => (btn.textContent = old), 1800);
});

renderTypeSelect();

// =====================================================================
//                    أدوات بناء العناصر (آمنة من حقن HTML)
// =====================================================================
function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    e.append(c instanceof Node ? c : String(c));
  });
  return e;
}
function fmtAnyDate(v) {
  const d = tsToDate(v);
  return d && !isNaN(d) ? fmtDateTime(d) : "—";
}

// =====================================================================
//                 إدارة المستخدمين (للمالك فقط)
// =====================================================================
let usersList = [];
let usersUnsub = null;

function startUsersWatch() {
  stopUsersWatch();
  usersUnsub = onSnapshot(
    collection(db, "users"),
    (snap) => {
      usersList = snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
      if (currentPage === "users") renderUsersList();
      if (currentPage === "audit") renderAuditFilters();
    },
    (err) => console.error("تعذر تحميل المستخدمين", err),
  );
}
function stopUsersWatch() {
  usersUnsub?.();
  usersUnsub = null;
  usersList = [];
}

function renderUsersPage() {
  const on = document.getElementById("ownerNameInput");
  if (on && document.activeElement !== on) on.value = ownerName;
  renderUsersList();
}

function permChips(perms = {}) {
  return h(
    "div",
    { class: "perm-chips" },
    SECTIONS.map((s) => {
      const p = perms[s.key] === "edit" || perms[s.key] === "view" ? perms[s.key] : "hidden";
      return h("span", { class: `perm-chip perm-${p}`, text: `${s.label}: ${PERM_LABELS[p]}` });
    }),
  );
}

function renderUsersList() {
  const list = document.getElementById("usersList");
  if (!list) return;
  list.innerHTML = "";
  if (!usersList.length) {
    list.append(h("div", { class: "guest-empty", text: "لا يوجد مستخدمين بعد. اضغط «مستخدم جديد»." }));
    return;
  }
  usersList.forEach((u) => {
    const status = u.disabled
      ? h("span", { class: "user-badge off", text: "⛔ موقوف" })
      : h("span", { class: "user-badge on", text: "✅ مفعّل" });
    list.append(
      h(
        "div",
        { class: "user-card" + (u.disabled ? " disabled" : "") },
        h(
          "div",
          { class: "user-info" },
          h("div", { class: "user-name" }, u.name || "بدون اسم", " ", status),
          h("div", { class: "user-meta", text: `${u.email || ""} · أُنشئ ${fmtAnyDate(u.createdAt)}` }),
          permChips(u.permissions),
        ),
        h(
          "div",
          { class: "user-btns" },
          h("button", { class: "btn-sm btn-blue", text: "✏️ تعديل", onclick: () => openUserModal(u) }),
          h("button", {
            class: "btn-sm btn-gray",
            text: u.disabled ? "▶️ تشغيل" : "⏸ إيقاف",
            onclick: () => toggleUserDisabled(u),
          }),
          h("button", { class: "btn-sm btn-gray", text: "🔑 رابط كلمة المرور", onclick: () => sendUserReset(u) }),
          h("button", { class: "btn-sm btn-red", text: "🗑 حذف", onclick: () => deleteUserProfile(u) }),
        ),
      ),
    );
  });
}

// ---------- اسم المالك ----------
document.getElementById("ownerNameSaveBtn").addEventListener("click", async () => {
  if (!isOwner) return;
  const v = document.getElementById("ownerNameInput").value.trim();
  try {
    await setDoc(doc(db, "settings", "audit"), { ownerName: v }, { merge: true });
    alert("✅ تم حفظ اسم المالك");
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحفظ: " + (err.code || err.message));
  }
});

// ---------- نافذة مستخدم جديد / تعديل ----------
const userModal = document.getElementById("userModal");
let userModalUid = null; // null = مستخدم جديد
let userModalPerms = {};

function renderPermGrid() {
  const grid = document.getElementById("umPerms");
  grid.innerHTML = "";
  SECTIONS.forEach((s) => {
    const cur = userModalPerms[s.key] || "hidden";
    grid.append(
      h(
        "div",
        { class: "perm-row" },
        h("span", { class: "perm-label", text: s.label }),
        h(
          "div",
          { class: "perm-btns" },
          ["hidden", "view", "edit"].map((p) =>
            h("button", {
              type: "button",
              class: `perm-btn perm-${p}` + (cur === p ? " selected" : ""),
              text: PERM_LABELS[p],
              onclick: () => {
                userModalPerms[s.key] = p;
                renderPermGrid();
              },
            }),
          ),
        ),
      ),
    );
  });
}

function openUserModal(u) {
  userModalUid = u ? u.uid : null;
  userModalPerms = {};
  SECTIONS.forEach((s) => {
    const p = u?.permissions?.[s.key];
    userModalPerms[s.key] = p === "edit" || p === "view" ? p : "hidden";
  });
  document.getElementById("umTitle").textContent = u ? "✏️ تعديل مستخدم" : "➕ مستخدم جديد";
  document.getElementById("umName").value = u?.name || "";
  document.getElementById("umEmail").value = u?.email || "";
  document.getElementById("umPassword").value = "";
  document.getElementById("umNewOnly").style.display = u ? "none" : "";
  document.getElementById("umEmailNote").style.display = u ? "" : "none";
  document.getElementById("umEmail").disabled = !!u;
  document.getElementById("umError").textContent = "";
  renderPermGrid();
  userModal.hidden = false;
  document.getElementById("umName").focus();
}
function closeUserModal() {
  userModal.hidden = true;
  document.getElementById("umPassword").value = "";
}
document.getElementById("newUserBtn").addEventListener("click", () => openUserModal(null));
document.getElementById("umCancelBtn").addEventListener("click", closeUserModal);
userModal.addEventListener("click", (e) => {
  if (e.target === userModal) closeUserModal();
});
document.querySelectorAll("#userModal [data-all]").forEach((b) =>
  b.addEventListener("click", () => {
    SECTIONS.forEach((s) => (userModalPerms[s.key] = b.dataset.all));
    renderPermGrid();
  }),
);

// إنشاء الحساب عن طريق Firebase App ثاني منفصل، عشان المالك ما يطلع من حسابه
let creatorAuth = null;
function getCreatorAuth() {
  if (creatorAuth) return creatorAuth;
  const app2 = getApps().find((a) => a.name === "userCreator") || initializeApp(firebaseConfig, "userCreator");
  try {
    creatorAuth = initializeAuth(app2, { persistence: inMemoryPersistence });
  } catch {
    creatorAuth = getAuth(app2);
  }
  return creatorAuth;
}

function createUserErrorText(code) {
  switch (code) {
    case "auth/email-already-in-use":
      return "الإيميل مستخدم مسبقًا. إذا كان لمستخدم محذوف، احذف حسابه من Firebase Authentication أولًا.";
    case "auth/invalid-email":
      return "صيغة الإيميل غير صحيحة";
    case "auth/weak-password":
      return "كلمة المرور ضعيفة (6 أحرف على الأقل)";
    case "auth/network-request-failed":
      return "تعذر الاتصال بالإنترنت";
    default:
      return "تعذر إنشاء الحساب: " + (code || "");
  }
}

document.getElementById("umSaveBtn").addEventListener("click", async () => {
  if (!isOwner) return;
  const errEl = document.getElementById("umError");
  const name = document.getElementById("umName").value.trim();
  const email = document.getElementById("umEmail").value.trim().toLowerCase();
  const password = document.getElementById("umPassword").value;
  const permissions = { ...userModalPerms };
  errEl.textContent = "";
  if (!name) return (errEl.textContent = "اكتب الاسم");

  const btn = document.getElementById("umSaveBtn");
  btn.disabled = true;
  try {
    if (userModalUid) {
      await setDoc(doc(db, "users", userModalUid), { name, permissions }, { merge: true });
      closeUserModal();
      alert("✅ تم تحديث المستخدم، والصلاحيات تنطبق عليه فورًا");
      return;
    }
    if (!email) return (errEl.textContent = "اكتب الإيميل");
    if (OWNER_EMAILS.includes(email)) return (errEl.textContent = "هذا إيميل المالك");
    if (password.length < 6) return (errEl.textContent = "كلمة المرور 6 أحرف على الأقل");

    const a2 = getCreatorAuth();
    let uid;
    try {
      const cred = await createUserWithEmailAndPassword(a2, email, password);
      uid = cred.user.uid;
    } catch (err) {
      errEl.textContent = createUserErrorText(err.code);
      return;
    }
    try {
      await setDoc(doc(db, "users", uid), {
        name,
        email,
        permissions,
        disabled: false,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error(err);
      errEl.textContent =
        "تم إنشاء الحساب في Firebase Authentication لكن تعذر حفظ ملفه. احذفه من Authentication وأعد المحاولة. (" +
        (err.code || err.message) +
        ")";
      return;
    } finally {
      signOut(a2).catch(() => {});
    }
    closeUserModal();
    alert(`✅ تم إنشاء حساب ${name}`);
  } finally {
    btn.disabled = false;
  }
});

async function toggleUserDisabled(u) {
  const next = !u.disabled;
  if (next && !confirm(`إيقاف حساب ${u.name || u.email}؟\nسيطلع من الموقع فورًا ولن يقدر يعدّل شي.`)) return;
  try {
    await updateDoc(doc(db, "users", u.uid), { disabled: next });
  } catch (err) {
    console.error(err);
    alert("❌ تعذر التعديل: " + (err.code || err.message));
  }
}

async function sendUserReset(u) {
  if (!u.email) return alert("لا يوجد إيميل لهذا المستخدم");
  if (!confirm(`إرسال رابط تغيير كلمة المرور إلى ${u.email}؟`)) return;
  try {
    await sendPasswordResetEmail(auth, u.email);
    alert("✅ تم إرسال الرابط على إيميله (قد يصل في مجلد الرسائل غير المرغوبة)");
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الإرسال: " + (err.code || err.message));
  }
}

async function deleteUserProfile(u) {
  if (
    !confirm(
      `حذف المستخدم ${u.name || u.email}؟\n\n` +
        "• يُحذف ملفه وصلاحياته من النظام، فما يقدر يدخل أي قسم (ولو سجّل دخول يطلع تلقائيًا).\n" +
        "• حسابه (الإيميل وكلمة المرور) يظل في Firebase Authentication، واحذفه من هناك يدويًا إذا تبغى.",
    )
  )
    return;
  try {
    await deleteDoc(doc(db, "users", u.uid));
    alert(
      "🗑 تم حذف المستخدم من النظام.\n\nتذكير: احذف حسابه يدويًا من Firebase Console ← Authentication ← Users إذا تبغى تستخدم نفس الإيميل مرة ثانية.",
    );
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحذف: " + (err.code || err.message));
  }
}

// =====================================================================
//                     صفحة سجل التعديلات (للمالك فقط)
// =====================================================================
const AUDIT_PAGE_SIZE = 200;
const AUDIT_ACTIONS = {
  create: { label: "إنشاء", cls: "create" },
  update: { label: "تعديل", cls: "update" },
  delete: { label: "حذف", cls: "delete" },
};
let auditEntries = [];
let auditLastDoc = null;
let auditHasMore = false;
let auditLoading = false;
const auditSelected = new Set();
const auditOpen = new Set();

function renderAuditToggle() {
  const btn = document.getElementById("auditToggleBtn");
  if (!btn) return;
  btn.textContent = auditEnabled ? "🟢 السجل شغّال — اضغط للإيقاف" : "⏸ السجل موقوف — اضغط للتشغيل";
  btn.className = auditEnabled ? "btn-green" : "btn-gray";
}

document.getElementById("auditToggleBtn").addEventListener("click", async () => {
  if (!isOwner) return;
  const next = !auditEnabled;
  if (!next && !confirm("إيقاف السجل؟ وهو موقوف ما ينكتب أي تعديل.")) return;
  try {
    await setDoc(doc(db, "settings", "audit"), { enabled: next }, { merge: true });
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحفظ: " + (err.code || err.message));
  }
});

async function refreshAuditCount() {
  const el = document.getElementById("auditCount");
  try {
    const c = await getCountFromServer(collection(db, "auditLog"));
    el.textContent = c.data().count;
  } catch (err) {
    console.error(err);
    el.textContent = "—";
  }
}

async function loadAuditPage(reset) {
  if (!isOwner || auditLoading) return;
  auditLoading = true;
  renderAuditToggle();
  if (reset) {
    auditEntries = [];
    auditLastDoc = null;
    auditSelected.clear();
    auditOpen.clear();
    document.getElementById("auditList").textContent = "جاري التحميل...";
  }
  try {
    const parts = [collection(db, "auditLog"), orderBy("at", "desc")];
    if (auditLastDoc) parts.push(startAfter(auditLastDoc));
    parts.push(limit(AUDIT_PAGE_SIZE));
    const snap = await getDocs(query(...parts));
    snap.docs.forEach((d) => auditEntries.push({ id: d.id, ...d.data() }));
    if (snap.docs.length) auditLastDoc = snap.docs[snap.docs.length - 1];
    auditHasMore = snap.docs.length === AUDIT_PAGE_SIZE;
  } catch (err) {
    console.error(err);
    document.getElementById("auditList").textContent = "تعذر تحميل السجل: " + (err.code || err.message);
    auditLoading = false;
    return;
  }
  auditLoading = false;
  refreshAuditCount();
  renderAuditFilters();
  renderAuditList();
}

function renderAuditFilters() {
  const uSel = document.getElementById("auditUserFilter");
  const sSel = document.getElementById("auditSectionFilter");
  if (!uSel || !sSel) return;
  const curU = uSel.value;
  const curS = sSel.value;
  const users = new Map();
  usersList.forEach((u) => users.set(u.uid, u.name || u.email));
  auditEntries.forEach((e) => {
    if (e.uid && !users.has(e.uid)) users.set(e.uid, e.name || e.email || e.uid);
  });
  uSel.innerHTML = "";
  uSel.append(h("option", { value: "", text: "كل المستخدمين" }));
  [...users.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "ar"))
    .forEach(([uid, name]) => uSel.append(h("option", { value: uid, text: name })));
  uSel.value = [...uSel.options].some((o) => o.value === curU) ? curU : "";

  sSel.innerHTML = "";
  sSel.append(h("option", { value: "", text: "كل الأقسام" }));
  Object.entries(PAGE_LABELS).forEach(([k, label]) => sSel.append(h("option", { value: k, text: label })));
  sSel.value = curS;
}

function auditFiltered() {
  const u = document.getElementById("auditUserFilter").value;
  const s = document.getElementById("auditSectionFilter").value;
  const term = document.getElementById("auditSearch").value.trim().toLowerCase();
  return auditEntries.filter((e) => {
    if (u && e.uid !== u) return false;
    if (s && e.sectionKey !== s) return false;
    if (term) {
      const hay = [
        e.name,
        e.email,
        e.record,
        e.section,
        AUDIT_ACTIONS[e.action]?.label,
        ...(e.changes || []).flatMap((c) => [c.row, c.field, c.before, c.after]),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

function renderAuditList() {
  const list = document.getElementById("auditList");
  list.innerHTML = "";
  const rows = auditFiltered();
  document.getElementById("auditShown").textContent = `المعروض: ${rows.length} من ${auditEntries.length} محمّل`;
  document.getElementById("auditDelSelBtn").textContent = `🗑 حذف المحدد (${auditSelected.size})`;
  if (!rows.length) {
    list.append(h("div", { class: "guest-empty", text: "لا توجد سجلات" }));
  }
  rows.forEach((e) => {
    const act = AUDIT_ACTIONS[e.action] || { label: e.action || "—", cls: "update" };
    const isOpen = auditOpen.has(e.id);
    const cb = h("input", {
      type: "checkbox",
      checked: auditSelected.has(e.id),
      onclick: (ev) => ev.stopPropagation(),
      onchange: (ev) => {
        ev.target.checked ? auditSelected.add(e.id) : auditSelected.delete(e.id);
        document.getElementById("auditDelSelBtn").textContent = `🗑 حذف المحدد (${auditSelected.size})`;
      },
    });
    const head = h(
      "div",
      {
        class: "audit-head",
        onclick: () => {
          isOpen ? auditOpen.delete(e.id) : auditOpen.add(e.id);
          renderAuditList();
        },
      },
      cb,
      h("b", { class: "audit-name", text: e.name || e.email || "—" }),
      h("span", { class: `audit-action ${act.cls}`, text: act.label }),
      h("span", { class: "audit-record", text: e.record || "" }),
      h("span", { class: "audit-section", text: e.section || "" }),
      h("span", { class: "audit-time", text: fmtAnyDate(e.at) }),
      h("span", { class: "audit-count", text: `${e.changeCount ?? (e.changes || []).length} تغيير` }),
      h("span", { class: "audit-arrow", text: isOpen ? "▲" : "▼" }),
    );
    const row = h("div", { class: "audit-row" }, head);
    if (isOpen) {
      row.append(
        h(
          "div",
          { class: "audit-table-wrap" },
          h(
            "table",
            { class: "audit-table" },
            h("thead", {}, h("tr", {}, ["الصف", "الخانة", "قبل", "بعد"].map((t) => h("th", { text: t })))),
            h(
              "tbody",
              {},
              (e.changes || []).map((c) =>
                h(
                  "tr",
                  {},
                  h("td", { text: c.row || "—" }),
                  h("td", { text: c.field || "" }),
                  h("td", { class: "before", text: c.before || "" }),
                  h("td", { class: "after", text: c.after || "" }),
                ),
              ),
            ),
          ),
          e.email ? h("div", { class: "audit-email", text: e.email }) : null,
        ),
      );
    }
    list.append(row);
  });
  document.getElementById("auditMoreBtn").style.display = auditHasMore ? "" : "none";
}

["auditUserFilter", "auditSectionFilter"].forEach((id) =>
  document.getElementById(id).addEventListener("change", renderAuditList),
);
document.getElementById("auditSearch").addEventListener("input", renderAuditList);
document.getElementById("auditMoreBtn").addEventListener("click", () => loadAuditPage(false));
document.getElementById("auditReloadBtn").addEventListener("click", () => loadAuditPage(true));
document.getElementById("auditSelectShownBtn").addEventListener("click", () => {
  const shown = auditFiltered();
  const allSel = shown.length && shown.every((e) => auditSelected.has(e.id));
  shown.forEach((e) => (allSel ? auditSelected.delete(e.id) : auditSelected.add(e.id)));
  renderAuditList();
});

// حذف على دفعات (400 لكل دفعة) عشان يشتغل لو السجل كبير
async function deleteAuditRefs(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}
async function deleteAuditByQuery(makeQuery, btn) {
  let total = 0;
  const old = btn.textContent;
  btn.disabled = true;
  try {
    for (;;) {
      const snap = await getDocs(makeQuery());
      if (!snap.docs.length) break;
      await deleteAuditRefs(snap.docs.map((d) => d.ref));
      total += snap.docs.length;
      btn.textContent = `⏳ تم حذف ${total}...`;
      if (snap.docs.length < 400) break;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
  return total;
}

document.getElementById("auditDelSelBtn").addEventListener("click", async () => {
  if (!auditSelected.size) return alert("ما حددت أي سجل");
  if (!confirm(`حذف ${auditSelected.size} سجل نهائيًا؟`)) return;
  try {
    await deleteAuditRefs([...auditSelected].map((id) => doc(db, "auditLog", id)));
    alert("🗑 تم الحذف");
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحذف: " + (err.code || err.message));
  }
  loadAuditPage(true);
});

document.getElementById("auditDelOldBtn").addEventListener("click", async (ev) => {
  const days = Number(document.getElementById("auditOldDays").value);
  if (!Number.isFinite(days) || days < 1) return alert("اكتب عدد أيام صحيح (1 أو أكثر)");
  const cutoff = new Date(Date.now() - days * 86400000);
  if (!confirm(`حذف كل السجلات الأقدم من ${days} يوم (قبل ${fmtDateTime(cutoff)})؟`)) return;
  try {
    const n = await deleteAuditByQuery(
      () => query(collection(db, "auditLog"), where("at", "<", cutoff), limit(400)),
      ev.currentTarget,
    );
    alert(`🗑 تم حذف ${n} سجل`);
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحذف: " + (err.code || err.message));
  }
  loadAuditPage(true);
});

document.getElementById("auditDelAllBtn").addEventListener("click", async (ev) => {
  if (!confirm("حذف كل السجلات نهائيًا؟\nلا يمكن التراجع.")) return;
  if (!confirm("متأكد؟ سيتم حذف السجل بالكامل.")) return;
  try {
    const n = await deleteAuditByQuery(() => query(collection(db, "auditLog"), limit(400)), ev.currentTarget);
    alert(`🗑 تم حذف ${n} سجل`);
  } catch (err) {
    console.error(err);
    alert("❌ تعذر الحذف: " + (err.code || err.message));
  }
  loadAuditPage(true);
});

updateFollowupStatus();
route();
