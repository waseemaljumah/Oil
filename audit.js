// =====================================================================
//   سجل التعديلات (Audit Log)
//   نسخ من setDoc / updateDoc / deleteDoc / writeBatch بنفس الشكل والاستخدام:
//   تقرأ البيانات قبل الحفظ (من الكاش أولًا ثم من السيرفر)، تحفظ، ثم تقارن
//   قبل وبعد وتكتب سطرًا في مجموعة auditLog.
//   فشل كتابة السجل لا يوقف الحفظ الأصلي أبدًا.
// =====================================================================
import {
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  writeBatch as fsWriteBatch,
  getDoc,
  getDocFromCache,
  addDoc,
  collection,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const MAX_TEXT = 160; // أقصى طول للنص في السجل
const MAX_CHANGES = 300; // أقصى عدد تغييرات في سطر واحد (حماية من تجاوز حجم المستند)
const EXCLUDED_COLLECTIONS = new Set(["auditLog"]);
// خانات تتغير لحالها (الأوقات والترتيب والقيم المحسوبة تلقائيًا) — لا تُسجَّل
const IGNORED_FIELDS = new Set([
  "updatedAt",
  "createdAt",
  "currentKmUpdatedAt",
  "lastUpdated",
  "timestamp",
  "order",
  "sortOrder",
  "position",
  "statusColor",
]);
const ROW_KEYS = ["id", "number", "name"]; // مفاتيح تمييز الصفوف داخل القوائم (بالترتيب)

const cfg = {
  db: null,
  actor: () => null, // {uid, name, email} أو null
  section: () => "", // مفتاح القسم الحالي
  sectionLabel: (k) => k,
  enabled: () => true,
  recordName: (col, id) => `${col}/${id}`,
  fieldLabel: (path) => path,
  formatValue: () => undefined, // (path, value) => نص أو undefined للتنسيق الافتراضي
};

export function initAudit(options) {
  Object.assign(cfg, options);
}

// ---------------------------------------------------------------------
//                         أدوات مساعدة
// ---------------------------------------------------------------------
const topCollection = (ref) => ref.path.split("/")[0];
const lastSeg = (path) => String(path).split(".").pop();
const isIgnoredKey = (k) => IGNORED_FIELDS.has(lastSeg(k));
const isPlainObj = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !isTimestamp(v) && !(v instanceof Date);
function isTimestamp(v) {
  return v && typeof v === "object" && typeof v.toDate === "function";
}

function shouldLog(ref) {
  try {
    return !EXCLUDED_COLLECTIONS.has(topCollection(ref)) && !!cfg.actor() && cfg.enabled() !== false;
  } catch {
    return false;
  }
}

// هل كل الخانات المرسلة من الخانات المتجاهلة؟ (مثل تحديث statusColor فقط) — نتخطى القراءة والسجل
function onlyIgnored(data) {
  if (!isPlainObj(data)) return false;
  const keys = Object.keys(data);
  return keys.length > 0 && keys.every((k) => isIgnoredKey(k.split(".")[0]) || isIgnoredKey(k));
}

// قراءة آمنة: من الكاش أولًا ثم من السيرفر. لا ترمي خطأ أبدًا.
async function readSafe(ref) {
  try {
    const c = await getDocFromCache(ref);
    if (c.exists()) return { ok: true, data: c.data() };
  } catch {
    /* غير موجود في الكاش */
  }
  try {
    const s = await getDoc(ref);
    return { ok: true, data: s.exists() ? s.data() : null };
  } catch (err) {
    console.warn("السجل: تعذرت قراءة البيانات", ref.path, err);
    return { ok: false, data: null };
  }
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function normalize(v) {
  if (isTimestamp(v)) return fmtDate(v.toDate());
  if (v instanceof Date) return fmtDate(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (isPlainObj(v)) {
    const o = {};
    Object.keys(v)
      .sort()
      .forEach((k) => (o[k] = normalize(v[k])));
    return o;
  }
  return v;
}
const same = (a, b) => JSON.stringify(normalize(a) ?? null) === JSON.stringify(normalize(b) ?? null);

function isImageStr(v) {
  return (
    typeof v === "string" &&
    (/^data:image\//i.test(v) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg|heic)(\?|#|$)/i.test(v))
  );
}
function isImageVal(v) {
  if (isImageStr(v)) return true;
  if (Array.isArray(v) && v.length && v.every((x) => isImageStr(x) || (isPlainObj(x) && Object.values(x).some(isImageStr))))
    return true;
  return false;
}
function imageLabel(v) {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return "";
  return `${Array.isArray(v) ? v.length : 1} صورة`;
}

const trunc = (s) => {
  s = String(s ?? "");
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s;
};

function fmt(path, v) {
  const custom = cfg.formatValue(path, v);
  if (custom !== undefined) return trunc(custom);
  if (v === undefined || v === null || v === "") return "";
  if (isImageVal(v)) return imageLabel(v);
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (isTimestamp(v) || v instanceof Date) return normalize(v);
  if (Array.isArray(v)) {
    if (v.every((x) => !isPlainObj(x) && !Array.isArray(x))) return trunc(v.map((x) => fmt(path, x)).join("، "));
    return `${v.length} صف`;
  }
  if (isPlainObj(v)) return trunc(summarize(v));
  return trunc(v);
}

// وصف مختصر لصف (أول خانات بسيطة فيه)
function summarize(obj) {
  const parts = [];
  for (const [k, val] of Object.entries(obj)) {
    if (isIgnoredKey(k)) continue;
    if (isPlainObj(val) || (Array.isArray(val) && !isImageVal(val))) continue;
    const f = fmt(k, val);
    if (f !== "") parts.push(`${cfg.fieldLabel(k)}: ${f}`);
    if (parts.length >= 4) break;
  }
  return parts.join("، ");
}

// اختيار مفتاح يميّز صفوف القائمة (id ثم number ثم name) — لازم يكون موجود وفريد
function pickRowKey(A, B) {
  const all = A.concat(B);
  if (!all.length || !all.every(isPlainObj)) return null;
  for (const key of ROW_KEYS) {
    const ok = [A, B].every((arr) => {
      const vals = arr.map((x) => x[key]);
      return (
        vals.every((v) => (typeof v === "string" || typeof v === "number") && v !== "") &&
        new Set(vals.map(String)).size === vals.length
      );
    });
    if (ok) return key;
  }
  return null;
}

function joinRow(outer, inner) {
  return outer && outer !== "—" ? `${outer} / ${inner}` : String(inner);
}

// ---------------------------------------------------------------------
//                            المقارنة
// ---------------------------------------------------------------------
function diff(path, a, b, out, row) {
  if (path && isIgnoredKey(path)) return;
  if (same(a, b)) return;
  const push = (before, after) =>
    out.push({ row: row || "—", field: cfg.fieldLabel(path), before: trunc(before), after: trunc(after) });

  if (isImageVal(a) || isImageVal(b)) return push(imageLabel(a), imageLabel(b));

  if (Array.isArray(a) || Array.isArray(b)) {
    const A = Array.isArray(a) ? a : [];
    const B = Array.isArray(b) ? b : [];
    const primitives = A.concat(B).every((x) => !isPlainObj(x) && !Array.isArray(x));
    if (primitives) {
      // قائمة قيم بسيطة: نسجّل المضاف والمحذوف فقط
      const sa = new Set(A.map((x) => JSON.stringify(normalize(x))));
      const sb = new Set(B.map((x) => JSON.stringify(normalize(x))));
      const removed = A.filter((x) => !sb.has(JSON.stringify(normalize(x))));
      const added = B.filter((x) => !sa.has(JSON.stringify(normalize(x))));
      if (!removed.length && !added.length) return; // تغيّر الترتيب فقط
      return push(fmt(path, removed), fmt(path, added));
    }
    const key = pickRowKey(A, B);
    if (key) {
      const mA = new Map(A.map((x) => [String(x[key]), x]));
      const mB = new Map(B.map((x) => [String(x[key]), x]));
      mB.forEach((item, k) => {
        if (!mA.has(k))
          out.push({ row: joinRow(row, k), field: "صف جديد", before: "", after: trunc(summarize(item)) });
      });
      mA.forEach((item, k) => {
        if (!mB.has(k))
          out.push({ row: joinRow(row, k), field: "حذف صف", before: trunc(summarize(item)), after: "" });
      });
      mA.forEach((item, k) => {
        if (mB.has(k)) diff("", item, mB.get(k), out, joinRow(row, k));
      });
      return;
    }
    // صفوف بدون مفتاح: مقارنة حسب الترتيب
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const r = joinRow(row, `#${i + 1}`);
      if (i >= A.length) out.push({ row: r, field: "صف جديد", before: "", after: trunc(fmt(path, B[i])) });
      else if (i >= B.length) out.push({ row: r, field: "حذف صف", before: trunc(fmt(path, A[i])), after: "" });
      else diff("", A[i], B[i], out, r);
    }
    return;
  }

  if (isPlainObj(a) || isPlainObj(b)) {
    const keys = new Set([...Object.keys(isPlainObj(a) ? a : {}), ...Object.keys(isPlainObj(b) ? b : {})]);
    keys.forEach((k) =>
      diff(path ? `${path}.${k}` : k, isPlainObj(a) ? a[k] : undefined, isPlainObj(b) ? b[k] : undefined, out, row),
    );
    return;
  }

  push(fmt(path, a), fmt(path, b));
}

function rowCount(data) {
  if (!isPlainObj(data)) return 0;
  return Object.values(data).reduce(
    (n, v) => n + (Array.isArray(v) && v.length && v.every(isPlainObj) ? v.length : 0),
    0,
  );
}
const countText = (data) => (rowCount(data) ? ` (${rowCount(data)} صف)` : "");

// يحسب تغييرات مستند واحد. يرجع {action, name, changes}
function docChanges(item, after) {
  const col = topCollection(item.ref);
  const id = item.ref.id;
  const before = item.before?.data ?? null;
  const name = cfg.recordName(col, id, before, after);
  if (item.op === "delete") {
    return { action: "delete", name, changes: [{ row: "—", field: "حذف", before: trunc(name + countText(before)), after: "" }] };
  }
  if (item.before?.ok && !before) {
    return { action: "create", name, changes: [{ row: "—", field: "إنشاء", before: "", after: trunc(name + countText(after)) }] };
  }
  const raw = [];
  diff("", before || {}, after || {}, raw, "");
  // حذف الأسطر المكررة (نفس الصف والخانة والقيم، مثل خانتين بنفس المعنى)
  const seen = new Set();
  const changes = raw.filter((c) => {
    const k = `${c.row}\u0001${c.field}\u0001${c.before}\u0001${c.after}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return { action: "update", name, changes };
}

async function writeEntry(ctx, { action, record, collectionName, docId, changes }) {
  if (!changes.length) return;
  const total = changes.length;
  const list = changes.slice(0, MAX_CHANGES);
  if (total > MAX_CHANGES)
    list.push({ row: "—", field: "…", before: "", after: `و ${total - MAX_CHANGES} تغيير آخر` });
  await addDoc(collection(cfg.db, "auditLog"), {
    at: new Date(),
    uid: ctx.actor.uid,
    name: ctx.actor.name || "",
    email: ctx.actor.email || "",
    sectionKey: ctx.section || "",
    section: cfg.sectionLabel(ctx.section) || "",
    action,
    record: trunc(record),
    collection: collectionName,
    docId: docId || "",
    changes: list,
    changeCount: total,
  });
}

// بعد الحفظ: قراءة البيانات الجديدة + المقارنة + كتابة السجل (لا يرمي خطأ أبدًا)
async function afterWrite(items, ctx) {
  try {
    const results = [];
    for (const item of items) {
      const after = item.op === "delete" ? null : (await readSafe(item.ref)).data;
      results.push({ item, ...docChanges(item, after) });
    }
    const withChanges = results.filter((r) => r.changes.length);
    if (!withChanges.length) return;

    if (withChanges.length === 1) {
      const r = withChanges[0];
      await writeEntry(ctx, {
        action: r.action,
        record: r.name,
        collectionName: topCollection(r.item.ref),
        docId: r.item.ref.id,
        changes: r.changes,
      });
      return;
    }
    // دفعة: سطر واحد يجمع كل المستندات، والصف = اسم السجل
    const actions = new Set(withChanges.map((r) => r.action));
    const cols = [...new Set(withChanges.map((r) => topCollection(r.item.ref)))];
    const changes = withChanges.flatMap((r) =>
      r.changes.map((c) => ({ ...c, row: joinRow(r.name, c.row === "—" ? "" : c.row).replace(/ \/ $/, "") })),
    );
    await writeEntry(ctx, {
      action: actions.size === 1 ? [...actions][0] : "update",
      record: `${withChanges.length} سجل: ${withChanges
        .slice(0, 5)
        .map((r) => r.name)
        .join("، ")}${withChanges.length > 5 ? " …" : ""}`,
      collectionName: cols.join(","),
      docId: "",
      changes,
    });
  } catch (err) {
    console.warn("السجل: تعذرت كتابة سجل التعديلات (الحفظ الأصلي تم بنجاح)", err);
  }
}

const captureCtx = () => ({ actor: { ...cfg.actor() }, section: cfg.section() });

// ---------------------------------------------------------------------
//                  النسخ المغلّفة (نفس الشكل الأصلي)
// ---------------------------------------------------------------------
export async function setDoc(ref, data, options) {
  const run = () => (options === undefined ? fsSetDoc(ref, data) : fsSetDoc(ref, data, options));
  if (!shouldLog(ref) || onlyIgnored(data)) return run();
  const ctx = captureCtx();
  const before = await readSafe(ref);
  const res = await run();
  afterWrite([{ ref, before, op: "set" }], ctx);
  return res;
}

export async function updateDoc(ref, ...args) {
  const run = () => fsUpdateDoc(ref, ...args);
  const data = isPlainObj(args[0]) ? args[0] : null;
  if (!shouldLog(ref) || (data && onlyIgnored(data))) return run();
  const ctx = captureCtx();
  const before = await readSafe(ref);
  const res = await run();
  afterWrite([{ ref, before, op: "update" }], ctx);
  return res;
}

export async function deleteDoc(ref) {
  const run = () => fsDeleteDoc(ref);
  if (!shouldLog(ref)) return run();
  const ctx = captureCtx();
  const before = await readSafe(ref);
  const res = await run();
  afterWrite([{ ref, before, op: "delete" }], ctx);
  return res;
}

export function writeBatch(db) {
  const b = fsWriteBatch(db);
  const ops = [];
  const wrapped = {
    set(ref, data, options) {
      options === undefined ? b.set(ref, data) : b.set(ref, data, options);
      ops.push({ ref, data, op: "set" });
      return wrapped;
    },
    update(ref, ...args) {
      b.update(ref, ...args);
      ops.push({ ref, data: isPlainObj(args[0]) ? args[0] : null, op: "update" });
      return wrapped;
    },
    delete(ref) {
      b.delete(ref);
      ops.push({ ref, op: "delete" });
      return wrapped;
    },
    async commit() {
      const logged = ops.filter(
        (o) => shouldLog(o.ref) && (o.op === "delete" || !o.data || !onlyIgnored(o.data)),
      );
      if (!logged.length) return b.commit();
      const ctx = captureCtx();
      const befores = await Promise.all(logged.map((o) => readSafe(o.ref)));
      const res = await b.commit();
      afterWrite(
        logged.map((o, i) => ({ ref: o.ref, op: o.op, before: befores[i] })),
        ctx,
      );
      return res;
    },
  };
  return wrapped;
}
