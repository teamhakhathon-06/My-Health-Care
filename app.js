// =========================================================
// MedLedger
// CORE + FIREBASE + SECURE BACKBLAZE B2 CONFIGURATION
// =========================================================

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  remove,
  update
} from
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";


// =========================================================
// FIREBASE CONFIGURATION
// =========================================================

const firebaseConfig = {

  apiKey: "AIzaSyCMVD6bTQct-o_OWWvtBwrJOa3DJSWMhv0",

  authDomain:
    "myhealth-67e39.firebaseapp.com",

  databaseURL:
    "https://myhealth-67e39-default-rtdb.firebaseio.com",

  projectId:
    "myhealth-67e39",

  storageBucket:
    "myhealth-67e39.firebasestorage.app",

  messagingSenderId:
    "1067008214544",

  appId:
    "1:1067008214544:web:89775a4b4379aa2f062c95",

  measurementId:
    "G-5FDQ23216F"
};


// =========================================================
// INITIALIZE FIREBASE
// =========================================================

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getDatabase(app);

const googleProvider =
  new GoogleAuthProvider();


// =========================================================
// BACKBLAZE B2 CONFIGURATION
// =========================================================
//
// NEVER put:
// - B2 keyID
// - B2 applicationKey
//
// inside browser JavaScript.
//
// Browser
//    ↓ Firebase ID Token
// Cloudflare Worker
//    ↓ B2 credentials
// Backblaze B2
// =========================================================

const BACKBLAZE_B2_CONFIG = Object.freeze({

  enabled: true,

  workerUrl:
    "https://medledger-b2-worker.shaikhrehan.workers.dev",

  maxFileSize:
    25 * 1024 * 1024,

  allowedTypes: [
    "application/pdf",
    "image/jpeg",
    "image/png"
  ]

});


// =========================================================
// GLOBAL STATE
// =========================================================

let currentUser = null;

let currentProfile = {
  name: "",
  email: "",
  blood: "O+",
  age: ""
};

let userDocuments = [];

let userMedicines = [];

let activeCategoryFilter = "all";

let activeSearchQuery = "";

let unsubscribeProfile = null;

let unsubscribeDocuments = null;

let unsubscribeMedicines = null;

let medicineAlarmTimer = null;

let activeAlarmInterval = null;

let activeAlarmMedId = null;

let audioCtx = null;


// =========================================================
// DOM HELPER
// =========================================================

const $ = id =>
  document.getElementById(id);


// =========================================================
// SECURITY HELPER
// =========================================================

function escapeHTML(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// =========================================================
// GENERAL HELPERS
// =========================================================

function initials(name) {

  if (!name) return "U";

  return name
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}


function formatDate(value) {

  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime()))
    return String(value);

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  );
}


function formatTime(time) {

  if (!time) return "";

  const [hour, minute] =
    time.split(":");

  const date = new Date();

  date.setHours(
    Number(hour),
    Number(minute),
    0,
    0
  );

  return date.toLocaleTimeString(
    "en-IN",
    {
      hour: "numeric",
      minute: "2-digit"
    }
  );
}


function formatBytes(bytes) {

  if (!bytes) return "0 KB";

  const sizes = [
    "Bytes",
    "KB",
    "MB",
    "GB"
  ];

  const i =
    Math.floor(
      Math.log(bytes) /
      Math.log(1024)
    );

  return `${(
    bytes /
    Math.pow(1024, i)
  ).toFixed(1)} ${sizes[i]}`;
}


function getDocumentIcon(
  mimeType,
  fileName = ""
) {

  const extension =
    fileName
      .split(".")
      .pop()
      .toLowerCase();

  if (
    extension === "pdf" ||
    mimeType?.includes("pdf")
  ) {
    return "📕";
  }

  return "🖼️";
}


// =========================================================
// TOAST
// =========================================================

function showToast(
  title,
  message,
  icon = "🔔"
) {

  const toast =
    $("toastNotification");

  if (!toast) return;

  $("toastTitle").textContent =
    title;

  $("toastBody").textContent =
    message;

  $("toastIcon").textContent =
    icon;

  toast.classList.remove("hidden");

  setTimeout(() => {

    toast.classList.add("hidden");

  }, 4500);
}


window.hideToast = () => {

  $("toastNotification")
    ?.classList.add("hidden");

};


// =========================================================
// STEP 2 — AUTHENTICATION
// =========================================================

function formatAuthError(error) {

  switch (error?.code) {

    case "auth/email-already-in-use":
      return "This email is already registered.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Invalid email or password.";

    case "auth/weak-password":
      return "Password must contain at least 6 characters.";

    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";

    case "auth/popup-blocked":
      return "Please allow popups for Google sign-in.";

    case "auth/network-request-failed":
      return "Network error. Check your internet connection.";

    default:
      return error?.message ||
        "Authentication failed.";
  }
}


// =========================================================
// AUTH TABS
// =========================================================

function switchAuthTab(tab) {

  const loginTab =
    $("tabLoginBtn");

  const registerTab =
    $("tabRegisterBtn");

  const loginForm =
    $("loginForm");

  const registerForm =
    $("registerForm");

  if (tab === "login") {

    loginTab?.classList.add("active");

    registerTab?.classList.remove("active");

    loginForm?.classList.remove("hidden");

    registerForm?.classList.add("hidden");

  } else {

    registerTab?.classList.add("active");

    loginTab?.classList.remove("active");

    registerForm?.classList.remove("hidden");

    loginForm?.classList.add("hidden");
  }
}


$("tabLoginBtn")
  ?.addEventListener(
    "click",
    () => switchAuthTab("login")
  );


