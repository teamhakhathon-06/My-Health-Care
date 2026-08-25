// =========================================================
// MedLedger — SUPABASE AUTH + DATABASE + STORAGE
// =========================================================
// Required Supabase tables:
//   profiles
//   documents
//   medicines
//
// Required private Storage bucket:
//   medical-documents
//
// Storage path:
//   users/{auth.uid}/{document_id}/{timestamp}-{filename}
// =========================================================

import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_CONFIG = Object.freeze({
  url: "https://vqucrbgvjncgyskpjvgg.supabase.co",
  anonKey: "sb_publishable_DHVQiZ_c4Sr3mnNMXLL9Sg_jCxfFzlL",
  bucket: "medical-documents",
  maxFileSize: 25 * 1024 * 1024,
  allowedTypes: ["application/pdf", "image/jpeg", "image/png"],
  signedUrlExpiry: 300
});

const supabase = createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

let currentUser = null;
let currentProfile = { name: "", email: "", blood: "O+", age: "" };
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
let selectedScreenFile = null;
let uploadInProgress = false;

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function errorMessage(error) {
  return error?.message || error?.error_description || String(error);
}

function initials(name) {
  return !name ? "U" : name.trim().split(/\s+/)
    .map(x => x[0]).slice(0, 2).join("").toUpperCase();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) :
    d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
}

function formatTime(time) {
  if (!time) return "";
  const [h,m] = String(time).split(":");
  const d = new Date();
  d.setHours(Number(h),Number(m),0,0);
  return d.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"});
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const sizes=["Bytes","KB","MB","GB"];
  const i=Math.floor(Math.log(bytes)/Math.log(1024));
  return `${(bytes/Math.pow(1024,i)).toFixed(1)} ${sizes[i]}`;
}

function documentIcon(type="", name="") {
  return name.toLowerCase().endsWith(".pdf") || type.includes("pdf") ? "📕" : "🖼️";
}

function showToast(title,message,icon="🔔") {
  const toast=$("toastNotification");
  if (!toast) return;
  if ($("toastTitle")) $("toastTitle").textContent=title;
  if ($("toastBody")) $("toastBody").textContent=message;
  if ($("toastIcon")) $("toastIcon").textContent=icon;
  toast.classList.remove("hidden");
  setTimeout(()=>toast.classList.add("hidden"),4500);
}
window.hideToast=()=> $("toastNotification")?.classList.add("hidden");

function authError(error) {
  const m=errorMessage(error);
  if (/invalid login credentials/i.test(m)) return "Invalid email or password.";
  if (/already registered|already exists/i.test(m)) return "This email is already registered.";
  if (/email.*invalid/i.test(m)) return "Please enter a valid email address.";
  return m || "Authentication failed.";
}

function switchAuthTab(tab) {
  $("tabLoginBtn")?.classList.toggle("active",tab==="login");
  $("tabRegisterBtn")?.classList.toggle("active",tab!=="login");
  $("loginForm")?.classList.toggle("hidden",tab!=="login");
  $("registerForm")?.classList.toggle("hidden",tab==="login");
}
$("tabLoginBtn")?.addEventListener("click",()=>switchAuthTab("login"));
$("tabRegisterBtn")?.addEventListener("click",()=>switchAuthTab("register"));

/* ========================= AUTH ========================= */

$("loginForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("loginEmail")?.value.trim();
  const password=$("loginPassword")?.value;
  const error=$("loginError");
  if(error) error.textContent="";
  if(!email||!password){ if(error) error.textContent="Enter your email and password."; return; }
  const {error:err}=await supabase.auth.signInWithPassword({email,password});
  if(err){console.error(err);if(error)error.textContent=authError(err);}
});

$("registerForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const name=$("regName")?.value.trim();
  const email=$("regEmail")?.value.trim();
  const password=$("regPassword")?.value;
  const blood=$("regBlood")?.value||"O+";
  const age=$("regAge")?.value||"";
  const error=$("regError");
  if(error) error.textContent="";
  if(!name||!email||!password){if(error)error.textContent="Please complete all required fields.";return;}
  const {data,error:err}=await supabase.auth.signUp({
    email,password,options:{data:{name,blood,age}}
  });
  if(err){console.error(err);if(error)error.textContent=authError(err);return;}
  showToast("Account Created",
    data.session ? `Welcome to MedLedger, ${name}.` : "Check your email to verify your account.",
    data.session ? "✅" : "📧");
  if(!data.session) switchAuthTab("login");
});

