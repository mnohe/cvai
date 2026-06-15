# UC-CV-004: Export CV as PDF

| | |
|---|---|
| **Actor** | User |
| **Preconditions** | Signed in; CV has at least one section populated |
| **Milestone** | M1 |
| **Credit cost** | None |
| **LLM** | No |

## Flow

1. User clicks **Export PDF** on the `/cv` page.
2. SPA calls `window.print()`.
3. The browser opens the system print dialog.
4. A dedicated print stylesheet (`cv-print.css`) applies:
   - Hides all application chrome (sidebar, top nav, buttons, editor controls).
   - Renders CV content only in a single-column A4 layout.
   - Uses Inter from Google Fonts (already cached by the browser from the app session).
   - `@page { size: A4 portrait; margin: 15mm 20mm; }`
5. User selects "Save as PDF" in the print dialog.

No backend call. No credit. No Cloud Storage involved.

## Notes

The Export PDF button itself is hidden in print (`@media print { display: none }`).
The print layout component (`<CVPrintLayout>`) is screen-hidden and print-visible —
`@media screen { display: none }`.

## Postconditions

- A PDF file is saved locally to the user's device.
- No state changes in Firestore.

## E2E scenarios

| Scenario | File | Describe block |
|---|---|---|
| Export PDF button triggers window.print() | `e2e/cv.spec.ts` | `UC-CV-004 print triggered` |
| Print layout contains CV content and no chrome elements | `e2e/cv.spec.ts` | `UC-CV-004 print layout correct` |