$("tabRegisterBtn")
  ?.addEventListener(
    "click",
    () => switchAuthTab("register")
  );


// =========================================================
// LOGIN
// =========================================================

$("loginForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      const email =
        $("loginEmail")?.value.trim();

      const password =
        $("loginPassword")?.value;

      const error =
        $("loginError");

      if (error)
        error.textContent = "";

      try {

        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

      } catch (err) {

        console.error(err);

        if (error)
          error.textContent =
            formatAuthError(err);
      }
    }
  );


// =========================================================
// REGISTRATION
// =========================================================

$("registerForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      const name =
        $("regName")?.value.trim();

      const email =
        $("regEmail")?.value.trim();

      const password =
        $("regPassword")?.value;

      const blood =
        $("regBlood")?.value || "O+";

      const age =
        $("regAge")?.value || "";

      const error =
        $("regError");

      if (error)
        error.textContent = "";

      if (!name || !email || !password) {

        if (error)
          error.textContent =
            "Please complete all required fields.";

        return;
      }

      try {

        const credential =
          await createUserWithEmailAndPassword(
            auth,
            email,
            password
          );

        await updateProfile(
          credential.user,
          {
            displayName: name
          }
        );

        const profile = {

          name,

          email,

          blood,

          age,

          createdAt: Date.now(),

          updatedAt: Date.now()

        };

        await set(
          ref(
            db,
            `users/${credential.user.uid}/profile`
          ),
          profile
        );

        showToast(
          "Account Created",
          `Welcome to MedLedger, ${name}.`,
          "✅"
        );

      } catch (err) {

        console.error(err);

        if (error)
          error.textContent =
            formatAuthError(err);
      }
    }
  );


// =========================================================
// GOOGLE LOGIN
// =========================================================

$("googleSignInBtn")
  ?.addEventListener(
    "click",
    async () => {

      try {

        await signInWithPopup(
          auth,
          googleProvider
        );

      } catch (err) {

        console.error(err);

        const error =
          $("loginError");

        if (error)
          error.textContent =
            formatAuthError(err);
      }
    }
  );


// =========================================================
// LOGOUT
// =========================================================

async function handleSignOut() {

  try {

    await signOut(auth);

    window.closeMobileSidebar?.();

  } catch (error) {

    console.error(
      "Logout failed:",
      error
    );
  }
}


$("logoutBtn")
  ?.addEventListener(
    "click",
    handleSignOut
  );


$("profileLogoutBtn")
  ?.addEventListener(
    "click",
    handleSignOut
  );

  // =========================================================
// STEP 3 — PROFILE
// =========================================================

function listenToProfile(user) {

  if (!user) return;

  const profileRef =
    ref(
      db,
      `users/${user.uid}/profile`
    );

  if (unsubscribeProfile)
    unsubscribeProfile();

  unsubscribeProfile =
    onValue(
      profileRef,
      snapshot => {

        let profile =
          snapshot.val();

        if (!profile) {

          profile = {

            name:
              user.displayName ||
              user.email?.split("@")[0] ||
              "Patient",

            email:
              user.email || "",

            blood: "O+",

            age: "",

            createdAt: Date.now(),

            updatedAt: Date.now()

          };

          set(
            profileRef,
            profile
          ).catch(console.error);
        }

        currentProfile =
          profile;

        renderProfileUI(
          profile
        );

      },
      error => {

        console.error(
          "Profile listener:",
          error
        );

      }
    );
}


function renderProfileUI(profile) {

  const name =
    profile.name ||
    "Patient";

  const blood =
    profile.blood ||
    "O+";

  const age =
    profile.age
      ? `${profile.age} yrs`
      : "— yrs";

  const email =
    profile.email ||
    currentUser?.email ||
    "—";

  const avatar =
    initials(name);


  if ($("dashboardName"))
    $("dashboardName")
      .textContent =
      name.split(" ")[0];


  if ($("heroName"))
    $("heroName")
      .textContent =
      name;


  if ($("heroBlood"))
    $("heroBlood")
      .textContent =
      `Blood Group: ${blood}`;


  if ($("heroAvatar"))
    $("heroAvatar")
      .textContent =
      avatar;


  if ($("sidebarName"))
    $("sidebarName")
      .textContent =
      name;


  if ($("sidebarBlood"))
    $("sidebarBlood")
      .textContent =
      `Blood: ${blood}`;


  if ($("sidebarAvatar"))
    $("sidebarAvatar")
      .textContent =
      avatar;


  if ($("profileAvatarLarge"))
    $("profileAvatarLarge")
      .textContent =
      avatar;


  if ($("profileNameLarge"))
    $("profileNameLarge")
      .textContent =
      name;


  if ($("profileDisplayName"))
    $("profileDisplayName")
      .textContent =
      name;


  if ($("profileBlood"))
    $("profileBlood")
      .textContent =
      blood;


  if ($("profileAge"))
    $("profileAge")
      .textContent =
      age;


  if ($("profileEmail"))
    $("profileEmail")
      .textContent =
      email;


  document
    .querySelectorAll(".mobile-avatar")
    .forEach(element => {

      element.textContent =
        avatar;

    });
}

// =========================================================
// STEP 4 — BACKBLAZE B2 ENGINE
// =========================================================

function getWorkerURL() {

  const url =
    String(
      BACKBLAZE_B2_CONFIG.workerUrl
    )
    .trim()
    .replace(/\/+$/, "");

  if (!url) {

    throw new Error(
      "Backblaze Worker URL is not configured."
    );
  }

  if (!url.startsWith("https://")) {

    throw new Error(
      "Backblaze Worker must use HTTPS."
    );
  }

  return url;
}


