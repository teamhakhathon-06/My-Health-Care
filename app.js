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
    "https://vite-react-template.teamhakhathon.workers.dev",

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


// ============================================================
// MEDLEDGER — SECURE DOCUMENT VAULT
// Production Frontend Storage Layer
// Cloudflare Worker -> Backblaze B2
// Firebase Authentication
// ============================================================
//
// Required existing globals/functions:
//
// currentUser
// userDocuments
// db
// ref()
// push()
// set()
// getFirebaseIdToken()
// getWorkerURL()
// BACKBLAZE_B2_CONFIG
// formatBytes()
// getDocumentIcon()
// renderDocumentsUI()
// updateCategoryCounts()
// renderDashboardUI()
// showToast()
// $()
//
// IMPORTANT:
// Never place Backblaze application keys in this file.
// All B2 credentials remain inside the Cloudflare Worker.
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const MEDLEDGER_STORAGE_CONFIG = Object.freeze({

    requestTimeoutMs: 120000,

    downloadTimeoutMs: 120000,

    maxFileSize:
        Number(
            BACKBLAZE_B2_CONFIG?.maxFileSize
        ) ||
        25 * 1024 * 1024,

    allowedTypes:
        Array.isArray(
            BACKBLAZE_B2_CONFIG?.allowedTypes
        )
            ? BACKBLAZE_B2_CONFIG.allowedTypes
            : [
                "application/pdf",
                "image/jpeg",
                "image/png"
            ],

    allowedExtensions:
        new Set([
            "pdf",
            "jpg",
            "jpeg",
            "png"
        ]),

    workerPath: "",

    maxTitleLength: 240,

    maxCategoryLength: 80,

    maxDoctorLength: 240,

    maxRecordDateLength: 40

});


// ============================================================
// STATE
// ============================================================

let selectedScreenFile = null;

let uploadInProgress = false;

let downloadInProgress = false;


// ============================================================
// CUSTOM STORAGE ERROR
// ============================================================

class MedLedgerStorageError extends Error {

    constructor(
        message,
        options = {}
    ) {

        super(message);

        this.name =
            "MedLedgerStorageError";

        this.status =
            options.status || 0;

        this.code =
            options.code || "";

        this.details =
            options.details || null;

        this.retryable =
            Boolean(options.retryable);

    }

}


// ============================================================
// UTILITY — SAFE TEXT
// ============================================================

