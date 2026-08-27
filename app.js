/* =========================================================
   MedVault — Complete app.js
   Supabase Auth + Database + Storage + Medicines + Alarms
   + Local MedVault AI using ./data.json
   + Offline-First IndexedDB Sync & Background Notifications
   ========================================================= */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_CONFIG = Object.freeze({
  url: "https://vqucrbgvjncgyskpjvgg.supabase.co",
  anonKey: "sb_publishable_DHVQiZ_c4Sr3mnNMXLL9Sg_jCxfFzlL",
  bucket: "medical-documents", 
  maxFileSize: 25 * 1024 * 1024,
  allowedTypes: ["application/pdf", "image/jpeg", "image/png"], 
  signedUrlExpiry: 300
});

const AI_CONFIG = Object.freeze({
  knowledgeUrl: "./data.json",
  maxHistory: 40,
  maxResults: 8,
  storagePrefix: "medvault-ai-chat"
});

const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null, currentProfile = { name: "", email: "", blood: "O+", age: "" };
let userDocuments = [], userMedicines = [], activeCategoryFilter = "all", activeSearchQuery = "";
let unsubscribeProfile = null, unsubscribeDocuments = null, unsubscribeMedicines = null;
let medicineAlarmTimer = null, activeAlarmInterval = null, activeAlarmMedId = null, audioCtx = null;
let selectedScreenFile = null, uploadInProgress = false;
let knowledgeItems = [], knowledgeReady = false, knowledgeLoading = false, aiHistory = [];

const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const errMsg = e => e?.message || e?.error_description || String(e || "Unknown error");
const initials = n => !n ? "U" : n.trim().split(/\s+/).map(x => x[0]).slice(0, 2).join("").toUpperCase();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const formatDate = v => { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };
const formatTime = t => { if (!t) return ""; const [h, m] = String(t).split(":"); const d = new Date(); d.setHours(+h, +m, 0, 0); return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); };
const formatBytes = b => { if (!b) return "0 KB"; const s = ["Bytes", "KB", "MB", "GB"], i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), s.length - 1); return `${(b / 1024 ** i).toFixed(1)} ${s[i]}`; };
const documentIcon = (type = "", name = "") => name.toLowerCase().endsWith(".pdf") || type.includes("pdf") ? "📕" : "🖼️";

const GREETINGS_AND_COURTESIES = [
  "hi", "hello", "hey",
  "good morning", "good evening", "good afternoon", "good night",
  "thank you", "thanks", "you're welcome", "youre welcome"
];

function isGreetingOrCourtesy(text) {
  const cleaned = text.trim().toLowerCase().replace(/[^\w\s]/gi, '');
  return GREETINGS_AND_COURTESIES.includes(cleaned);
}

function toast(title, message, icon = "🔔") {
  const t = $("toastNotification");
  if (!t) return;
  if ($("toastTitle")) $("toastTitle").textContent = title;
  if ($("toastBody")) $("toastBody").textContent = message;
  if ($("toastIcon")) $("toastIcon").textContent = icon;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 4500);
}
window.hideToast = () => $("toastNotification")?.classList.add("hidden");

function authError(e) {
  const m = errMsg(e);
  if (/invalid login credentials/i.test(m)) return "Invalid email or password.";
  if (/already registered|already exists/i.test(m)) return "This email is already registered.";
  if (/email.*invalid/i.test(m)) return "Please enter a valid email address.";
  return m || "Authentication failed.";
}

/* ================= OFFLINE INDEXEDDB & SERVICE WORKER SYNC ================= */
let dbPromise = null;

function initIndexedDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // Upgraded database version to 2 to support offline documents
    const req = indexedDB.open("MedVaultOfflineDB", 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("medicines")) {
        db.createObjectStore("medicines", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sync_queue")) {
        db.createObjectStore("sync_queue", { keyPath: "id", autoIncrement: true });
      }
      // NEW: Store for local document files (blobs) when offline
      if (!db.objectStoreNames.contains("offline_documents")) {
        db.createObjectStore("offline_documents", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// NEW: Save document file blob locally
async function saveDocumentOffline(docRecord, fileBlob) {
  const db = await initIndexedDB();
  const tx = db.transaction("offline_documents", "readwrite");
  tx.objectStore("offline_documents").put({
    id: docRecord.id,
    record: docRecord,
    fileBlob: fileBlob
  });
}

// NEW: Get local document file blob
async function getOfflineDocument(id) {
  const db = await initIndexedDB();
  return new Promise((resolve) => {
    const tx = db.transaction("offline_documents", "readonly");
    const req = tx.objectStore("offline_documents").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function saveMedicineOffline(med) {
  const db = await initIndexedDB();
  const tx = db.transaction("medicines", "readwrite");
  tx.objectStore("medicines").put(med);
}

async function getOfflineMedicines() {
  const db = await initIndexedDB();
  return new Promise((resolve) => {
    const tx = db.transaction("medicines", "readonly");
    const req = tx.objectStore("medicines").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function queueOfflineAction(actionType, data) {
  const db = await initIndexedDB();
  const tx = db.transaction("sync_queue", "readwrite");
  tx.objectStore("sync_queue").add({ actionType, data, timestamp: Date.now() });
}

async function syncOfflineData() {
  if (!navigator.onLine || !currentUser) return;
  try {
    const db = await initIndexedDB();
    const tx = db.transaction("sync_queue", "readonly");
    const req = tx.objectStore("sync_queue").getAll();

    req.onsuccess = async () => {
      const items = req.result || [];
      if (!items.length) return;

      toast("Syncing Data", "Re-connected to network. Syncing offline updates...", "🔄");

      for (const item of items) {
        if (item.actionType === "ADD_MEDICINE") {
          await supabase.from("medicines").upsert(item.data);
        } else if (item.actionType === "UPDATE_MEDICINE") {
          await supabase.from("medicines").update(item.data.changes).eq("id", item.data.id).eq("owner_id", currentUser.id);
        } else if (item.actionType === "DELETE_MEDICINE") {
          await supabase.from("medicines").delete().eq("id", item.data.id).eq("owner_id", currentUser.id);
        } else if (item.actionType === "ADD_DOCUMENT") {
          // NEW: Upload queued offline document to Supabase Storage & DB
          try {
            const path = item.data.storagePath;
            const fileBlob = item.data.fileBlob;
            const record = item.data.record;
            
            await supabase.storage.from(SUPABASE_CONFIG.bucket).upload(path, fileBlob, { 
              cacheControl: "3600", 
              contentType: record.type, 
              upsert: true 
            });
            await supabase.from("documents").upsert(record);
          } catch (err) {
            console.error("Failed syncing offline document:", err);
          }
        }
      }

      const clearTx = db.transaction("sync_queue", "readwrite");
      clearTx.objectStore("sync_queue").clear();
      toast("Sync Complete", "Offline logs and files updated with Supabase cloud.", "✅");
      loadMedicines();
      loadDocuments();
    };
  } catch (e) {
    console.error("Sync failed:", e);
  }
}

window.addEventListener("online", syncOfflineData);
/* ================= BACKGROUND ALARMS & NOTIFICATIONS ================= */
async function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      console.log("ServiceWorker registered successfully:", registration.scope);
    } catch (err) {
      console.error("ServiceWorker registration failed:", err);
    }
  }
}

function triggerSystemNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: "./icon-192.png",
          badge: "./icon-192.png",
          vibrate: [200, 100, 200]
        });
      });
    } else {
      new Notification(title, { body });
    }
  }
}

