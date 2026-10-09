# TaskVerse — Firebase PWA

TaskVerse is a static, installable task manager. Firebase Authentication handles Google sign-in and Cloud Firestore stores each user's profile, projects, and tasks under that user's Firebase UID. The frontend uses the Firebase JavaScript SDK directly; it does not need an Apps Script deployment or a Cloudflare Worker.

## Firestore data model

- `users/{uid}` — the signed-in user's display name, email, and update time. The app does not display or store profile photos; an existing legacy `photoURL` field is accepted but not written or used.
- `users/{uid}/projects/{projectId}` — the user's project name and description, a task count used to serialize safe deletion, and timestamps.
- `users/{uid}/tasks/{taskId}` — the user's tasks, including title, description, status, priority, due date, and project association (`projectId`).

Every Firestore path is constructed from the authenticated Firebase user's UID. The client never accepts a UID as proof of identity.

After sign-in, the workspace greets the user using the first name from Firebase Authentication. The interface uses initials and text/icons rather than profile photos or decorative image assets. Its responsive footer includes creator attribution, LinkedIn links, and the official Nexoverse website.

New accounts start without projects; create one from the sidebar or the empty-state button. On sign-in, the app migrates existing legacy tasks in place by adding `projectId`, `description`, and `status`; task IDs, titles, notes, dates, and completion state are retained. It does not create a predefined project list. For each signed-in user's own data, it removes only old built-in projects with their original IDs and names, an empty description, zero task count, an untouched timestamp pair, no extra fields, and no task references. Defaults with tasks, edits, or uncertain metadata are preserved and reported. User-created projects are not removed. Publish the updated rules below before using this migration; no task is deleted or moved to another collection.

Project deletion is refused when tasks remain assigned. Task create, delete, reassignment, and project deletion coordinate through Firestore transactions and a per-project task counter. Security Rules require task writes that change a counter to include the corresponding task mutation in the same atomic operation. This makes concurrent project deletion and task creation conflict safely. Firestore client transactions can read documents, not run a query and use its results atomically; deletion therefore relies on the transactionally maintained counter rather than a query as its safety guarantee.

## Firebase setup

The web app Firebase configuration is in `frontend/app.js`. Firebase web API keys identify a project and are not server credentials; access to task data is protected by Authentication and Firestore Security Rules.

1. Open the [Firebase Console](https://console.firebase.google.com/) and select project `taskverse-9b8dd`.
2. In **Authentication → Sign-in method**, enable **Google** and select a project support email.
3. In **Authentication → Settings → Authorized domains**, add the exact hostname used to serve the app (for example, `YOURNAME.github.io`; do not include a scheme, path, or port).
4. In **Firestore Database**, create a database. Choose the location nearest to the people using the app; a database's location cannot be changed after creation. For users mainly in India, consider `asia-south1` (Mumbai) if it is available.
5. Open **Firestore Database → Rules**, replace the current rules with the complete contents of [`firestore.rules`](./firestore.rules), and click **Publish**. These owner-only rules cover the user profile, projects, and tasks, validate task/project fields, and enforce the transaction-based task counter. Do not enable public read or write access.

## Search engine and social metadata

The app is a sign-in-gated personal workspace, not a public landing page. Its page metadata, `frontend/robots.txt`, and Vercel `X-Robots-Tag` response header tell compliant crawlers not to index the app. The canonical URL and social preview metadata use `https://taskverse.nexoverse.in/`; no sitemap or preview image is published because there is no public/indexable landing page or dedicated social image. These crawler directives are not an access-control mechanism: Firebase Authentication and the owner-only Firestore Rules protect private user data.

## Run and deploy

### Deploy to Vercel

The intended production site is [https://taskverse.nexoverse.in/](https://taskverse.nexoverse.in/). The repository root does not contain the HTML entry point; the static app is in `frontend/`. The root [`vercel.json`](./vercel.json) selects Vercel's static/Other framework mode and publishes only `frontend/`, so `frontend/index.html` is the deployed root document and backend-only source is excluded.

1. Import this GitHub repository into Vercel or open its existing Vercel project.
2. Use the repository root (`.`) as the project root so Vercel can read `vercel.json`. Leave the Framework Preset as **Other** and do not set a build command. The config sets `frontend` as the output directory.
3. In **Settings → Domains**, assign `taskverse.nexoverse.in` to this project and complete Vercel's DNS verification steps. Keep the Vercel-provided domain only if you still intend to serve the app there.
4. Confirm Firebase Authentication has `taskverse.nexoverse.in` under **Authorized domains**, Google sign-in is enabled, and the owner-only Firestore rules above are published.
5. Commit and push the changes to the connected Git branch, then verify the Vercel deployment is ready and open the production URL. Do not treat a local validation as proof of deployment.

All frontend asset, manifest, and service-worker URLs are relative to the app root. The service worker is deployed at `/sw.js` and controls only the site origin. The Vercel output directory contains only frontend files; `apps-script/`, `cloudflare-worker/`, Firestore rules, and documentation are not published as site assets.

GitHub Pages remains available as an alternative through `.github/workflows/deploy-pages.yml`; if using it, select **Settings → Pages → Source: GitHub Actions** and authorize `harish-reddy-duggempudi.github.io` in Firebase.

Opening `frontend/index.html` directly with a `file://` URL will not work because Firebase browser modules and Google sign-in require a web origin. For local testing, serve the contents of `frontend/` from `localhost`.

After the Firebase setup and deployment, sign in with Google and test creating, editing, completing, deleting, and refreshing tasks. To verify data isolation, sign in with a second Google account and confirm it cannot see the first account's tasks.

## PWA and offline behavior

The manifest and service worker cache the app shell. Authentication and task/project reads and writes need an internet connection; offline task mutation and reconciliation are not implemented.

## Existing legacy backend files

`apps-script/Code.gs` and `cloudflare-worker/worker.js` are from the previous Google Sheets architecture. The Firebase frontend does not call them; they are not required for this version.

## Troubleshooting

- **Unauthorized domain**: add the exact hosting hostname under **Authentication → Settings → Authorized domains**.
- **Google sign-in is unavailable**: enable the Google provider in **Authentication → Sign-in method** and set a support email.
- **Permission denied**: publish the complete rules from `firestore.rules` and confirm the signed-in account is using the same Firebase project.
- **Cannot delete project**: reassign or remove its tasks first. The stored task count is checked atomically and deletion is denied if it is nonzero or invalid.
- **Firebase imports fail**: serve the app over HTTPS or `localhost` and verify the browser can reach `www.gstatic.com`.
- **Tasks do not sync**: check the browser console and Firebase Console's Firestore usage and Authentication status.
