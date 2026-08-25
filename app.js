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
    "https://my-health-care.teamhakhathon.workers.dev",

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
// MEDLEDGER — PRODUCTION DOCUMENT STORAGE
// Backblaze B2 through Cloudflare Worker
// ============================================================

(() => {
  "use strict";

  // ----------------------------------------------------------
  // STORAGE STATE
  // ----------------------------------------------------------

  let selectedScreenFile = null;
  let uploadInProgress = false;

  // Prevent duplicate event registration if app.js is evaluated
  // more than once.
  let uploadFormInitialized = false;


  // ==========================================================
  // ERROR HELPERS
  // ==========================================================

  class MedLedgerStorageError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "MedLedgerStorageError";

      this.status = options.status ?? null;
      this.code = options.code ?? null;
      this.retryable = options.retryable ?? false;
      this.details = options.details ?? null;
    }
  }


  function createStorageError(
    message,
    {
      status = null,
      code = null,
      retryable = false,
      details = null
    } = {}
  ) {
    return new MedLedgerStorageError(message, {
      status,
      code,
      retryable,
      details
    });
  }


  function normalizeErrorMessage(error) {
    if (!error) {
      return "An unknown storage error occurred.";
    }

    if (error instanceof MedLedgerStorageError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message || "An unexpected error occurred.";
    }

    return String(error);
  }


  // ==========================================================
  // WORKER URL
  // ==========================================================

  function getMedLedgerWorkerURL() {
    const url = String(getWorkerURL?.() || "").trim();

    if (!url) {
      throw createStorageError(
        "Secure storage service is not configured."
      );
    }

    return url.replace(/\/+$/, "");
  }


  // ==========================================================
  // AUTHENTICATION
  // ==========================================================

  async function getSecureFirebaseToken() {
    if (!currentUser) {
      throw createStorageError(
        "Please sign in before accessing your medical documents.",
        {
          code: "AUTH_REQUIRED"
        }
      );
    }

    if (typeof getFirebaseIdToken !== "function") {
      throw createStorageError(
        "Firebase authentication is not available.",
        {
          code: "AUTH_UNAVAILABLE"
        }
      );
    }

    try {
      const token = await getFirebaseIdToken();

      if (!token || typeof token !== "string") {
        throw createStorageError(
          "Your Firebase session could not be verified.",
          {
            code: "AUTH_INVALID"
          }
        );
      }

      return token;

    } catch (error) {

      if (error instanceof MedLedgerStorageError) {
        throw error;
      }

      console.error(
        "MedLedger Firebase token error:",
        error
      );

      throw createStorageError(
        "Your login session could not be verified. Please sign in again.",
        {
          code: "AUTH_INVALID"
        }
      );
    }
  }


  // ==========================================================
  // WORKER RESPONSE PARSER
  // ==========================================================

  async function parseWorkerResponse(response) {
    const contentType =
      response.headers.get("content-type") || "";

    const rawText =
      await response.text();

    if (!rawText) {
      return {};
    }

    if (
      contentType.includes("application/json") ||
      rawText.trim().startsWith("{") ||
      rawText.trim().startsWith("[")
    ) {
      try {
        return JSON.parse(rawText);
      } catch (error) {
        console.error(
          "Invalid Worker JSON:",
          rawText
        );

        throw createStorageError(
          "Secure storage service returned invalid data.",
          {
            status: response.status,
            code: "INVALID_WORKER_RESPONSE"
          }
        );
      }
    }

    return {
      success: false,
      raw: rawText
    };
  }


  // ==========================================================
  // WORKER ERROR TRANSLATION
  // ==========================================================

  function medLedgerWorkerError(
    response,
    result,
    operation = "storage operation"
  ) {

    const status =
      Number(response?.status) || 0;

    const serverMessage =
      String(
        result?.error ||
        result?.message ||
        ""
      ).trim();

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    if (status === 401) {
      return createStorageError(
        "Your login session has expired. Please sign in again.",
        {
          status,
          code: "AUTH_REQUIRED",
          retryable: false,
          details: serverMessage
        }
      );
    }


    // --------------------------------------------------------
    // Forbidden
    // --------------------------------------------------------

    if (status === 403) {

      return createStorageError(
        "Secure storage rejected the request. Your account may not have permission to access this document storage.",
        {
          status,
          code: "STORAGE_FORBIDDEN",
          retryable: false,
          details: serverMessage
        }
      );
    }


    // --------------------------------------------------------
    // Not Found
    // --------------------------------------------------------

    if (status === 404) {
      return createStorageError(
        "The requested secure storage resource was not found.",
        {
          status,
          code: "STORAGE_NOT_FOUND",
          retryable: false,
          details: serverMessage
        }
      );
    }


    // --------------------------------------------------------
    // Payload Too Large
    // --------------------------------------------------------

    if (status === 413) {
      return createStorageError(
        "The document is too large. Maximum allowed size is 25 MB.",
        {
          status,
          code: "FILE_TOO_LARGE",
          retryable: false,
          details: serverMessage
        }
      );
    }


    // --------------------------------------------------------
    // Rate Limit
    // --------------------------------------------------------

    if (status === 429) {
      return createStorageError(
        "Secure storage is temporarily busy. Please try again shortly.",
        {
          status,
          code: "RATE_LIMITED",
          retryable: true,
          details: serverMessage
        }
      );
    }


    // --------------------------------------------------------
    // Server Error
    // --------------------------------------------------------

    if (status >= 500) {
      return createStorageError(
        "Secure storage is temporarily unavailable. Please try again.",
        {
          status,
          code: "STORAGE_SERVER_ERROR",
          retryable: true,
          details: serverMessage
        }
      );
    }


    // --------------------------------------------------------
    // Generic
    // --------------------------------------------------------

    return createStorageError(
      serverMessage ||
      `${operation} failed (${status || "unknown error"}).`,
      {
        status,
        code: "STORAGE_REQUEST_FAILED",
        retryable: status >= 500,
        details: serverMessage
      }
    );
  }


  // ==========================================================
  // MEDLEDGER WORKER FETCH
  // ==========================================================

  async function medLedgerFetch(
    path,
    {
      method = "GET",
      token = null,
      body = null,
      headers = {},
      timeoutMs = 120000
    } = {}
  ) {

    const workerURL =
      getMedLedgerWorkerURL();

    const endpoint =
      `${workerURL}/${String(path).replace(/^\/+/, "")}`;


    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        timeoutMs
      );


    const requestHeaders =
      new Headers(headers);


    if (token) {
      requestHeaders.set(
        "Authorization",
        `Bearer ${token}`
      );
    }


    let response;

    try {

      response = await fetch(
        endpoint,
        {
          method,
          headers: requestHeaders,
          body,
          signal: controller.signal,
          credentials: "omit",
          cache: "no-store"
        }
      );

    } catch (error) {

      if (error?.name === "AbortError") {
        throw createStorageError(
          "The secure storage request timed out. Please try again.",
          {
            code: "REQUEST_TIMEOUT",
            retryable: true
          }
        );
      }

      console.error(
        "MedLedger Worker network error:",
        error
      );

      throw createStorageError(
        "Unable to connect to secure storage. Please check your internet connection and try again.",
        {
          code: "NETWORK_ERROR",
          retryable: true
        }
      );

    } finally {

      clearTimeout(timeout);
    }


    const result =
      await parseWorkerResponse(response);


    if (!response.ok) {

      const translated =
        medLedgerWorkerError(
          response,
          result,
          `${method} ${path}`
        );

      console.error(
        "MedLedger Worker request rejected:",
        {
          endpoint,
          status: response.status,
          result
        }
      );

      throw translated;
    }


    return {
      response,
      result
    };
  }


  // ==========================================================
  // FILE VALIDATION
  // ==========================================================

  function validateSelectedFile(file) {

    if (!(file instanceof File)) {
      throw createStorageError(
        "Invalid file selected.",
        {
          code: "INVALID_FILE"
        }
      );
    }


    const maxFileSize =
      Number(
        BACKBLAZE_B2_CONFIG?.maxFileSize
      ) ||
      25 * 1024 * 1024;


    if (file.size <= 0) {
      throw createStorageError(
        "The selected file is empty.",
        {
          code: "EMPTY_FILE"
        }
      );
    }


    if (file.size > maxFileSize) {
      throw createStorageError(
        "Maximum document size is 25 MB.",
        {
          code: "FILE_TOO_LARGE"
        }
      );
    }


    const allowedTypes =
      Array.isArray(
        BACKBLAZE_B2_CONFIG?.allowedTypes
      )
        ? BACKBLAZE_B2_CONFIG.allowedTypes
        : [
            "application/pdf",
            "image/jpeg",
            "image/png"
          ];


    const allowedExtensions =
      new Set([
        "pdf",
        "jpg",
        "jpeg",
        "png"
      ]);


    const extension =
      String(
        file.name || ""
      )
        .toLowerCase()
        .split(".")
        .pop();


    const typeAllowed =
      allowedTypes.includes(
        String(file.type || "").toLowerCase()
      );


    const extensionAllowed =
      allowedExtensions.has(
        extension
      );


    if (!typeAllowed && !extensionAllowed) {
      throw createStorageError(
        "Only PDF, JPG, JPEG and PNG medical documents are allowed.",
        {
          code: "UNSUPPORTED_FILE_TYPE"
        }
      );
    }


    return true;
  }


  // ==========================================================
  // UPLOAD
  // ==========================================================

  async function uploadToB2(
    file,
    metadata = {},
    progressCallback
  ) {

    validateSelectedFile(file);


    if (uploadInProgress) {
      throw createStorageError(
        "Another document upload is already in progress.",
        {
          code: "UPLOAD_IN_PROGRESS"
        }
      );
    }


    uploadInProgress = true;


    try {

      progressCallback?.(
        5,
        "Verifying secure session..."
      );


      const token =
        await getSecureFirebaseToken();


      progressCallback?.(
        12,
        "Preparing secure upload..."
      );


      const form =
        new FormData();


      // ------------------------------------------------------
      // Normalize metadata.
      // ------------------------------------------------------

      const title =
        String(
          metadata?.title ?? file.name
        )
          .trim()
          .slice(0, 240);


      const category =
        String(
          metadata?.category ?? "Other"
        )
          .trim()
          .slice(0, 80) ||
        "Other";


      const recordDate =
        String(
          metadata?.recordDate ?? ""
        )
          .trim()
          .slice(0, 40);


      const doctor =
        String(
          metadata?.doctor ?? ""
        )
          .trim()
          .slice(0, 240);


      // ------------------------------------------------------
      // FormData
      // ------------------------------------------------------

      form.append(
        "file",
        file,
        file.name
      );


      form.append(
        "title",
        title || file.name
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
        25,
        "Uploading encrypted connection to secure storage..."
      );


      const {
        result
      } = await medLedgerFetch(
        "upload",
        {
          method: "POST",
          token,
          body: form,
          timeoutMs: 180000
        }
      );


      // ------------------------------------------------------
      // Validate server response.
      // ------------------------------------------------------

      if (!result?.success) {

        throw createStorageError(
          result?.error ||
          "Secure storage did not confirm the upload.",
          {
            code:
              result?.code ||
              "UPLOAD_NOT_CONFIRMED",
            details:
              result
          }
        );
      }


      const storagePath =
        String(
          result?.storage_path ||
          result?.file_id ||
          result?.file_path ||
          ""
        ).trim();


      if (!storagePath) {

        console.error(
          "Worker returned successful upload without storage path:",
          result
        );

        throw createStorageError(
          "The document was uploaded, but secure storage did not return a storage path.",
          {
            code: "MISSING_STORAGE_PATH"
          }
        );
      }


      progressCallback?.(
        85,
        "Verifying uploaded document..."
      );


      const originalName =
        String(
          result?.original_name ||
          result?.file_name ||
          file.name
        );


      progressCallback?.(
        100,
        "Upload complete."
      );


      return {

        fileId:
          String(
            result?.file_id ||
            result?.fileId ||
            storagePath
          ),

        storagePath,

        originalName,

        downloadURL:
          String(
            result?.downloadURL ||
            result?.download_url ||
            ""
          ),

        fileSize:
          Number(
            result?.file_size ||
            file.size
          ),

        contentType:
          String(
            result?.content_type ||
            file.type ||
            ""
          ),

        storageBackend:
          String(
            result?.storage_backend ||
            "Backblaze B2 via MedLedger Worker"
          )
      };


    } finally {

      uploadInProgress = false;
    }
  }


  // ==========================================================
  // DOWNLOAD
  // ==========================================================

  window.downloadDocumentRecord =
    async function (docId) {

      if (!currentUser) {

        showToast?.(
          "Authentication Required",
          "Please sign in first.",
          "🔐"
        );

        return;
      }


      const selectedDocument =
        Array.isArray(userDocuments)
          ? userDocuments.find(
              doc => doc.id === docId
            )
          : null;


      if (!selectedDocument) {

        showToast?.(
          "Download Error",
          "Document not found.",
          "⚠️"
        );

        return;
      }


      const storagePath =
        String(
          selectedDocument.b2StoragePath ||
          selectedDocument.b2FileName ||
          ""
        ).trim();


      if (!storagePath) {

        showToast?.(
          "Download Error",
          "Secure storage path is missing.",
          "⚠️"
        );

        return;
      }


      // ------------------------------------------------------
      // IMPORTANT:
      // Do not automatically trust a stored downloadURL for
      // private medical documents.
      //
      // The secure Worker should remain the authoritative
      // download path.
      // ------------------------------------------------------

      try {

        showToast?.(
          "Preparing Download",
          "Requesting secure document...",
          "☁️"
        );


        const token =
          await getSecureFirebaseToken();


        const workerURL =
          getMedLedgerWorkerURL();


        const endpoint =
          `${workerURL}/download?file=${encodeURIComponent(storagePath)}`;


        const controller =
          new AbortController();


        const timeout =
          setTimeout(
            () => controller.abort(),
            180000
          );


        let response;

        try {

          response =
            await fetch(
              endpoint,
              {
                method: "GET",

                headers: {
                  Authorization:
                    `Bearer ${token}`
                },

                credentials: "omit",

                cache: "no-store",

                signal:
                  controller.signal
              }
            );

        } catch (error) {

          if (
            error?.name ===
            "AbortError"
          ) {
            throw createStorageError(
              "The download timed out. Please try again.",
              {
                code: "DOWNLOAD_TIMEOUT",
                retryable: true
              }
            );
          }


          throw createStorageError(
            "Unable to connect to secure document storage.",
            {
              code: "NETWORK_ERROR",
              retryable: true
            }
          );

        } finally {

          clearTimeout(timeout);
        }


        if (!response.ok) {

          const result =
            await parseWorkerResponse(
              response
            );


          throw medLedgerWorkerError(
            response,
            result,
            "Document download"
          );
        }


        const blob =
          await response.blob();


        if (!blob || blob.size <= 0) {

          throw createStorageError(
            "The downloaded document is empty.",
            {
              code: "EMPTY_DOWNLOAD"
            }
          );
        }


        const blobURL =
          URL.createObjectURL(blob);


        const link =
          document.createElement("a");


        link.href =
          blobURL;


        const safeDownloadName =
          String(
            selectedDocument.originalName ||
            selectedDocument.name ||
            "medical-document"
          )
            .replace(
              /[<>:"/\\|?*\x00-\x1F]/g,
              "-"
            )
            .slice(0, 180);


        link.download =
          safeDownloadName ||
          "medical-document";


        link.style.display =
          "none";


        document.body.appendChild(
          link
        );


        link.click();


        link.remove();


        setTimeout(
          () => {
            URL.revokeObjectURL(
              blobURL
            );
          },
          15000
        );


        showToast?.(
          "Download Started",
          selectedDocument.name ||
            safeDownloadName,
          "✅"
        );


      } catch (error) {

        console.error(
          "MedLedger document download failed:",
          error
        );


        showToast?.(
          "Download Failed",
          normalizeErrorMessage(error),
          "⚠️"
        );
      }
    };


  // ==========================================================
  // FILE PICKER
  // ==========================================================

  window.handleScreenFileSelected =
    function (input) {

      try {

        const file =
          input?.files?.[0];


        if (!file) {

          selectedScreenFile =
            null;

          return;
        }


        validateSelectedFile(
          file
        );


        selectedScreenFile =
          file;


        const pickerTitle =
          $("screenPickerTitle");


        const pickerSub =
          $("screenPickerSub");


        const pickerIcon =
          $("screenPickerIcon");


        const titleInput =
          $("screenDocTitle");


        if (pickerTitle) {

          pickerTitle.textContent =
            file.name;
        }


        if (pickerSub) {

          pickerSub.textContent =
            `💾 ${
              formatBytes(file.size)
            } · Secure B2 Ready`;
        }


        if (pickerIcon) {

          pickerIcon.textContent =
            getDocumentIcon(
              file.type,
              file.name
            );
        }


        if (
          titleInput &&
          !String(
            titleInput.value || ""
          ).trim()
        ) {

          titleInput.value =
            file.name.replace(
              /\.[^/.]+$/,
              ""
            );
        }


      } catch (error) {

        console.error(
          "File validation failed:",
          error
        );


        selectedScreenFile =
          null;


        if (input) {
          input.value = "";
        }


        showToast?.(
          "Invalid Document",
          normalizeErrorMessage(error),
          "⚠️"
        );
      }
    };


  // ==========================================================
  // RESET FILE PICKER UI
  // ==========================================================

  function resetDocumentUploadUI() {

    selectedScreenFile =
      null;


    const input =
      $("screenFileInput");


    if (input) {
      input.value = "";
    }


    const title =
      $("screenPickerTitle");


    const sub =
      $("screenPickerSub");


    const icon =
      $("screenPickerIcon");


    if (title) {
      title.textContent =
        "Choose medical document";
    }


    if (sub) {
      sub.textContent =
        "PDF, JPG or PNG · Maximum 25 MB";
    }


    if (icon) {
      icon.textContent =
        "📄";
    }
  }


  // ==========================================================
  // UPLOAD FORM
  // ==========================================================

  function initializeDocumentUploadForm() {

    if (uploadFormInitialized) {
      return;
    }


    const form =
      $("screenUploadForm");


    if (!form) {
      return;
    }


    uploadFormInitialized =
      true;


    form.addEventListener(
      "submit",
      async event => {

        event.preventDefault();


        if (uploadInProgress) {

          showToast?.(
            "Upload In Progress",
            "Please wait for the current upload to finish.",
            "⏳"
          );

          return;
        }


        // ----------------------------------------------------
        // Authentication
        // ----------------------------------------------------

        if (!currentUser) {

          showToast?.(
            "Sign In Required",
            "Please sign in before uploading a document.",
            "🔐"
          );

          return;
        }


        // ----------------------------------------------------
        // File
        // ----------------------------------------------------

        if (!selectedScreenFile) {

          showToast?.(
            "No Document Selected",
            "Please select a medical document first.",
            "📄"
          );

          return;
        }


        try {

          validateSelectedFile(
            selectedScreenFile
          );

        } catch (error) {

          showToast?.(
            "Invalid Document",
            normalizeErrorMessage(error),
            "⚠️"
          );

          return;
        }


        // ----------------------------------------------------
        // Metadata
        // ----------------------------------------------------

        const title =
          String(
            $("screenDocTitle")?.value ||
            selectedScreenFile.name
          )
            .trim()
            .slice(0, 240);


        const category =
          String(
            $("screenDocCategory")?.value ||
            "Other"
          )
            .trim()
            .slice(0, 80) ||
          "Other";


        const recordDate =
          String(
            $("screenDocDate")?.value ||
            new Date()
              .toISOString()
              .split("T")[0]
          )
            .trim()
            .slice(0, 40);


        const doctor =
          String(
            $("screenDocDoctor")?.value ||
            ""
          )
            .trim()
            .slice(0, 240);


        // ----------------------------------------------------
        // UI
        // ----------------------------------------------------

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


        submitButton?.setAttribute(
          "aria-busy",
          "true"
        );


        progress?.classList.remove(
          "hidden"
        );


        if (progressFill) {
          progressFill.style.width =
            "0%";
        }


        if (progressText) {
          progressText.textContent =
            "Preparing secure upload...";
        }


        let documentId =
          null;


        try {

          // --------------------------------------------------
          // Generate Firebase record ID before upload.
          // --------------------------------------------------

          if (
            !db ||
            !currentUser?.uid
          ) {

            throw createStorageError(
              "Your document database is not ready.",
              {
                code: "DATABASE_UNAVAILABLE"
              }
            );
          }


          const documentRef =
            push(
              ref(
                db,
                `users/${currentUser.uid}/documents`
              )
            );


          documentId =
            documentRef.key;


          if (!documentId) {

            throw createStorageError(
              "Unable to create a document record.",
              {
                code: "DOCUMENT_ID_FAILED"
              }
            );
          }


          // --------------------------------------------------
          // Upload file to B2 Worker.
          // --------------------------------------------------

          const b2 =
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

                if (progressFill) {

                  const safePercent =
                    Math.max(
                      0,
                      Math.min(
                        100,
                        Number(percent) || 0
                      )
                    );


                  progressFill.style.width =
                    `${safePercent}%`;
                }


                if (progressText) {

                  progressText.textContent =
                    message ||
                    "Processing...";
                }
              }
            );


          if (!b2?.storagePath) {

            throw createStorageError(
              "Secure storage did not return a valid storage path.",
              {
                code: "MISSING_STORAGE_PATH"
              }
            );
          }


          // --------------------------------------------------
          // Build Firebase document record.
          // --------------------------------------------------

          const record = {

            id:
              documentId,

            ownerUid:
              currentUser.uid,

            name:
              title,

            originalName:
              selectedScreenFile.name,

            type:
              selectedScreenFile.type ||
              b2.contentType ||
              "application/octet-stream",

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


          // --------------------------------------------------
          // Save metadata only after B2 upload succeeds.
          // --------------------------------------------------

          if (progressText) {
            progressText.textContent =
              "Saving document record...";
          }


          await set(
            ref(
              db,
              `users/${currentUser.uid}/documents/${documentId}`
            ),
            record
          );


          // --------------------------------------------------
          // Update local state.
          // --------------------------------------------------

          if (
            Array.isArray(userDocuments)
          ) {

            userDocuments.unshift(
              record
            );
          }


          // --------------------------------------------------
          // Refresh UI.
          // --------------------------------------------------

          try {
            renderDocumentsUI();
          } catch (error) {
            console.warn(
              "renderDocumentsUI failed:",
              error
            );
          }


          try {
            updateCategoryCounts();
          } catch (error) {
            console.warn(
              "updateCategoryCounts failed:",
              error
            );
          }


          try {
            renderDashboardUI();
          } catch (error) {
            console.warn(
              "renderDashboardUI failed:",
              error
            );
          }


          if (progressFill) {
            progressFill.style.width =
              "100%";
          }


          if (progressText) {
            progressText.textContent =
              "Document securely stored.";
          }


          showToast?.(
            "Document Uploaded",
            `${title} saved securely.`,
            "📁"
          );


          // --------------------------------------------------
          // Reset form.
          // --------------------------------------------------

          form.reset();

          resetDocumentUploadUI();


        } catch (error) {

          console.error(
            "MedLedger document upload failed:",
            error
          );


          // --------------------------------------------------
          // Important:
          // If B2 succeeded but Firebase metadata failed,
          // the file can remain orphaned in B2.
          //
          // We do NOT silently pretend the upload failed
          // completely. The Worker should ideally expose a
          // cleanup/delete operation for this situation.
          // --------------------------------------------------

          const message =
            normalizeErrorMessage(
              error
            );


          showToast?.(
            "Upload Failed",
            message,
            "⚠️"
          );


          if (progressText) {

            progressText.textContent =
              message;
          }

        } finally {

          submitButton?.removeAttribute(
            "disabled"
          );


          submitButton?.removeAttribute(
            "aria-busy"
          );


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
  }


  // ==========================================================
  // INITIALIZE
  // ==========================================================

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initializeDocumentUploadForm,
      {
        once: true
      }
    );

  } else {

    initializeDocumentUploadForm();
  }


  // ==========================================================
  // PUBLIC API
  // ==========================================================

  window.MedLedgerStorage = {

    uploadToB2,

    downloadDocument:
      window.downloadDocumentRecord,

    validateFile:
      validateSelectedFile
  };

})();


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
// TEST ALARM (called by onclick="testMedicineAlarm()" in index.html)
// =========================================================

window.testMedicineAlarm = function () {
  startRingingAlarm({
    id: "test_alarm",
    name: "Test Medicine Alarm",
    instruction: "This is a test alarm — your real alarms will sound like this.",
    time: new Date().toTimeString().slice(0, 5)
  });
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

// AI scanner feature removed — will be replaced by new features.

// =========================================================
// MISSING WINDOW FUNCTIONS (called from index.html onclicks)
// =========================================================

// selectFolderCategory — folder tiles on vault screen
window.selectFolderCategory = function (category) {
  window.setCategoryFilter(category);
  // scroll to the docs grid
  const grid = document.getElementById("vaultGrid");
  if (grid) grid.scrollIntoView({ behavior: "smooth", block: "start" });
};

// focusMedicineForm — "Add Medicine" quick-action button
window.focusMedicineForm = function () {
  window.openSection("tracker");
  setTimeout(() => {
    const el = document.getElementById("medicineName");
    if (el) el.focus();
  }, 300);
};

// deleteMedicine — alias used in some rendered HTML
window.deleteMedicine = function (id) {
  if (window.deleteMedicineRecord) {
    window.deleteMedicineRecord(id);
  }
};

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
