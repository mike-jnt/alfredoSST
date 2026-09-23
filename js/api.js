import { firebaseConfig, certificaConfig } from "./firebase-config.js";
import { firebaseConfigured, idToken } from "./firebase-client.js";

function endpoint(name) {
  if (!firebaseConfigured) return "";
  if (certificaConfig.useEmulators) {
    return `http://${certificaConfig.emulatorHost}:${certificaConfig.functionsEmulatorPort}/${firebaseConfig.projectId}/${certificaConfig.functionsRegion}/${name}`;
  }
  return `https://${certificaConfig.functionsRegion}-${firebaseConfig.projectId}.cloudfunctions.net/${name}`;
}

async function request(name, { method = "GET", body, auth = false, timeout = 15000 } = {}) {
  const url = endpoint(name);
  if (!url) throw new Error("firebase_not_configured");

  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = await idToken();
    if (!token) throw new Error("authentication_required");
    headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `http_${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const backendReady = firebaseConfigured;
export const resourceUrl = resourceId => `${endpoint("getPublicResource")}?resourceId=${encodeURIComponent(resourceId)}`;

export const api = {
  health: () => request("health"),
  getPublicCourses: () => request("getPublicCourses"),
  checkCourseCode: (courseId, position, code) => request("checkCourseCode", { method: "POST", body: { courseId, position, code } }),
  scoreCourse: (courseId, answers) => request("scoreCourse", { method: "POST", body: { courseId, answers } }),
  issueCertificate: payload => request("issueCertificate", { method: "POST", body: payload }),
  verifyCertificate: code => request("verifyCertificate", { method: "POST", body: { code } }),
  getAdminSession: () => request("getAdminSession", { auth: true }),
  bootstrapAdmin: () => request("bootstrapAdmin", { method: "POST", body: {}, auth: true }),
  listAdminCourses: () => request("listAdminCourses", { auth: true }),
  saveAdminCourse: course => request("saveAdminCourse", { method: "POST", body: course, auth: true }),
  uploadResource: payload => request("uploadResource", { method: "POST", body: payload, auth: true, timeout: 120000 }),
  deleteResource: resourceId => request("deleteResource", { method: "POST", body: { resourceId }, auth: true }),
  resourceUrl
};
