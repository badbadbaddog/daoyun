# DaoYun Engineering Rules

## Product

- DaoYun is a new self-hosted community product.
- Do not add migration or compatibility code for legacy forum products.
- The public web is responsive; desktop and mobile share domain behavior.

## Frontend Stack

- React 19, TypeScript, Vite, Vitest, Testing Library.
- Use named exports for components and domain data.
- Keep server-shaped data separate from presentation components.
- Use semantic CSS tokens from `src/styles.css`; do not hard-code theme colors in components.
- Use Lucide icons for interface controls.

## Commands

- Install: `pnpm install`
- Develop: `pnpm dev`
- Test: `pnpm test`
- Type check: `pnpm typecheck`
- Build: `pnpm build`

## UI Boundaries

- Follow the compact, content-first community style defined by the DaoYun design tokens.
- Use cards only for individual panels and repeated content items.
- Keep card radius at 8px or below.
- Every icon-only button needs an accessible label and tooltip.
- Support 320px, 768px, 1024px, and 1440px widths.
- Do not copy Rhex source code, branding, or product text.

## Quality

- Add a failing behavior test before implementing new behavior.
- Run tests, type checking, and production build before committing.
- Do not commit generated build output or secrets.