/* ================= AUTH ================= */
function switchAuthTab(tab) {
  $("tabLoginBtn")?.classList.toggle("active", tab === "login");
  $("tabRegisterBtn")?.classList.toggle("active", tab !== "login");
  $("loginForm")?.classList.toggle("hidden", tab !== "login");
  $("registerForm")?.classList.toggle("hidden", tab === "login");
}
$("tabLoginBtn")?.addEventListener("click", () => switchAuthTab("login"));
$("tabRegisterBtn")?.addEventListener("click", () => switchAuthTab("register"));

$("loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("loginEmail")?.value.trim(), password = $("loginPassword")?.value, error = $("loginError");
  if (error) error.textContent = "";
  if (!email || !password) { if (error) error.textContent = "Enter your email and password."; return; }
  const { error: er } = await supabase.auth.signInWithPassword({ email, password });
  if (er) { console.error(er); if (error) error.textContent = authError(er); }
});

$("registerForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("regName")?.value.trim(), email = $("regEmail")?.value.trim(), password = $("regPassword")?.value, blood = $("regBlood")?.value || "O+", age = $("regAge")?.value || "", error = $("regError");
  if (error) error.textContent = "";
  if (!name || !email || !password) { if (error) error.textContent = "Please complete all required fields."; return; }
  const { data, error: er } = await supabase.auth.signUp({ email, password, options: { data: { name, blood, age } } });
  if (er) { console.error(er); if (error) error.textContent = authError(er); return; }
  toast("Account Created", data.session ? `Welcome to MedVault, ${name}.` : "Check your email to verify your account.", data.session ? "✅" : "📧");
  if (!data.session) switchAuthTab("login");
});

$("googleSignInBtn")?.addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
  if (error && $("loginError")) $("loginError").textContent = authError(error);
});

// Global, robust Sign Out Function
window.signOut = async function signOut() {
  try {
    if (typeof window.closeMobileSidebar === "function") {
      window.closeMobileSidebar();
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast("Logout Failed", errMsg(error), "⚠️");
    } else {
      window.location.reload();
    }
  } catch (err) {
    console.error("Sign out error:", err);
    toast("Logout Error", errMsg(err), "⚠️");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  $("logoutBtn")?.addEventListener("click", window.signOut);
  $("profileLogoutBtn")?.addEventListener("click", window.signOut);
});
$("profileLogoutBtn")?.addEventListener("click", signOut);

/* ================= THEME ================= */
(function () {
  if (localStorage.getItem("medvault-theme") === "dark") document.documentElement.classList.add("dark-mode");
})();

