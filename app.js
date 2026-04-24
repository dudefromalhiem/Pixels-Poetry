import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAnalytics,
  isSupported as isAnalyticsSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import emailjs from "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm";
import { siteConfig } from "./config.js";

const requestForm = document.getElementById("request-form");
const requestFilesInput = document.getElementById("request-files");
const selectedFilesContainer = document.getElementById("selected-files");
const submitButton = document.getElementById("submit-request-button");
const signInButton = document.getElementById("sign-in-button");
const signOutButton = document.getElementById("sign-out-button");
const authState = document.getElementById("auth-state");
const ownerDashboard = document.getElementById("owner-dashboard");
const dashboardFeedback = document.getElementById("dashboard-feedback");
const refreshDashboardButton = document.getElementById("refresh-dashboard-button");
const requestsList = document.getElementById("requests-list");
const ownerModal = document.getElementById("owner-modal");
const ownerModalBackdrop = document.getElementById("owner-modal-backdrop");
const ownerModalClose = document.getElementById("owner-modal-close");

let auth;
let db;
let storage;
let analytics;
let currentUser = null;
let selectedFiles = [];
let ownerKeyBuffer = "";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".ppt",
  ".pptx"
];

const REQUIRED_KEYS = [
  "name",
  "email",
  "websiteName",
  "description",
  "theme",
  "colorPreferences",
  "fontPreferences",
  "dataToDisplay",
  "websitePurpose",
  "type",
  "maintenancePlan",
  "additionalRequirements",
  "fileUrls",
  "createdAt"
];
const OWNER_TRIGGER = "ALHIEM";

initializeRuntime();

function initializeRuntime() {
  bindBaseEvents();

  if (!hasFirebaseConfig()) {
    setRequestStatus("Configure Firebase in config.js before using the request system.");
    renderAuthMessage("Firebase config is missing. Owner access is disabled until configuration is complete.");
    disableInteractiveControls();
    return;
  }

  const app = initializeApp(siteConfig.firebase);
  void initializeAnalytics(app);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);

  if (hasEmailJsConfig()) {
    emailjs.init({ publicKey: siteConfig.emailjs.publicKey });
  }

  bindFirebaseEvents();
  renderSelectedFiles();
  onAuthStateChanged(auth, handleAuthStateChanged);
  setRequestStatus("Idle. Ready for intake.");
}

function bindBaseEvents() {
  document.addEventListener("keydown", handleOwnerKeySequence);
  ownerModalBackdrop.addEventListener("click", closeOwnerModal);
  ownerModalClose.addEventListener("click", closeOwnerModal);
}

function bindFirebaseEvents() {
  requestFilesInput.addEventListener("change", handleFileSelection);
  requestForm.addEventListener("submit", handleRequestSubmit);
  signInButton.addEventListener("click", handleSignIn);
  signOutButton.addEventListener("click", () => signOut(auth));
  refreshDashboardButton.addEventListener("click", () => loadOwnerDashboard(true));
}

function hasFirebaseConfig() {
  const config = siteConfig.firebase || {};
  return ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"].every(
    key => typeof config[key] === "string" && config[key] && !config[key].includes("REPLACE_ME")
  );
}

function hasEmailJsConfig() {
  const config = siteConfig.emailjs || {};
  return ["serviceId", "templateId", "publicKey"].every(
    key => typeof config[key] === "string" && config[key] && !config[key].includes("REPLACE_WITH")
  );
}

async function initializeAnalytics(app) {
  try {
    const analyticsSupported = await isAnalyticsSupported();
    if (!analyticsSupported || !siteConfig.firebase?.measurementId) {
      return;
    }
    analytics = getAnalytics(app);
  } catch (error) {
    console.warn("Firebase Analytics is unavailable in this environment.", error);
  }
}

function disableInteractiveControls() {
  submitButton.disabled = true;
  signInButton.disabled = true;
}