$("googleSignInBtn")?.addEventListener("click",async()=>{
  const {error}=await supabase.auth.signInWithOAuth({
    provider:"google",
    options:{redirectTo:window.location.origin+window.location.pathname}
  });
  if(error){console.error(error);if($("loginError"))$("loginError").textContent=authError(error);}
});

async function handleSignOut(){
  const {error}=await supabase.auth.signOut();
  if(error) showToast("Logout Failed",errorMessage(error),"⚠️");
  window.closeMobileSidebar?.();
}
$("logoutBtn")?.addEventListener("click",handleSignOut);
$("profileLogoutBtn")?.addEventListener("click",handleSignOut);

/* =========================================================
   MEDVAULT — DARK / LIGHT MODE
   ========================================================= */

(function initializeTheme() {

  const savedTheme = localStorage.getItem("medvault-theme");

  /*
   * If the user has previously selected dark mode,
   * restore it immediately.
   */
  if (savedTheme === "dark") {
    document.documentElement.classList.add("dark-mode");
  }

})();


function updateThemeUI() {

  const isDark = document.documentElement.classList.contains("dark-mode");

  const headerButton = document.getElementById("themeToggleBtn");
  const headerIcon = document.getElementById("themeToggleIcon");

  const sidebarIcon = document.getElementById("sidebarThemeIcon");
  const sidebarText = document.getElementById("sidebarThemeText");

  if (isDark) {

    if (headerIcon) {
      headerIcon.textContent = "☀️";
    }

    if (headerButton) {
      headerButton.title = "Switch to light mode";
      headerButton.setAttribute(
        "aria-label",
        "Switch to light mode"
      );
    }

    if (sidebarIcon) {
      sidebarIcon.textContent = "☀️";
    }

    if (sidebarText) {
      sidebarText.textContent = "Light Mode";
    }

  } else {

    if (headerIcon) {
      headerIcon.textContent = "🌙";
    }

    if (headerButton) {
      headerButton.title = "Switch to dark mode";
      headerButton.setAttribute(
        "aria-label",
        "Switch to dark mode"
      );
    }

    if (sidebarIcon) {
      sidebarIcon.textContent = "🌙";
    }

    if (sidebarText) {
      sidebarText.textContent = "Dark Mode";
    }

  }
}


function toggleMedVaultTheme() {

  const html = document.documentElement;

  const isDark = html.classList.toggle("dark-mode");

  localStorage.setItem(
    "medvault-theme",
    isDark ? "dark" : "light"
  );

  updateThemeUI();
}


document.addEventListener("DOMContentLoaded", () => {

  const headerThemeButton =
    document.getElementById("themeToggleBtn");

  const sidebarThemeButton =
    document.getElementById("sidebarThemeToggle");

  if (headerThemeButton) {
    headerThemeButton.addEventListener(
      "click",
      toggleMedVaultTheme
    );
  }

  if (sidebarThemeButton) {
    sidebarThemeButton.addEventListener(
      "click",
      toggleMedVaultTheme
    );
  }

  updateThemeUI();

});

/* ========================= PROFILE ========================= */

async function loadProfile(user){
  const {data,error}=await supabase.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(error) throw error;
  let p=data;
  if(!p){
    p={
      id:user.id,
      name:user.user_metadata?.name||user.user_metadata?.full_name||user.email?.split("@")[0]||"Patient",
      email:user.email||"",
      blood:user.user_metadata?.blood||"O+",
      age:user.user_metadata?.age||""
    };
    const r=await supabase.from("profiles").upsert(p,{onConflict:"id"}).select().single();
    if(r.error) throw r.error;
    p=r.data;
  }
  currentProfile={name:p.name||"Patient",email:p.email||user.email||"",blood:p.blood||"O+",age:p.age||""};
  renderProfileUI(currentProfile);
}