function updateThemeUI() {
  const dark = document.documentElement.classList.contains("dark-mode");
  if ($("themeToggleIcon")) $("themeToggleIcon").textContent = dark ? "☀️" : "🌙";
  if ($("themeToggleBtn")) {
    $("themeToggleBtn").title = dark ? "Switch to light mode" : "Switch to dark mode";
    $("themeToggleBtn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  if ($("sidebarThemeIcon")) $("sidebarThemeIcon").textContent = dark ? "☀️" : "🌙";
  if ($("sidebarThemeText")) $("sidebarThemeText").textContent = dark ? "Light Mode" : "Dark Mode";
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark-mode");
  localStorage.setItem("medvault-theme", dark ? "dark" : "light");
  updateThemeUI();
}

document.addEventListener("DOMContentLoaded", () => {
  $("themeToggleBtn")?.addEventListener("click", toggleTheme);
  $("sidebarThemeToggle")?.addEventListener("click", toggleTheme);
  updateThemeUI();
  loadKnowledge();
  requestNotificationPermission();
  registerServiceWorker();
});

/* ================= PROFILE ================= */
async function loadProfile(user) {
  const { data: p, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  let profile = p;
  if (!profile) {
    const fresh = {
      id: user.id,
      name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Patient",
      email: user.email || "",
      blood: user.user_metadata?.blood || "O+",
      age: user.user_metadata?.age || ""
    };
    const r = await supabase.from("profiles").insert(fresh).select("*").single();
    if (r.error && r.error.code === "23505") {
      const retry = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (retry.error) throw retry.error;
      profile = retry.data;
    } else {
      if (r.error) throw r.error;
      profile = r.data;
    }
  }
  currentProfile = { name: profile?.name || "Patient", email: profile?.email || user.email || "", blood: profile?.blood || "O+", age: profile?.age || "" };
  renderProfileUI(currentProfile);
  renderAIUserContext();
}

function renderProfileUI(p) {
  const name = p.name || "Patient", blood = p.blood || "O+", av = initials(name);
  if ($("dashboardName")) $("dashboardName").textContent = name.split(" ")[0];
  if ($("heroName")) $("heroName").textContent = name;
  if ($("heroBlood")) $("heroBlood").textContent = `Blood Group: ${blood}`;
  if ($("heroAvatar")) $("heroAvatar").textContent = av;
  if ($("sidebarName")) $("sidebarName").textContent = name;
  if ($("sidebarBlood")) $("sidebarBlood").textContent = `Blood: ${blood}`;
  if ($("sidebarAvatar")) $("sidebarAvatar").textContent = av;
  if ($("profileAvatarLarge")) $("profileAvatarLarge").textContent = av;
  if ($("profileNameLarge")) $("profileNameLarge").textContent = name;
  if ($("profileDisplayName")) $("profileDisplayName").textContent = name;
  if ($("profileBlood")) $("profileBlood").textContent = blood;
  if ($("profileAge")) $("profileAge").textContent = p.age ? `${p.age} yrs` : "— yrs";
  if ($("profileEmail")) $("profileEmail").textContent = p.email || "—";
  document.querySelectorAll(".mobile-avatar").forEach(x => x.textContent = av);
}

function listenToProfile(user) {
  unsubscribeProfile?.();
  loadProfile(user).catch(console.error);
  const c = supabase.channel(`profile-${user.id}-${Date.now()}`).on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, p => p.new && loadProfile(user).catch(console.error)).subscribe();
  unsubscribeProfile = () => supabase.removeChannel(c);
}

/* ================= STORAGE / DOCUMENTS ================= */
function validateFile(f) {
  if (!(f instanceof File) || f.size <= 0) throw Error("Invalid or empty file.");
  if (f.size > SUPABASE_CONFIG.maxFileSize) throw Error("Maximum document size is 25 MB.");
  const ext = f.name.toLowerCase().split(".").pop();
  if (!SUPABASE_CONFIG.allowedTypes.includes((f.type || "").toLowerCase()) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) throw Error("Only PDF, JPG, JPEG and PNG medical documents are allowed.");
}

function safeName(n) {
  return String(n || "document").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 180) || "document";
}

function storagePath(uid, did, f) {
  return `users/${uid}/${did}/${Date.now()}-${safeName(f.name)}`;
}

async function uploadToSupabase(file, meta = {}, progress) {
  if (!currentUser) throw Error("Please sign in before uploading.");
  if (uploadInProgress) throw Error("Another document upload is already in progress.");
  validateFile(file);
  uploadInProgress = true;
  try {
    progress?.(10, "Preparing secure upload...");
    const path = storagePath(currentUser.id, meta.documentId || crypto.randomUUID(), file);
    progress?.(25, "Uploading medical document...");
    const { data, error } = await supabase.storage.from(SUPABASE_CONFIG.bucket).upload(path, file, { cacheControl: "3600", contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    if (!data?.path) throw Error("Supabase did not return a storage path.");
    progress?.(100, "Upload complete.");
    return { storagePath: data.path, originalName: file.name, fileSize: file.size, contentType: file.type || "application/octet-stream", bucket: SUPABASE_CONFIG.bucket };
  } finally {
    uploadInProgress = false;
  }
}

window.handleScreenFileSelected = input => {
  try {
    const f = input?.files?.[0];
    if (!f) { selectedScreenFile = null; return; }
    validateFile(f);
    selectedScreenFile = f;
    if ($("screenPickerTitle")) $("screenPickerTitle").textContent = f.name;
    if ($("screenPickerSub")) $("screenPickerSub").textContent = `💾 ${formatBytes(f.size)} · Supabase Storage Ready`;
    if ($("screenPickerIcon")) $("screenPickerIcon").textContent = documentIcon(f.type, f.name);
    if ($("screenDocTitle") && !$("screenDocTitle").value.trim()) $("screenDocTitle").value = f.name.replace(/\.[^/.]+$/, "");
  } catch (e) {
    selectedScreenFile = null;
    if (input) input.value = "";
    toast("Invalid Document", errMsg(e), "⚠️");
  }
};

function resetUpload() {
  selectedScreenFile = null;
  if ($("screenFileInput")) $("screenFileInput").value = "";
  if ($("screenPickerTitle")) $("screenPickerTitle").textContent = "Choose medical document";
  if ($("screenPickerSub")) $("screenPickerSub").textContent = "PDF, JPG or PNG · Maximum 25 MB";
  if ($("screenPickerIcon")) $("screenPickerIcon").textContent = "📄";
}

$("screenUploadForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return toast("Sign In Required", "Please sign in first.", "🔐");
  if (!selectedScreenFile) return toast("No Document Selected", "Please select a document.", "📄");
  
  const title = String($("screenDocTitle")?.value || selectedScreenFile.name).trim().slice(0, 240);
  const category = String($("screenDocCategory")?.value || "Other").trim().slice(0, 80) || "Other";
  const recordDate = String($("screenDocDate")?.value || today()).trim();
  const doctor = String($("screenDocDoctor")?.value || "").trim().slice(0, 240);
  const button = $("screenSubmitBtn");
  const progress = $("screenUploadProgress");
  const fill = $("screenProgressFill");
  const text = $("screenProgressText");
  const docId = crypto.randomUUID();

  button?.setAttribute("disabled", "true");
  progress?.classList.remove("hidden");

  // Create record structure
  const path = storagePath(currentUser.id, docId, selectedScreenFile);
  const record = { 
    id: docId, 
    owner_id: currentUser.id, 
    name: title, 
    original_name: selectedScreenFile.name, 
    type: selectedScreenFile.type || "application/pdf", 
    size: selectedScreenFile.size, 
    formatted_size: formatBytes(selectedScreenFile.size), 
    category, 
    record_date: recordDate, 
    doctor, 
    storage_path: path, 
    supabase_storage_path: path, 
    supabase_bucket: SUPABASE_CONFIG.bucket, 
    storage_backend: "Supabase Storage", 
    uploaded_at: new Date().toISOString() 
  };

  try {
    if (!navigator.onLine) {
      // OFFLINE HANDLER: Cache document locally and queue sync
      await saveDocumentOffline(record, selectedScreenFile);
      await queueOfflineAction("ADD_DOCUMENT", { storagePath: path, record, fileBlob: selectedScreenFile });
      
      userDocuments.unshift(normalizeDocument(record));
      renderDocumentsUI();
      updateCategoryCounts();
      renderDashboardUI();
      renderAIUserContext();
      
      toast("Saved Offline", `${title} stored locally. Will upload when back online.`, "📶");
      $("screenUploadForm")?.reset();
      resetUpload();
      return;
    }

    // ONLINE HANDLER: Standard upload to Supabase
    const storage = await uploadToSupabase(selectedScreenFile, { documentId: docId }, (p, m) => { 
      if (fill) fill.style.width = `${p}%`; 
      if (text) text.textContent = m; 
    });

    const r = await supabase.from("documents").insert(record).select().single();
    if (r.error) { 
      await supabase.storage.from(SUPABASE_CONFIG.bucket).remove([storage.storagePath]); 
      throw r.error; 
    }

    // Also cache online uploads locally for seamless offline reading later
    await saveDocumentOffline(record, selectedScreenFile);

    userDocuments.unshift(normalizeDocument(r.data));
    renderDocumentsUI();
    updateCategoryCounts();
    renderDashboardUI();
    renderAIUserContext();
    toast("Document Uploaded", `${title} saved securely.`, "📁");
    $("screenUploadForm")?.reset();
    resetUpload();
  } catch (e) {
    console.error(e);
    toast("Upload Failed", errMsg(e), "⚠️");
    if (text) text.textContent = errMsg(e);
  } finally {
    button?.removeAttribute("disabled");
    setTimeout(() => progress?.classList.add("hidden"), 1200);
  }
});

window.downloadDocumentRecord = async id => {
  const d = userDocuments.find(x => x.id === id);
  if (!currentUser || !d) return toast("Download Error", "Document not found.", "⚠️");
  
  try {
    // If offline, try serving from local IndexedDB cache
    if (!navigator.onLine) {
      const offlineDoc = await getOfflineDocument(id);
      if (offlineDoc && offlineDoc.fileBlob) {
        const fileUrl = URL.createObjectURL(offlineDoc.fileBlob);
        const a = document.createElement("a");
        a.href = fileUrl;
        a.download = d.originalName || d.name || "medical-document";
        a.target = "_blank";
        a.click();
        setTimeout(() => URL.revokeObjectURL(fileUrl), 5000);
        toast("Offline Access", "Opening document from local storage.", "📄");
        return;
      } else {
        return toast("Offline Error", "This document wasn't cached for offline viewing.", "📶");
      }
    }

    // Online Download from Supabase
    toast("Preparing Download", "Creating secure document link...", "☁️");
    const r = await supabase.storage.from(SUPABASE_CONFIG.bucket).createSignedUrl(d.storagePath, SUPABASE_CONFIG.signedUrlExpiry);
    if (r.error) throw r.error;
    
    // Fetch and cache the file locally for future offline access
    fetch(r.data.signedUrl)
      .then(res => res.blob())
      .then(blob => saveDocumentOffline(d, blob))
      .catch(err => console.warn("Failed caching downloaded doc offline:", err));

    const a = document.createElement("a");
    a.href = r.data.signedUrl;
    a.download = d.originalName || d.name || "medical-document";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  } catch (e) {
    toast("Download Failed", errMsg(e), "⚠️");
  }
};

function normalizeDocument(d) {
  return { ...d, id: d.id, name: d.name || d.original_name || "Medical Document", originalName: d.original_name || d.name || "medical-document", size: +d.size || 0, formattedSize: d.formatted_size || formatBytes(d.size), category: d.category || "Other", recordDate: d.record_date || "", doctor: d.doctor || "", storagePath: d.storage_path || d.supabase_storage_path || "", supabaseStoragePath: d.supabase_storage_path || d.storage_path || "", icon: d.icon || documentIcon(d.type, d.original_name || d.name), uploadedAt: d.uploaded_at ? new Date(d.uploaded_at).getTime() : 0 };
}

async function loadDocuments() {
  if (!currentUser) return;
  const r = await supabase.from("documents").select("*").eq("owner_id", currentUser.id).order("uploaded_at", { ascending: false });
  if (r.error) { console.error(r.error); toast("Documents Error", errMsg(r.error), "⚠️"); return; }
  userDocuments = (r.data || []).map(normalizeDocument);
  updateCategoryCounts();
  renderDocumentsUI();
  renderDashboardUI();
  renderAIUserContext();
}

function listenToDocuments() {
  unsubscribeDocuments?.();
  loadDocuments();
  const c = supabase.channel(`documents-${currentUser.id}`).on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `owner_id=eq.${currentUser.id}` }, loadDocuments).subscribe();
  unsubscribeDocuments = () => supabase.removeChannel(c);
}

