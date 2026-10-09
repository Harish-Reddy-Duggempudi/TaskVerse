/**
 * TaskVerse Apps Script API.
 * Set SCRIPT PROPERTY SPREADSHEET_ID and GOOGLE_CLIENT_ID before deployment.
 * Never accept a user ID/email from the browser as identity; verify the ID token.
 */
const TASK_HEADERS = ["id","ownerSub","title","project","priority","dueDate","notes","completed","createdAt","updatedAt"];
const USER_HEADERS = ["sub","email","name","createdAt","lastSeenAt"];
const PROJECTS = ["Personal","Nexoverse","Student Nexus","Microsoft Fabric User Group Hyderabad","GitHub Dev Days","Content Creation","Career"];

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    service: "TaskVerse API", status: "ok", version: "1.0",
    note: "POST JSON requests through the configured Cloudflare Worker."
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!body.idToken || typeof body.idToken !== "string" || body.idToken.length > 10000) {
      throw new Error("A valid Google sign-in token is required.");
    }
    const user = verifyGoogleToken_(body.idToken);
    const result = route_(body.action, body, user);
    return json_({ok:true, ...result});
  } catch (err) {
    return json_({ok:false, error:safeError_(err)});
  }
}

function setupTaskVerse() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty("SPREADSHEET_ID");
  let ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.create("TaskVerse Database");
    spreadsheetId = ss.getId();
    props.setProperty("SPREADSHEET_ID", spreadsheetId);
  }
  ensureSheet_(ss, "Tasks", TASK_HEADERS);
  ensureSheet_(ss, "Users", USER_HEADERS);
  ensureSheet_(ss, "Projects", ["project"]);
  const projectSheet = ss.getSheetByName("Projects");
  if (projectSheet.getLastRow() < 2) {
    projectSheet.getRange(2,1,PROJECTS.length,1).setValues(PROJECTS.map(p => [p]));
  }
  Logger.log("TaskVerse spreadsheet: " + ss.getUrl());
  return ss.getUrl();
}

function route_(action, body, user) {
  touchUser_(user);
  switch (action) {
    case "login":
      return {user:{sub:user.sub, email:user.email, name:user.name}};
    case "listTasks":
      return {tasks:listTasks_(user.sub), projects:PROJECTS};
    case "createTask":
      return {task:createTask_(user.sub, body.task)};
    case "updateTask":
      return {task:updateTask_(user.sub, body.taskId, body.task)};
    case "deleteTask":
      deleteTask_(user.sub, body.taskId);
      return {deleted:true};
    default:
      throw new Error("Unsupported action.");
  }
}

/**
 * Google tokeninfo validates Google's signed ID token and claims remotely.
 * We additionally pin the expected audience, issuer, expiry and verified email.
 * For high-volume production, migrate verification to a standard Google auth
 * library on a conventional backend; tokeninfo has rate limits.
 */
