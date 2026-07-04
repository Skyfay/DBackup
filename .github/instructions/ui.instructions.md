---
applyTo: "src/components/**/*.tsx, src/app/**/*.tsx"
---

# UI & Frontend Guidelines

<rules>
  <tech_stack>
    - **Framework**: Next.js 16 App Router. Default to Server Components; use `use client` only when interactivity is required.
    - **Styling**: Tailwind CSS (mobile-first).
    - **Component Lib**: Shadcn UI. Reuse primitives from `src/components/ui/` whenever possible.
    - **Forms**: `react-hook-form` + `zod`. Reference: [`src/components/adapter-manager.tsx`](src/components/adapter-manager.tsx).
  </tech_stack>

  <styling>
    - Avoid inline styles (`style={{...}}`). Use Tailwind utility classes. Exception: dynamically computed values (chart colors, progress percentages) may need `style` - keep these isolated to the specific element, never as a substitute for static styling.
    - **Tailwind Best Practices**: Prefer standard utility classes (e.g., `h-px`, `w-4`) over arbitrary values (e.g., `h-[1px]`, `w-[1rem]`) whenever possible.
    - **Feedback**: Use `toast` (Sonner) for success/error notifications. Never use `alert()`.
  </styling>

  <formatting>
    - **Dates**:
      - ❌ Forbidden: `.toLocaleDateString()`, `.toLocaleTimeString()`, `.toLocaleString()` on a `Date`, or any direct locale formatting - not just the `Date` variant. All three sneak in easily in chart tooltips, table cells, and preview components.
      - ✅ Use the `useDateFormatter` hook from `src/hooks/use-date-formatter.ts` instead.
      - This ensures user timezone and format preferences are respected.
      - Numbers (not dates) may use `.toLocaleString()` for thousands separators if there is genuinely no timezone/format concern - but check `formatBytes`/`formatDuration` in `src/lib/utils.ts` first, they likely already cover the case.
  </formatting>

  <logging>
    - **Never** use raw `console.log`/`console.error`/`console.warn`, including inside `.catch()` handlers. Import `logger` from `@/lib/logging/logger` instead - it has no Node-only dependencies, so it is safe in both Server and Client Components, and gives structured, level-filtered output.
    - Never log full context/session/auth objects, even via `logger` - log specific fields (`{ userId }`, not the whole user/session object) to avoid leaking sensitive data into the browser console.
    - User-facing errors still go through `toast`, not just the logger - the logger is for diagnostics, the toast is for the user.
  </logging>

  <architecture>
    - **Separation**: Decouple data fetching (Server Actions) from presentation.
    - **Props**: Validate all props with strict TypeScript Interfaces.
    - **Server Components by default**: `page.tsx` should rarely need `"use client"` itself. Fetch data in the (Server Component) page, then pass it as props to a child Client Component that owns the interactive parts (forms, client-side sort/filter, real-time widgets). Before adding `"use client"` to a page, check whether only a sub-tree actually needs it.
  </architecture>
</rules>