function updateCategoryCounts() {
  const counts = {};
  userDocuments.forEach(d => counts[d.category] = (counts[d.category] || 0) + 1);
  if ($("count-all")) $("count-all").textContent = userDocuments.length;
  if ($("navDocCount")) $("navDocCount").textContent = userDocuments.length;
  const map = { Prescription: "folderCountPrescription", "Blood Test": "folderCountBloodTest", Scan: "folderCountScan", Surgery: "folderCountSurgery", Vaccination: "folderCountVaccination", Other: "folderCountOther" };
  Object.entries(map).forEach(([c, id]) => { if ($(id)) $(id).textContent = `${counts[c] || 0} files`; });
}

function renderDocumentsUI() {
  const grid = $("vaultGrid");
  if (!grid) return;
  let docs = [...userDocuments];
  if (activeCategoryFilter !== "all") docs = docs.filter(d => (d.category || "Other") === activeCategoryFilter);
  if (activeSearchQuery) docs = docs.filter(d => `${d.name} ${d.doctor} ${d.category}`.toLowerCase().includes(activeSearchQuery));
  if (!docs.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🗂️</div><strong>No medical records found</strong><p>Upload prescriptions, reports or diagnostic scans.</p></div>`; return; }
  grid.innerHTML = docs.map(d => `<div class="doc-card"><div class="doc-header"><div class="doc-icon-badge">${esc(d.icon || "📄")}</div><span class="category-tag">${esc(d.category)}</span></div><div class="doc-name">${esc(d.name)}</div><div class="doc-doctor">${d.doctor ? `👨‍⚕️ ${esc(d.doctor)}` : "🏥 Medical Report"}</div><div class="doc-meta-strip">📅 ${formatDate(d.recordDate || d.uploadedAt)} · 💾 ${formatBytes(d.size)}</div><div class="doc-actions"><button class="btn-open" onclick="downloadDocumentRecord('${esc(d.id)}')">Download ↧</button><button class="btn-del" onclick="deleteDocumentRecord('${esc(d.id)}')">Delete</button></div></div>`).join("");
}

window.deleteDocumentRecord = async id => {
  const d = userDocuments.find(x => x.id === id);
  if (!d || !currentUser || !confirm(`Delete "${d.name}"?`)) return;
  try {
    if (d.storagePath) { const r = await supabase.storage.from(SUPABASE_CONFIG.bucket).remove([d.storagePath]); if (r.error) throw r.error; }
    const r = await supabase.from("documents").delete().eq("id", id).eq("owner_id", currentUser.id);
    if (r.error) throw r.error;
    userDocuments = userDocuments.filter(x => x.id !== id);
    updateCategoryCounts();
    renderDocumentsUI();
    renderDashboardUI();
    renderAIUserContext();
    toast("Document Deleted", d.name, "🗑️");
  } catch (e) {
    toast("Delete Failed", errMsg(e), "⚠️");
  }
};

window.filterDocuments = () => { activeSearchQuery = $("docSearchInput")?.value.trim().toLowerCase() || ""; renderDocumentsUI(); };
window.setCategoryFilter = c => { activeCategoryFilter = c; renderDocumentsUI(); };

/* ================= MEDICINES (OFFLINE-FIRST ENABLED) ================= */
function normalizeMedicine(m) { return { ...m, takenTodayDate: m.taken_today_date || "", enabled: m.enabled !== false }; }

async function loadMedicines() {
  if (!currentUser) return;
  if (!navigator.onLine) {
    const offlineMeds = await getOfflineMedicines();
    userMedicines = offlineMeds.map(normalizeMedicine);
    renderMedicinesUI();
    renderDashboardUI();
    renderAIUserContext();
    startAlarmScheduler();
    return;
  }
  const r = await supabase.from("medicines").select("*").eq("owner_id", currentUser.id).order("time", { ascending: true });
  if (r.error) { toast("Medicine Error", errMsg(r.error), "⚠️"); return; }
  userMedicines = (r.data || []).map(normalizeMedicine);
  
  // Cache fetched records locally in IndexedDB
  userMedicines.forEach(m => saveMedicineOffline(m));

  renderMedicinesUI();
  renderDashboardUI();
  renderAIUserContext();
  startAlarmScheduler();
}

function listenToMedicines() {
  unsubscribeMedicines?.();
  loadMedicines();
  const c = supabase.channel(`medicines-${currentUser.id}`).on("postgres_changes", { event: "*", schema: "public", table: "medicines", filter: `owner_id=eq.${currentUser.id}` }, loadMedicines).subscribe();
  unsubscribeMedicines = () => supabase.removeChannel(c);
}

$("medicineForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return;
  const name = $("medicineName")?.value.trim(), instruction = $("medicineInstruction")?.value || "", dosage = $("medicineDosage")?.value.trim() || "", time = $("medicineTime")?.value;
  if (!name || !time) return alert("Enter medicine name and time.");

  const newMed = { id: crypto.randomUUID(), owner_id: currentUser.id, name, instruction, dosage, time, enabled: true, taken_today_date: "" };

  if (!navigator.onLine) {
    await saveMedicineOffline(newMed);
    await queueOfflineAction("ADD_MEDICINE", newMed);
    userMedicines.push(normalizeMedicine(newMed));
    userMedicines.sort((a, b) => a.time.localeCompare(b.time));
    renderMedicinesUI();
    renderDashboardUI();
    renderAIUserContext();
    startAlarmScheduler();
    $("medicineForm")?.reset();
    toast("Saved Offline", `${name} cached locally. Will sync when back online.`, "📶");
    return;
  }

  const r = await supabase.from("medicines").insert(newMed).select().single();
  if (r.error) return toast("Medicine Error", errMsg(r.error), "⚠️");
  const normMed = normalizeMedicine(r.data);
  saveMedicineOffline(normMed);
  userMedicines.push(normMed);
  userMedicines.sort((a, b) => a.time.localeCompare(b.time));
  renderMedicinesUI();
  renderDashboardUI();
  renderAIUserContext();
  startAlarmScheduler();
  $("medicineForm")?.reset();
  toast("Alarm Added", `${name} at ${formatTime(time)}`, "⏰");
});

function renderMedicinesUI() {
  const list = $("trackList");
  if (!list) return;
  if ($("navMedCount")) $("navMedCount").textContent = userMedicines.length;
  if ($("statMedCount")) $("statMedCount").textContent = userMedicines.length;
  if (!userMedicines.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">💊</div><strong>No medicines scheduled</strong><p>Add your daily medicine reminders.</p></div>`; return; }
  list.innerHTML = userMedicines.map(m => { const taken = m.takenTodayDate === today(); return `<div class="medicine-item ${taken ? "done" : ""}"><button class="med-check-btn" onclick="toggleMedicineTaken('${esc(m.id)}')">${taken ? "✓" : "○"}</button><div class="med-details"><div class="med-name">${esc(m.name)}</div><div class="med-sub">${m.dosage ? `${esc(m.dosage)} · ` : ""}${formatTime(m.time)}</div></div><div class="med-controls"><button onclick="toggleMedicineEnabled('${esc(m.id)}')">${m.enabled === false ? "▶" : "⏸"}</button><button onclick="deleteMedicineRecord('${esc(m.id)}')">🗑</button></div></div>`; }).join("");
}