function renderProfileUI(p){
  const name=p.name||"Patient", blood=p.blood||"O+", avatar=initials(name);
  if($("dashboardName"))$("dashboardName").textContent=name.split(" ")[0];
  if($("heroName"))$("heroName").textContent=name;
  if($("heroBlood"))$("heroBlood").textContent=`Blood Group: ${blood}`;
  if($("heroAvatar"))$("heroAvatar").textContent=avatar;
  if($("sidebarName"))$("sidebarName").textContent=name;
  if($("sidebarBlood"))$("sidebarBlood").textContent=`Blood: ${blood}`;
  if($("sidebarAvatar"))$("sidebarAvatar").textContent=avatar;
  if($("profileAvatarLarge"))$("profileAvatarLarge").textContent=avatar;
  if($("profileNameLarge"))$("profileNameLarge").textContent=name;
  if($("profileDisplayName"))$("profileDisplayName").textContent=name;
  if($("profileBlood"))$("profileBlood").textContent=blood;
  if($("profileAge"))$("profileAge").textContent=p.age?`${p.age} yrs`:"— yrs";
  if($("profileEmail"))$("profileEmail").textContent=p.email||"—";
  document.querySelectorAll(".mobile-avatar").forEach(x=>x.textContent=avatar);
}

function listenToProfile(user){
  unsubscribeProfile?.();
  loadProfile(user).catch(e=>console.error("Profile:",e));
  const channel=supabase.channel(`profile-${user.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"profiles",filter:`id=eq.${user.id}`},
      payload=>{if(payload.new)loadProfile(user).catch(console.error);})
    .subscribe();
  unsubscribeProfile=()=>supabase.removeChannel(channel);
}

/* ========================= STORAGE ========================= */

function validateFile(file){
  if(!(file instanceof File)||file.size<=0) throw new Error("Invalid or empty file.");
  if(file.size>SUPABASE_CONFIG.maxFileSize) throw new Error("Maximum document size is 25 MB.");
  const ext=String(file.name).toLowerCase().split(".").pop();
  if(!SUPABASE_CONFIG.allowedTypes.includes(String(file.type).toLowerCase()) &&
     !["pdf","jpg","jpeg","png"].includes(ext))
    throw new Error("Only PDF, JPG, JPEG and PNG medical documents are allowed.");
}

function safeName(name){
  return String(name||"document").normalize("NFKD")
    .replace(/[^\w.\- ]+/g,"").replace(/\s+/g,"-")
    .replace(/-+/g,"-").slice(0,180)||"document";
}

function storagePath(userId,docId,file){
  return `users/${userId}/${docId}/${Date.now()}-${safeName(file.name)}`;
}

async function uploadToSupabase(file,metadata={},progress){
  if(!currentUser) throw new Error("Please sign in before uploading.");
  if(uploadInProgress) throw new Error("Another document upload is already in progress.");
  validateFile(file); uploadInProgress=true;
  try{
    progress?.(10,"Preparing secure upload...");
    const path=storagePath(currentUser.id,metadata.documentId,file);
    progress?.(25,"Uploading medical document...");
    const {data,error}=await supabase.storage.from(SUPABASE_CONFIG.bucket)
      .upload(path,file,{cacheControl:"3600",contentType:file.type||"application/octet-stream",upsert:false});
    if(error)throw error;
    if(!data?.path)throw new Error("Supabase did not return a storage path.");
    progress?.(100,"Upload complete.");
    return {storagePath:data.path,originalName:file.name,fileSize:file.size,
      contentType:file.type||"application/octet-stream",bucket:SUPABASE_CONFIG.bucket};
  }finally{uploadInProgress=false;}
}

window.handleScreenFileSelected=input=>{
  try{
    const file=input?.files?.[0]; if(!file){selectedScreenFile=null;return;}
    validateFile(file); selectedScreenFile=file;
    if($("screenPickerTitle"))$("screenPickerTitle").textContent=file.name;
    if($("screenPickerSub"))$("screenPickerSub").textContent=`💾 ${formatBytes(file.size)} · Supabase Storage Ready`;
    if($("screenPickerIcon"))$("screenPickerIcon").textContent=documentIcon(file.type,file.name);
    if($("screenDocTitle")&&!$("screenDocTitle").value.trim())
      $("screenDocTitle").value=file.name.replace(/\.[^/.]+$/,"");
  }catch(e){selectedScreenFile=null;if(input)input.value="";showToast("Invalid Document",errorMessage(e),"⚠️");}
};

function resetDocumentUploadUI(){
  selectedScreenFile=null;
  if($("screenFileInput"))$("screenFileInput").value="";
  if($("screenPickerTitle"))$("screenPickerTitle").textContent="Choose medical document";
  if($("screenPickerSub"))$("screenPickerSub").textContent="PDF, JPG or PNG · Maximum 25 MB";
  if($("screenPickerIcon"))$("screenPickerIcon").textContent="📄";
}

$("screenUploadForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!currentUser){showToast("Sign In Required","Please sign in first.","🔐");return;}
  if(!selectedScreenFile){showToast("No Document Selected","Please select a document.","📄");return;}
  const title=String($("screenDocTitle")?.value||selectedScreenFile.name).trim().slice(0,240);
  const category=String($("screenDocCategory")?.value||"Other").trim().slice(0,80)||"Other";
  const recordDate=String($("screenDocDate")?.value||today()).trim();
  const doctor=String($("screenDocDoctor")?.value||"").trim().slice(0,240);
  const button=$("screenSubmitBtn"),progress=$("screenUploadProgress"),fill=$("screenProgressFill"),text=$("screenProgressText");
  button?.setAttribute("disabled","true"); progress?.classList.remove("hidden");
  const docId=crypto.randomUUID();
  try{
    const storage=await uploadToSupabase(selectedScreenFile,{documentId:docId},(p,m)=>{
      if(fill)fill.style.width=`${p}%`;if(text)text.textContent=m;
    });
    const record={
      id:docId,owner_id:currentUser.id,name:title,original_name:selectedScreenFile.name,
      type:selectedScreenFile.type||storage.contentType,size:selectedScreenFile.size,
      formatted_size:formatBytes(selectedScreenFile.size),category,record_date:recordDate,
      doctor,storage_path:storage.storagePath,supabase_storage_path:storage.storagePath,
      supabase_bucket:SUPABASE_CONFIG.bucket,storage_backend:"Supabase Storage",
      uploaded_at:new Date().toISOString()
    };
    const {data,error}=await supabase.from("documents").insert(record).select().single();
    if(error){
      await supabase.storage.from(SUPABASE_CONFIG.bucket).remove([storage.storagePath]);
      throw error;
    }
    userDocuments.unshift(normalizeDocument(data));
    renderDocumentsUI();updateCategoryCounts();renderDashboardUI();
    showToast("Document Uploaded",`${title} saved securely.`,"📁");
    $("screenUploadForm")?.reset();resetDocumentUploadUI();
  }catch(err){console.error(err);showToast("Upload Failed",errorMessage(err),"⚠️");if(text)text.textContent=errorMessage(err);}
  finally{button?.removeAttribute("disabled");setTimeout(()=>progress?.classList.add("hidden"),1200);}
});

window.downloadDocumentRecord=async docId=>{
  const doc=userDocuments.find(x=>x.id===docId);
  if(!currentUser||!doc){showToast("Download Error","Document not found.","⚠️");return;}
  try{
    showToast("Preparing Download","Creating secure document link...","☁️");
    const {data,error}=await supabase.storage.from(SUPABASE_CONFIG.bucket)
      .createSignedUrl(doc.storagePath,SUPABASE_CONFIG.signedUrlExpiry);
    if(error)throw error;
    const a=document.createElement("a");
    a.href=data.signedUrl;a.download=doc.originalName||doc.name||"medical-document";
    a.target="_blank";a.rel="noopener noreferrer";a.click();
  }catch(e){showToast("Download Failed",errorMessage(e),"⚠️");}
};

/* ========================= DOCUMENTS ========================= */

function normalizeDocument(d){
  return {...d,id:d.id,name:d.name||d.original_name||"Medical Document",
    originalName:d.original_name||d.name||"medical-document",size:Number(d.size)||0,
    formattedSize:d.formatted_size||formatBytes(d.size),category:d.category||"Other",
    recordDate:d.record_date||"",doctor:d.doctor||"",storagePath:d.storage_path||d.supabase_storage_path||"",
    supabaseStoragePath:d.supabase_storage_path||d.storage_path||"",
    icon:d.icon||documentIcon(d.type,d.original_name||d.name),
    uploadedAt:d.uploaded_at?new Date(d.uploaded_at).getTime():0};
}

async function loadDocuments(){
  if(!currentUser)return;
  const {data,error}=await supabase.from("documents").select("*").eq("owner_id",currentUser.id).order("uploaded_at",{ascending:false});
  if(error){console.error(error);showToast("Documents Error",errorMessage(error),"⚠️");return;}
  userDocuments=(data||[]).map(normalizeDocument);updateCategoryCounts();renderDocumentsUI();renderDashboardUI();
}

function listenToDocuments(){
  unsubscribeDocuments?.();loadDocuments();
  const c=supabase.channel(`documents-${currentUser.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"documents",filter:`owner_id=eq.${currentUser.id}`},loadDocuments)
    .subscribe();
  unsubscribeDocuments=()=>supabase.removeChannel(c);
}