function handleFileSelection(event) {
  const incomingFiles = Array.from(event.target.files || []);
  requestFilesInput.value = "";

  if (!incomingFiles.length) {
    renderSelectedFiles();
    return;
  }

  const invalidFiles = incomingFiles.filter(file => !isAllowedFile(file) || file.size > MAX_FILE_SIZE_BYTES);
  const validIncomingFiles = incomingFiles.filter(file => isAllowedFile(file) && file.size <= MAX_FILE_SIZE_BYTES);

  if (invalidFiles.length) {
    setRequestStatus("Only images/documents up to 10 MB per file are allowed.");
  }

  if (!validIncomingFiles.length) {
    renderSelectedFiles();
    return;
  }

  const existingFiles = new Set(selectedFiles.map(getFileKey));
  let addedCount = 0;

  validIncomingFiles.forEach(file => {
    const fileKey = getFileKey(file);

    if (existingFiles.has(fileKey)) {
      return;
    }

    existingFiles.add(fileKey);
    selectedFiles.push(file);
    addedCount += 1;
  });

  if (!selectedFiles.length) {
    renderSelectedFiles();
    setRequestStatus("Idle. Ready for intake.");
    return;
  }

  renderSelectedFiles();

  if (addedCount) {
    setRequestStatus(`${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} ready for upload.`);
  }
}

async function handleRequestSubmit(event) {
  event.preventDefault();

  if (!db || !storage) {
    setRequestStatus("Firebase is not configured.");
    return;
  }

  const formData = new FormData(requestForm);
  const payload = {
    name: normalize(formData.get("name")),
    email: normalize(formData.get("email")),
    websiteName: normalize(formData.get("websiteName")),
    description: normalize(formData.get("description")),
    theme: normalize(formData.get("theme")),
    colorPreferences: normalize(formData.get("colorPreferences")),
    fontPreferences: normalize(formData.get("fontPreferences")),
    dataToDisplay: normalize(formData.get("dataToDisplay")),
    websitePurpose: normalize(formData.get("websitePurpose")),
    type: normalize(formData.get("type")),
    maintenancePlan: normalize(formData.get("maintenancePlan")),
    additionalRequirements: normalize(formData.get("additionalRequirements"))
  };

  if (!validateRequestPayload(payload)) {
    setRequestStatus("Every required field must be completed before submission.");
    return;
  }

  submitButton.disabled = true;

  try {
    setRequestStatus("Uploading files to Firebase Storage...");
    const fileUrls = await uploadSelectedFiles(selectedFiles);

    setRequestStatus("Writing request to Firestore...");
    const writePayload = {
      ...payload,
      fileUrls,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, "website_requests"), writePayload);

    if (hasEmailJsConfig()) {
      setRequestStatus("Sending EmailJS alert...");
      await emailjs.send(siteConfig.emailjs.serviceId, siteConfig.emailjs.templateId, {
        requester_name: payload.name,
        requester_email: payload.email,
        website_name: payload.websiteName,
        description: payload.description,
        theme: payload.theme,
        website_purpose: payload.websitePurpose,
        type: payload.type,
        maintenance_plan: payload.maintenancePlan,
        additional_requirements: payload.additionalRequirements
      });
    }

    requestForm.reset();
    selectedFiles = [];
    requestFilesInput.value = "";
    renderSelectedFiles();
    setRequestStatus("Request submitted successfully.");
  } catch (error) {
    console.error(error);
    setRequestStatus(error.message || "Submission failed.");
  } finally {
    submitButton.disabled = false;
  }
}

function validateRequestPayload(payload) {
  return (
    payload.name &&
    payload.email &&
    payload.websiteName &&
    payload.description &&
    payload.theme &&
    payload.colorPreferences &&
    payload.fontPreferences &&
    payload.dataToDisplay &&
    payload.websitePurpose &&
    ["personal", "business", "company"].includes(payload.type) &&
    ["monthly", "yearly", "none"].includes(payload.maintenancePlan) &&
    payload.additionalRequirements
  );
}

async function uploadSelectedFiles(files) {
  if (!files.length) {
    return [];
  }

  const fileUrls = [];

  for (const file of files) {
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const storageRef = ref(storage, `website-requests/${safeName}`);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(snapshot.ref);
    fileUrls.push(downloadUrl);
  }

  return fileUrls;
}