// =========================================================
// FIREBASE ID TOKEN
// =========================================================

async function getFirebaseIdToken() {

  if (!currentUser)
    throw new Error(
      "Please sign in again."
    );

  return await currentUser
    .getIdToken(true);
}


// =========================================================
// WORKER HEALTH CHECK
// =========================================================

async function testBackblazeWorker() {

  try {

    const response =
      await fetch(
        `${getWorkerURL()}/health`,
        {
          cache: "no-store"
        }
      );

    return response.ok;

  } catch (error) {

    console.error(
      "B2 Worker unavailable:",
      error
    );

    return false;
  }
}


// =========================================================
// UPLOAD
// =========================================================

async function uploadToB2(
  file,
  metadata,
  progressCallback
) {

  if (!file)
    throw new Error(
      "No file selected."
    );


  if (
    file.size >
    BACKBLAZE_B2_CONFIG.maxFileSize
  ) {

    throw new Error(
      "Maximum file size is 25 MB."
    );
  }


  const token =
    await getFirebaseIdToken();

  progressCallback?.(
    10,
    "Preparing secure upload..."
  );


  const form =
    new FormData();


  form.append(
    "file",
    file,
    file.name
  );


  form.append(
    "title",
    metadata.title || file.name
  );


  form.append(
    "category",
    metadata.category || "Other"
  );


  form.append(
    "recordDate",
    metadata.recordDate || ""
  );


  form.append(
    "doctor",
    metadata.doctor || ""
  );


  progressCallback?.(
    30,
    "Uploading to secure storage..."
  );


  const response =
    await fetch(
      `${getWorkerURL()}/upload`,
      {

        method: "POST",

        headers: {
          Authorization:
            `Bearer ${token}`
        },

        body: form

      }
    );


  const text =
    await response.text();


  let result;

  try {

    result =
      JSON.parse(text);

  } catch {

    throw new Error(
      "Storage Worker returned invalid data."
    );
  }


  if (!response.ok) {

    throw new Error(
      result.error ||
      `Upload failed (${response.status}).`
    );
  }


  if (!result.success) {

    throw new Error(
      result.error ||
      "B2 upload was not confirmed."
    );
  }


  progressCallback?.(
    90,
    "Upload complete..."
  );


  return {

    fileId:
      result.file_id ||
      result.fileId ||
      "",

    storagePath:
      result.storage_path ||
      result.file_path ||
      result.fileName ||
      result.file_name ||
      "",

    originalName:
      result.file_name ||
      file.name,

    downloadURL:
      result.downloadURL ||
      result.download_url ||
      ""

  };
}


// =========================================================
// DOWNLOAD
// =========================================================

window.downloadDocumentRecord =
  async function (docId) {

    if (!currentUser)
      return;


    const document =
      userDocuments.find(
        doc => doc.id === docId
      );


    if (!document) {

      showToast(
        "Download Error",
        "Document not found.",
        "⚠️"
      );

      return;
    }


    if (document.downloadURL) {

      window.open(
        document.downloadURL,
        "_blank",
        "noopener,noreferrer"
      );

      return;
    }


    const storagePath =
      document.b2StoragePath ||
      document.b2FileName;


    if (!storagePath) {

      showToast(
        "Download Error",
        "Secure storage path is missing.",
        "⚠️"
      );

      return;
    }


    try {

      showToast(
        "Preparing Download",
        "Requesting secure file...",
        "☁️"
      );


      const token =
        await getFirebaseIdToken();


      const response =
        await fetch(
          `${getWorkerURL()}/download?file=${encodeURIComponent(storagePath)}`,
          {

            headers: {

              Authorization:
                `Bearer ${token}`

            }

          }
        );


      if (!response.ok) {

        let message =
          `Download failed (${response.status}).`;

        try {

          const result =
            await response.json();

          message =
            result.error ||
            result.message ||
            message;

        } catch {}

        throw new Error(message);
      }


      const blob =
        await response.blob();


      if (!blob.size)
        throw new Error(
          "Downloaded file is empty."
        );


      const blobURL =
        URL.createObjectURL(blob);


      const link =
        document.createElement("a");


      link.href =
        blobURL;


      link.download =
        document.originalName ||
        document.name ||
        "medical-document";


      document.body.appendChild(link);

      link.click();

      link.remove();


      setTimeout(
        () =>
          URL.revokeObjectURL(blobURL),
        10000
      );


      showToast(
        "Download Started",
        document.name,
        "✅"
      );

    } catch (error) {

      console.error(error);

      showToast(
        "Download Failed",
        error.message,
        "⚠️"
      );
    }
  };

  // =========================================================
// STEP 5 — DOCUMENT VAULT
// =========================================================

let selectedScreenFile = null;


// =========================================================
// FILE VALIDATION
// =========================================================

window.handleScreenFileSelected =
  function (input) {

    const file =
      input.files?.[0];

    if (!file) return;


    const allowed =
      BACKBLAZE_B2_CONFIG
        .allowedTypes
        .includes(file.type);


    if (!allowed) {

      alert(
        "Only PDF, JPG and PNG files are allowed."
      );

      input.value = "";

      return;
    }


    if (
      file.size >
      BACKBLAZE_B2_CONFIG.maxFileSize
    ) {

      alert(
        "Maximum file size is 25 MB."
      );

      input.value = "";

      return;
    }


    selectedScreenFile =
      file;


    if ($("screenPickerTitle"))
      $("screenPickerTitle")
        .textContent =
        file.name;


    if ($("screenPickerSub"))
      $("screenPickerSub")
        .textContent =
        `💾 ${formatBytes(file.size)} · Secure B2 Ready`;


    if ($("screenPickerIcon"))
      $("screenPickerIcon")
        .textContent =
        getDocumentIcon(
          file.type,
          file.name
        );


    const title =
      $("screenDocTitle");


    if (title && !title.value) {

      title.value =
        file.name.replace(
          /\.[^/.]+$/,
          ""
        );
    }
  };