window.toggleMedicineTaken = async id => {
  const m = userMedicines.find(x => x.id === id);
  if (!m || !currentUser) return;
  const value = m.takenTodayDate === today() ? null : today();

  if (!navigator.onLine) {
    m.takenTodayDate = value || "";
    m.taken_today_date = value || "";
    await saveMedicineOffline(m);
    await queueOfflineAction("UPDATE_MEDICINE", { id, changes: { taken_today_date: value } });
    renderMedicinesUI();
    renderDashboardUI();
    renderAIUserContext();
    return;
  }

  const r = await supabase.from("medicines").update({ taken_today_date: value, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", currentUser.id).select().single();
  if (r.error) return toast("Medicine Error", errMsg(r.error), "⚠️");
  const i = userMedicines.findIndex(x => x.id === id);
  if (i >= 0) {
    userMedicines[i] = normalizeMedicine(r.data);
    saveMedicineOffline(userMedicines[i]);
  }
  renderMedicinesUI();
  renderDashboardUI();
  renderAIUserContext();
};

window.toggleMedicineEnabled = async id => {
  const m = userMedicines.find(x => x.id === id);
  if (!m || !currentUser) return;
  const nextStatus = m.enabled === false;

  if (!navigator.onLine) {
    m.enabled = nextStatus;
    await saveMedicineOffline(m);
    await queueOfflineAction("UPDATE_MEDICINE", { id, changes: { enabled: nextStatus } });
    renderMedicinesUI();
    renderDashboardUI();
    renderAIUserContext();
    return;
  }

  const r = await supabase.from("medicines").update({ enabled: nextStatus, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", currentUser.id).select().single();
  if (r.error) return toast("Medicine Error", errMsg(r.error), "⚠️");
  const i = userMedicines.findIndex(x => x.id === id);
  if (i >= 0) {
    userMedicines[i] = normalizeMedicine(r.data);
    saveMedicineOffline(userMedicines[i]);
  }
  renderMedicinesUI();
  renderDashboardUI();
  renderAIUserContext();
};

window.deleteMedicineRecord = async id => {
  const m = userMedicines.find(x => x.id === id);
  if (!m || !currentUser || !confirm(`Delete ${m.name}?`)) return;

  if (!navigator.onLine) {
    const db = await initIndexedDB();
    const tx = db.transaction("medicines", "readwrite");
    tx.objectStore("medicines").delete(id);
    await queueOfflineAction("DELETE_MEDICINE", { id });
    userMedicines = userMedicines.filter(x => x.id !== id);
    renderMedicinesUI();
    renderDashboardUI();
    renderAIUserContext();
    toast("Medicine Removed", `${m.name} removed locally.`, "🗑️");
    return;
  }

  const r = await supabase.from("medicines").delete().eq("id", id).eq("owner_id", currentUser.id);
  if (r.error) return toast("Delete Failed", errMsg(r.error), "⚠️");
  userMedicines = userMedicines.filter(x => x.id !== id);
  renderMedicinesUI();
  renderDashboardUI();
  renderAIUserContext();
  toast("Medicine Removed", m.name, "🗑️");
};
window.deleteMedicine = id => window.deleteMedicineRecord(id);

/* ================= ALARMS ================= */
function playAlarmChime() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.setValueAtTime(1174, audioCtx.currentTime + .15);
    o.frequency.setValueAtTime(880, audioCtx.currentTime + .3);
    g.gain.setValueAtTime(.3, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.01, audioCtx.currentTime + .5);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + .55);
  } catch (e) {
    console.warn("Audio unavailable", e);
  }
}

function startRingingAlarm(m) {
  activeAlarmMedId = m.id;
  if ($("alarmMedName")) $("alarmMedName").textContent = m.name;
  if ($("alarmMedInstruction")) $("alarmMedInstruction").textContent = m.instruction || "Time to take your medicine";
  if ($("alarmMedTime")) $("alarmMedTime").textContent = formatTime(m.time);
  $("medicineAlarmModal")?.classList.remove("hidden");
  playAlarmChime();
  triggerSystemNotification(`⏰ Medicine Alarm: ${m.name}`, m.instruction || `Time to take ${m.name}`);
  clearInterval(activeAlarmInterval);
  activeAlarmInterval = setInterval(playAlarmChime, 1000);
}

window.stopMedicineAlarm = async markTaken => {
  clearInterval(activeAlarmInterval);
  activeAlarmInterval = null;
  $("medicineAlarmModal")?.classList.add("hidden");
  if (markTaken && activeAlarmMedId) await window.toggleMedicineTaken(activeAlarmMedId);
  activeAlarmMedId = null;
};
window.testMedicineAlarm = () => startRingingAlarm({ id: "test", name: "Test Medicine Alarm", instruction: "This is a test alarm.", time: new Date().toTimeString().slice(0, 5) });

function startAlarmScheduler() {
  clearInterval(medicineAlarmTimer);
  checkAlarms();
  medicineAlarmTimer = setInterval(checkAlarms, 15000);
}
function checkAlarms() {
  if (!currentUser) return;
  const d = new Date(), t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  userMedicines.forEach(m => {
    if (m.enabled === false || m.time !== t) return;
    const k = `medvault_alarm_${currentUser.id}_${m.id}_${today()}`;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
    startRingingAlarm(m);
  });
}

/* ================= DASHBOARD / NAV ================= */
function renderDashboardUI() {
  if ($("statDocCount")) $("statDocCount").textContent = userDocuments.length;
  if ($("statMedCount")) $("statMedCount").textContent = userMedicines.length;
  if ($("statLastDoc")) $("statLastDoc").textContent = userDocuments[0] ? formatDate(userDocuments[0].recordDate || userDocuments[0].uploadedAt) : "No uploads yet";
  const next = userMedicines.filter(m => m.enabled !== false).sort((a, b) => a.time.localeCompare(b.time))[0];
  if ($("statNextMed")) $("statNextMed").textContent = next ? `${formatTime(next.time)} next` : "No alarms set";
  if ($("recentActivity")) $("recentActivity").innerHTML = userDocuments.slice(0, 4).map(d => `<div class="recent-doc-item"><div class="recent-doc-icon">${esc(d.icon || "📄")}</div><div class="recent-doc-info"><strong>${esc(d.name)}</strong><span>${esc(d.category || "Record")} · ${formatDate(d.recordDate || d.uploadedAt)}</span></div><button class="btn-link" onclick="downloadDocumentRecord('${esc(d.id)}')">Download</button></div>`).join("");
  if ($("dashboardMedList")) $("dashboardMedList").innerHTML = userMedicines.slice(0, 4).map(m => `<div class="recent-doc-item"><div class="recent-doc-icon">💊</div><div class="recent-doc-info"><strong>${esc(m.name)}</strong><span>${esc(m.instruction || "Daily")} · ${formatTime(m.time)}</span></div></div>`).join("");
}

window.openSection = id => {
  document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === id));
  document.querySelectorAll(".nav-item,.bottom-nav-item").forEach(b => b.classList.toggle("active", b.dataset.target === id));
  window.closeMobileSidebar?.();
  window.scrollTo({ top: 0, behavior: "smooth" });
};
window.selectFolderCategory = c => { window.setCategoryFilter(c); $("vaultGrid")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
window.focusMedicineForm = () => { window.openSection("tracker"); setTimeout(() => $("medicineName")?.focus(), 300); };
window.toggleMobileSidebar = () => {
  const s = $("appSidebar"), o = $("sidebarDrawerOverlay");
  if (!s || !o) return;
  if (s.classList.contains("mobile-open")) window.closeMobileSidebar();
  else { s.classList.add("mobile-open"); o.classList.remove("hidden"); }
};
window.closeMobileSidebar = () => { $("appSidebar")?.classList.remove("mobile-open"); $("sidebarDrawerOverlay")?.classList.add("hidden"); };

document.querySelectorAll(".nav-item,.bottom-nav-item").forEach(b => b.addEventListener("click", () => openSection(b.dataset.target)));

/* =========================================================
   MEDVAULT AI — LOCAL RETRIEVAL ASSISTANT
   ========================================================= */
function normalizeKnowledge(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.entries)) return data.entries;
  if (Array.isArray(data.knowledge)) return data.knowledge;
  if (Array.isArray(data.sections)) {
    const a = [];
    data.sections.forEach(sec => (sec.items || sec.entries || []).forEach(x => a.push({ ...x, section: x.section || sec.name || sec.title || "General" })));
    return a;
  }
  return [];
}