function renderSelectedFiles() {
  selectedFilesContainer.innerHTML = "";

  if (!selectedFiles.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "selected-files-empty";
    emptyState.textContent = "No files selected yet.";
    selectedFilesContainer.appendChild(emptyState);
    return;
  }

  selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "selected-file-item";

    const meta = document.createElement("div");
    meta.className = "selected-file-meta";

    const name = document.createElement("span");
    name.className = "selected-file-name";
    name.textContent = file.name;

    const size = document.createElement("span");
    size.className = "selected-file-size";
    size.textContent = formatFileSize(file.size);

    meta.append(name, size);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "selected-file-remove";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderSelectedFiles();

      if (!selectedFiles.length) {
        setRequestStatus("Idle. Ready for intake.");
      } else {
        setRequestStatus(`${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} ready for upload.`);
      }
    });

    item.append(meta, removeButton);
    selectedFilesContainer.appendChild(item);
  });
}

async function handleSignIn() {
  if (!auth) {
    return;
  }

  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    renderAuthMessage(error.message || "Sign-in failed.");
  }
}

function handleOwnerKeySequence(event) {
  if (event.key === "Escape") {
    closeOwnerModal();
    ownerKeyBuffer = "";
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key.length !== 1 || /\s/.test(event.key)) {
    return;
  }

  ownerKeyBuffer = `${ownerKeyBuffer}${event.key.toUpperCase()}`.slice(-OWNER_TRIGGER.length);

  if (ownerKeyBuffer === OWNER_TRIGGER) {
    openOwnerModal();
    ownerKeyBuffer = "";
  }
}

function openOwnerModal() {
  ownerModal.classList.remove("hidden");
  ownerModal.setAttribute("aria-hidden", "false");
}

function closeOwnerModal() {
  ownerModal.classList.add("hidden");
  ownerModal.setAttribute("aria-hidden", "true");
}

async function handleAuthStateChanged(user) {
  currentUser = user;

  if (!user) {
    renderAuthMessage("No active owner session.");
    ownerDashboard.classList.add("hidden");
    signInButton.classList.remove("hidden");
    signOutButton.classList.add("hidden");
    return;
  }

  signInButton.classList.add("hidden");
  signOutButton.classList.remove("hidden");

  if (user.email !== siteConfig.ownerEmail) {
    renderAuthMessage(`Signed in as ${user.email}. This account has no owner access.`);
    ownerDashboard.classList.add("hidden");
    return;
  }

  renderAuthMessage(`Owner session active for ${user.email}.`);
  ownerDashboard.classList.remove("hidden");
  await loadOwnerDashboard(false);
}

