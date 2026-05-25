/**
 * Index for the React best-practices demos.
 *
 * Each module corresponds to a sub-section of `BEST_PRACTICES.md` §7.
 * They are standalone .tsx / .ts snippets — copy-paste-ready into any
 * React 18+ project. They are NOT runnable from the CLI.
 *
 * | Section | File |
 * | ------- | ---- |
 * | 7.1 — Pick the right hook                   | see `examples/react-bindings.tsx` (covers `useModelField`, `useModelFields`, `useModelSelector`, `useModelFieldState`) |
 * | 7.2 — Stable selector references            | `7-2-stable-selector.tsx`     |
 * | 7.3 — Avoid prop drilling with `<ModelProvider>` | `7-3-model-provider.tsx`  |
 * | 7.4 — `<Field>` for declarative inputs      | `7-4-field-render-prop.tsx`   |
 * | 7.5 — Touched semantics                     | `7-5-touched.tsx`             |
 * | 7.6 — Submission flow                       | `7-6-submission-flow.tsx`     |
 * | 7.8 — Lifecycle and cleanup                 | `7-8-lifecycle.tsx`           |
 * | 7.10.2 — Combine with zustand               | `7-10-2-with-zustand.tsx`     |
 * | 7.10.3 — Combine with Redux Toolkit         | `7-10-3-with-redux.tsx`       |
 * | 7.10.5 — Code-style cheat sheet             | `7-10-5-cheat-sheet.ts`       |
 */
export * from './7-2-stable-selector';
export * from './7-3-model-provider';
export * from './7-4-field-render-prop';
export * from './7-5-touched';
export {
    SubmitButton as SubmitFlowButton,
    userModel as submitFlowUserModel,
} from './7-6-submission-flow';
export * from './7-8-lifecycle';
export * from './7-10-2-with-zustand';
export * from './7-10-3-with-redux';
export {
    userSlice,
    useUserStore,
    userModel as cheatSheetUserModel,
} from './7-10-5-cheat-sheet';