async function loadKnowledge(force = false) {
  if (knowledgeReady && !force) return knowledgeItems;
  if (knowledgeLoading) return knowledgeItems;
  knowledgeLoading = true;
  aiStatus("Loading local medical knowledge…", "loading");

  try {
    const r = await fetch(AI_CONFIG.knowledgeUrl, { cache: force ? "reload" : "default" });
    if (!r.ok) throw Error(`data.json could not be loaded (${r.status}).`);
    const data = await r.json();

    const rawList = normalizeKnowledge(data);
    knowledgeItems = window.MedVaultSearchEngine ? window.MedVaultSearchEngine.index(rawList) : rawList;
    knowledgeReady = true;

    aiStatus(`${knowledgeItems.length} local topics ready`, `ready`);
    return knowledgeItems;
  } catch (e) {
    knowledgeReady = false;
    knowledgeItems = [];
    aiStatus("Local knowledge unavailable", "error");
    console.error("MedVault AI:", e);
    return [];
  } finally {
    knowledgeLoading = false;
  }
}

function searchKnowledge(q) {
  if (window.MedVaultSearchEngine) {
    if (!window.MedVaultSearchEngine.isReady()) {
      window.MedVaultSearchEngine.index(knowledgeItems);
    }
    const results = window.MedVaultSearchEngine.search(q, AI_CONFIG.maxResults);
    return results.map(r => ({
      item: r.item || r,
      score: r.score || 1
    }));
  }
  return [];
}

function personalContext() {
  return {
    profile: { name: currentProfile.name || "Patient", age: currentProfile.age || "", blood: currentProfile.blood || "" },
    documents: userDocuments.map(d => ({ name: d.name, category: d.category || "Other", doctor: d.doctor || "", date: d.recordDate || d.uploadedAt, type: d.type || "", size: d.size || 0 })),
    medicines: userMedicines.map(m => ({ name: m.name, dosage: m.dosage || "", instruction: m.instruction || "", time: m.time, enabled: m.enabled !== false, takenToday: m.takenTodayDate === today() })),
    totals: { documents: userDocuments.length, medicines: userMedicines.length }
  };
}

function personalIntent(q) {
  const s = q.toLowerCase(), a = [];
  const isKnowledgeQuery = /\b(diagnose|diagnosed|diagnosis|effect|effects|side effect|side-effect|cause|causes|symptom|symptoms|treatment|treat|how is|what is|why is)\b/i.test(s);

  if (/\b(my|mine|uploaded|upload|document|documents|report|reports|record|records|file|files)\b/.test(s)) a.push("documents");
  if (!isKnowledgeQuery && /\b(medicine|medicines|tablet|tablets|dose|dosage|drug|medication|pill|pills)\b/.test(s)) a.push("medicines");
  if (/\b(profile|name|age|blood|blood group)\b/.test(s)) a.push("profile");
  if (!isKnowledgeQuery && /\b(today|taken|missed|pending|schedule|scheduled|reminder|alarm)\b/.test(s)) a.push("today");
  return [...new Set(a)];
}