function medLedgerCleanText(
    value,
    maxLength
) {

    return String(value ?? "")
        .replace(
            /[\u0000-\u001F\u007F]/g,
            " "
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .slice(
            0,
            maxLength
        );

}


// ============================================================
// UTILITY — FILE EXTENSION
// ============================================================

function medLedgerGetExtension(
    fileName
) {

    const name =
        String(fileName || "")
            .trim()
            .toLowerCase();

    const index =
        name.lastIndexOf(".");

    if (
        index < 0 ||
        index === name.length - 1
    ) {
        return "";
    }

    return name
        .slice(index + 1)
        .replace(
            /[^a-z0-9]/g,
            ""
        );

}


// ============================================================
// UTILITY — SAFE FILE NAME
// ============================================================

function medLedgerSafeFileName(
    fileName
) {

    const fallback =
        "medical-document";

    let name =
        String(fileName || "")
            .trim();

    name =
        name
            .replace(
                /[<>:"/\\|?*\u0000-\u001F]/g,
                "-"
            )
            .replace(
                /\s+/g,
                "-"
            )
            .replace(
                /-+/g,
                "-"
            )
            .replace(
                /^\.+/,
                ""
            )
            .slice(
                0,
                180
            );

    return name || fallback;

}


// ============================================================
// UTILITY — FILE TYPE
// ============================================================

function medLedgerIsAllowedFile(
    file
) {

    if (!(file instanceof File)) {
        return false;
    }

    const extension =
        medLedgerGetExtension(
            file.name
        );

    const mime =
        String(
            file.type || ""
        ).toLowerCase();

    const allowedMime =
        MEDLEDGER_STORAGE_CONFIG
            .allowedTypes
            .includes(mime);

    const allowedExtension =
        MEDLEDGER_STORAGE_CONFIG
            .allowedExtensions
            .has(extension);

    return (
        allowedMime &&
        allowedExtension
    );

}


// ============================================================
// UTILITY — FILE SIGNATURE
// Frontend validation only.
// Worker remains authoritative.
// ============================================================

async function medLedgerValidateSignature(
    file
) {

    if (!(file instanceof File)) {
        return false;
    }

    const extension =
        medLedgerGetExtension(
            file.name
        );

    const bytes =
        new Uint8Array(
            await file
                .slice(0, 16)
                .arrayBuffer()
        );

    // PDF
    if (extension === "pdf") {

        const signature =
            new TextDecoder()
                .decode(
                    bytes.slice(0, 5)
                );

        return signature === "%PDF-";

    }

    // JPEG
    if (
        extension === "jpg" ||
        extension === "jpeg"
    ) {

        return (
            bytes[0] === 0xFF &&
            bytes[1] === 0xD8 &&
            bytes[2] === 0xFF
        );

    }

    // PNG
    if (extension === "png") {

        const signature = [
            0x89,
            0x50,
            0x4E,
            0x47,
            0x0D,
            0x0A,
            0x1A,
            0x0A
        ];

        return signature.every(
            (value, index) =>
                bytes[index] === value
        );

    }

    return false;

}


// ============================================================
// FILE VALIDATION
// ============================================================

async function medLedgerValidateFile(
    file
) {

    if (!file) {

        throw new MedLedgerStorageError(
            "Please select a file."
        );

    }

    if (!(file instanceof File)) {

        throw new MedLedgerStorageError(
            "Invalid file selected."
        );

    }

    if (file.size <= 0) {

        throw new MedLedgerStorageError(
            "The selected file is empty."
        );

    }

    if (
        file.size >
        MEDLEDGER_STORAGE_CONFIG.maxFileSize
    ) {

        throw new MedLedgerStorageError(
            "Maximum file size is 25 MB.",
            {
                status: 413,
                code: "FILE_TOO_LARGE"
            }
        );

    }

    if (
        !medLedgerIsAllowedFile(file)
    ) {

        throw new MedLedgerStorageError(
            "Only PDF, JPG, JPEG and PNG files are allowed.",
            {
                status: 400,
                code: "INVALID_FILE_TYPE"
            }
        );

    }

    const validSignature =
        await medLedgerValidateSignature(
            file
        );

    if (!validSignature) {

        throw new MedLedgerStorageError(
            "The file content does not match its declared type.",
            {
                status: 400,
                code: "INVALID_FILE_SIGNATURE"
            }
        );

    }

    return true;

}


// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function medLedgerFetch(
    url,
    options = {},
    timeoutMs =
        MEDLEDGER_STORAGE_CONFIG.requestTimeoutMs
) {

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            timeoutMs
        );

    try {

        return await fetch(
            url,
            {
                ...options,
                signal:
                    controller.signal
            }
        );

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {

            throw new MedLedgerStorageError(
                "The storage request timed out. Please try again.",
                {
                    code: "REQUEST_TIMEOUT",
                    retryable: true
                }
            );

        }

        if (
            error instanceof TypeError
        ) {

            throw new MedLedgerStorageError(
                "Unable to connect to the secure storage service. Check your internet connection and try again.",
                {
                    code: "NETWORK_ERROR",
                    retryable: true
                }
            );

        }

        throw error;

    } finally {

        clearTimeout(timeout);

    }

}


// ============================================================
// PARSE WORKER RESPONSE
// ============================================================

