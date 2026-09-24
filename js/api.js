import { firebaseConfigured, firebaseServices, currentUser } from "./firebase-client.js";
import { PUBLIC_DEFAULT_COURSES } from "./default-courses.js";

export const backendReady = firebaseConfigured;
const RESOURCE_CHUNK_CHARS = 560000;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCES_PER_COURSE = 20;
const resourceObjectUrls = new Map();

function appError(message) {
  return new Error(message);
}

function normalizeCode(value = "") {
  return String(value).trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function safeCourseId(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function bytesToBase64(bytes) {
  let binary = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + block, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function assessmentKey(codes) {
  const material = new TextEncoder().encode(`PREVENIR-PSST-v7.4|${codes.map(normalizeCode).join("|")}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptAssessment(answerKey, codes) {
  const key = await assessmentKey(codes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ answerKey }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)), version: 1 };
}

async function decryptAssessment(cipher, codes) {
  if (!cipher?.iv || !cipher?.data) throw appError("course_not_configured");
  try {
    const key = await assessmentKey(codes);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(cipher.iv) },
      key,
      base64ToBytes(cipher.data)
    );
    return JSON.parse(new TextDecoder().decode(clear));
  } catch {
    throw appError("invalid_codes");
  }
}

async function ctx() {
  if (!firebaseConfigured) throw appError("firebase_not_configured");
  const { db, firestoreSdk } = await firebaseServices();
  return { db, fs: firestoreSdk };
}

async function adminIdentity() {
  const user = await currentUser();
  if (!user) throw appError("authentication_required");
  const { db, fs } = await ctx();
  const ref = fs.doc(db, "system", "admin");
  const snap = await fs.getDoc(ref);
  if (!snap.exists() || snap.data().uid !== user.uid) throw appError("admin_required");
  return { user, db, fs };
}

function storedCodesKey(courseId) {
  return `prevenir_psst_codes_${courseId}`;
}

function loadStoredCodes(courseId) {
  try {
    const raw = sessionStorage.getItem(storedCodesKey(courseId));
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
}

function saveStoredCode(courseId, position, code) {
  const codes = loadStoredCodes(courseId);
  codes[position] = normalizeCode(code);
  sessionStorage.setItem(storedCodesKey(courseId), JSON.stringify(codes));
}

function attemptSessionKey(attemptId) {
  return `prevenir_psst_attempt_${attemptId}`;
}

function resourceSizeFromBase64(dataBase64) {
  const clean = String(dataBase64 || "").replace(/\s/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function normalizeAdminCourse(publicData, privateData = {}) {
  const answerKey = Array.isArray(privateData.answerKey) ? privateData.answerKey : [];
  const questions = Array.isArray(publicData.questions)
    ? publicData.questions.map((question, index) => ({ ...question, correct: Number.isInteger(answerKey[index]) ? answerKey[index] : -1 }))
    : [];
  return {
    ...publicData,
    codes: Array.isArray(privateData.codes) ? privateData.codes : ["", "", ""],
    questions,
    configured: publicData.configured === true && privateData.configured === true,
    resources: Array.isArray(publicData.resources) ? publicData.resources : []
  };
}

function publicCourseDocument(course, existing = {}) {
  const questions = course.questions.map(question => ({
    prompt: String(question.prompt || "").trim(),
    options: Array.isArray(question.options) ? question.options.map(option => String(option || "").trim()).slice(0, 3) : []
  }));
  return {
    courseId: course.courseId,
    number: course.number || existing.number || "01.1",
    icon: course.icon || "✦",
    theme: course.theme || "#2778d5",
    themeSoft: course.themeSoft || "#e1efff",
    title: course.title,
    category: course.category,
    duration: course.duration,
    description: course.description,
    videoUrl: course.videoUrl,
    learn: course.learn,
    questions,
    resources: Array.isArray(existing.resources) ? existing.resources : (Array.isArray(course.resources) ? course.resources : []),
    coverResourceId: existing.coverResourceId || course.coverResourceId || "",
    sortOrder: Number(existing.sortOrder || course.sortOrder || 999),
    isCustom: existing.isCustom === true || course.isCustom === true,
    configured: true,
    active: true
  };
}

function validateAdminCourse(course) {
  if (!course || String(course.title || "").trim().length < 3 || String(course.category || "").trim().length < 2 || !String(course.duration || "").trim() || String(course.description || "").trim().length < 10) throw appError("invalid_course_details");
  if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(String(course.videoUrl || ""))) throw appError("invalid_youtube_url");
  const codes = Array.isArray(course.codes) ? course.codes.map(normalizeCode) : [];
  if (codes.length !== 3 || codes.some(code => !code || code.length > 18) || new Set(codes).size !== 3) throw appError("invalid_codes");
  if (!Array.isArray(course.learn) || course.learn.length !== 3 || course.learn.some(item => !String(item || "").trim())) throw appError("invalid_learning_goals");
  if (!Array.isArray(course.questions) || course.questions.length < 4 || course.questions.length > 20) throw appError("invalid_question_count");
  if (course.questions.some(question => !String(question.prompt || "").trim() || !Array.isArray(question.options) || question.options.length !== 3 || question.options.some(option => !String(option || "").trim()) || !Number.isInteger(Number(question.correct)) || Number(question.correct) < 0 || Number(question.correct) > 2)) throw appError("invalid_questions");
  return codes;
}

async function seedDefaultsIfEmpty(db, fs) {
  const existing = await fs.getDocs(fs.collection(db, "coursesPublic"));
  if (!existing.empty) return;
  const batch = fs.writeBatch(db);
  PUBLIC_DEFAULT_COURSES.forEach((course, index) => {
    const publicRef = fs.doc(db, "coursesPublic", course.courseId);
    const privateRef = fs.doc(db, "coursesPrivate", course.courseId);
    batch.set(publicRef, {
      ...course,
      questions: course.questions.map(question => ({ prompt: question.prompt, options: question.options })),
      resources: [],
      coverResourceId: "",
      codeHashes: [],
      assessmentCipher: null,
      configured: false,
      active: false,
      createdAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp()
    });
    batch.set(privateRef, {
      courseId: course.courseId,
      codes: ["", "", ""],
      answerKey: course.questions.map(() => -1),
      configured: false,
      createdAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp()
    });
  });
  await batch.commit();
}

function certificateCode() {
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = crypto.getRandomValues(new Uint32Array(2));
  return `PPSST-${day}-${suffix[0].toString(36).toUpperCase().slice(0, 4)}${suffix[1].toString(36).toUpperCase().slice(0, 4)}`;
}

function maskedDocument(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (clean.length <= 4) return `${clean.slice(0, 1)}***`;
  return `${clean.slice(0, Math.min(4, clean.length - 3))}${"*".repeat(Math.min(5, Math.max(3, clean.length - 6)))}${clean.slice(-2)}`;
}

function formatSpanishDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

async function getPublicCourse(courseId) {
  const { db, fs } = await ctx();
  const snap = await fs.getDoc(fs.doc(db, "coursesPublic", courseId));
  if (!snap.exists()) throw appError("course_not_found");
  return { id: snap.id, ...snap.data() };
}

async function resourceObjectUrl(resourceId) {
  if (resourceObjectUrls.has(resourceId)) return resourceObjectUrls.get(resourceId);
  const { db, fs } = await ctx();
  const metaSnap = await fs.getDoc(fs.doc(db, "resources", resourceId));
  if (!metaSnap.exists()) throw appError("resource_not_found");
  const meta = metaSnap.data();
  const parts = [];
  for (let index = 0; index < Number(meta.chunkCount || 0); index += 1) {
    const chunkId = String(index).padStart(5, "0");
    const chunkSnap = await fs.getDoc(fs.doc(db, "resources", resourceId, "chunks", chunkId));
    if (!chunkSnap.exists()) throw appError("resource_incomplete");
    parts.push(String(chunkSnap.data().data || ""));
  }
  const bytes = base64ToBytes(parts.join(""));
  const url = URL.createObjectURL(new Blob([bytes], { type: meta.mimeType || "application/octet-stream" }));
  resourceObjectUrls.set(resourceId, url);
  return url;
}

export const resourceUrl = resourceId => `#recurso-${encodeURIComponent(resourceId)}`;

export const api = {
  async health() {
    return { ok: firebaseConfigured, mode: "spark-firestore-direct" };
  },

  async getPublicCourses() {
    const { db, fs } = await ctx();
    const snap = await fs.getDocs(fs.collection(db, "coursesPublic"));
    const courses = snap.docs
      .map(docSnap => ({ courseId: docSnap.id, ...docSnap.data() }))
      .filter(course => course.active === true && course.configured === true);
    return { courses };
  },

  async checkCourseCode(courseId, position, code) {
    const course = await getPublicCourse(courseId);
    if (!course.configured || !Array.isArray(course.codeHashes) || course.codeHashes.length !== 3) throw appError("course_not_configured");
    const index = Number(position);
    if (!Number.isInteger(index) || index < 0 || index > 2) throw appError("invalid_code_position");
    const normalized = normalizeCode(code);
    const digest = await sha256Hex(normalized);
    const valid = digest === course.codeHashes[index];
    if (valid) saveStoredCode(courseId, index, normalized);
    return { valid };
  },

  async scoreCourse(courseId, answers) {
    const course = await getPublicCourse(courseId);
    if (!course.configured || !course.assessmentCipher) throw appError("course_not_configured");
    const codes = loadStoredCodes(courseId);
    if (codes.length < 3 || codes.some(code => !code)) throw appError("codes_required");
    const assessment = await decryptAssessment(course.assessmentCipher, codes);
    const answerKey = Array.isArray(assessment.answerKey) ? assessment.answerKey.map(Number) : [];
    const normalizedAnswers = Array.isArray(answers) ? answers.map(Number) : [];
    if (!answerKey.length || normalizedAnswers.length !== answerKey.length) throw appError("invalid_answers");
    const correct = normalizedAnswers.reduce((sum, answer, index) => sum + (answer === answerKey[index] ? 1 : 0), 0);
    const total = answerKey.length;
    const score = Math.floor((correct * 100) / total);
    const passed = correct * 5 >= total * 4;
    const { db, fs } = await ctx();
    const attemptId = crypto.randomUUID().replace(/-/g, "");
    await fs.setDoc(fs.doc(db, "attempts", attemptId), {
      courseId,
      answers: normalizedAnswers,
      correct,
      total,
      score,
      passed,
      createdAt: fs.serverTimestamp()
    });
    sessionStorage.setItem(attemptSessionKey(attemptId), JSON.stringify({ courseId, correct, total, score, passed }));
    return { score, correct, total, passed, attemptToken: passed ? attemptId : null };
  },

  async issueCertificate(payload) {
    const attemptId = String(payload?.attemptToken || "");
    let attempt;
    try {
      attempt = JSON.parse(sessionStorage.getItem(attemptSessionKey(attemptId)) || "null");
    } catch {
      attempt = null;
    }
    if (!attempt?.passed) throw appError("invalid_attempt");
    const name = String(payload?.name || "").trim();
    const documentValue = String(payload?.document || "").trim();
    const company = String(payload?.company || "").trim();
    if (name.length < 3 || documentValue.length < 3) throw appError("invalid_participant");
    const course = await getPublicCourse(attempt.courseId);
    const code = certificateCode();
    const date = formatSpanishDate();
    const documentMasked = maskedDocument(documentValue);
    const { db, fs } = await ctx();
    await fs.setDoc(fs.doc(db, "certificates", code), {
      code,
      attemptId,
      courseId: attempt.courseId,
      name,
      document: documentMasked,
      company,
      course: course.title,
      score: Number(attempt.score),
      date,
      createdAt: fs.serverTimestamp()
    });
    return { certificate: { code, name, document: documentValue, company, course: course.title, score: Number(attempt.score), date } };
  },

  async verifyCertificate(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return { valid: false };
    const { db, fs } = await ctx();
    const snap = await fs.getDoc(fs.doc(db, "certificates", normalized));
    return snap.exists() ? { valid: true, certificate: snap.data() } : { valid: false };
  },

  async getAdminSession() {
    const user = await currentUser();
    if (!user) throw appError("authentication_required");
    const { db, fs } = await ctx();
    const snap = await fs.getDoc(fs.doc(db, "system", "admin"));
    if (!snap.exists()) return { isAdmin: false, canClaim: true, email: user.email || "" };
    const data = snap.data();
    return { isAdmin: data.uid === user.uid, canClaim: false, email: user.email || "", adminEmail: data.email || "" };
  },

  async bootstrapAdmin() {
    const user = await currentUser();
    if (!user) throw appError("authentication_required");
    const { db, fs } = await ctx();
    const ref = fs.doc(db, "system", "admin");
    await fs.runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (snap.exists() && snap.data().uid !== user.uid) throw appError("admin_already_claimed");
      if (!snap.exists()) {
        transaction.set(ref, { uid: user.uid, email: user.email || "", createdAt: fs.serverTimestamp() });
      }
    });
    await seedDefaultsIfEmpty(db, fs);
    return { isAdmin: true };
  },

  async listAdminCourses() {
    const { db, fs } = await adminIdentity();
    await seedDefaultsIfEmpty(db, fs);
    const [publicSnap, privateSnap] = await Promise.all([
      fs.getDocs(fs.collection(db, "coursesPublic")),
      fs.getDocs(fs.collection(db, "coursesPrivate"))
    ]);
    const privateMap = new Map(privateSnap.docs.map(docSnap => [docSnap.id, docSnap.data()]));
    const courses = publicSnap.docs.map(docSnap => normalizeAdminCourse({ courseId: docSnap.id, ...docSnap.data() }, privateMap.get(docSnap.id) || {}));
    return { courses };
  },

  async saveAdminCourse(courseInput) {
    const { db, fs } = await adminIdentity();
    const course = { ...courseInput };
    const codes = validateAdminCourse(course);
    let courseId = safeCourseId(course.courseId || course.title);
    if (!courseId) courseId = `curso-${Date.now()}`;
    if (!course.courseId) {
      const collision = await fs.getDoc(fs.doc(db, "coursesPublic", courseId));
      if (collision.exists()) courseId = `${courseId}-${Date.now().toString(36)}`;
    }
    course.courseId = courseId;

    const publicRef = fs.doc(db, "coursesPublic", courseId);
    const privateRef = fs.doc(db, "coursesPrivate", courseId);
    const existingSnap = await fs.getDoc(publicRef);
    const existing = existingSnap.exists() ? existingSnap.data() : {};
    if (!existingSnap.exists()) {
      const countSnap = await fs.getDocs(fs.collection(db, "coursesPublic"));
      course.number = `${String(countSnap.size + 1).padStart(2, "0")}.1`;
      course.sortOrder = countSnap.size + 1;
      course.isCustom = true;
    }

    const answerKey = course.questions.map(question => Number(question.correct));
    const codeHashes = await Promise.all(codes.map(sha256Hex));
    const assessmentCipher = await encryptAssessment(answerKey, codes);
    const publicDoc = publicCourseDocument(course, existing);
    publicDoc.codeHashes = codeHashes;
    publicDoc.assessmentCipher = assessmentCipher;
    publicDoc.updatedAt = fs.serverTimestamp();
    if (!existingSnap.exists()) publicDoc.createdAt = fs.serverTimestamp();

    const batch = fs.writeBatch(db);
    batch.set(publicRef, publicDoc, { merge: true });
    batch.set(privateRef, {
      courseId,
      codes,
      answerKey,
      configured: true,
      updatedAt: fs.serverTimestamp(),
      ...(existingSnap.exists() ? {} : { createdAt: fs.serverTimestamp() })
    }, { merge: true });
    await batch.commit();

    const savedPublic = (await fs.getDoc(publicRef)).data();
    const savedPrivate = (await fs.getDoc(privateRef)).data();
    return { saved: true, course: normalizeAdminCourse({ courseId, ...savedPublic }, savedPrivate) };
  },

  async uploadResource(payload) {
    const { db, fs } = await adminIdentity();
    const courseId = String(payload?.courseId || "");
    const name = String(payload?.name || "").trim();
    const mimeType = String(payload?.mimeType || "application/octet-stream");
    const kind = payload?.kind === "cover" ? "cover" : "resource";
    const dataBase64 = String(payload?.dataBase64 || "");
    const size = resourceSizeFromBase64(dataBase64);
    if (!courseId || !name || !dataBase64 || size <= 0) throw appError("invalid_resource");
    if (size > MAX_RESOURCE_BYTES) throw appError("resource_too_large");
    const allowed = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation))$/i;
    if (!allowed.test(mimeType)) throw appError("invalid_resource");

    const courseRef = fs.doc(db, "coursesPublic", courseId);
    const courseSnap = await fs.getDoc(courseRef);
    if (!courseSnap.exists()) throw appError("course_not_found");
    const courseData = courseSnap.data();
    const resources = Array.isArray(courseData.resources) ? courseData.resources : [];
    if (resources.length >= MAX_RESOURCES_PER_COURSE) throw appError("resource_limit_reached");

    const resourceId = crypto.randomUUID().replace(/-/g, "");
    const chunks = [];
    for (let offset = 0; offset < dataBase64.length; offset += RESOURCE_CHUNK_CHARS) chunks.push(dataBase64.slice(offset, offset + RESOURCE_CHUNK_CHARS));
    for (let index = 0; index < chunks.length; index += 1) {
      await fs.setDoc(fs.doc(db, "resources", resourceId, "chunks", String(index).padStart(5, "0")), {
        resourceId,
        index,
        data: chunks[index]
      });
    }
    const metadata = { id: resourceId, courseId, name, mimeType, kind, size, chunkCount: chunks.length, public: true };
    await fs.setDoc(fs.doc(db, "resources", resourceId), { ...metadata, createdAt: fs.serverTimestamp() });
    const nextResources = [...resources.filter(item => item.id !== resourceId), metadata];
    await fs.updateDoc(courseRef, {
      resources: nextResources,
      ...(kind === "cover" ? { coverResourceId: resourceId } : {}),
      updatedAt: fs.serverTimestamp()
    });
    return { saved: true, resource: metadata };
  },

  async deleteResource(resourceId) {
    const { db, fs } = await adminIdentity();
    const id = String(resourceId || "");
    const resourceRef = fs.doc(db, "resources", id);
    const snap = await fs.getDoc(resourceRef);
    if (!snap.exists()) return { deleted: true };
    const data = snap.data();
    for (let index = 0; index < Number(data.chunkCount || 0); index += 1) {
      await fs.deleteDoc(fs.doc(db, "resources", id, "chunks", String(index).padStart(5, "0")));
    }
    await fs.deleteDoc(resourceRef);
    const courseRef = fs.doc(db, "coursesPublic", data.courseId);
    const courseSnap = await fs.getDoc(courseRef);
    if (courseSnap.exists()) {
      const course = courseSnap.data();
      const resources = (Array.isArray(course.resources) ? course.resources : []).filter(item => item.id !== id);
      await fs.updateDoc(courseRef, {
        resources,
        ...(course.coverResourceId === id ? { coverResourceId: "" } : {}),
        updatedAt: fs.serverTimestamp()
      });
    }
    const cached = resourceObjectUrls.get(id);
    if (cached) URL.revokeObjectURL(cached);
    resourceObjectUrls.delete(id);
    return { deleted: true };
  },

  resourceUrl,
  resourceObjectUrl,

  async openResource(resourceId) {
    const popup = window.open("about:blank", "_blank");
    try {
      const url = await resourceObjectUrl(resourceId);
      if (popup) popup.location.href = url;
      else window.location.href = url;
      return url;
    } catch (error) {
      if (popup) popup.close();
      throw error;
    }
  }
};