function updateCategoryCounts(){
  const counts={};userDocuments.forEach(d=>counts[d.category]=(counts[d.category]||0)+1);
  if($("count-all"))$("count-all").textContent=userDocuments.length;
  if($("navDocCount"))$("navDocCount").textContent=userDocuments.length;
  const map={Prescription:"folderCountPrescription","Blood Test":"folderCountBloodTest",Scan:"folderCountScan",Surgery:"folderCountSurgery",Vaccination:"folderCountVaccination",Other:"folderCountOther"};
  Object.entries(map).forEach(([c,id])=>{if($(id))$(id).textContent=`${counts[c]||0} files`;});
}

function renderDocumentsUI(){
  const grid=$("vaultGrid");if(!grid)return;
  let docs=[...userDocuments];
  if(activeCategoryFilter!=="all")docs=docs.filter(d=>(d.category||"Other")===activeCategoryFilter);
  if(activeSearchQuery)docs=docs.filter(d=>`${d.name} ${d.doctor} ${d.category}`.toLowerCase().includes(activeSearchQuery));
  if(!docs.length){grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🗂️</div><strong>No medical records found</strong><p>Upload prescriptions, reports or diagnostic scans.</p></div>`;return;}
  grid.innerHTML=docs.map(d=>`
    <div class="doc-card">
      <div class="doc-header"><div class="doc-icon-badge">${escapeHTML(d.icon||"📄")}</div><span class="category-tag">${escapeHTML(d.category)}</span></div>
      <div class="doc-name">${escapeHTML(d.name)}</div>
      <div class="doc-doctor">${d.doctor?`👨‍⚕️ ${escapeHTML(d.doctor)}`:"🏥 Medical Report"}</div>
      <div class="doc-meta-strip">📅 ${formatDate(d.recordDate||d.uploadedAt)} · 💾 ${formatBytes(d.size)}</div>
      <div class="doc-actions">
        <button class="btn-open" onclick="downloadDocumentRecord('${escapeHTML(d.id)}')">Download ↧</button>
        <button class="btn-del" onclick="deleteDocumentRecord('${escapeHTML(d.id)}')">Delete</button>
      </div>
    </div>`).join("");
}

window.deleteDocumentRecord=async id=>{
  const d=userDocuments.find(x=>x.id===id);if(!d||!currentUser)return;
  if(!confirm(`Delete "${d.name}"?`))return;
  try{
    if(d.storagePath){
      const {error}=await supabase.storage.from(SUPABASE_CONFIG.bucket).remove([d.storagePath]);
      if(error)throw error;
    }
    const {error}=await supabase.from("documents").delete().eq("id",id).eq("owner_id",currentUser.id);
    if(error)throw error;
    userDocuments=userDocuments.filter(x=>x.id!==id);updateCategoryCounts();renderDocumentsUI();renderDashboardUI();
    showToast("Document Deleted",d.name,"🗑️");
  }catch(e){showToast("Delete Failed",errorMessage(e),"⚠️");}
};

window.filterDocuments=()=>{activeSearchQuery=$("docSearchInput")?.value.trim().toLowerCase()||"";renderDocumentsUI();};
window.setCategoryFilter=category=>{activeCategoryFilter=category;renderDocumentsUI();};

/* ========================= MEDICINES ========================= */

function normalizeMedicine(m){
  return {...m,takenTodayDate:m.taken_today_date||"",enabled:m.enabled!==false};
}

async function loadMedicines(){
  if(!currentUser)return;
  const {data,error}=await supabase.from("medicines").select("*").eq("owner_id",currentUser.id).order("time",{ascending:true});
  if(error){console.error(error);showToast("Medicine Error",errorMessage(error),"⚠️");return;}
  userMedicines=(data||[]).map(normalizeMedicine);renderMedicinesUI();renderDashboardUI();startAlarmScheduler();
}

function listenToMedicines(){
  unsubscribeMedicines?.();loadMedicines();
  const c=supabase.channel(`medicines-${currentUser.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"medicines",filter:`owner_id=eq.${currentUser.id}`},loadMedicines)
    .subscribe();
  unsubscribeMedicines=()=>supabase.removeChannel(c);
}