async function medLedgerParseResponse(
    response
) {

    const text =
        await response.text();

    if (!text) {

        return {};

    }

    try {

        return JSON.parse(text);

    } catch {

        throw new MedLedgerStorageError(
            "Storage Worker returned an invalid response.",
            {
                status: response.status,
                code: "INVALID_WORKER_RESPONSE"
            }
        );

    }

}


// ============================================================
// WORKER ERROR TRANSLATION
// ============================================================

function medLedgerWorkerError(
    response,
    result
) {

    const status =
        Number(
            response?.status || 0
        );

    const workerMessage =
        result?.error ||
        result?.message ||
        "";

    // Authentication
    if (status === 401) {

        return new MedLedgerStorageError(
            "Your login session has expired. Please sign in again.",
            {
                status,
                code: "AUTH_REQUIRED"
            }
        );

    }

    // Authorization
    if (status === 403) {

        return new MedLedgerStorageError(
            workerMessage ||
            "Secure storage denied this request. Your account may not have permission to access this document.",
            {
                status,
                code: "FORBIDDEN"
            }
        );

    }

    // Too large
    if (status === 413) {

        return new MedLedgerStorageError(
            workerMessage ||
            "The selected file is too large. Maximum size is 25 MB.",
            {
                status,
                code: "FILE_TOO_LARGE"
            }
        );

    }

    // Rate limit
    if (status === 429) {

        return new MedLedgerStorageError(
            "Too many requests. Please wait a moment and try again.",
            {
                status,
                code: "RATE_LIMITED",
                retryable: true
            }
        );

    }

    // Server errors
    if (status >= 500) {

        return new MedLedgerStorageError(
            workerMessage ||
            "Secure storage is temporarily unavailable. Please try again shortly.",
            {
                status,
                code: "SERVER_ERROR",
                retryable: true
            }
        );

    }

    return new MedLedgerStorageError(
        workerMessage ||
        `Storage request failed (${status || "unknown"}).`,
        {
            status,
            code: "WORKER_ERROR"
        }
    );

}


// ============================================================
// FIREBASE TOKEN
// ============================================================

async function medLedgerGetAuthToken() {

    if (!currentUser) {

        throw new MedLedgerStorageError(
            "Please sign in before using the document vault.",
            {
                status: 401,
                code: "AUTH_REQUIRED"
            }
        );

    }

    let token;

    try {

        token =
            await getFirebaseIdToken();

    } catch (error) {

        console.error(
            "Firebase token error:",
            error
        );

        throw new MedLedgerStorageError(
            "Unable to verify your login session. Please sign in again.",
            {
                status: 401,
                code: "AUTH_TOKEN_ERROR"
            }
        );

    }

    if (
        typeof token !== "string" ||
        !token.trim()
    ) {

        throw new MedLedgerStorageError(
            "Your login session is invalid. Please sign in again.",
            {
                status: 401,
                code: "AUTH_TOKEN_MISSING"
            }
        );

    }

    return token.trim();

}


// ============================================================
// WORKER URL
// ============================================================

function medLedgerWorkerUrl(
    endpoint
) {

    const base =
        String(
            getWorkerURL() || ""
        )
            .trim()
            .replace(
                /\/+$/,
                ""
            );

    if (!base) {

        throw new MedLedgerStorageError(
            "Secure storage service URL is not configured.",
            {
                code: "WORKER_URL_MISSING"
            }
        );

    }

    return `${base}/${String(endpoint).replace(/^\/+/, "")}`;

}


// ============================================================
// UPLOAD
// ============================================================