function personalAnswer(q) {
  const intents = personalIntent(q);
  if (!intents.length) return null;
  const out = [];
  if (intents.includes("profile")) out.push(`Your MedVault profile: ${currentProfile.name || "Patient"}${currentProfile.age ? `, age ${currentProfile.age}` : ""}, blood group ${currentProfile.blood || "not set"}.`);
  if (intents.includes("medicines") || intents.includes("today")) {
    const taken = userMedicines.filter(m => m.takenTodayDate === today()).length, pending = userMedicines.filter(m => m.enabled !== false && m.takenTodayDate !== today()).length;
    out.push(`You have ${userMedicines.length} saved medicines. ${taken} marked taken today and ${pending} active medicines are not marked taken today.`);
    if (userMedicines.length) out.push(userMedicines.map(m => `• ${m.name}${m.dosage ? ` — ${m.dosage}` : ""} at ${formatTime(m.time)} (${m.enabled === false ? "paused" : "active"}; ${m.takenTodayDate === today() ? "taken today" : "not marked taken today"})`).join("\n"));
  }
  if (intents.includes("documents")) {
    out.push(`You have ${userDocuments.length} uploaded medical documents.`);
    if (/\b(show|list|which|what|my)\b/i.test(q) && userDocuments.length) out.push(userDocuments.slice(0, 12).map(d => `• ${d.name} — ${d.category || "Other"}${d.doctor ? ` — ${d.doctor}` : ""} — ${formatDate(d.recordDate || d.uploadedAt)}`).join("\n"));
  }
  return out.length ? out.join("\n\n") : null;
}

async function answerAI(q) {
  const clean = String(q || "").trim();
  if (!clean) return { text: "Please type a question.", sources: [] };

  if (isGreetingOrCourtesy(clean)) {
    return {
      text: "You're welcome! I am here to provide educational health information and help you navigate the information stored in MedVault.",
      sources: []
    };
  }

  if (/\b(help|what can you do|how can you help)\b/i.test(clean)) return { text: "You can ask about medical topics in data.json, your saved medicines, medicine schedule, uploaded-document metadata, and profile details. I do not invent facts outside the local knowledge base.", sources: [] };
  const p = personalAnswer(clean);
  if (p) return { text: p, sources: [] };
  if (!knowledgeReady) await loadKnowledge();

  let filteredRelated = searchKnowledge(clean);

  if (isGreetingOrCourtesy(clean)) {
    filteredRelated = [];
  } else {
    filteredRelated = filteredRelated.slice(0, 1);
  }

  if (filteredRelated.length) {
    const top = filteredRelated[0].item;
    let text = `Based on MedVault's local medical knowledge:\n\n**${top.title}**\n${top.content}`;
    text += "\n\nEducational information only; not a diagnosis or a substitute for a qualified healthcare professional.";
    return { text, sources: filteredRelated.map(x => ({ title: x.item.title, section: x.item.section, source: x.item.source })) };
  }
  return { text: "I couldn't find a sufficiently relevant answer in local data.json. Try a more specific medical topic, or ask about your saved medicines, documents, or profile. I will not invent medical facts that are not present in the local knowledge base.", sources: [] };
}

function aiStatus(t, state = "ready") {
  const e = $("mvaiStatus");
  if (e) e.textContent = t;
  if (e) e.style.color = state === "error" ? "var(--red)" : state === "loading" ? "var(--orange)" : "var(--text-secondary)";
}

function renderAIUserContext() {
  const e = $("mvaiContext");
  if (!e) return;
  if (!currentUser) { e.textContent = "Personal context: sign in required"; return; }
  e.textContent = `${currentProfile.name?.split(" ")[0] || "Patient"} · ${userDocuments.length} records · ${userMedicines.length} medicines`;
}

function aiKey() {
  return `${AI_CONFIG.storagePrefix}:${currentUser?.id || "anonymous"}`;
}

function loadAIHistory() {
  try {
    const x = JSON.parse(localStorage.getItem(aiKey()) || "[]");
    aiHistory = Array.isArray(x) ? x.slice(-AI_CONFIG.maxHistory) : [];
  } catch {
    aiHistory = [];
  }
  if (window.MedVaultAI?.renderHistory) {
    window.MedVaultAI.renderHistory();
  }
}

function saveAIHistory() {
  try {
    localStorage.setItem(aiKey(), JSON.stringify(aiHistory.slice(-AI_CONFIG.maxHistory)));
  } catch (e) {
    console.warn(e);
  }
}

function clearAIHistory() {
  aiHistory = [];
  saveAIHistory();
  if (window.MedVaultAI?.clearHistory) {
    window.MedVaultAI.clearHistory();
  }
  toast("AI Chat Cleared", "Local chat history cleared.", "🧹");
}

function aiText(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/^• (.+)$/gm, "• $1").replace(/\n/g, "<br>");
}

async function sendAI(prompt) {
  const q = String(prompt || "").trim();
  if (!q) return;
  if (!currentUser) return toast("Sign In Required", "Sign in to use personalized MedVault AI.", "🔐");
  const input = $("mvaiInput"), send = $("mvaiSend");
  if (input) { input.value = ""; input.style.height = "auto"; }
  aiHistory.push({ role: "user", text: q, createdAt: new Date().toISOString() });
  saveAIHistory();
  if (window.MedVaultAI?.renderHistory) window.MedVaultAI.renderHistory();
  if (send) send.disabled = true;
  const box = $("mvaiMessages");
  const typing = document.createElement("div");
  typing.id = "mvaiTyping";
  typing.className = "mvai-msg";
  typing.innerHTML = `<div class="mvai-avatar">✦</div><div class="mvai-bubble">MedVault AI is thinking locally…</div>`;
  box?.appendChild(typing);
  if (box) box.scrollTop = box.scrollHeight;
  try {
    const a = await answerAI(q);
    $("mvaiTyping")?.remove();
    aiHistory.push({ role: "assistant", text: a.text, sources: a.sources || [], createdAt: new Date().toISOString() });
    saveAIHistory();
    if (window.MedVaultAI?.renderHistory) window.MedVaultAI.renderHistory();
  } catch (e) {
    $("mvaiTyping")?.remove();
    aiHistory.push({ role: "assistant", text: "Local AI processing failed. Please try again.", sources: [] });
    saveAIHistory();
    if (window.MedVaultAI?.renderHistory) window.MedVaultAI.renderHistory();
    console.error(e);
  } finally {
    if (send) send.disabled = false;
    input?.focus();
  }
}

/* =========================================================
   UNIFIED MEDVAULT AI CONTROLLER
   ========================================================= */
