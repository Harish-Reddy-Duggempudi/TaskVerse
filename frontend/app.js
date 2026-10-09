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
  doc,
  getDocs,
  getFirestore,
  runTransaction,
  setDoc,
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
const LEGACY_DEFAULT_PROJECTS = [
  { id: "default-1", name: "Personal" },
  { id: "default-2", name: "Nexoverse" },
  { id: "default-3", name: "Student Nexus" },
  { id: "default-4", name: "Microsoft Fabric User Group Hyderabad" },
  { id: "default-5", name: "GitHub Dev Days" },
  { id: "default-6", name: "Content Creation" },
  { id: "default-7", name: "Career" }
];
const state = {
  user: null, projects: [], tasks: [], view: "Today", query: "",
  editingId: null, editingProjectId: null, loading: false
};
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
  const el = $("notice");
  el.textContent = message;
  el.className = good ? "notice good" : "notice";
  el.hidden = false;
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
function userDocument() {
  if (!state.user) throw new Error("Please sign in with Google again.");
  return doc(db, "users", state.user.uid);
}
function projectsCollection() {
  if (!state.user) throw new Error("Please sign in with Google again.");
  return collection(db, "users", state.user.uid, "projects");
}
function tasksCollection() {
  if (!state.user) throw new Error("Please sign in with Google again.");
  return collection(db, "users", state.user.uid, "tasks");
}
function taskDocument(taskId) {
  return doc(tasksCollection(), taskId);
}
function projectDocument(projectId) {
  return doc(projectsCollection(), projectId);
}
function makeProject(name, description = "") {
  const now = new Date().toISOString();
  return { name, description, taskCount: 0, createdAt: now, updatedAt: now, lastMutationTaskId: null };
}
function legacyProjectId(name) {
  return `legacy-${encodeURIComponent(name).replaceAll("%", "_")}`;
}
function setSignedIn(user) {
  if (state.user?.uid === user.uid) return;
  state.user = user;
  state.projects = [];
  state.tasks = [];
  state.loading = true;
  $("auth-overlay").hidden = true;
  $("user-box").hidden = false;
  $("user-name").textContent = user.displayName || "TaskVerse user";
  $("user-email").textContent = user.email || "";
  $("avatar").textContent = (user.displayName || user.email || "T").slice(0,1).toUpperCase();
  $("auth-error").hidden = true;
  render();
  bootstrapUser().catch(error => {
    state.loading = false;
    showNotice(error.code === "permission-denied"
      ? "Firestore denied access. Publish the owner-only Firestore rules from the README."
      : error.message || "Could not load your Firebase data.");
    render();
  });
}
function signedOut() {
  state.user = null;
  state.projects = [];
  state.tasks = [];
  state.loading = false;
  state.view = "Today";
  $("auth-overlay").hidden = false;
  $("user-box").hidden = true;
  render();
}
async function ensureLegacyProject(name) {
  const id = legacyProjectId(name);
  const projectRef = projectDocument(id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(projectRef);
    if (!snapshot.exists()) transaction.set(projectRef, makeProject(name));
  });
  return { id, name };
}
async function removeUntouchedEmptyDefaultProjects(tasks) {
  const removed = [];
  const preserved = [];
  const uid = state.user.uid;
  const projectKeys = [
    "name", "description", "taskCount", "createdAt",
    "updatedAt", "lastMutationTaskId"
  ];

  for (const project of LEGACY_DEFAULT_PROJECTS) {
    const isReferenced = tasks.some(task =>
      task.projectId === project.id
      || (!task.projectId && String(task.project || "Personal") === project.name)
    );
    if (isReferenced) {
      preserved.push(`${project.name} (has tasks)`);
      continue;
    }

    const projectRef = doc(db, "users", uid, "projects", project.id);
    const result = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(projectRef);
      if (!snapshot.exists()) return "absent";
      const data = snapshot.data();
      const hasOriginalShape = Object.keys(data).length === projectKeys.length
        && projectKeys.every(key => Object.hasOwn(data, key));
      const isUntouchedDefault = hasOriginalShape
        && data.name === project.name
        && data.description === ""
        && data.taskCount === 0
        && data.createdAt === data.updatedAt
        && data.lastMutationTaskId === null;
      if (!isUntouchedDefault) return "changed";
      transaction.delete(projectRef);
      return "removed";
    });

    if (result === "removed") removed.push(project.name);
    if (result === "changed") preserved.push(`${project.name} (has edits)`);
  }

  return { removed, preserved };
}
async function migrateLegacyTask(task) {
  const projectName = String(task.project || "Personal");
  let project = state.projects.find(item => item.name === projectName);
  if (!project) project = await ensureLegacyProject(projectName);
  const taskRef = taskDocument(task.id);
  const projectRef = projectDocument(project.id);

  await runTransaction(db, async transaction => {
    const [taskSnapshot, projectSnapshot] = await Promise.all([
      transaction.get(taskRef),
      transaction.get(projectRef)
    ]);
    if (!taskSnapshot.exists()) return;
    const current = taskSnapshot.data();
    if (current.projectId) return;
    if (!projectSnapshot.exists()) throw new Error("The task's project no longer exists.");
    const projectData = projectSnapshot.data();
    if (!Number.isInteger(projectData.taskCount) || projectData.taskCount < 0) {
      throw new Error("Project task counts are invalid. Contact the app administrator.");
    }
    const status = current.status || (current.completed ? "completed" : "open");
    transaction.update(taskRef, {
      projectId: project.id,
      description: current.description || current.notes || "",
      status,
      completed: status === "completed"
    });
    transaction.update(projectRef, {
      taskCount: projectData.taskCount + 1,
      lastMutationTaskId: task.id,
      updatedAt: new Date().toISOString()
    });
  });
}
async function bootstrapUser() {
  const user = state.user;
  const now = new Date().toISOString();
  await setDoc(userDocument(), {
    displayName: user.displayName || "",
    email: user.email || "",
    updatedAt: now
  }, { merge: true });

  let projectsSnapshot = await getDocs(projectsCollection());
  state.projects = projectsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));

  const legacyTasks = await getDocs(tasksCollection());
  const userTasks = legacyTasks.docs.map(item => ({ id: item.id, ...item.data() }));
  for (const task of userTasks) {
    if (!task.projectId || !task.status || typeof task.description !== "string") {
      await migrateLegacyTask(task);
    }
  }

  const cleanupResult = await removeUntouchedEmptyDefaultProjects(userTasks);
  projectsSnapshot = await getDocs(projectsCollection());
  state.projects = projectsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  await loadTasks();
  if (cleanupResult.removed.length || cleanupResult.preserved.length) {
    const removedMessage = cleanupResult.removed.length
      ? `Removed unused default projects: ${cleanupResult.removed.join(", ")}.`
      : "";
    const preservedMessage = cleanupResult.preserved.length
      ? ` Kept defaults that were edited or have tasks: ${cleanupResult.preserved.join(", ")}.`
      : "";
    showNotice(`${removedMessage}${preservedMessage}`, true);
  }
}
async function loadTasks() {
  try {
    const snapshot = await getDocs(tasksCollection());
    state.tasks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    showNotice(error.code === "permission-denied"
      ? "Firestore denied access. Check that your Firestore security rules are published."
      : error.message || "Could not load tasks from Firebase.");
    render();
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
  if (!state.projects.length) {
    showNotice("Create a project first, then add a task.");
    openProjectEditor();
    return;
  }
  state.editingId = task?.id || null;
  $("editor-title").textContent = task ? "Edit task" : "Create a task";
  $("task-title").value = task?.title || "";
  $("task-project").value = task?.projectId || state.projects[0].id;
  $("task-priority").value = task?.priority || "Medium";
  $("task-status").value = task?.status || (task?.completed ? "completed" : "open");
  $("task-due").value = task?.dueDate || "";
  $("task-notes").value = task?.description || task?.notes || "";
  $("save-task").textContent = task ? "Save changes" : "Save task";
  $("task-editor").hidden = false;
  $("task-title").focus();
  $("task-editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeEditor() {
  $("task-editor").hidden = true;
  $("task-form").reset();
  state.editingId = null;
}
function openProjectEditor(project = null) {
  state.editingProjectId = project?.id || null;
  $("project-editor-title").textContent = project ? "Edit project" : "Create a project";
  $("project-name").value = project?.name || "";
  $("project-description").value = project?.description || "";
  $("save-project").textContent = project ? "Save changes" : "Create project";
  $("project-editor").hidden = false;
  $("project-name").focus();
  $("project-editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeProjectEditor() {
  $("project-editor").hidden = true;
  $("project-form").reset();
  state.editingProjectId = null;
}
async function saveProject(event) {
  event.preventDefault();
  const name = $("project-name").value.trim();
  const description = $("project-description").value.trim();
  if (!name || name.length > 80 || description.length > 300) return;
  if (state.projects.some(project =>
    project.id !== state.editingProjectId && project.name.toLowerCase() === name.toLowerCase()
  )) {
    showNotice("A project with that name already exists.");
    return;
  }
  const editingId = state.editingProjectId;
  const now = new Date().toISOString();
  try {
    $("save-project").disabled = true;
    if (editingId) {
      await updateDoc(projectDocument(editingId), { name, description, updatedAt: now });
    } else {
      await addDoc(projectsCollection(), makeProject(name, description));
    }
    closeProjectEditor();
    await loadWorkspace();
    showNotice(editingId ? "Project updated." : "Project created.", true);
  } catch (error) {
    showNotice(error.code === "permission-denied"
      ? "Firestore denied this project change. Publish the owner-only rules from the README."
      : error.message || "Could not save the project.");
  } finally {
    $("save-project").disabled = false;
  }
}
async function loadWorkspace() {
  const [projectsSnapshot, tasksSnapshot] = await Promise.all([
    getDocs(projectsCollection()),
    getDocs(tasksCollection())
  ]);
  state.projects = projectsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  state.tasks = tasksSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  render();
}
async function deleteProject(project) {
  const locallyAssigned = state.tasks.filter(task =>
    task.projectId === project.id || (!task.projectId && task.project === project.name)
  ).length;
  if (locallyAssigned > 0) {
    showNotice(`Cannot delete “${project.name}”: ${locallyAssigned} task${locallyAssigned === 1 ? "" : "s"} use this project. Reassign those tasks first.`);
    return;
  }
  if (!confirm(`Delete the empty project “${project.name}”? This cannot be undone.`)) return;

  try {
    await runTransaction(db, async transaction => {
      const projectRef = projectDocument(project.id);
      const snapshot = await transaction.get(projectRef);
      if (!snapshot.exists()) throw new Error("This project no longer exists.");
      const taskCount = snapshot.data().taskCount;
      if (!Number.isInteger(taskCount) || taskCount !== 0) {
        throw new Error(`Cannot delete “${project.name}”: it has tasks assigned. Reassign those tasks first.`);
      }
      transaction.delete(projectRef);
    });
    if (state.view === `project:${project.id}`) state.view = "All Tasks";
    await loadWorkspace();
    showNotice("Project deleted.", true);
  } catch (error) {
    showNotice(error.code === "permission-denied"
      ? "Project deletion was denied. Firestore requires an empty project and valid owner-only rules."
      : error.message || "Could not delete the project.");
  }
}
async function saveTask(event) {
  event.preventDefault();
  const title = $("task-title").value.trim();
  const project = state.projects.find(item => item.id === $("task-project").value);
  if (!title || !project) {
    showNotice("Choose a valid project and enter a task title.");
    return;
  }
  const status = $("task-status").value;
  const description = $("task-notes").value.trim();
  const now = new Date().toISOString();
  const task = {
    title,
    project: project.name,
    projectId: project.id,
    description,
    notes: description,
    priority: $("task-priority").value,
    status,
    completed: status === "completed",
    dueDate: $("task-due").value,
    updatedAt: now
  };
  const editingId = state.editingId;
  const taskRef = editingId ? taskDocument(editingId) : doc(tasksCollection());
  try {
    $("save-task").disabled = true;
    await runTransaction(db, async transaction => {
      const existingSnapshot = editingId ? await transaction.get(taskRef) : null;
      if (editingId && !existingSnapshot.exists()) throw new Error("This task no longer exists.");
      const existing = existingSnapshot?.data();
      const oldProjectId = existing?.projectId || null;
      const newProjectRef = projectDocument(project.id);
      const oldProjectRef = oldProjectId && oldProjectId !== project.id
        ? projectDocument(oldProjectId)
        : null;
      const newProjectSnapshot = await transaction.get(newProjectRef);
      const oldProjectSnapshot = oldProjectRef ? await transaction.get(oldProjectRef) : null;
      if (!newProjectSnapshot.exists()) throw new Error("The selected project no longer exists.");
      if (oldProjectRef && !oldProjectSnapshot.exists()) {
        throw new Error("The current task project no longer exists. Refresh and try again.");
      }

      if (!editingId || oldProjectId !== project.id) {
        const newCount = newProjectSnapshot.data().taskCount;
        if (!Number.isInteger(newCount) || newCount < 0) throw new Error("The selected project's task count is invalid.");
        transaction.update(newProjectRef, {
          taskCount: newCount + 1,
          lastMutationTaskId: taskRef.id,
          updatedAt: now
        });
      }
      if (oldProjectRef) {
        const oldCount = oldProjectSnapshot.data().taskCount;
        if (!Number.isInteger(oldCount) || oldCount < 1) throw new Error("The current project's task count is invalid.");
        transaction.update(oldProjectRef, {
          taskCount: oldCount - 1,
          lastMutationTaskId: taskRef.id,
          updatedAt: now
        });
      }
      if (editingId) {
        transaction.update(taskRef, task);
      } else {
        transaction.set(taskRef, { ...task, createdAt: now });
      }
    });
    closeEditor();
    await loadWorkspace();
    showNotice(editingId ? "Task updated." : "Task created.", true);
  } catch (error) {
    showNotice(error.code === "permission-denied"
      ? "Firestore denied this task change. Publish the owner-only rules from the README."
      : error.message || "Could not save the task.");
  } finally {
    $("save-task").disabled = false;
  }
}
async function toggleTask(task) {
  const completed = !task.completed;
  try {
    await updateDoc(taskDocument(task.id), {
      completed,
      status: completed ? "completed" : "open",
      updatedAt: new Date().toISOString()
    });
    await loadWorkspace();
  } catch (error) {
    showNotice(error.code === "permission-denied"
      ? "Firestore denied this change. Check that the current security rules are published."
      : error.message || "Could not update the task.");
  }
}
async function deleteTask(task) {
  if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
  try {
    await runTransaction(db, async transaction => {
      const taskRef = taskDocument(task.id);
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists()) throw new Error("This task no longer exists.");
      const projectId = snapshot.data().projectId;
      if (!projectId) throw new Error("This task needs a project assignment. Refresh and try again.");
      const projectRef = projectDocument(projectId);
      const projectSnapshot = await transaction.get(projectRef);
      if (!projectSnapshot.exists()) throw new Error("The task's project no longer exists.");
      const count = projectSnapshot.data().taskCount;
      if (!Number.isInteger(count) || count < 1) throw new Error("The project task count is invalid. The task was not deleted.");
      transaction.update(projectRef, {
        taskCount: count - 1,
        lastMutationTaskId: task.id,
        updatedAt: new Date().toISOString()
      });
      transaction.delete(taskRef);
    });
    await loadWorkspace();
    showNotice("Task deleted.", true);
  } catch (error) {
    showNotice(error.code === "permission-denied"
      ? "Firestore denied this task deletion. Check that the current security rules are published."
      : error.message || "Could not delete the task.");
  }
}
function projectName(projectId, fallback = "Unassigned") {
  return state.projects.find(project => project.id === projectId)?.name || fallback;
}
function filteredTasks() {
  const today = localDateKey();
  const q = state.query.toLowerCase();
  return state.tasks.filter(task => {
    const project = projectName(task.projectId, task.project || "Unassigned");
    const matches = !q || `${task.title} ${project} ${task.description || task.notes || ""}`.toLowerCase().includes(q);
    if (!matches) return false;
    if (state.view === "Completed") return task.completed;
    if (state.view === "Upcoming") return !task.completed && task.dueDate && task.dueDate > today;
    if (state.view === "Today") return !task.completed && (!task.dueDate || task.dueDate <= today);
    if (state.view.startsWith("project:")) return task.projectId === state.view.slice(8);
    return true;
  }).sort((a,b) => {
    const rank = {High:0,Medium:1,Low:2};
    return Number(a.completed)-Number(b.completed) || (rank[a.priority] ?? 1)-(rank[b.priority] ?? 1) || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
  });
}
function renderProjects() {
  $("task-project").innerHTML = state.projects.map(project =>
    `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`
  ).join("");
  $("project-nav").innerHTML = state.projects.map(project => `
    <div class="project-nav-row">
      <button class="nav-item ${state.view === `project:${project.id}` ? "active" : ""}" data-project="${escapeHTML(project.id)}">▦ <span>${escapeHTML(project.name)}</span></button>
      <button class="project-action" data-project-action="edit" data-id="${escapeHTML(project.id)}" aria-label="Edit ${escapeHTML(project.name)}" title="Edit project">✎</button>
      <button class="project-action delete" data-project-action="delete" data-id="${escapeHTML(project.id)}" aria-label="Delete ${escapeHTML(project.name)}" title="Delete project">×</button>
    </div>`).join("") || (state.loading
      ? `<div class="project-empty"><p>Loading projects…</p></div>`
      : `
      <div class="project-empty">
        <p>No projects yet.</p>
        <button class="project-empty-create" data-create-project>Create Project</button>
      </div>`);
}
function render() {
  renderProjects();
  const firstName = state.user?.displayName?.trim().split(/\s+/)[0];
  $("greeting").textContent = firstName
    ? `Welcome back, ${firstName}!`
    : state.user ? "Welcome back!" : "✦ A FRESH START";
  const total = state.tasks.length, done = state.tasks.filter(task => task.completed).length;
  $("stat-total").textContent = total;
  $("stat-open").textContent = total-done;
  $("stat-done").textContent = done;
  const percent = total ? Math.round(done/total*100) : 0;
  $("stat-progress").textContent = `${percent}%`;
  $("progress-bar").style.width = `${percent}%`;
  const projectView = state.view.startsWith("project:");
  const activeProject = projectView ? state.projects.find(project => project.id === state.view.slice(8)) : null;
  const viewName = activeProject?.name || (projectView ? "Project" : state.view);
  $("current-view").textContent = viewName;
  $("list-title").textContent = viewName;
  $("heading").textContent = state.view === "Today" ? "Your day, your pace." : viewName;
  $("subheading").textContent = state.view === "Today"
    ? "Small steps today. Big things over time."
    : activeProject?.description || "Keep everything moving, one task at a time.";
  const tasks = filteredTasks();
  $("task-count").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  if (state.loading && !tasks.length) {
    $("task-list").innerHTML = `<div class="empty"><h3>Loading your workspace…</h3></div>`;
  } else if (!tasks.length) {
    const needsProject = state.projects.length === 0 && !state.query;
    $("task-list").innerHTML = `<div class="empty"><div class="empty-icon">✓</div><h3>${state.query ? "No matching tasks." : needsProject ? "Start with a project." : "A little breathing room."}</h3><p>${state.query ? "Try another search or clear the search box." : needsProject ? "Create a project to organize your tasks." : "Nothing here right now. Add a task when you're ready."}</p><button class="btn primary" id="empty-add">${needsProject ? "＋ Create Project" : "＋ Add a task"}</button></div>`;
    $("empty-add").addEventListener("click", () => needsProject ? openProjectEditor() : openEditor());
  } else {
    $("task-list").innerHTML = tasks.map(task => {
      const project = projectName(task.projectId, task.project || "Unassigned");
      const status = task.status || (task.completed ? "completed" : "open");
      return `
      <article class="task-row ${task.completed ? "is-complete" : ""}">
        <button class="task-check ${task.completed ? "checked" : ""}" data-action="toggle" data-id="${escapeHTML(task.id)}" aria-label="${task.completed ? "Mark incomplete" : "Complete task"}">${task.completed ? "✓" : ""}</button>
        <div class="task-copy"><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta"><span class="project-tag">${escapeHTML(project)}</span><span class="status-tag status-${escapeHTML(status)}">${escapeHTML(status.replace("-", " "))}</span>${task.dueDate ? `<span class="due-tag">◷ ${escapeHTML(task.dueDate)}</span>` : ""}</div>${(task.description || task.notes) ? `<div class="task-description">${escapeHTML(task.description || task.notes)}</div>` : ""}</div>
        <span class="priority priority-${escapeHTML((task.priority || "Medium").toLowerCase())}">${escapeHTML(task.priority || "Medium")}</span>
        <div class="row-actions"><button data-action="edit" data-id="${escapeHTML(task.id)}" aria-label="Edit task" title="Edit">✎</button><button class="delete" data-action="delete" data-id="${escapeHTML(task.id)}" aria-label="Delete task" title="Delete">×</button></div>
      </article>`;
    }).join("");
  }
  document.querySelectorAll(".nav-item[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
}
function init() {
  $("today-date").textContent = new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});
  $("main-nav").addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    render();
  });
  $("project-nav").addEventListener("click", event => {
    if (event.target.closest("[data-create-project]")) {
      openProjectEditor();
      return;
    }
    const actionButton = event.target.closest("[data-project-action]");
    if (actionButton) {
      const project = state.projects.find(item => item.id === actionButton.dataset.id);
      if (!project) return;
      if (actionButton.dataset.projectAction === "edit") openProjectEditor(project);
      if (actionButton.dataset.projectAction === "delete") deleteProject(project);
      return;
    }
    const button = event.target.closest("[data-project]");
    if (!button) return;
    state.view = `project:${button.dataset.project}`;
    state.query = "";
    $("search").value = "";
    render();
  });
  $("search").addEventListener("input", event => { state.query = event.target.value; render(); });
  $("new-task-top").addEventListener("click", () => openEditor());
  $("new-project").addEventListener("click", () => openProjectEditor());
  $("close-editor").addEventListener("click", closeEditor);
  $("cancel-editor").addEventListener("click", closeEditor);
  $("task-form").addEventListener("submit", saveTask);
  $("close-project-editor").addEventListener("click", closeProjectEditor);
  $("cancel-project-editor").addEventListener("click", closeProjectEditor);
  $("project-form").addEventListener("submit", saveProject);
  $("view-all").addEventListener("click", () => {
    state.view = "All Tasks";
    state.query = "";
    $("search").value = "";
    render();
  });
  $("google-sign-in").addEventListener("click", signIn);
  $("sign-out").addEventListener("click", async () => {
    try { await signOut(auth); }
    catch (error) { showAuthError(error); }
  });
  $("task-list").addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const task = state.tasks.find(item => item.id === button.dataset.id);
    if (!task) return;
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