// =========================================================
// UPLOAD FORM
// =========================================================

$("screenUploadForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      if (!currentUser) {

        alert(
          "Please sign in first."
        );

        return;
      }


      if (!selectedScreenFile) {

        alert(
          "Please select a file."
        );

        return;
      }


      const title =
        $("screenDocTitle")
          ?.value.trim() ||
        selectedScreenFile.name;


      const category =
        $("screenDocCategory")
          ?.value ||
        "Other";


      const recordDate =
        $("screenDocDate")
          ?.value ||
        new Date()
          .toISOString()
          .split("T")[0];


      const doctor =
        $("screenDocDoctor")
          ?.value.trim() ||
        "";


      const submitButton =
        $("screenSubmitBtn");


      const progress =
        $("screenUploadProgress");


      const progressFill =
        $("screenProgressFill");


      const progressText =
        $("screenProgressText");


      submitButton?.setAttribute(
        "disabled",
        "true"
      );


      progress?.classList.remove(
        "hidden"
      );


      try {

        const documentId =
          push(
            ref(
              db,
              `users/${currentUser.uid}/documents`
            )
          ).key;


        const b2 =
          await uploadToB2(
            selectedScreenFile,

            {
              title,
              category,
              recordDate,
              doctor
            },

            (percent, message) => {

              if (progressFill)
                progressFill.style.width =
                  `${percent}%`;

              if (progressText)
                progressText.textContent =
                  message;
            }
          );


        if (!b2.storagePath) {

          throw new Error(
            "B2 did not return a storage path."
          );
        }


        const record = {

          id: documentId,

          name: title,

          originalName:
            selectedScreenFile.name,

          type:
            selectedScreenFile.type,

          size:
            selectedScreenFile.size,

          formattedSize:
            formatBytes(
              selectedScreenFile.size
            ),

          category,

          recordDate,

          doctor,

          icon:
            getDocumentIcon(
              selectedScreenFile.type,
              selectedScreenFile.name
            ),

          b2FileId:
            b2.fileId,

          b2FileName:
            b2.storagePath,

          b2StoragePath:
            b2.storagePath,

          storageBackend:
            "Backblaze B2",

          uploadedAt:
            Date.now()

        };


        await set(
          ref(
            db,
            `users/${currentUser.uid}/documents/${documentId}`
          ),
          record
        );


        userDocuments.unshift(
          record
        );


        renderDocumentsUI();

        updateCategoryCounts();

        renderDashboardUI();


        showToast(
          "Document Uploaded",
          `${title} saved securely.`,
          "📁"
        );


        $("screenUploadForm")
          ?.reset();


        selectedScreenFile =
          null;


      } catch (error) {

        console.error(
          "Document upload:",
          error
        );


        showToast(
          "Upload Failed",
          error.message,
          "⚠️"
        );

      } finally {

        submitButton?.removeAttribute(
          "disabled"
        );

        progress?.classList.add(
          "hidden"
        );
      }
    }
  );


// =========================================================
// LISTEN FOR DOCUMENTS
// =========================================================

function listenToDocuments() {

  if (!currentUser)
    return;


  if (unsubscribeDocuments)
    unsubscribeDocuments();


  const documentsRef =
    ref(
      db,
      `users/${currentUser.uid}/documents`
    );


  unsubscribeDocuments =
    onValue(
      documentsRef,
      snapshot => {

        const data =
          snapshot.val() || {};


        userDocuments =
          Object.values(data)
            .sort(
              (a, b) =>
                (b.uploadedAt || 0) -
                (a.uploadedAt || 0)
            );


        updateCategoryCounts();

        renderDocumentsUI();

        renderDashboardUI();

        updateAiHealthStats();

      }
    );
}


// =========================================================
// CATEGORY COUNTS
// =========================================================

function updateCategoryCounts() {

  const counts = {};

  userDocuments.forEach(
    document => {

      const category =
        document.category ||
        "Other";

      counts[category] =
        (counts[category] || 0) + 1;

    }
  );


  if ($("count-all"))
    $("count-all")
      .textContent =
      userDocuments.length;


  if ($("navDocCount"))
    $("navDocCount")
      .textContent =
      userDocuments.length;


  const folders = {

    Prescription:
      "folderCountPrescription",

    "Blood Test":
      "folderCountBloodTest",

    Scan:
      "folderCountScan",

    Surgery:
      "folderCountSurgery",

    Vaccination:
      "folderCountVaccination",

    Other:
      "folderCountOther"

  };


  Object.entries(folders)
    .forEach(
      ([category, elementId]) => {

        if ($(elementId)) {

          $(elementId)
            .textContent =
            `${counts[category] || 0} files`;
        }

      }
    );
}


// =========================================================
// DOCUMENT RENDERING
// =========================================================

