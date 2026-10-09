# TaskVerse — Firebase PWA

TaskVerse is a static, installable task manager. Firebase Authentication handles Google sign-in and Cloud Firestore stores tasks in a user-specific path. The frontend uses the Firebase JavaScript SDK directly; it does not need an Apps Script deployment or a Cloudflare Worker.

## Firebase setup

The web app Firebase configuration is in `frontend/app.js`. Firebase web API keys identify a project and are not server credentials; access to task data is protected by Authentication and Firestore Security Rules.

1. Open the [Firebase Console](https://console.firebase.google.com/) and select project `taskverse-9b8dd`.
2. In **Authentication → Sign-in method**, enable **Google** and select a project support email.
3. In **Authentication → Settings → Authorized domains**, add the exact hostname used to serve the app (for example, `YOURNAME.github.io`; do not include a scheme, path, or port).
4. In **Firestore Database**, create a database. Choose the location nearest to the people using the app; a database's location cannot be changed after creation. For users mainly in India, consider `asia-south1` (Mumbai) if it is available.
5. Open **Firestore Database → Rules**, replace the starter rules with the rules below, and click **Publish**:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedInAs(userId) {
      return request.auth != null && request.auth.uid == userId;
    }

    function validTask() {
      return request.resource.data.keys().hasAll([
          'title', 'project', 'priority', 'dueDate', 'notes',
          'completed', 'createdAt', 'updatedAt'
        ])
        && request.resource.data.keys().hasOnly([
          'title', 'project', 'priority', 'dueDate', 'notes',
          'completed', 'createdAt', 'updatedAt'
        ])
        && request.resource.data.title is string
        && request.resource.data.title.size() > 0
        && request.resource.data.title.size() <= 180
        && request.resource.data.project in [
          'Personal', 'Nexoverse', 'Student Nexus',
          'Microsoft Fabric User Group Hyderabad', 'GitHub Dev Days',
          'Content Creation', 'Career'
        ]
        && request.resource.data.priority in ['High', 'Medium', 'Low']
        && request.resource.data.dueDate is string
        && request.resource.data.notes is string
        && request.resource.data.notes.size() <= 1000
        && request.resource.data.completed is bool
        && request.resource.data.createdAt is string
        && request.resource.data.updatedAt is string;
    }

    match /users/{userId}/tasks/{taskId} {
      allow get, list, delete: if signedInAs(userId);
      allow create: if signedInAs(userId) && validTask();
      allow update: if signedInAs(userId)
        && validTask()
        && request.resource.data.createdAt == resource.data.createdAt;
    }
  }
}
```

These rules allow users to access only `users/{their Firebase UID}/tasks/*`; do not replace them with public read/write rules.

## Run and deploy

### Deploy to GitHub Pages

The complete source stays in this repository, while GitHub Pages publishes only `frontend/`. The GitHub Actions workflow uploads that directory as the Pages artifact, placing its `index.html` at the site root. This avoids exposing backend source as website assets and avoids serving this README instead of the app.

1. In the GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**. Do not select **Deploy from a branch** or publish the repository root.
3. Commit and push the workflow and project changes to the `main` branch. The workflow is `.github/workflows/deploy-pages.yml`; it deploys when frontend files change and can also be started from **Actions → Deploy TaskVerse to GitHub Pages → Run workflow**.
4. In **Firebase Console → Authentication → Settings → Authorized domains**, add `harish-reddy-duggempudi.github.io`. Enter only the hostname—no scheme, repository path, or trailing slash.
5. In **Firebase Console → Authentication → Sign-in method**, ensure Google sign-in is enabled. Confirm Firestore exists and its owner-only rules above are published.
6. Wait for **Actions → Deploy TaskVerse to GitHub Pages** to complete successfully. Open [https://harish-reddy-duggempudi.github.io/TaskVerse/](https://harish-reddy-duggempudi.github.io/TaskVerse/).

The site is hosted under the `/TaskVerse/` project path. Frontend asset, manifest, and service-worker URLs are relative to that path, and the service worker scope is limited to the app. The workflow publishes only `frontend/`; `apps-script/`, `cloudflare-worker/`, `.gitignore`, and documentation remain in the source repository and are not uploaded as website files.

Opening `frontend/index.html` directly with a `file://` URL will not work because Firebase browser modules and Google sign-in require a web origin. For local testing, serve the contents of `frontend/` from `localhost`.

After the Firebase setup and deployment, sign in with Google and test creating, editing, completing, deleting, and refreshing tasks. To verify data isolation, sign in with a second Google account and confirm it cannot see the first account's tasks.

## PWA and offline behavior

The manifest and service worker cache the app shell. Authentication and task reads/writes need an internet connection; offline task mutation and reconciliation are not implemented.

## Existing legacy backend files

`apps-script/Code.gs` and `cloudflare-worker/worker.js` are from the previous Google Sheets architecture. The Firebase frontend does not call them; they are not required for this version.

## Troubleshooting

- **Unauthorized domain**: add the exact hosting hostname under **Authentication → Settings → Authorized domains**.
- **Google sign-in is unavailable**: enable the Google provider in **Authentication → Sign-in method** and set a support email.
- **Permission denied**: publish the Firestore rules above and confirm the signed-in account is using the same Firebase project.
- **Firebase imports fail**: serve the app over HTTPS or `localhost` and verify the browser can reach `www.gstatic.com`.
- **Tasks do not sync**: check the browser console and Firebase Console's Firestore usage and Authentication status.