async function uploadToB2(
    file,
    metadata = {},
    progressCallback
) {

    await medLedgerValidateFile(
        file
    );

    const token =
        await medLedgerGetAuthToken();

    progressCallback?.(
        10,
        "Preparing secure upload..."
    );

    // --------------------------------------------------------
    // IMPORTANT:
    // Convert all metadata to strings.
    // --------------------------------------------------------

    const title =
        medLedgerCleanText(
            metadata.title ||
            file.name,
            MEDLEDGER_STORAGE_CONFIG
                .maxTitleLength
        );

    const category =
        medLedgerCleanText(
            metadata.category ||
            "Other",
            MEDLEDGER_STORAGE_CONFIG
                .maxCategoryLength
        ) || "Other";

    const recordDate =
        medLedgerCleanText(
            metadata.recordDate ||
            "",
            MEDLEDGER_STORAGE_CONFIG
                .maxRecordDateLength
        );

    const doctor =
        medLedgerCleanText(
            metadata.doctor ||
            "",
            MEDLEDGER_STORAGE_CONFIG
                .maxDoctorLength
        );

    const form =
        new FormData();

    form.append(
        "file",
        file,
        medLedgerSafeFileName(
            file.name
        )
    );

    form.append(
        "title",
        title
    );

    form.append(
        "category",
        category
    );

    form.append(
        "recordDate",
        recordDate
    );

    form.append(
        "doctor",
        doctor
    );

    progressCallback?.(
        30,
        "Uploading to secure storage..."
    );

    let response;

    try {

        response =
            await medLedgerFetch(
                medLedgerWorkerUrl(
                    "/upload"
                ),
                {
                    method: "POST",

                    headers: {
                        Authorization:
                            `Bearer ${token}`
                    },

                    body: form
                },

                MEDLEDGER_STORAGE_CONFIG
                    .requestTimeoutMs
            );

    } catch (error) {

        throw error;

    }

    const result =
        await medLedgerParseResponse(
            response
        );

    if (!response.ok) {

        console.error(
            "MedLedger Worker upload rejected:",
            {
                status:
                    response.status,
                result
            }
        );

        throw medLedgerWorkerError(
            response,
            result
        );

    }

    if (!result?.success) {

        throw new MedLedgerStorageError(
            result?.error ||
            "Secure storage did not confirm the upload.",
            {
                status:
                    response.status,
                code:
                    "UPLOAD_NOT_CONFIRMED"
            }
        );

    }

    const storagePath =
        result.storage_path ||
        result.file_path ||
        result.fileName ||
        result.file_name ||
        "";

    if (!storagePath) {

        throw new MedLedgerStorageError(
            "The storage service completed the upload but did not return a storage path.",
            {
                code: "STORAGE_PATH_MISSING"
            }
        );

    }

    progressCallback?.(
        90,
        "Upload complete. Saving document record..."
    );

    return {

        fileId:
            result.file_id ||
            result.fileId ||
            storagePath,

        storagePath,

        originalName:
            result.original_name ||
            result.file_name ||
            result.fileName ||
            file.name,

        downloadURL:
            result.downloadURL ||
            result.download_url ||
            "",

        fileSize:
            result.file_size ||
            file.size,

        contentType:
            result.content_type ||
            file.type,

        metadata:
            result.metadata || {

                title,
                category,
                recordDate,
                doctor

            }

    };

}


// ============================================================
// DOWNLOAD
// ============================================================

