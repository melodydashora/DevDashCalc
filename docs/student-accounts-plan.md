# Student accounts and Canvas credentials — implementation plan

**Status: PLAN ONLY, September 14, 2026.** This document creates no accounts, tables, migrations, encryption keys, or authentication configuration. The current family app remains unchanged. Implement and verify the account boundary before opening public student registration.

## Current behavior and intended result

Today, learner IDs select family workspaces without individual sign-in. They scope progress, Canvas connections and caches, but knowing a UUID is not proof of ownership. Dev and Esha have exact server-configured secret bindings; other workspaces can use the existing connection form. Named secret values remain server-side. Remembered form credentials currently use the existing server-only file/database store; application-level encryption is not implemented.

The future flow is: sign in, choose an authorized workspace, select **Connect Canvas**, and authorize that student's Canvas connection. Later workspace switches reuse its stored authorization without requesting the token again. Keep existing study features available when Canvas is disconnected. Choose the authentication provider and account-recovery approach before coding; do not build a password system as an incidental part of Canvas integration.

A Canvas token must be recoverable because Canvas expects the original credential on API requests. A hash alone cannot supply it. Use encrypted credential storage or a secret-manager reference. Passwords, if the eventual sign-in design stores them, require dedicated password hashing instead. [OWASP Cryptographic Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Proposed relational model

These are proposed fields and constraints, not executable migration SQL.

| Table | Essential fields and rules |
|---|---|
| `users` | UUID primary key; unique authentication-provider issuer/subject pair; verified contact information when needed; status and timestamps. Derive identity from a verified server session, never a submitted user ID or display name. |
| `workspaces` | UUID primary key; `owner_user_id` foreign key; learner label; nullable unique legacy-profile mapping; timestamps. Existing progress can initially remain behind a server-side mapping to its original store key. |
| `workspace_members` | Workspace/user foreign keys; explicit role and permissions; invitation acceptance and revocation timestamps; unique membership pair. Family access is granted and revocable. Separate reading coursework from managing a connection. |
| `canvas_connections` | Workspace and owner foreign keys, constrained to agree with workspace ownership; actor who connected it; verified Canvas origin/user ID; method; scopes; expiry; status; revision; timestamps. One active connection per workspace. Store either an opaque `credential_ref` or authenticated ciphertext with key version, nonce and authentication tag. No raw-token or hash-only credential column. |

Treat access and refresh tokens as one protected credential payload. Keep connection metadata available without decryption. A referenced vault entry must be resolved by the server; clients cannot nominate a secret name or reference. Add nonsecret audit events for ownership grants, connection changes and migration outcomes. Keep instructor-source history and progress separate from credentials.

## Authorization and credential lifecycle

Every progress, Canvas, coach and mixed-session request must authenticate the caller and verify the requested workspace's ownership or accepted membership. Query through that relationship before reading records, resolving credentials or creating jobs. A browser profile ID remains a selection hint. Use parameterized queries and deny requests lacking a valid relationship. Enforce the same checks when inviting family members, switching workspaces, replacing connections and exporting data.

Key caches and queued work by workspace, connection revision and verified Canvas identity. Recheck membership and revision before returning delayed results. Clear client state on sign-out/switch; revoke outstanding sessions when access is removed. Family members may switch only among workspaces explicitly shared with their signed-in account.

For encrypted blobs, use a reviewed authenticated-encryption implementation, such as AES-GCM, with fresh nonces. Bind workspace, connection and schema identifiers as authenticated associated data. Keep encryption keys outside the credential database and its backups, preferably in a managed key service; restrict decryption to the Canvas adapter. Store key versions, test rotation and recovery, and retire old keys only after retained backups are addressed. A missing key or failed integrity check must leave Canvas disconnected. Encryption does not replace ownership checks. [OWASP Cryptographic Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Connecting Canvas

Use Canvas OAuth when the institution has approved and enabled a suitable developer key. Approval and availability vary by institution; do not promise one registration works with every school. Each student connects their own account. The server must bind one-use OAuth state to the signed-in user, authorized workspace and configured Canvas origin, validate the callback, exchange the code server-side, and verify the returned Canvas identity. Request only required read scopes. Persist expiry and refresh credentials; serialize refreshes and reject results from replaced connections. [Canvas OAuth endpoints](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints)

**Token-entry fallback has a public-onboarding constraint.** Preserve the current form during this preparation, but do not make manual token entry the general signup fallback: Canvas's official overview restricts manual token generation to testing and requires OAuth for applications used by multiple users. A future per-student token-entry option needs a confirmed permitted testing context or explicit provider-approved arrangement. Until OAuth approval is available, offer independent study with Canvas disconnected. Do not ask students for Canvas passwords. [Canvas OAuth overview and manual-token guidance](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)

## Migration and acceptance

1. Back up current progress, connection records, preferences and append-only source history with restricted access. Inventory identifiers without displaying credentials. Preserve the original `learner` and all existing workspace mappings.
2. Establish verified app accounts and explicit owner approval for each legacy workspace. Never let a new account claim existing work merely by supplying its UUID, matching its label or knowing a Canvas ID. Unclaimed work stays inaccessible to public accounts.
3. Run an idempotent, resumable migration into owner-bound records. Validate each Canvas identity before linking it. Use a protected reference for existing server secrets; encrypt legacy remembered credentials server-side. Verify copied progress and connection metadata before switching reads. Preserve original evidence until an explicitly reviewed retirement step; never expose legacy credential copies through the new app.
4. Release only after tests prove: unauthorized IDs and copied sessions reveal no other student's data; revoked family access blocks delayed responses; wrong/revoked tokens preserve the working connection; OAuth replay/origin mismatch fails; key rotation, corruption and outages cannot select another account; disconnect/restart cannot resurrect old credentials; and migration retries preserve progress and source history.

Capture logs, API responses, exports and model requests in those tests and assert that none contain credentials. Test successful authorized family switching separately. The next implementation decision is the sign-in provider and institution-approved Canvas OAuth configuration; this handoff does not select, install or activate either.
