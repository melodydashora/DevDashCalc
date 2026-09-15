# Student accounts and Canvas credentials — implementation record and remaining work

**Status: account boundary implemented, September 14, 2026.** The repository now includes username/password accounts, database ownership checks, hashed sessions, private enrollment links, and the sign-in interface. Replit preview and deployment must explicitly use `AUTH_REQUIRED=1`; local zero-configuration mode remains available only for isolated private development. Deployment activation and each student's completed enrollment must be verified separately from the code. Canvas OAuth, encrypted remembered Canvas credentials, password recovery, and administrative sharing screens remain planned.

## Current behavior and intended result

In account mode, a valid server session and a fresh database ownership check are required before any progress, Canvas, coach, or mixed-practice endpoint. A profile query is a selection hint; a different account's UUID, copied Canvas cookie, or browser workspace list cannot grant access. Dev and Esha retain their exact server-configured Canvas secret bindings and original progress/source-history records. Other authorized workspaces can use the existing connection form. Remembered form credentials still use the existing server-only file/database store; application-level credential encryption is not implemented.

The implemented flow is: open a private enrollment link, choose a username and password, then sign in from another computer to the same owned workspace. An enrollment token can claim only the workspace bound to it and is consumed atomically with account, membership, and session creation. Registration without an enrollment link is disabled by default. Explicit `AUTH_ALLOW_SIGNUP=1` creates a new random workspace and never claims a submitted legacy ID. Study features remain available when Canvas is disconnected. Account-recovery and institution-approved Canvas OAuth still need implementation.

