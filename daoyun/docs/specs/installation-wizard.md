# Spec: Installation Wizard And Application Gate

## Objective

Provide the first usable screen for a fresh DaoYun instance. The web application reads the installation status before mounting community features, guides the operator through creation of the first administrator, recovers from API failures, and enters the existing community home only after the server confirms initialization.

## Tech Stack

- React 19, TypeScript 5.7, Vite 5, Vitest 2, and Testing Library.
- The existing hand-written `fetch` client pattern with runtime response validation.
- Lucide React icons and the semantic CSS variables in `src/styles.css`.

## Contract And Behavior

- `GET /api/v1/installation` returns a validated `data.is_initialized` boolean and UUID `meta.request_id`.
- `POST /api/v1/installation` sends `username`, `email`, `display_name`, and `password` as JSON.
- The client validates the complete success and error envelopes before exposing their values to components.
- Application startup has four exclusive states: loading, retryable status failure, installation wizard, and initialized community home.
- A successful `201` response does not directly trust local state. The application refreshes `GET /api/v1/installation` and enters the community home only when it returns `true`.
- `422 request.validation_failed` maps known `fields` entries to their inputs and exposes body-level errors as a form alert.
- `409 installation.already_initialized` triggers a status refresh so a concurrent installer can move this client to the community home.
- `503 system.database_unavailable`, malformed responses, and network failures keep the form data and show a retryable form-level failure.
- This slice does not create login sessions, expose administrator controls, or change the community home data sources.

## Validation

- Username: `^[a-z][a-z0-9_]{2,31}$`.
- Email: trimmed, syntactically valid, and at most 254 characters.
- Display name: trimmed, 1-80 Unicode characters, and no control characters.
- Password: 6-128 Unicode characters; never trimmed or echoed in error messages.
- Browser validation gives immediate field feedback and the server remains authoritative.

## Commands

- Install: `pnpm install`
- Develop: `pnpm dev`
- Test: `pnpm test`
- Type check: `pnpm typecheck`
- Build: `pnpm build`

## Project Structure

- `src/api/installation.ts`: request types, response/error validation, and GET/POST clients.
- `src/api/installation.test.ts`: client contract and malformed-response tests.
- `src/components/InstallationWizard.tsx`: accessible installation form and presentation states.
- `src/App.tsx`: installation gate and the existing initialized community application.
- `src/App.test.tsx`: startup, retry, validation, conflict, and success-transition behavior.
- `src/styles.css`: responsive installer styles using existing semantic tokens.

## Code Style

```tsx
const status = await getInstallationStatus(controller.signal)

if (!controller.signal.aborted) {
  setInstallationState(status.isInitialized ? "initialized" : "required")
}
```

- Use named exports and explicit domain types.
- Keep server-shaped DTO validation inside the API module.
- Use semantic HTML labels, alerts, status regions, and native form controls.
- Keep the installer compact, content-first, responsive, and at or below the existing 8px radius.

## Testing Strategy

- API client tests cover valid GET/POST envelopes, request serialization, structured `422` errors, status-specific failures, and malformed JSON shapes.
- Component tests cover all startup states, local validation, server field mapping, retry behavior, concurrent `409`, submit locking, and the verified transition to the community home.
- Browser verification covers 320px, 768px, 1024px, and 1440px viewports, keyboard-only completion, console output, and installation network requests.
- The complete frontend suite, type check, and production build must pass.

## Boundaries

- Always: validate external JSON at runtime, preserve typed field errors, disable duplicate submits, retain entered values after retryable failures, and refetch status after `201` or `409`.
- Ask first: changing the backend contract, adding a dependency, or expanding setup into branding/default-board configuration.
- Never: assume initialization from local storage, persist the password, expose a password in logs or errors, enter the community home before a confirmed `true` status, or add authentication behavior in this slice.

## Implementation Tasks

- [x] Task 1: Installation API client
  - Acceptance: GET and POST validate successful envelopes; structured API failures retain status, code, message, and field errors.
  - Verify: `pnpm test -- src/api/installation.test.ts`.
  - Files: `src/api/installation.ts`, `src/api/installation.test.ts`.
- [x] Task 2: Application installation gate
  - Acceptance: loading, retry, required, and initialized states are exclusive; board requests begin only in the initialized state.
  - Verify: focused `src/App.test.tsx` state tests.
  - Files: `src/App.tsx`, `src/App.test.tsx`.
- [x] Task 3: Administrator installation form
  - Acceptance: fields and limits match the server; `422`, `409`, `503`, duplicate submission, and successful status refresh behave as specified.
  - Verify: focused component tests and `pnpm typecheck`.
  - Files: `src/components/InstallationWizard.tsx`, `src/App.tsx`, `src/App.test.tsx`.
- [x] Task 4: Responsive presentation and runtime verification
  - Acceptance: installer is usable at all required widths and by keyboard; no console errors or unexpected requests occur.
  - Verify: screenshots, DOM/accessibility inspection, network inspection, `pnpm test`, `pnpm typecheck`, and `pnpm build`.
  - Files: `src/styles.css`, `docs/project-status.md`.

## Success Criteria

- A fresh instance opens directly to a usable Chinese installation form without flashing the community home.
- Invalid input is associated with the correct field and no invalid request is submitted.
- Network/database failure is recoverable without clearing the form.
- Concurrent completion elsewhere refreshes status and safely enters the community home.
- A successful installation performs a confirming status read and then renders the existing community home.
- All automated and required browser checks pass.

## Open Questions

None. The backend contract and the slice boundary are already fixed by `docs/project-status.md` and `docs/specs/installation-initialization.md`.