function verifyGoogleToken_(token) {
  const expectedClientId = PropertiesService.getScriptProperties().getProperty("GOOGLE_CLIENT_ID");
  if (!expectedClientId) throw new Error("Backend is not configured: GOOGLE_CLIENT_ID is missing.");
  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token);
  const response = UrlFetchApp.fetch(url, {method:"get", muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error("Google sign-in token is invalid or expired. Please sign in again.");
  const claims = JSON.parse(response.getContentText());
  const now = Math.floor(Date.now()/1000);
  if (claims.aud !== expectedClientId) throw new Error("Token audience does not match this app.");
  if (!["accounts.google.com","https://accounts.google.com"].includes(claims.iss)) throw new Error("Invalid token issuer.");
  if (!claims.sub || !claims.exp || Number(claims.exp) <= now) throw new Error("Google sign-in token has expired.");
  if (claims.email_verified !== "true" && claims.email_verified !== true) throw new Error("A verified Google email is required.");
  return {
    sub:String(claims.sub),
    email:String(claims.email || "").toLowerCase(),
    name:String(claims.name || claims.given_name || "TaskVerse user").slice(0,120)
  };
}

function listTasks_(sub) {
  const sheet = getSheet_("Tasks");
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(row => String(row[headers.indexOf("ownerSub")]) === sub)
    .map(rowToTask_);
}
function createTask_(sub, input) {
  const task = validateTask_(input, false);
  const now = new Date().toISOString();
  task.id = Utilities.getUuid();
  task.ownerSub = sub;
  task.completed = false;
  task.createdAt = now;
  task.updatedAt = now;
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    getSheet_("Tasks").appendRow(taskToRow_(task));
  } finally { lock.releaseLock(); }
  return publicTask_(task);
}
function updateTask_(sub, id, input) {
  if (!id || typeof id !== "string" || id.length > 100) throw new Error("Invalid task ID.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid task update.");
  const sheet = getSheet_("Tasks"), values = sheet.getDataRange().getValues(), headers = values[0];
  const idCol = headers.indexOf("id"), ownerCol = headers.indexOf("ownerSub");
  for (let i=1; i<values.length; i++) {
    if (String(values[i][idCol]) !== id) continue;
    if (String(values[i][ownerCol]) !== sub) throw new Error("Task not found.");
    const old = rowToTask_(values[i], headers);
    const merged = {
      title: Object.prototype.hasOwnProperty.call(input,"title") ? input.title : old.title,
      project: Object.prototype.hasOwnProperty.call(input,"project") ? input.project : old.project,
      priority: Object.prototype.hasOwnProperty.call(input,"priority") ? input.priority : old.priority,
      dueDate: Object.prototype.hasOwnProperty.call(input,"dueDate") ? input.dueDate : old.dueDate,
      notes: Object.prototype.hasOwnProperty.call(input,"notes") ? input.notes : old.notes,
      completed: Object.prototype.hasOwnProperty.call(input,"completed") ? input.completed : old.completed
    };
    const clean = validateTask_(merged, true);
    const task = Object.assign({}, old, clean, {updatedAt:new Date().toISOString()});
    sheet.getRange(i+1,1,1,headers.length).setValues([taskToRow_(task)]);
    return publicTask_(task);
  }
  throw new Error("Task not found.");
}
function deleteTask_(sub, id) {
  if (!id || typeof id !== "string" || id.length > 100) throw new Error("Invalid task ID.");
  const sheet = getSheet_("Tasks"), values = sheet.getDataRange().getValues(), headers = values[0];
  const idCol = headers.indexOf("id"), ownerCol = headers.indexOf("ownerSub");
  for (let i=1; i<values.length; i++) {
    if (String(values[i][idCol]) === id && String(values[i][ownerCol]) === sub) {
      sheet.deleteRow(i+1); return;
    }
  }
  throw new Error("Task not found.");
}
function validateTask_(input, allowCompleted) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid task.");
  const title = String(input.title == null ? "" : input.title).trim();
  const project = String(input.project == null ? "Personal" : input.project);
  const priority = String(input.priority == null ? "Medium" : input.priority);
  const dueDate = String(input.dueDate == null ? "" : input.dueDate);
  const notes = String(input.notes == null ? "" : input.notes).trim();
  if (!title || title.length > 180) throw new Error("Task title must be 1–180 characters.");
  if (!PROJECTS.includes(project)) throw new Error("Unknown project.");
  if (!["High","Medium","Low"].includes(priority)) throw new Error("Invalid priority.");
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("Due date must be YYYY-MM-DD.");
  if (notes.length > 1000) throw new Error("Notes must be 1000 characters or fewer.");
  const result = {title, project, priority, dueDate, notes};
  if (allowCompleted) {
    if (typeof input.completed !== "boolean") throw new Error("Completed must be true or false.");
    result.completed = input.completed;
  }
  return result;
}
function touchUser_(user) {
  const sheet = getSheet_("Users"), values = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  for (let i=1; i<values.length; i++) {
    if (String(values[i][0]) === user.sub) {
      sheet.getRange(i+1,2,1,4).setValues([[user.email,user.name,values[i][3] || now,now]]);
      return;
    }
  }
  sheet.appendRow([user.sub,user.email,user.name,now,now]);
}
function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  else {
    const actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
    if (headers.some((h,i) => actual[i] !== h)) throw new Error("Unexpected headers in " + name + " sheet.");
  }
  sheet.setFrozenRows(1);
}
function getSheet_(name) {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Run setupTaskVerse() once before using the API.");
  const ss = SpreadsheetApp.openById(id), sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet: " + name + ". Run setupTaskVerse().");
  return sheet;
}
function rowToTask_(row, headers) {
  headers = headers || TASK_HEADERS;
  const obj = {};
  headers.forEach((key,i) => obj[key] = row[i]);
  return {
    id:String(obj.id), ownerSub:String(obj.ownerSub), title:String(obj.title),
    project:String(obj.project), priority:String(obj.priority), dueDate:String(obj.dueDate || ""),
    notes:String(obj.notes || ""), completed:obj.completed === true || String(obj.completed) === "true",
    createdAt:String(obj.createdAt || ""), updatedAt:String(obj.updatedAt || "")
  };
}
function taskToRow_(t) {
  return [t.id,t.ownerSub,t.title,t.project,t.priority,t.dueDate || "",t.notes || "",Boolean(t.completed),t.createdAt,t.updatedAt];
}
function publicTask_(t) {
  return {id:t.id,title:t.title,project:t.project,priority:t.priority,dueDate:t.dueDate || "",notes:t.notes || "",completed:Boolean(t.completed),createdAt:t.createdAt,updatedAt:t.updatedAt};
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function safeError_(err) {
  const message = String(err && err.message || "Request failed.");
  return message.slice(0,240);
}