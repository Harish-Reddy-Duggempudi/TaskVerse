import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  updateDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZDUjAgNwdPfAbGwUoGUaUac9AwQDZWyA",
  authDomain: "taskverse-9b8dd.firebaseapp.com",
  projectId: "taskverse-9b8dd",
  storageBucket: "taskverse-9b8dd.firebasestorage.app",
  messagingSenderId: "18196093078",
  appId: "1:18196093078:web:29418559aac90508448ab7",
  measurementId: "G-RB26GX1HVK"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const PROJECTS = [
  "Personal", "Nexoverse", "Student Nexus",
  "Microsoft Fabric User Group Hyderabad", "GitHub Dev Days",
  "Content Creation", "Career"
];
const state = { user: null, tasks: [], view: "Today", query: "", editingId: null };
const $ = (id) => document.getElementById(id);

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function showNotice(message, good = false) {
  const el = $("notice"); el.textContent = message; el.className = good ? "notice good" : "notice"; el.hidden = false;
  window.setTimeout(() => { el.hidden = true; }, 5000);
}
function showAuthError(error) {
  const messages = {
    "auth/unauthorized-domain": "Add this website's domain to Firebase Authentication → Settings → Authorized domains.",
    "auth/operation-not-allowed": "Enable Google as a sign-in provider in Firebase Authentication.",
    "permission-denied": "Firestore denied access. Check that your Firestore security rules are published."
  };
  const message = messages[error?.code] || error?.message || "Firebase could not complete the request.";
  $("auth-error").textContent = message;
  $("auth-error").hidden = false;
}
function tasksCollection() {
  if (!state.user) throw new Error("Please sign in with Google again.");
  return collection(db, "users", state.user.uid, "tasks");
}
function setSignedIn(user) {
  state.user = user;
  $("auth-overlay").hidden = true; $("user-box").hidden = false;
  $("user-name").textContent = user.displayName || "TaskVerse user";
  $("user-email").textContent = user.email || "";
  $("avatar").textContent = (user.displayName || user.email || "T").slice(0,1).toUpperCase();
  $("sync-status").textContent = "Syncing…";
  document.querySelector(".sync-dot").classList.add("online");
  $("footer-sync").textContent = "Connected to Firebase";
  $("auth-error").hidden = true;
  loadTasks();
}
function signedOut() {
  state.user = null; state.tasks = [];
  $("auth-overlay").hidden = false; $("user-box").hidden = true;
  $("sync-status").textContent = "Not signed in";
  $("footer-sync").textContent = "Your tasks sync to Firebase";
  document.querySelector(".sync-dot").classList.remove("online");
  render();
}
async function loadTasks() {
  try {
    $("sync-status").textContent = "Syncing…";
    const snapshot = await getDocs(tasksCollection());
    state.tasks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    $("sync-status").textContent = "All changes synced";
    render();
  } catch (error) {
    $("sync-status").textContent = "Sync failed";
    showNotice(error.code === "permission-denied"
      ? "Firestore denied access. Check that your Firestore security rules are published."
      : error.message || "Could not load tasks from Firebase.");
  }
}
async function signIn() {
  const button = $("google-sign-in");
  button.disabled = true;
  $("auth-error").hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") showAuthError(error);
  } finally {
    button.disabled = false;
  }
}
function openEditor(task = null) {
  state.editingId = task?.id || null;
  $("editor-title").textContent = task ? "Edit task" : "Create a task";
  $("task-title").value = task?.title || "";
  $("task-project").value = task?.project || PROJECTS[0];
  $("task-priority").value = task?.priority || "Medium";
  $("task-due").value = task?.dueDate || "";
  $("task-notes").value = task?.notes || "";
  $("save-task").textContent = task ? "Save changes" : "Save task";
  $("task-editor").hidden = false;
  $("task-title").focus();
  $("task-editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeEditor() { $("task-editor").hidden = true; $("task-form").reset(); state.editingId = null; }
async function saveTask(event) {
  event.preventDefault();
  const title = $("task-title").value.trim();
  if (!title) return;
  const task = {
    title, project: $("task-project").value,
    priority: $("task-priority").value,
    dueDate: $("task-due").value,
    notes: $("task-notes").value.trim(),
    updatedAt: new Date().toISOString()
  };
  const editing = Boolean(state.editingId);
  try {
    $("save-task").disabled = true;
    if (editing) {
      await updateDoc(doc(tasksCollection(), state.editingId), task);
    } else {
      const now = new Date().toISOString();
      await addDoc(tasksCollection(), { ...task, completed: false, createdAt: now });
    }
    closeEditor(); await loadTasks();
    showNotice(editing ? "Task updated." : "Task created.", true);
  } catch (error) { showNotice(error.code === "permission-denied" ? "Firestore denied this change. Check your security rules." : error.message); }
  finally { $("save-task").disabled = false; }
}
async function toggleTask(task) {
  try {
    await updateDoc(doc(tasksCollection(), task.id), { completed: !task.completed, updatedAt: new Date().toISOString() });
    await loadTasks();
  } catch (error) { showNotice(error.code === "permission-denied" ? "Firestore denied this change. Check your security rules." : error.message); }
}
async function deleteTask(task) {
  if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(tasksCollection(), task.id));
    await loadTasks(); showNotice("Task deleted.", true);
  } catch (error) { showNotice(error.code === "permission-denied" ? "Firestore denied this change. Check your security rules." : error.message); }
}
function filteredTasks() {
  const today = localDateKey();
  const q = state.query.toLowerCase();
  return state.tasks.filter(task => {
    const matches = !q || `${task.title} ${task.project} ${task.notes || ""}`.toLowerCase().includes(q);
    if (!matches) return false;
    if (state.view === "Completed") return task.completed;
    if (state.view === "Upcoming") return !task.completed && task.dueDate && task.dueDate > today;
    if (state.view === "Today") return !task.completed && (!task.dueDate || task.dueDate <= today);
    if (state.view.startsWith("project:")) return task.project === state.view.slice(8);
    return true;
  }).sort((a,b) => {
    const rank = {High:0,Medium:1,Low:2};
    return Number(a.completed)-Number(b.completed) || (rank[a.priority] ?? 1)-(rank[b.priority] ?? 1) || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
  });
}
function render() {
  const total = state.tasks.length, done = state.tasks.filter(t => t.completed).length;
  $("stat-total").textContent = total; $("stat-open").textContent = total-done; $("stat-done").textContent = done;
  const percent = total ? Math.round(done/total*100) : 0;
  $("stat-progress").textContent = `${percent}%`; $("progress-bar").style.width = `${percent}%`;
  const viewName = state.view.startsWith("project:") ? state.view.slice(8) : state.view;
  $("current-view").textContent = viewName; $("list-title").textContent = viewName;
  $("heading").textContent = state.view === "Today" ? "Your day, your pace." : viewName;
  $("subheading").textContent = state.view === "Today" ? "Small steps today. Big things over time." : "Keep everything moving, one task at a time.";
  const tasks = filteredTasks();
  $("task-count").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  if (!tasks.length) {
    $("task-list").innerHTML = `<div class="empty"><div class="empty-icon">✓</div><h3>${state.query ? "No matching tasks." : "A little breathing room."}</h3><p>${state.query ? "Try another search or clear the search box." : "Nothing here right now. Add a task when you're ready."}</p><button class="btn primary" id="empty-add">＋ Add a task</button></div>`;
    $("empty-add").addEventListener("click", () => openEditor());
  } else {
    $("task-list").innerHTML = tasks.map(task => `
      <article class="task-row ${task.completed ? "is-complete" : ""}">
        <button class="task-check ${task.completed ? "checked" : ""}" data-action="toggle" data-id="${escapeHTML(task.id)}" aria-label="${task.completed ? "Mark incomplete" : "Complete task"}">${task.completed ? "✓" : ""}</button>
        <div class="task-copy"><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta"><span class="project-tag">${escapeHTML(task.project)}</span>${task.dueDate ? `<span class="due-tag">◷ ${escapeHTML(task.dueDate)}</span>` : ""}</div>${task.notes ? `<div class="due-tag">${escapeHTML(task.notes)}</div>` : ""}</div>
        <span class="priority priority-${escapeHTML((task.priority || "Medium").toLowerCase())}">${escapeHTML(task.priority || "Medium")}</span>
        <div class="row-actions"><button data-action="edit" data-id="${escapeHTML(task.id)}" aria-label="Edit task" title="Edit">✎</button><button class="delete" data-action="delete" data-id="${escapeHTML(task.id)}" aria-label="Delete task" title="Delete">×</button></div>
      </article>`).join("");
  }
  document.querySelectorAll(".nav-item[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
}
function init() {
  $("today-date").textContent = new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});
  $("task-project").innerHTML = PROJECTS.map(p => `<option>${escapeHTML(p)}</option>`).join("");
  $("project-nav").innerHTML = PROJECTS.map(p => `<button class="nav-item" data-project="${escapeHTML(p)}">▦ <span>${escapeHTML(p)}</span></button>`).join("");
  $("main-nav").addEventListener("click", event => {
    const button = event.target.closest("[data-view]"); if (!button) return;
    state.view = button.dataset.view; render();
  });
  $("project-nav").addEventListener("click", event => {
    const button = event.target.closest("[data-project]"); if (!button) return;
    state.view = `project:${button.dataset.project}`; state.query = ""; $("search").value = ""; render();
  });
  $("search").addEventListener("input", event => { state.query = event.target.value; render(); });
  $("new-task-top").addEventListener("click", () => openEditor());
  $("close-editor").addEventListener("click", closeEditor);
  $("cancel-editor").addEventListener("click", closeEditor);
  $("task-form").addEventListener("submit", saveTask);
  $("view-all").addEventListener("click", () => { state.view = "All Tasks"; state.query = ""; $("search").value = ""; render(); });
  $("google-sign-in").addEventListener("click", signIn);
  $("sign-out").addEventListener("click", async () => {
    try { await signOut(auth); }
    catch (error) { showAuthError(error); }
  });
  $("task-list").addEventListener("click", event => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const task = state.tasks.find(t => t.id === button.dataset.id); if (!task) return;
    if (button.dataset.action === "toggle") toggleTask(task);
    if (button.dataset.action === "edit") openEditor(task);
    if (button.dataset.action === "delete") deleteTask(task);
  });
  onAuthStateChanged(auth, user => user ? setSignedIn(user) : signedOut(), showAuthError);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(err => console.warn("PWA worker registration failed", err));
  }
  render();
}
window.addEventListener("load", init);