function renderDocumentsUI() {

  const grid =
    $("vaultGrid");

  if (!grid) return;


  let documents =
    [...userDocuments];


  if (
    activeCategoryFilter !==
    "all"
  ) {

    documents =
      documents.filter(
        doc =>
          (doc.category ||
           "Other") ===
          activeCategoryFilter
      );
  }


  if (activeSearchQuery) {

    documents =
      documents.filter(
        doc => {

          const text =
            `${doc.name || ""} ${doc.doctor || ""} ${doc.category || ""}`
              .toLowerCase();

          return text.includes(
            activeSearchQuery
          );
        }
      );
  }


  if (!documents.length) {

    grid.innerHTML = `

      <div class="empty-state"
           style="grid-column:1/-1">

        <div class="empty-icon">
          🗂️
        </div>

        <strong>
          No medical records found
        </strong>

        <p>
          Upload prescriptions,
          reports or diagnostic scans.
        </p>

      </div>

    `;

    return;
  }


  grid.innerHTML =
    documents.map(
      document => `

      <div class="doc-card">

        <div class="doc-header">

          <div class="doc-icon-badge">
            ${escapeHTML(
              document.icon || "📄"
            )}
          </div>

          <span class="category-tag">
            ${escapeHTML(
              document.category || "Other"
            )}
          </span>

        </div>


        <div class="doc-name">
          ${escapeHTML(
            document.name
          )}
        </div>


        <div class="doc-doctor">
          ${
            document.doctor
              ? `👨‍⚕️ ${escapeHTML(document.doctor)}`
              : "🏥 Medical Report"
          }
        </div>


        <div class="doc-meta-strip">

          📅
          ${formatDate(
            document.recordDate ||
            document.uploadedAt
          )}

          ·

          💾
          ${formatBytes(
            document.size
          )}

        </div>


        <div class="doc-actions">

          <button
            class="btn-open"
            onclick="downloadDocumentRecord('${escapeHTML(document.id)}')">

            Download ↧

          </button>


          <button
            class="btn-del"
            onclick="deleteDocumentRecord('${escapeHTML(document.id)}')">

            Delete

          </button>

        </div>

      </div>

    `
    ).join("");
}


// =========================================================
// DELETE DOCUMENT
// =========================================================

window.deleteDocumentRecord =
  async function (docId) {

    if (!currentUser)
      return;


    const document =
      userDocuments.find(
        d => d.id === docId
      );


    if (!document)
      return;


    if (
      !confirm(
        `Delete "${document.name}"?`
      )
    ) return;


    try {

      await remove(
        ref(
          db,
          `users/${currentUser.uid}/documents/${docId}`
        )
      );


      showToast(
        "Document Deleted",
        document.name,
        "🗑️"
      );

    } catch (error) {

      console.error(error);

      showToast(
        "Delete Failed",
        error.message,
        "⚠️"
      );
    }
  };


// =========================================================
// SEARCH
// =========================================================

window.filterDocuments =
  function () {

    activeSearchQuery =
      $("docSearchInput")
        ?.value
        .trim()
        .toLowerCase() ||
      "";

    renderDocumentsUI();
  };


window.setCategoryFilter =
  function (category) {

    activeCategoryFilter =
      category;

    renderDocumentsUI();

  };

  // =========================================================
// STEP 6 — MEDICINE + ALARM SYSTEM
// =========================================================

function playAlarmChime() {

  try {

    if (!audioCtx) {

      audioCtx =
        new (
          window.AudioContext ||
          window.webkitAudioContext
        )();

    }


    if (
      audioCtx.state ===
      "suspended"
    ) {

      audioCtx.resume();

    }


    const oscillator =
      audioCtx.createOscillator();


    const gain =
      audioCtx.createGain();


    oscillator.type =
      "sine";


    oscillator.frequency
      .setValueAtTime(
        880,
        audioCtx.currentTime
      );


    oscillator.frequency
      .setValueAtTime(
        1174,
        audioCtx.currentTime + 0.15
      );


    oscillator.frequency
      .setValueAtTime(
        880,
        audioCtx.currentTime + 0.3
      );


    gain.gain
      .setValueAtTime(
        0.3,
        audioCtx.currentTime
      );


    gain.gain
      .exponentialRampToValueAtTime(
        0.01,
        audioCtx.currentTime + 0.5
      );


    oscillator.connect(gain);

    gain.connect(
      audioCtx.destination
    );


    oscillator.start();

    oscillator.stop(
      audioCtx.currentTime + 0.55
    );

  } catch (error) {

    console.warn(
      "Audio unavailable:",
      error
    );

  }
}


// =========================================================
// START ALARM
// =========================================================

function startRingingAlarm(medicine) {

  activeAlarmMedId =
    medicine.id;


  if ($("alarmMedName"))
    $("alarmMedName")
      .textContent =
      medicine.name;


  if ($("alarmMedInstruction"))
    $("alarmMedInstruction")
      .textContent =
      medicine.instruction ||
      "Time to take your medicine";


  if ($("alarmMedTime"))
    $("alarmMedTime")
      .textContent =
      formatTime(
        medicine.time
      );


  $("medicineAlarmModal")
    ?.classList.remove(
      "hidden"
    );


  playAlarmChime();


  if (activeAlarmInterval)
    clearInterval(
      activeAlarmInterval
    );


  activeAlarmInterval =
    setInterval(
      playAlarmChime,
      1000
    );
}


// =========================================================
// STOP ALARM
// =========================================================

window.stopMedicineAlarm =
  async function (
    markTaken = false
  ) {

    if (activeAlarmInterval) {

      clearInterval(
        activeAlarmInterval
      );

      activeAlarmInterval =
        null;
    }


    $("medicineAlarmModal")
      ?.classList.add(
        "hidden"
      );


    if (
      markTaken &&
      activeAlarmMedId
    ) {

      await window
        .toggleMedicineTaken(
          activeAlarmMedId
        );

    }


    activeAlarmMedId =
      null;
  };


// =========================================================
// ADD MEDICINE
// =========================================================