window.MedVaultAI = {
  currentMode: 'all',

  init() {
    this.renderHistory();
  },

  open() {
    openSection('medvaultAI');
    const widget = $("medvaultAIWidget");
    if (widget) widget.classList.add("open");
    const input = document.getElementById("aiInput");
    if (input) input.focus();
  },

  close() {
    const widget = $("medvaultAIWidget");
    if (widget) widget.classList.remove("open");
  },

  ask: answerAI,
  search: searchKnowledge,
  loadKnowledge,
  reloadKnowledge: () => loadKnowledge(true),
  getPersonalContext: personalContext,

  renderHistory() {
    const box = $("mvaiMessages");
    if (!box) return;
    if (!aiHistory.length) {
      box.innerHTML = `<div class="mvai-welcome"><div class="mvai-welcome-icon">✦</div><h3>MedVault AI</h3><p>Local medical knowledge + your MedVault context.</p><div class="mvai-suggestions"><button class="mvai-suggestion" data-p="What is fever?">🌡️ Learn about a medical topic</button><button class="mvai-suggestion" data-p="What medicines do I have?">💊 Show my medicines</button><button class="mvai-suggestion" data-p="Show my uploaded documents.">📁 Show my records</button></div></div>`;
      box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => sendAI(b.dataset.p));
      return;
    }
    box.innerHTML = "";
    aiHistory.forEach(m => {
      const d = document.createElement("div");
      d.className = `mvai-msg ${m.role}`;
      d.innerHTML = `<div class="mvai-avatar">${m.role === "user" ? esc(initials(currentProfile.name)) : "✦"}</div><div class="mvai-bubble"><div class="mvai-role">${m.role === "user" ? "You" : "MedVault AI"}</div><div>${aiText(m.text)}</div>${m.sources?.length ? `<div>${m.sources.slice(0, 5).map(s => `<span class="mvai-source">${esc(s.section)} · ${esc(s.title)}</span>`).join("")}</div>` : ""}</div>`;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  },

  switchMode(mode, btnElement) {
    this.currentMode = mode;
    document.querySelectorAll('.ai-mode-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    const titleMap = {
      all: 'Ask MedVault Assistant',
      knowledge: 'Medical Knowledge Search',
      medicines: 'Medicine Schedule AI',
      records: 'Health Records Assistant'
    };
    const titleEl = document.getElementById('aiCurrentTitle');
    if (titleEl) titleEl.textContent = titleMap[mode] || 'Ask MedVault';

    const input = document.getElementById('aiInput');
    if (input) {
      input.placeholder = `Ask about ${mode === 'all' ? 'anything' : mode}...`;
      input.focus();
    }
  },

  toggleSidebar() {
    const sidebar = document.getElementById('aiSidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
  },

  newChat() {
    const messages = document.getElementById('aiMessages');
    const hero = document.getElementById('aiWelcomeHero');
    if (messages && hero) {
      messages.innerHTML = '';
      messages.appendChild(hero);
      hero.classList.remove('hidden');
    }
  },

  clearHistory() {
    aiHistory = [];
    saveAIHistory();
    this.newChat();
    const historyList = document.getElementById('aiHistoryList');
    if (historyList) {
      historyList.innerHTML = `
        <button type="button" class="ai-history-item active">
          <span class="icon">💬</span>
          <span class="lbl">Current Session</span>
        </button>
      `;
    }
  },

  sendSuggested(text) {
    const input = document.getElementById('aiInput');
    if (input) {
      input.value = text;
      this.handleSubmit();
    }
  },

  handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSubmit(e);
    }
  },

  async handleSubmit(e) {
    if (e) e.preventDefault();

    const input = document.getElementById('aiInput');
    const query = input?.value?.trim();
    if (!query) return;

    input.value = '';

    const hero = document.getElementById('aiWelcomeHero');
    if (hero) hero.classList.add('hidden');

    this.appendMessage('user', query);

    const processing = document.getElementById('aiProcessing');
    if (processing) processing.classList.remove('hidden');
    this.scrollToBottom();

    try {
      let res = await answerAI(query);
      this.appendMessage('assistant', res.text || res);
    } catch (err) {
      this.appendMessage('assistant', 'Sorry, I encountered an issue accessing the local database.');
      console.error(err);
    } finally {
      if (processing) processing.classList.add('hidden');
      this.scrollToBottom();
    }
  },

  appendMessage(role, text) {
    const container = document.getElementById('aiMessages');
    if (!container) return;

    const row = document.createElement('div');
    row.className = `ai-msg-row ${role}`;
    const avatar = role === 'user' ? initials(currentProfile.name) : '✦';
    
    row.innerHTML = `
      ${role === 'assistant' ? `<div class="ai-msg-avatar">${avatar}</div>` : ''}
      <div class="ai-msg-body">${aiText(text)}</div>
      ${role === 'user' ? `<div class="ai-msg-avatar">${avatar}</div>` : ''}
    `;

    container.appendChild(row);
    this.scrollToBottom();
  },

  scrollToBottom() {
    const scrollArea = document.getElementById('aiScrollArea');
    if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  MedVaultAI.init();
});

/* ================= AUTH STATE / STARTUP ================= */
async function onUser(user) {
  const auth = $("authContainer"), app = document.querySelector(".app");
  if (!user) {
    currentUser = null;
    userDocuments = [];
    userMedicines = [];
    currentProfile = { name: "", email: "", blood: "O+", age: "" };
    unsubscribeProfile?.();
    unsubscribeDocuments?.();
    unsubscribeMedicines?.();
    unsubscribeProfile = unsubscribeDocuments = unsubscribeMedicines = null;
    clearInterval(medicineAlarmTimer);
    clearInterval(activeAlarmInterval);
    medicineAlarmTimer = activeAlarmInterval = null;
    aiHistory = [];
    auth?.classList.remove("hidden");
    app?.classList.add("hidden");
    renderAIUserContext();
    return;
  }
  currentUser = user;
  auth?.classList.add("hidden");
  app?.classList.remove("hidden");
  loadAIHistory();
  try { await loadProfile(user); } catch (e) { console.error("Profile:", e); }
  listenToProfile(user);
  listenToDocuments();
  listenToMedicines();
  renderDashboardUI();
  renderAIUserContext();
  loadKnowledge().catch(console.error);
}

supabase.auth.onAuthStateChange((event, session) => {
  console.log("Supabase Auth:", event, session?.user?.email || "Logged out");
  setTimeout(() => onUser(session?.user || null), 0);
});

async function initializeMedVault() {
  console.log("🏥 MedVault starting...");
  loadKnowledge().catch(console.error);
  try {
    const r = await supabase.auth.getSession();
    if (r.error) throw r.error;
    await onUser(r.data.session?.user || null);
    console.log("🔐 Supabase Auth: READY");
    console.log("🗄️ Supabase Database: READY");
    console.log(`☁️ Supabase Storage: ${SUPABASE_CONFIG.bucket}`);
    console.log("🧠 MedVault AI: LOCAL JSON KNOWLEDGE MODE");
  } catch (e) {
    console.error("MedVault initialization failed:", e);
    toast("Initialization Error", errMsg(e), "⚠️");
  }
  openSection("dashboard");
  console.log("✅ MedVault initialized.");
}

window.MedLedgerSupabase = { client: supabase, config: SUPABASE_CONFIG, getCurrentUser: () => currentUser, getDocuments: () => [...userDocuments], getMedicines: () => [...userMedicines], getProfile: () => ({ ...currentProfile }) };
window.MedVault = { supabase, config: SUPABASE_CONFIG, getCurrentUser: () => currentUser, getProfile: () => ({ ...currentProfile }), getDocuments: () => [...userDocuments], getMedicines: () => [...userMedicines], getAIContext: personalContext };

initializeMedVault();

function openSection(sectionId) {
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));

  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-target') === sectionId);
  });
}
window.openSection = openSection;