window.downloadDocumentRecord =
    async function (docId) {

        if (
            downloadInProgress
        ) {

            showToast?.(
                "Download In Progress",
                "Please wait for the current download to finish.",
                "⏳"
            );

            return;

        }

        if (!currentUser) {

            showToast?.(
                "Authentication Required",
                "Please sign in first.",
                "🔐"
            );

            return;

        }

        const documentRecord =
            userDocuments.find(
                doc =>
                    doc.id === docId
            );

        if (!documentRecord) {

            showToast?.(
                "Download Error",
                "Document not found.",
                "⚠️"
            );

            return;

        }

        const storagePath =
            documentRecord.b2StoragePath ||
            documentRecord.b2FileName ||
            documentRecord.storagePath;

        if (!storagePath) {

            showToast?.(
                "Download Error",
                "Secure storage path is missing.",
                "⚠️"
            );

            return;

        }

        downloadInProgress =
            true;

        try {

            showToast?.(
                "Preparing Download",
                "Requesting your secure document...",
                "☁️"
            );

            const token =
                await medLedgerGetAuthToken();

            const downloadUrl =
                `${medLedgerWorkerUrl("/download")}?file=${encodeURIComponent(storagePath)}`;

            const response =
                await medLedgerFetch(
                    downloadUrl,
                    {
                        method: "GET",

                        headers: {
                            Authorization:
                                `Bearer ${token}`
                        }
                    },

                    MEDLEDGER_STORAGE_CONFIG
                        .downloadTimeoutMs
                );

            if (!response.ok) {

                let result = {};

                try {

                    result =
                        await medLedgerParseResponse(
                            response
                        );

                } catch {}

                console.error(
                    "MedLedger Worker download rejected:",
                    {
                        status:
                            response.status,
                        result
                    }
                );

                throw medLedgerWorkerError(
                    response,
                    result
                );

            }

            const blob =
                await response.blob();

            if (
                !blob ||
                !blob.size
            ) {

                throw new MedLedgerStorageError(
                    "The downloaded document is empty.",
                    {
                        code: "EMPTY_DOWNLOAD"
                    }
                );

            }

            const blobUrl =
                URL.createObjectURL(
                    blob
                );

            const link =
                document.createElement(
                    "a"
                );

            link.href =
                blobUrl;

            link.download =
                medLedgerSafeFileName(
                    documentRecord.originalName ||
                    documentRecord.name ||
                    "medical-document"
                );

            link.rel =
                "noopener";

            document.body.appendChild(
                link
            );

            link.click();

            link.remove();

            setTimeout(
                () => {
                    URL.revokeObjectURL(
                        blobUrl
                    );
                },
                10000
            );

            showToast?.(
                "Download Started",
                documentRecord.name ||
                documentRecord.originalName ||
                "Medical document",
                "✅"
            );

        } catch (error) {

            console.error(
                "MedLedger document download failed:",
                error
            );

            showToast?.(
                "Download Failed",
                error?.message ||
                "Unable to download the document.",
                "⚠️"
            );

        } finally {

            downloadInProgress =
                false;

        }

    };


// ============================================================
// STEP 5 — DOCUMENT VAULT
// ============================================================


// ============================================================
// FILE VALIDATION / PICKER
// ============================================================

window.handleScreenFileSelected =
    async function (input) {

        // Reset old state first.
        selectedScreenFile =
            null;

        if (!input) {
            return;
        }

        const file =
            input.files?.[0];

        if (!file) {
            return;
        }

        try {

            await medLedgerValidateFile(
                file
            );

            selectedScreenFile =
                file;

            if ($("screenPickerTitle")) {

                $("screenPickerTitle")
                    .textContent =
                    file.name;

            }

            if ($("screenPickerSub")) {

                $("screenPickerSub")
                    .textContent =
                    `💾 ${formatBytes(file.size)} · Secure B2 Ready`;

            }

            if ($("screenPickerIcon")) {

                $("screenPickerIcon")
                    .textContent =
                    getDocumentIcon(
                        file.type,
                        file.name
                    );

            }

            const titleInput =
                $("screenDocTitle");

            if (
                titleInput &&
                !titleInput.value.trim()
            ) {

                const baseName =
                    file.name.replace(
                        /\.[^/.]+$/,
                        ""
                    );

                titleInput.value =
                    medLedgerCleanText(
                        baseName,
                        MEDLEDGER_STORAGE_CONFIG
                            .maxTitleLength
                    );

            }

        } catch (error) {

            console.error(
                "File validation failed:",
                error
            );

            input.value =
                "";

            selectedScreenFile =
                null;

            if ($("screenPickerTitle")) {

                $("screenPickerTitle")
                    .textContent =
                    "Choose a medical document";

            }

            if ($("screenPickerSub")) {

                $("screenPickerSub")
                    .textContent =
                    "PDF, JPG or PNG · Maximum 25 MB";

            }

            showToast?.(
                "Invalid File",
                error?.message ||
                "The selected file is not supported.",
                "⚠️"
            );

        }

    };