$("medicineForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      if (!currentUser)
        return;


      const name =
        $("medicineName")
          ?.value.trim();


      const instruction =
        $("medicineInstruction")
          ?.value ||
        "";


      const dosage =
        $("medicineDosage")
          ?.value.trim() ||
        "";


      const time =
        $("medicineTime")
          ?.value;


      if (!name || !time) {

        alert(
          "Enter medicine name and time."
        );

        return;
      }


      const id =
        push(
          ref(
            db,
            `users/${currentUser.uid}/medicines`
          )
        ).key;


      const medicine = {

        id,

        name,

        instruction,

        dosage,

        time,

        enabled: true,

        takenTodayDate: "",

        createdAt:
          Date.now(),

        updatedAt:
          Date.now()

      };


      await set(
        ref(
          db,
          `users/${currentUser.uid}/medicines/${id}`
        ),
        medicine
      );


      $("medicineForm")
        ?.reset();


      showToast(
        "Alarm Added",
        `${name} at ${formatTime(time)}`,
        "⏰"
      );
    }
  );


// =========================================================
// MEDICINE LISTENER
// =========================================================

function listenToMedicines() {

  if (!currentUser)
    return;


  if (unsubscribeMedicines)
    unsubscribeMedicines();


  const medicinesRef =
    ref(
      db,
      `users/${currentUser.uid}/medicines`
    );


  unsubscribeMedicines =
    onValue(
      medicinesRef,
      snapshot => {

        const data =
          snapshot.val() || {};


        userMedicines =
          Object.values(data);


        userMedicines.sort(
          (a, b) =>
            String(a.time)
              .localeCompare(
                String(b.time)
              )
        );


        renderMedicinesUI();

        renderDashboardUI();

        startAlarmScheduler();

      }
    );
}


// =========================================================
// RENDER MEDICINES
// =========================================================

function renderMedicinesUI() {

  const list =
    $("trackList");

  if (!list) return;


  if ($("navMedCount"))
    $("navMedCount")
      .textContent =
      userMedicines.length;


  if ($("statMedCount"))
    $("statMedCount")
      .textContent =
      userMedicines.length;


  if (!userMedicines.length) {

    list.innerHTML = `

      <div class="empty-state">

        <div class="empty-icon">
          💊
        </div>

        <strong>
          No medicines scheduled
        </strong>

        <p>
          Add your daily medicine
          reminders.
        </p>

      </div>

    `;

    return;
  }


  const today =
    new Date()
      .toISOString()
      .split("T")[0];


  list.innerHTML =
    userMedicines.map(
      medicine => {

        const taken =
          medicine.takenTodayDate ===
          today;


        return `

          <div class="medicine-item
            ${taken ? "done" : ""}">

            <button
              class="med-check-btn"
              onclick="toggleMedicineTaken('${escapeHTML(medicine.id)}')">

              ${taken ? "✓" : "○"}

            </button>


            <div class="med-details">

              <div class="med-name">

                ${escapeHTML(
                  medicine.name
                )}

              </div>


              <div class="med-sub">

                ${
                  medicine.dosage
                    ? `${escapeHTML(medicine.dosage)} · `
                    : ""
                }

                ${formatTime(
                  medicine.time
                )}

              </div>

            </div>


            <div class="med-controls">

              <button
                onclick="toggleMedicineEnabled('${escapeHTML(medicine.id)}')">

                ${
                  medicine.enabled === false
                    ? "▶"
                    : "⏸"
                }

              </button>


              <button
                onclick="deleteMedicineRecord('${escapeHTML(medicine.id)}')">

                🗑

              </button>

            </div>

          </div>

        `;
      }
    ).join("");
}


// =========================================================
// MARK TAKEN
// =========================================================

window.toggleMedicineTaken =
  async function (id) {

    const medicine =
      userMedicines.find(
        m => m.id === id
      );

    if (!medicine)
      return;


    const today =
      new Date()
        .toISOString()
        .split("T")[0];


    const value =
      medicine.takenTodayDate === today
        ? ""
        : today;


    await update(
      ref(
        db,
        `users/${currentUser.uid}/medicines/${id}`
      ),
      {
        takenTodayDate: value,
        updatedAt: Date.now()
      }
    );
  };


// =========================================================
// ENABLE / DISABLE
// =========================================================

window.toggleMedicineEnabled =
  async function (id) {

    const medicine =
      userMedicines.find(
        m => m.id === id
      );

    if (!medicine)
      return;


    await update(
      ref(
        db,
        `users/${currentUser.uid}/medicines/${id}`
      ),
      {
        enabled:
          medicine.enabled === false,

        updatedAt:
          Date.now()
      }
    );
  };


// =========================================================
// DELETE
// =========================================================

window.deleteMedicineRecord =
  async function (id) {

    const medicine =
      userMedicines.find(
        m => m.id === id
      );

    if (!medicine)
      return;


    if (
      !confirm(
        `Delete ${medicine.name}?`
      )
    )
      return;


    await remove(
      ref(
        db,
        `users/${currentUser.uid}/medicines/${id}`
      )
    );


    showToast(
      "Medicine Removed",
      medicine.name,
      "🗑️"
    );
  };


// =========================================================
// ALARM SCHEDULER
// =========================================================

function startAlarmScheduler() {

  if (medicineAlarmTimer)
    clearInterval(
      medicineAlarmTimer
    );


  checkAlarms();


  medicineAlarmTimer =
    setInterval(
      checkAlarms,
      15000
    );
}