async function loadOwnerDashboard(forceRefresh) {
  if (!currentUser || currentUser.email !== siteConfig.ownerEmail || !db) {
    return;
  }

  dashboardFeedback.textContent = forceRefresh ? "Refreshing requests..." : "Loading requests...";
  requestsList.innerHTML = "";

  try {
    const requestsQuery = query(collection(db, "website_requests"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(requestsQuery);

    if (snapshot.empty) {
      dashboardFeedback.textContent = "No requests yet.";
      return;
    }

    dashboardFeedback.textContent = `${snapshot.size} request${snapshot.size === 1 ? "" : "s"} loaded.`;
    snapshot.forEach(docSnapshot => {
      const data = docSnapshot.data();
      requestsList.appendChild(createRequestCard(data));
    });
  } catch (error) {
    console.error(error);
    dashboardFeedback.textContent = error.message || "Could not load requests.";
  }
}

function createRequestCard(data) {
  const card = document.createElement("details");
  card.className = "request-card";
  card.open = false;

  const timestamp = formatTimestamp(data.createdAt);
  const requirementPreview = buildRequirementPreview(data);

  const summary = document.createElement("summary");
  summary.className = "request-card-summary";
  summary.innerHTML = `
    <div class="request-card-summary-head">
      <div>
        <p class="request-card-kicker">Request</p>
        <h4 class="request-card-title">${escapeHtml(data.websiteName || "Untitled Request")}</h4>
      </div>
      <span class="project-tag">${escapeHtml(data.type || "request")}</span>
    </div>
    <div class="request-card-summary-meta">
      <span>${escapeHtml(data.name || "Unnamed requester")}</span>
      <span>${escapeHtml(data.email || "No email provided")}</span>
      <span>${escapeHtml(timestamp)}</span>
    </div>
    <p class="request-card-summary-copy">${escapeHtml(truncateText(data.description || "", 180))}</p>
    <p class="request-card-summary-copy request-card-summary-copy-muted">${escapeHtml(truncateText(requirementPreview, 180))}</p>
  `;

  const body = document.createElement("div");
  body.className = "request-card-body";

  const fieldList = document.createElement("div");
  fieldList.className = "request-field-list";

  const detailsFields = [
    "name",
    "email",
    "websiteName",
    "description",
    "theme",
    "colorPreferences",
    "fontPreferences",
    "dataToDisplay",
    "websitePurpose",
    "type",
    "maintenancePlan",
    "additionalRequirements",
    "fileUrls",
    "createdAt"
  ];

  for (const key of detailsFields) {
    const field = document.createElement("div");
    field.className = "request-field";

    const label = document.createElement("span");
    label.className = "request-field-label";
    label.textContent = formatFieldLabel(key);

    const value = document.createElement("div");

    if (key === "fileUrls") {
      const files = Array.isArray(data.fileUrls) ? data.fileUrls : [];
      const linksWrap = document.createElement("div");
      linksWrap.className = "request-files";

      if (!files.length) {
        linksWrap.textContent = "No files uploaded.";
      } else {
        files.forEach((url, index) => {
          const fileItem = document.createElement("a");
          fileItem.className = "request-file-item";
          fileItem.href = url;
          fileItem.target = "_blank";
          fileItem.rel = "noreferrer";

          if (isImageUrl(url)) {
            const preview = document.createElement("img");
            preview.className = "request-file-thumb";
            preview.src = url;
            preview.alt = `Uploaded file ${index + 1}`;
            fileItem.appendChild(preview);
          } else {
            const fileName = document.createElement("span");
            fileName.className = "request-file-name";
            fileName.textContent = `File ${index + 1}`;
            fileItem.appendChild(fileName);
          }

          linksWrap.appendChild(fileItem);
        });
      }

      value.appendChild(linksWrap);
    } else if (key === "createdAt") {
      value.textContent = timestamp;
    } else {
      value.textContent = typeof data[key] === "string" ? data[key] : "";
    }

    field.append(label, value);
    fieldList.appendChild(field);
  }

  body.appendChild(fieldList);
  card.append(summary, body);
  return card;
}

function buildRequirementPreview(data) {
  return [
    data.theme,
    data.colorPreferences,
    data.fontPreferences,
    data.dataToDisplay,
    data.websitePurpose,
    data.additionalRequirements
  ]
    .filter(Boolean)
    .join(" • ");
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatFieldLabel(key) {
  const labels = {
    name: "Name",
    email: "Email",
    websiteName: "Website Name",
    description: "Description",
    theme: "Theme",
    colorPreferences: "Color Preferences",
    fontPreferences: "Font Preferences",
    dataToDisplay: "Data to Display",
    websitePurpose: "Website Purpose",
    type: "Type",
    maintenancePlan: "Maintenance Plan",
    additionalRequirements: "Additional Requirements",
    fileUrls: "Files",
    createdAt: "Timestamp"
  };

  return labels[key] || key;
}

function getFileKey(file) {
  return [file.name, file.size, file.lastModified].join("::");
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp)(?:$|\?)/i.test(String(url || ""));
}

function normalize(value) {
  return String(value || "").trim();
}

function isAllowedFile(file) {
  const lowerName = String(file.name || "").toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.some(extension => lowerName.endsWith(extension));
}

function formatFileSize(size) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(value) {
  if (!value) {
    return "Pending timestamp";
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleString();
  }

  return "Pending timestamp";
}

function renderAuthMessage(message) {
  authState.innerHTML = `<p class="auth-copy">${escapeHtml(message)}</p>`;
}

function setRequestStatus(message) {
  return message;
}
