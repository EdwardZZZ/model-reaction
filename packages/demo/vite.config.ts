import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const lib = (p: string) => resolve(here, '../model-reaction/src', p);

// Alias the workspace dependency to the library *source* (not built dist), so
// editing the library is reflected instantly in `dev` and the demo build never
// depends on the library being built first. Mirrors the devtools package's
// jest/tsconfig source-mapping (see docs/MONOREPO_MIGRATION.md).
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            'model-reaction/devtools': lib('devtools.ts'),
            'model-reaction/react': lib('react.ts'),
            'model-reaction': lib('index.ts'),
        },
    },
});