function checkAlarms() {

  if (
    !currentUser ||
    !userMedicines.length
  )
    return;


  const now =
    new Date();


  const hour =
    String(
      now.getHours()
    ).padStart(2, "0");


  const minute =
    String(
      now.getMinutes()
    ).padStart(2, "0");


  const currentTime =
    `${hour}:${minute}`;


  const today =
    now.toISOString()
      .split("T")[0];


  userMedicines.forEach(
    medicine => {

      if (
        medicine.enabled === false
      )
        return;


      if (
        medicine.time !==
        currentTime
      )
        return;


      const key =
        `medledger_alarm_${currentUser.uid}_${medicine.id}_${today}`;


      if (
        localStorage.getItem(key)
      )
        return;


      localStorage.setItem(
        key,
        "1"
      );


      startRingingAlarm(
        medicine
      );

    }
  );
}


// =========================================================
// STEP 7 — DASHBOARD
// =========================================================

function renderDashboardUI() {

  // -------------------------------------------------------
  // DOCUMENT COUNT
  // -------------------------------------------------------

  if ($("statDocCount"))
    $("statDocCount")
      .textContent =
      userDocuments.length;


  // -------------------------------------------------------
  // MEDICINE COUNT
  // -------------------------------------------------------

  if ($("statMedCount"))
    $("statMedCount")
      .textContent =
      userMedicines.length;


  // -------------------------------------------------------
  // LAST DOCUMENT
  // -------------------------------------------------------

  if ($("statLastDoc")) {

    const latest =
      userDocuments[0];

    $("statLastDoc")
      .textContent =
      latest
        ? formatDate(
            latest.recordDate ||
            latest.uploadedAt
          )
        : "No uploads yet";
  }


  // -------------------------------------------------------
  // NEXT MEDICINE
  // -------------------------------------------------------

  if ($("statNextMed")) {

    const medicines =
      userMedicines
        .filter(
          medicine =>
            medicine.enabled !== false
        )
        .sort(
          (a, b) =>
            a.time.localeCompare(
              b.time
            )
        );


    $("statNextMed")
      .textContent =
      medicines.length
        ? `${formatTime(medicines[0].time)} next`
        : "No alarms set";
  }


  // -------------------------------------------------------
  // RECENT DOCUMENTS
  // -------------------------------------------------------

  const recent =
    $("recentActivity");


  if (recent) {

    recent.innerHTML =
      userDocuments
        .slice(0, 4)
        .map(
          document => `

            <div class="recent-doc-item">

              <div class="recent-doc-icon">
                ${escapeHTML(
                  document.icon || "📄"
                )}
              </div>


              <div class="recent-doc-info">

                <strong>
                  ${escapeHTML(
                    document.name
                  )}
                </strong>

                <span>

                  ${escapeHTML(
                    document.category ||
                    "Record"
                  )}

                  ·

                  ${formatDate(
                    document.recordDate ||
                    document.uploadedAt
                  )}

                </span>

              </div>


              <button
                class="btn-link"
                onclick="downloadDocumentRecord('${escapeHTML(document.id)}')">

                Download

              </button>

            </div>

          `
        )
        .join("");
  }


  // -------------------------------------------------------
  // MEDICINES
  // -------------------------------------------------------

  const medicineList =
    $("dashboardMedList");


  if (medicineList) {

    medicineList.innerHTML =
      userMedicines
        .slice(0, 4)
        .map(
          medicine => `

            <div class="recent-doc-item">

              <div class="recent-doc-icon">
                💊
              </div>

              <div class="recent-doc-info">

                <strong>
                  ${escapeHTML(
                    medicine.name
                  )}
                </strong>

                <span>
                  ${escapeHTML(
                    medicine.instruction ||
                    "Daily"
                  )}
                  ·
                  ${formatTime(
                    medicine.time
                  )}
                </span>

              </div>

            </div>

          `
        )
        .join("");
  }
}

// =========================================================
// STEP 8 — AI / DOCUMENT ANALYSIS
// =========================================================
//
// IMPORTANT:
// This layer does NOT diagnose disease.
// It summarizes metadata until a real AI/document
// extraction backend is connected.
// =========================================================

window.runAiAnalysis =
  function () {

    const output =
      $("aiAnalysisOutput");

    if (!output)
      return;


    if (!userDocuments.length) {

      output.innerHTML = `

        <div class="ai-empty-state">

          <div class="ai-spark-icon">
            ✨
          </div>

          <h3>
            No Medical Documents
          </h3>

          <p>
            Upload a medical document
            to begin document analysis.
          </p>

        </div>

      `;

      return;
    }


    output.innerHTML = `

      <div class="ai-empty-state">

        <div class="ai-spark-icon">
          ⏳
        </div>

        <h3>
          Analyzing Medical Vault
        </h3>

        <p>
          Preparing ${userDocuments.length}
          document(s) for analysis...
        </p>

      </div>

    `;


    setTimeout(
      generateDocumentSummary,
      1000
    );
  };


// =========================================================
// DOCUMENT SUMMARY
// =========================================================