A Canvas token must be recoverable because Canvas expects the original credential on API requests. A hash alone cannot supply it. Future Canvas credential storage should use authenticated encryption or a secret-manager reference. App passwords already use dedicated salted scrypt hashing; they are never treated as Canvas credentials. [OWASP Cryptographic Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Implemented account tables and limits

`account-store.js` initializes these six PostgreSQL tables through parameterized statements. Account authentication has no file fallback. Existing learner data remains in its original `calc_coach_store` keys and file mirrors behind the authorized `profile_id` mapping.

| Actual table | Implemented responsibility |
|---|---|
| `s4ai_users` | UUID, unique normalized username, display name, salted password hash, active/disabled status, and authentication version. |
| `s4ai_workspaces` | UUID, unique legacy/current profile ID, name, and owning account. |
| `s4ai_workspace_members` | Explicit account/workspace membership. Current protected APIs require the owner role; the schema's viewer role is reserved for later permission features. |
| `s4ai_sessions` | Random session's HMAC hash, account/authentication version, expiry, and revocation time. No bearer token is stored. |
| `s4ai_enrollments` | HMAC hash of a one-use setup token, prepared workspace, expiry, and atomic consumption record. |
| `s4ai_auth_limits` | Persistent, hashed client/username request buckets for sign-in and registration limits. |

The separate `s4ai_student_memos` table implements explicit student continuity.
Each append has a server-generated note ID/time, workspace foreign key,
saving-account foreign key, text, student/coach note type, allowlisted source,
and a client request UUID unique within the workspace. It is a seventh table,
not part of the six authentication tables above. The server derives the saving
account and workspace from authentication, never from submitted fields.

Only an explicit student Save or Remember action appends a note. Repeating the
same request UUID returns the original; reusing it with different content is a
conflict, and never rewrites the earlier note. There is no edit/delete endpoint
or automatic transcript archive. Text is limited to 2,000 characters and source
metadata to kind, subject, unit ID, and question ID. An obvious-credential-paste
check reduces accidents but does not guarantee that all sensitive text can be
detected; credentials do not belong in learning notes.

`GET /api/continuity` returns the newest 30 notes, total count, and remaining
older-note count; `offset` pages through retained history. The general study
coach receives the newest ten notes and reports inclusion/omission or retrieval
failure. All note text remains untrusted data: remembering an explanation does
not verify its math or make it a rule that can override current instructions,
Canvas evidence, or grading. This supports continuity without claiming complete
recall or creating a vector-search system.

Usernames are trimmed/lowercased ASCII letters, numbers, underscores, or hyphens, 3–32 characters. Passwords are 15–128 Unicode code points without trimming or truncation. scrypt uses N=131072, r=8, p=1, a fresh 16-byte salt, and a 32-byte derived key. Expensive password operations are limited to two active and four queued requests. Unknown-user and wrong-password login responses use the same message and password work.

Sessions contain 32 random bytes and expire after seven days; current-session logout revokes their stored hash. Enrollment tokens also contain 32 random bytes, expire after 24 hours by default, and may be configured for one minute to seven days. `SESSION_SECRET` supplies domain-separated HMAC hashing and must contain at least 32 bytes. Rotating it invalidates existing sessions and unconsumed setup links, so keep it stable across deployments. It is not a Canvas encryption key.

The current persistent rate limits allow 60 login attempts per client and 12 per username per 15 minutes; registration allows 12 per client and 5 per username per hour. The client key uses the direct socket address. Replit's reverse proxy may therefore share that client bucket across students; username buckets remain separate. This is a known limitation for larger enrollment groups.

HTTPS uses `__Host-students4ai_session` with Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain; local HTTP testing uses an unprefixed cookie. Mutations require an exact same-origin Origin header. API responses are no-store. The server suppresses a pending response after logout in that same server process; new requests always recheck the database session and ownership. The embedded Replit preview can block third-party cookies, so the sign-in page offers a standalone app tab.

## Operator setup and preserved student data

Configure `DATABASE_URL`, stable `SESSION_SECRET`, and `AUTH_REQUIRED=1` for the Replit workflow and deployment. Keep `AUTH_ALLOW_SIGNUP` unset for private enrollment. Configuration/database failures must never downgrade to the unauthenticated local mode.

For a prepared workspace that already has a database progress record, run this on the server, replacing the example identifiers and origin:

```sh
node scripts/create-enrollment.mjs --profile EXISTING_PROFILE_ID --name "Student name" --base-url https://YOUR-APP.example
```

The operator command preserves progress and Canvas records, creates or reuses an unclaimed ownership row, and writes a private link artifact to ignored `data/enrollment-links/`. Files are created exclusively with owner-only permissions; an existing artifact is never overwritten. Paths under static `public/` and `content/`, including parent symlink aliases, are rejected. The terminal shows only the file path and expiry. Share the setup link privately with the intended student; it grants that workspace and is not suitable for a public issue, log, screenshot, or commit. The student supplies their own password through the form. A UUID or matching display name alone cannot claim a workspace.

The browser removes the enrollment token from the URL and keeps it only for the current setup flow. Reopening the private link is required after reloading an unfinished setup. Existing students use their selected username and password on later visits. There is no password-reset endpoint, recovery email, public invite-issuance endpoint, or administrative sharing UI yet.

Progress remains a whole-state record. A single-process per-profile queue covers each file and awaited database save; lower timestamps are rejected, equal timestamps use completed-request order, and reads prefer the local copy on a timestamp tie because the file commits first. Database failure preserves the local/browser copy. This is not a distributed merge of concurrent tabs, computers, or server instances. Existing source-location rules remain append-only and retain previous Canvas identities; only currently verified matching sources are used.

## Remaining Canvas connection model

The following are future extensions to the implemented account tables, not a description of tables already deployed. `canvas_connections`, application-level credential encryption, and identity-provider integration are not implemented.

| Table | Essential fields and rules |
|---|---|
| `users` | UUID primary key; unique authentication-provider issuer/subject pair; verified contact information when needed; status and timestamps. Derive identity from a verified server session, never a submitted user ID or display name. |
| `workspaces` | UUID primary key; `owner_user_id` foreign key; learner label; nullable unique legacy-profile mapping; timestamps. Existing progress can initially remain behind a server-side mapping to its original store key. |
| `workspace_members` | Workspace/user foreign keys; explicit role and permissions; invitation acceptance and revocation timestamps; unique membership pair. Family access is granted and revocable. Separate reading coursework from managing a connection. |
| `canvas_connections` | Workspace and owner foreign keys, constrained to agree with workspace ownership; actor who connected it; verified Canvas origin/user ID; method; scopes; expiry; status; revision; timestamps. One active connection per workspace. Store either an opaque `credential_ref` or authenticated ciphertext with key version, nonce and authentication tag. No raw-token or hash-only credential column. |

Treat access and refresh tokens as one protected credential payload. Keep connection metadata available without decryption. A referenced vault entry must be resolved by the server; clients cannot nominate a secret name or reference. Add nonsecret audit events for ownership grants, connection changes and migration outcomes. Keep instructor-source history and progress separate from credentials.

## Implemented authorization and remaining credential lifecycle work

The implemented account boundary authenticates every progress, Canvas, coach, and mixed-session request and verifies ownership before resolving data or credentials. Registration and login project only public account/workspace metadata; raw tokens, password hashes, and enrollment secrets are excluded. Future family-sharing and credential-management endpoints must use the same ownership checks and explicitly defined permissions.

Canvas caches and queued work remain scoped to workspace and verified connection. The current server guards late same-process connection replacements and logouts. Clear client state on sign-out/switch. Future multi-instance membership revocation must also recheck authorization before returning delayed results; do not claim that an already-running request on another server is canceled instantly. Future family sharing must expose only explicitly granted workspaces.

For encrypted blobs, use a reviewed authenticated-encryption implementation, such as AES-GCM, with fresh nonces. Bind workspace, connection and schema identifiers as authenticated associated data. Keep encryption keys outside the credential database and its backups, preferably in a managed key service; restrict decryption to the Canvas adapter. Store key versions, test rotation and recovery, and retire old keys only after retained backups are addressed. A missing key or failed integrity check must leave Canvas disconnected. Encryption does not replace ownership checks. [OWASP Cryptographic Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Connecting Canvas

Use Canvas OAuth when the institution has approved and enabled a suitable developer key. Approval and availability vary by institution; do not promise one registration works with every school. Each student connects their own account. The server must bind one-use OAuth state to the signed-in user, authorized workspace and configured Canvas origin, validate the callback, exchange the code server-side, and verify the returned Canvas identity. Request only required read scopes. Persist expiry and refresh credentials; serialize refreshes and reject results from replaced connections. [Canvas OAuth endpoints](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints)

**Token-entry fallback has a public-onboarding constraint.** Preserve the current form during this preparation, but do not make manual token entry the general signup fallback: Canvas's official overview restricts manual token generation to testing and requires OAuth for applications used by multiple users. A future per-student token-entry option needs a confirmed permitted testing context or explicit provider-approved arrangement. Until OAuth approval is available, offer independent study with Canvas disconnected. Do not ask students for Canvas passwords. [Canvas OAuth overview and manual-token guidance](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)

## Migration and acceptance

1. Back up current progress, connection records, preferences and append-only source history with restricted access. Inventory identifiers without displaying credentials. Preserve the original `learner` and all existing workspace mappings.
2. Establish verified app accounts and explicit owner approval for each legacy workspace. Never let a new account claim existing work merely by supplying its UUID, matching its label or knowing a Canvas ID. Unclaimed work stays inaccessible to public accounts.
3. Run an idempotent, resumable migration into owner-bound records. Validate each Canvas identity before linking it. Use a protected reference for existing server secrets; encrypt legacy remembered credentials server-side. Verify copied progress and connection metadata before switching reads. Preserve original evidence until an explicitly reviewed retirement step; never expose legacy credential copies through the new app.
4. The implemented account tests cover unauthorized IDs, copied cookies, session expiry/revocation, same-origin mutations, preserved enrollment mappings, late same-process logout responses, and storage failure. Disposable PostgreSQL integration verifies actual table constraints, enrollment races, and username-conflict rollback. Future OAuth/encryption work additionally needs replay/origin mismatch, key rotation/corruption, and migration-retry tests before those features can be claimed complete.

Keep logs, responses, exports, and model requests free of credentials. Current sign-in is the implemented password/session system; it does not use an external identity provider. Remaining decisions include account recovery, institution-approved Canvas OAuth, encrypted credential storage, and permission-managed family sharing. Account code and test completion do not establish that a particular student's enrollment or a production deployment has been completed.
