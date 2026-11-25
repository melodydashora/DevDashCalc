# Reedy planning guide

**Reedy guide** (`#/reedy`) brings general course-planning instructions,
new/returning dual-credit steps, deadlines, and source references into the
learning app. It is an independent, dated guidance snapshot, not an official
school service or live enrollment record. Shared guide data contains no
student profiles, family correspondence links, credentials, or private progress.
The existing account boundary still applies to the app route.

The guide's Calculus AB/BC explorer uses the existing curriculum manifest and
course filters. Opening a module explicitly changes the learner's study view;
it does not request a school course or change mastery. Study plans, Canvas and
study sessions remain separate tools with their existing account boundaries.
The guide does not submit applications, change course requests, sign forms,
make payments, or contact the school. Its static source guidance replaces the
interactive coach on this route because those sources are not in the coach's
server-side context.

## Selected coursework handoff

Each existing Canvas class page offers **Use selected work in the Reedy guide**.
Nothing is selected initially. The learner reviews assignment names and dates,
then explicitly downloads a JSON file or opens the selected work in the guide.
The file/message contains only `format`, `version`, the course name, and selected
items with `title`, `due` and a fixed human-readable `source` label. No credentials,
account fields, Canvas IDs, links, grades, submission states, or documents are
included. Unknown dates remain null; date-only instructor evidence stays date-only.
The original snapshot and all school records remain unchanged.

Direct transfer runs only from the two established DevCalc origins. The guide
must respond from the exact opened/opener window and exact guide origin with
a UUIDv4 nonce before any selected work is sent. The reply targets only that
origin, expires after 60 seconds, and is canceled on page exit, new attempts,
selection changes, or view cleanup. The workspace and snapshot must still match.
The guide separately asks the visitor to accept the brief. A blocked popup or
local preview can use the file download instead. This adds no cross-origin API,
credential sharing, persistent export storage, or automatic Canvas transfer.

This source change requires a separate reviewed DevCalc deployment before the
button is available in the live learning workspace.
