/**
 * BEST_PRACTICES §7.10.5 — Code-style cheat sheet
 *
 * The same `name: required` requirement, three styles. Only the
 * `model-reaction` variant is fully self-contained — the other two
 * stubs intentionally elide the boilerplate they would normally
 * require.
 *
 * NOTE: this demo imports `@reduxjs/toolkit` and `zustand` purely to
 * mirror the documentation. Install them before using if you want to
 * actually run this snippet:
 *   npm install @reduxjs/toolkit zustand
 */

// eslint-disable-next-line import/no-unresolved
import { createSlice } from '@reduxjs/toolkit';
// eslint-disable-next-line import/no-unresolved
import { create } from 'zustand';

import { createModel, ValidationRules } from '../../src/index';

// Redux Toolkit
export const userSlice = createSlice({
    name: 'user',
    initialState: { name: '', errors: {} as Record<string, string> },
    reducers: {
        setName(state, action: { payload: string }) {
            state.name = action.payload;
            state.errors.name = action.payload ? '' : 'Name is required';
        },
    },
});

// zustand
export const useUserStore = create<{
    name: string;
    errors: Record<string, string>;
    setName: (v: string) => void;
}>((set) => ({
    name: '',
    errors: {},
    setName: (v) =>
        set(() => ({
            name: v,
            errors: { name: v ? '' : 'Name is required' },
        })),
}));

// model-reaction
export const userModel = createModel<{ name: string }>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
});