// ============================================================
// RESET FILE PICKER UI
// ============================================================

function resetMedLedgerUploadUI() {

    selectedScreenFile =
        null;

    const form =
        $("screenUploadForm");

    form?.reset();

    if ($("screenPickerTitle")) {

        $("screenPickerTitle")
            .textContent =
            "Choose a medical document";

    }

    if ($("screenPickerSub")) {

        $("screenPickerSub")
            .textContent =
            "PDF, JPG or PNG · Maximum 25 MB";

    }

    if ($("screenPickerIcon")) {

        $("screenPickerIcon")
            .textContent =
            "📄";

    }

    if ($("screenProgressFill")) {

        $("screenProgressFill")
            .style.width =
            "0%";

    }

    if ($("screenProgressText")) {

        $("screenProgressText")
            .textContent =
            "";

    }

}


// ============================================================
// UPLOAD FORM
// ============================================================

$("screenUploadForm")
    ?.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            if (
                uploadInProgress
            ) {

                showToast?.(
                    "Upload In Progress",
                    "Please wait for the current upload to finish.",
                    "⏳"
                );

                return;

            }

            if (!currentUser) {

                showToast?.(
                    "Authentication Required",
                    "Please sign in before uploading a medical document.",
                    "🔐"
                );

                return;

            }

            if (!selectedScreenFile) {

                showToast?.(
                    "No File Selected",
                    "Please select a PDF, JPG or PNG file.",
                    "📄"
                );

                return;

            }

            const submitButton =
                $("screenSubmitBtn");

            const progress =
                $("screenUploadProgress");

            const progressFill =
                $("screenProgressFill");

            const progressText =
                $("screenProgressText");

            // --------------------------------------------------
            // Read metadata as STRINGS.
            // --------------------------------------------------

            const title =
                medLedgerCleanText(
                    $("screenDocTitle")
                        ?.value ||
                    selectedScreenFile.name,
                    MEDLEDGER_STORAGE_CONFIG
                        .maxTitleLength
                ) ||
                selectedScreenFile.name;

            const category =
                medLedgerCleanText(
                    $("screenDocCategory")
                        ?.value ||
                    "Other",
                    MEDLEDGER_STORAGE_CONFIG
                        .maxCategoryLength
                ) ||
                "Other";

            const recordDate =
                medLedgerCleanText(
                    $("screenDocDate")
                        ?.value ||
                    new Date()
                        .toISOString()
                        .slice(0, 10),
                    MEDLEDGER_STORAGE_CONFIG
                        .maxRecordDateLength
                );

            const doctor =
                medLedgerCleanText(
                    $("screenDocDoctor")
                        ?.value ||
                    "",
                    MEDLEDGER_STORAGE_CONFIG
                        .maxDoctorLength
                );

            uploadInProgress =
                true;

            submitButton?.setAttribute(
                "disabled",
                "true"
            );

            if (submitButton) {

                submitButton.dataset
                    .originalText =
                    submitButton.textContent;

                submitButton.textContent =
                    "Uploading...";

            }

            progress?.classList.remove(
                "hidden"
            );

            if (progressFill) {

                progressFill.style.width =
                    "5%";

            }

            if (progressText) {

                progressText.textContent =
                    "Validating document...";

            }

            let documentId =
                null;

            let b2 =
                null;

            try {

                // ------------------------------------------------
                // Revalidate immediately before upload.
                // Prevents stale/changed file state.
                // ------------------------------------------------

                await medLedgerValidateFile(
                    selectedScreenFile
                );

                // ------------------------------------------------
                // Create Firebase record ID.
                // ------------------------------------------------

                const documentsRef =
                    ref(
                        db,
                        `users/${currentUser.uid}/documents`
                    );

                documentId =
                    push(
                        documentsRef
                    ).key;

                if (!documentId) {

                    throw new Error(
                        "Unable to create document record."
                    );

                }

                // ------------------------------------------------
                // Upload to Cloudflare Worker / B2.
                // ------------------------------------------------

                b2 =
                    await uploadToB2(
                        selectedScreenFile,
                        {
                            title,
                            category,
                            recordDate,
                            doctor
                        },
                        (
                            percent,
                            message
                        ) => {

                            if (
                                progressFill
                            ) {

                                progressFill
                                    .style
                                    .width =
                                    `${percent}%`;

                            }

                            if (
                                progressText
                            ) {

                                progressText
                                    .textContent =
                                    message;

                            }

                        }
                    );

                if (
                    !b2 ||
                    !b2.storagePath
                ) {

                    throw new MedLedgerStorageError(
                        "Secure storage did not return a valid storage path.",
                        {
                            code:
                                "STORAGE_PATH_MISSING"
                        }
                    );

                }

                if (
                    progressFill
                ) {

                    progressFill.style.width =
                        "95%";

                }

                if (
                    progressText
                ) {

                    progressText.textContent =
                        "Saving document record...";

                }

                // ------------------------------------------------
                // Create local/Firebase document record.
                // ------------------------------------------------

                const record = {

                    id:
                        documentId,

                    name:
                        title,

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
                        "Backblaze B2 via MedLedger Worker",

                    uploadedAt:
                        Date.now()

                };

                // ------------------------------------------------
                // Save metadata to Firebase.
                // ------------------------------------------------

                await set(
                    ref(
                        db,
                        `users/${currentUser.uid}/documents/${documentId}`
                    ),
                    record
                );

                // ------------------------------------------------
                // Update application state.
                // ------------------------------------------------

                userDocuments.unshift(
                    record
                );

                renderDocumentsUI();

                updateCategoryCounts();

                renderDashboardUI();

                if (
                    progressFill
                ) {

                    progressFill.style.width =
                        "100%";

                }

                if (
                    progressText
                ) {

                    progressText.textContent =
                        "Document securely saved.";

                }

                showToast?.(
                    "Document Uploaded",
                    `${title} was saved securely.`,
                    "📁"
                );

                // ------------------------------------------------
                // Reset UI only after complete success.
                // ------------------------------------------------

                resetMedLedgerUploadUI();

            } catch (error) {

                console.error(
                    "MedLedger document upload failed:",
                    error
                );

                // ------------------------------------------------
                // IMPORTANT:
                //
                // If B2 succeeded but Firebase failed,
                // the B2 object can become orphaned.
                //
                // We intentionally do NOT attempt an automatic
                // delete here unless your Worker exposes a
                // guaranteed authenticated delete endpoint.
                //
                // Your Worker does expose /delete, so this can
                // be added later as a transactional cleanup.
                // ------------------------------------------------

                let message =
                    error?.message ||
                    "Unable to upload the document.";

                if (
                    error?.status === 403
                ) {

                    message =
                        `${message} If this is unexpected, check the Cloudflare Worker authentication and Backblaze permissions.`;

                }

                showToast?.(
                    "Upload Failed",
                    message,
                    "⚠️"
                );

            } finally {

                uploadInProgress =
                    false;

                submitButton?.removeAttribute(
                    "disabled"
                );

                if (submitButton) {

                    submitButton.textContent =
                        submitButton.dataset
                            .originalText ||
                        "Upload";

                    delete submitButton
                        .dataset
                        .originalText;

                }

                // Don't hide immediately if you want the user
                // to see "100% / saved" after success.
                setTimeout(
                    () => {

                        progress?.classList.add(
                            "hidden"
                        );

                    },
                    1200
                );

            }

        }
    );


// ============================================================
// OPTIONAL — CLEANUP WHEN USER LEAVES PAGE
// ============================================================

window.addEventListener(
    "beforeunload",
    () => {

        selectedScreenFile =
            null;

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

