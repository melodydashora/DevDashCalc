# Existing deployment path

The repository remote is `https://github.com/melodydashora/DevDashCalc.git`.
The tracked `.replit` selects Node 22, runs `node server.js`, sets `PORT=8080`,
and maps port 8080 to external port 80. Its deployment target is `cloudrun` and
its deployment command is:

```sh
AUTH_REQUIRED=1 AUTH_ALLOW_SIGNUP=1 node server.js
```

There is no build or package-install step. `.github/workflows/ci.yml` runs
syntax, application tests, language lint, mastery-bank validation, and curriculum
validation; it does not publish a deployment. There is no deployment script
under the repository's `scripts/` directory.

The previously recorded production address is
`https://dev-dash-calc.replit.app`. This guide does not establish which commit
that address currently serves. `students4ai.com` was a planned domain, and
`ailearning4students.com` was subsequently named by the owner; neither custom
domain's deployment or DNS mapping is verified by this repository.

## Release procedure

1. Finish review and merge the intended commit through the repository's normal
   branch/PR process. Run `npm test`, `npm run lint`, and `npm run validate` and
   confirm CI. Importing or running a preview is not production publication.
2. In the existing Replit project, bring in that exact reviewed commit and
   confirm the deployment uses the tracked command. Preserve the existing
   production database and stable `SESSION_SECRET`; do not create a fresh
   workspace database as part of a routine code release.
3. Confirm `DATABASE_URL`, `SESSION_SECRET` (at least 32 bytes),
   `AUTH_REQUIRED=1`, and `AUTH_ALLOW_SIGNUP=1` in the deployment environment.
   Keep provider keys and each learner's Canvas binding server-side. A preview
   Secrets change must also reach the production deployment; never print values.
4. Use the existing Replit deployment's publish/update action for the reviewed
   code. There is no repository webhook/CI auto-deploy established here.
5. Verify the production `/api/health` and sign-in screen, then use an owned
   test workspace for Home, Course library, SAT/Algebra practice, and a saved
   plan. Reopen the plan and checked practice history after a page reload.
   Confirm anonymous/foreign-workspace requests remain rejected and that a
   model example records help before it opens pre-answer.
6. Verify Build only fills the coach draft, mystery stages advance explicitly,
   and reduced-motion/mobile behavior. Check persistence after a deliberate
   deployment restart using a test workspace: checked observations/plans
   survive, while active mixed sessions are expected to end.

No deployment was performed while writing this guide. Changing a DNS mapping,
claiming a new domain, or replacing production data is outside these steps.