function generateDocumentSummary() {

  const output =
    $("aiAnalysisOutput");

  if (!output)
    return;


  const categories = {};


  userDocuments.forEach(
    document => {

      const category =
        document.category ||
        "Other";


      categories[category] =
        (categories[category] || 0) + 1;

    }
  );


  const categoryHTML =
    Object.entries(categories)
      .map(
        ([category, count]) => `

          <div class="ai-metric-card">

            <span class="label">
              ${escapeHTML(category)}
            </span>

            <div class="val">
              ${count}
            </div>

            <span class="desc">
              Document${count === 1 ? "" : "s"}
            </span>

          </div>

        `
      )
      .join("");


  const totalSize =
    userDocuments.reduce(
      (total, document) =>
        total +
        (document.size || 0),
      0
    );


  output.innerHTML = `

    <div class="ai-summary-text-card">

      <h3>
        ✦ Medical Vault Overview
      </h3>

      <p>

        MedLedger currently contains

        <strong>
          ${userDocuments.length}
        </strong>

        medical document(s)

        occupying approximately

        <strong>
          ${formatBytes(totalSize)}
        </strong>.

      </p>

    </div>


    <div class="ai-insights-grid">

      ${categoryHTML}

    </div>


    <div class="ai-summary-text-card">

      <h4>
        Document Timeline
      </h4>

      ${userDocuments
        .slice(0, 10)
        .map(
          document => `

            <div class="ai-highlight-item">

              <div class="dot"></div>

              <div>

                <strong>
                  ${escapeHTML(
                    document.name
                  )}
                </strong>

                <span>

                  ${escapeHTML(
                    document.category ||
                    "Other"
                  )}

                  ·

                  ${formatDate(
                    document.recordDate ||
                    document.uploadedAt
                  )}

                </span>

              </div>

            </div>

          `
        )
        .join("")}

    </div>


    <div class="ai-summary-text-card">

      <h4>
        ⚠️ Important
      </h4>

      <p>

        This overview is based on
        document metadata only.
        It is not a medical diagnosis
        and does not determine whether
        a patient is healthy or unhealthy.

      </p>

    </div>

  `;
}


function updateAiHealthStats() {

  if ($("statAiStatus")) {

    $("statAiStatus")
      .textContent =
      userDocuments.length
        ? `${userDocuments.length} Reports`
        : "Ready";

  }
}

// =========================================================
// STEP 9 — NAVIGATION + INITIALIZATION
// =========================================================

window.openSection =
  function (sectionId) {

    document
      .querySelectorAll(".section")
      .forEach(
        section => {

          section.classList.toggle(
            "active",
            section.id === sectionId
          );

        }
      );


    document
      .querySelectorAll(".nav-item")
      .forEach(
        button => {

          button.classList.toggle(
            "active",
            button.dataset.target ===
            sectionId
          );

        }
      );


    document
      .querySelectorAll(
        ".bottom-nav-item"
      )
      .forEach(
        button => {

          button.classList.toggle(
            "active",
            button.dataset.target ===
            sectionId
          );

        }
      );


    if (
      sectionId === "scanner"
    ) {

      generateDocumentSummary();

    }


    window.closeMobileSidebar?.();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  };


// =========================================================
// MOBILE SIDEBAR
// =========================================================

window.toggleMobileSidebar =
  function () {

    const sidebar =
      $("appSidebar");

    const overlay =
      $("sidebarDrawerOverlay");

    if (!sidebar || !overlay)
      return;


    const open =
      sidebar.classList.contains(
        "mobile-open"
      );


    if (open) {

      window.closeMobileSidebar();

    } else {

      sidebar.classList.add(
        "mobile-open"
      );

      overlay.classList.remove(
        "hidden"
      );
    }
  };


window.closeMobileSidebar =
  function () {

    $("appSidebar")
      ?.classList.remove(
        "mobile-open"
      );

    $("sidebarDrawerOverlay")
      ?.classList.add(
        "hidden"
      );
  };


// =========================================================
// NAVIGATION EVENTS
// =========================================================

document
  .querySelectorAll(".nav-item")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          openSection(
            button.dataset.target
          );

        }
      );

    }
  );


document
  .querySelectorAll(
    ".bottom-nav-item"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          openSection(
            button.dataset.target
          );

        }
      );

    }
  );


// =========================================================
// FIREBASE AUTH STATE
// =========================================================

onAuthStateChanged(
  auth,
  user => {

    console.log(
      "MedLedger Auth:",
      user
        ? user.email
        : "Logged out"
    );


    const authContainer =
      $("authContainer");


    const appContainer =
      document.querySelector(
        ".app"
      );


    if (user) {

      currentUser =
        user;


      authContainer
        ?.classList.add(
          "hidden"
        );


      appContainer
        ?.classList.remove(
          "hidden"
        );


      listenToProfile(
        user
      );


      listenToDocuments();


      listenToMedicines();


      renderDashboardUI();


    } else {

      currentUser =
        null;


      currentProfile = {

        name: "",

        email: "",

        blood: "O+",

        age: ""

      };


      userDocuments = [];

      userMedicines = [];


      if (unsubscribeProfile) {

        unsubscribeProfile();

        unsubscribeProfile =
          null;

      }


      if (unsubscribeDocuments) {

        unsubscribeDocuments();

        unsubscribeDocuments =
          null;

      }


      if (unsubscribeMedicines) {

        unsubscribeMedicines();

        unsubscribeMedicines =
          null;

      }


      if (medicineAlarmTimer) {

        clearInterval(
          medicineAlarmTimer
        );

        medicineAlarmTimer =
          null;

      }


      if (activeAlarmInterval) {

        clearInterval(
          activeAlarmInterval
        );

        activeAlarmInterval =
          null;

      }


      authContainer
        ?.classList.remove(
          "hidden"
        );


      appContainer
        ?.classList.add(
          "hidden"
        );
    }

  }
);


// =========================================================
// MEDLEDGER BOOT
// =========================================================

async function initializeMedLedger() {

  console.log(
    "🏥 MedLedger starting..."
  );


  try {

    const workerOnline =
      await testBackblazeWorker();


    if (workerOnline) {

      console.log(
        "☁️ Secure B2 Worker: ONLINE"
      );

    } else {

      console.warn(
        "⚠️ Secure B2 Worker: OFFLINE"
      );

    }

  } catch (error) {

    console.warn(
      "B2 initialization:",
      error
    );

  }


  openSection(
    "dashboard"
  );


  console.log(
    "✅ MedLedger initialized."
  );
}


initializeMedLedger();