$("medicineForm")?.addEventListener("submit",async e=>{
  e.preventDefault();if(!currentUser)return;
  const name=$("medicineName")?.value.trim(),instruction=$("medicineInstruction")?.value||"",
    dosage=$("medicineDosage")?.value.trim()||"",time=$("medicineTime")?.value;
  if(!name||!time){alert("Enter medicine name and time.");return;}
  const medicine={id:crypto.randomUUID(),owner_id:currentUser.id,name,instruction,dosage,time,enabled:true,taken_today_date:""};
  const {data,error}=await supabase.from("medicines").insert(medicine).select().single();
  if(error){showToast("Medicine Error",errorMessage(error),"⚠️");return;}
  userMedicines.push(normalizeMedicine(data));userMedicines.sort((a,b)=>a.time.localeCompare(b.time));
  renderMedicinesUI();renderDashboardUI();startAlarmScheduler();$("medicineForm")?.reset();
  showToast("Alarm Added",`${name} at ${formatTime(time)}`,"⏰");
});

function renderMedicinesUI(){
  const list=$("trackList");if(!list)return;
  if($("navMedCount"))$("navMedCount").textContent=userMedicines.length;
  if($("statMedCount"))$("statMedCount").textContent=userMedicines.length;
  if(!userMedicines.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">💊</div><strong>No medicines scheduled</strong><p>Add your daily medicine reminders.</p></div>`;return;}
  list.innerHTML=userMedicines.map(m=>{
    const taken=m.takenTodayDate===today();
    return `<div class="medicine-item ${taken?"done":""}">
      <button class="med-check-btn" onclick="toggleMedicineTaken('${escapeHTML(m.id)}')">${taken?"✓":"○"}</button>
      <div class="med-details"><div class="med-name">${escapeHTML(m.name)}</div>
      <div class="med-sub">${m.dosage?`${escapeHTML(m.dosage)} · `:""}${formatTime(m.time)}</div></div>
      <div class="med-controls">
      <button onclick="toggleMedicineEnabled('${escapeHTML(m.id)}')">${m.enabled===false?"▶":"⏸"}</button>
      <button onclick="deleteMedicineRecord('${escapeHTML(m.id)}')">🗑</button></div></div>`;
  }).join("");
}

window.toggleMedicineTaken=async id=>{
  const m=userMedicines.find(x=>x.id===id);if(!m||!currentUser)return;
  const value=m.takenTodayDate===today()?null:today();
  const {data,error}=await supabase.from("medicines").update({taken_today_date:value,updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",currentUser.id).select().single();
  if(error){showToast("Medicine Error",errorMessage(error),"⚠️");return;}
  const i=userMedicines.findIndex(x=>x.id===id);if(i>=0)userMedicines[i]=normalizeMedicine(data);renderMedicinesUI();renderDashboardUI();
};

window.toggleMedicineEnabled=async id=>{
  const m=userMedicines.find(x=>x.id===id);if(!m||!currentUser)return;
  const {data,error}=await supabase.from("medicines").update({enabled:m.enabled===false,updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",currentUser.id).select().single();
  if(error){showToast("Medicine Error",errorMessage(error),"⚠️");return;}
  const i=userMedicines.findIndex(x=>x.id===id);if(i>=0)userMedicines[i]=normalizeMedicine(data);renderMedicinesUI();renderDashboardUI();
};

window.deleteMedicineRecord=async id=>{
  const m=userMedicines.find(x=>x.id===id);if(!m||!currentUser||!confirm(`Delete ${m.name}?`))return;
  const {error}=await supabase.from("medicines").delete().eq("id",id).eq("owner_id",currentUser.id);
  if(error){showToast("Delete Failed",errorMessage(error),"⚠️");return;}
  userMedicines=userMedicines.filter(x=>x.id!==id);renderMedicinesUI();renderDashboardUI();showToast("Medicine Removed",m.name,"🗑️");
};
window.deleteMedicine=id=>window.deleteMedicineRecord(id);

/* ========================= ALARMS ========================= */

function playAlarmChime(){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended")audioCtx.resume();
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type="sine";o.frequency.setValueAtTime(880,audioCtx.currentTime);
    o.frequency.setValueAtTime(1174,audioCtx.currentTime+.15);
    o.frequency.setValueAtTime(880,audioCtx.currentTime+.3);
    g.gain.setValueAtTime(.3,audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.01,audioCtx.currentTime+.5);
    o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.55);
  }catch(e){console.warn("Audio unavailable",e);}
}

function startRingingAlarm(m){
  activeAlarmMedId=m.id;
  if($("alarmMedName"))$("alarmMedName").textContent=m.name;
  if($("alarmMedInstruction"))$("alarmMedInstruction").textContent=m.instruction||"Time to take your medicine";
  if($("alarmMedTime"))$("alarmMedTime").textContent=formatTime(m.time);
  $("medicineAlarmModal")?.classList.remove("hidden");
  playAlarmChime();clearInterval(activeAlarmInterval);activeAlarmInterval=setInterval(playAlarmChime,1000);
}

window.stopMedicineAlarm=async markTaken=>{
  clearInterval(activeAlarmInterval);activeAlarmInterval=null;
  $("medicineAlarmModal")?.classList.add("hidden");
  if(markTaken&&activeAlarmMedId)await window.toggleMedicineTaken(activeAlarmMedId);
  activeAlarmMedId=null;
};

window.testMedicineAlarm=()=>startRingingAlarm({id:"test_alarm",name:"Test Medicine Alarm",instruction:"This is a test alarm.",time:new Date().toTimeString().slice(0,5)});

function startAlarmScheduler(){clearInterval(medicineAlarmTimer);checkAlarms();medicineAlarmTimer=setInterval(checkAlarms,15000);}
function checkAlarms(){
  if(!currentUser)return;
  const now=new Date(),t=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  userMedicines.forEach(m=>{
    if(m.enabled===false||m.time!==t)return;
    const key=`medledger_alarm_${currentUser.id}_${m.id}_${today()}`;
    if(localStorage.getItem(key))return;
    localStorage.setItem(key,"1");startRingingAlarm(m);
  });
}

/* ========================= DASHBOARD ========================= */

function renderDashboardUI(){
  if($("statDocCount"))$("statDocCount").textContent=userDocuments.length;
  if($("statMedCount"))$("statMedCount").textContent=userMedicines.length;
  if($("statLastDoc"))$("statLastDoc").textContent=userDocuments[0]?formatDate(userDocuments[0].recordDate||userDocuments[0].uploadedAt):"No uploads yet";
  const next=userMedicines.filter(m=>m.enabled!==false).sort((a,b)=>a.time.localeCompare(b.time))[0];
  if($("statNextMed"))$("statNextMed").textContent=next?`${formatTime(next.time)} next`:"No alarms set";
  if($("recentActivity"))$("recentActivity").innerHTML=userDocuments.slice(0,4).map(d=>`
    <div class="recent-doc-item"><div class="recent-doc-icon">${escapeHTML(d.icon||"📄")}</div>
    <div class="recent-doc-info"><strong>${escapeHTML(d.name)}</strong><span>${escapeHTML(d.category||"Record")} · ${formatDate(d.recordDate||d.uploadedAt)}</span></div>
    <button class="btn-link" onclick="downloadDocumentRecord('${escapeHTML(d.id)}')">Download</button></div>`).join("");
  if($("dashboardMedList"))$("dashboardMedList").innerHTML=userMedicines.slice(0,4).map(m=>`
    <div class="recent-doc-item"><div class="recent-doc-icon">💊</div>
    <div class="recent-doc-info"><strong>${escapeHTML(m.name)}</strong><span>${escapeHTML(m.instruction||"Daily")} · ${formatTime(m.time)}</span></div></div>`).join("");
}

/* ========================= NAVIGATION ========================= */

window.openSection=sectionId=>{
  document.querySelectorAll(".section").forEach(s=>s.classList.toggle("active",s.id===sectionId));
  document.querySelectorAll(".nav-item,.bottom-nav-item").forEach(b=>b.classList.toggle("active",b.dataset.target===sectionId));
  window.closeMobileSidebar?.();window.scrollTo({top:0,behavior:"smooth"});
};

window.selectFolderCategory=category=>{window.setCategoryFilter(category);$("vaultGrid")?.scrollIntoView({behavior:"smooth",block:"start"});};
window.focusMedicineForm=()=>{window.openSection("tracker");setTimeout(()=>$("medicineName")?.focus(),300);};

window.toggleMobileSidebar=()=>{
  const s=$("appSidebar"),o=$("sidebarDrawerOverlay");if(!s||!o)return;
  const open=s.classList.contains("mobile-open");if(open)window.closeMobileSidebar();
  else{s.classList.add("mobile-open");o.classList.remove("hidden");}
};
window.closeMobileSidebar=()=>{$("appSidebar")?.classList.remove("mobile-open");$("sidebarDrawerOverlay")?.classList.add("hidden");};

document.querySelectorAll(".nav-item,.bottom-nav-item").forEach(b=>b.addEventListener("click",()=>openSection(b.dataset.target)));

/* ========================= AUTH STATE ========================= */

async function onUser(user){
  const authContainer=$("authContainer"),app=document.querySelector(".app");
  if(!user){
    currentUser=null;userDocuments=[];userMedicines=[];currentProfile={name:"",email:"",blood:"O+",age:""};
    unsubscribeProfile?.();unsubscribeDocuments?.();unsubscribeMedicines?.();
    clearInterval(medicineAlarmTimer);clearInterval(activeAlarmInterval);
    medicineAlarmTimer=activeAlarmInterval=null;
    authContainer?.classList.remove("hidden");app?.classList.add("hidden");return;
  }
  currentUser=user;authContainer?.classList.add("hidden");app?.classList.remove("hidden");
  try{await loadProfile(user);}catch(e){console.error("Profile:",e);}
  listenToProfile(user);listenToDocuments();listenToMedicines();renderDashboardUI();
}

supabase.auth.onAuthStateChange((event,session)=>{
  console.log("Supabase Auth:",event,session?.user?.email||"Logged out");
  setTimeout(()=>onUser(session?.user||null),0);
});

async function initializeMedLedger(){
  console.log("🏥 MedLedger starting...");
  try{
    const {data,error}=await supabase.auth.getSession();
    if(error)throw error;
    await onUser(data.session?.user||null);
    console.log("🔐 Supabase Auth: READY");
    console.log("🗄️ Supabase Database: READY");
    console.log(`☁️ Supabase Storage: ${SUPABASE_CONFIG.bucket}`);
  }catch(e){
    console.error("MedLedger initialization failed:",e);
    showToast("Initialization Error",errorMessage(e),"⚠️");
  }
  openSection("dashboard");
  console.log("✅ MedLedger initialized.");
}

window.MedLedgerSupabase={
  client:supabase,
  config:SUPABASE_CONFIG,
  getCurrentUser:()=>currentUser,
  getDocuments:()=>[...userDocuments],
  getMedicines:()=>[...userMedicines],
  getProfile:()=>({...currentProfile})
};

initializeMedLedger();
