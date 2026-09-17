/**
 * Build the DevTools extension with esbuild.
 *
 * Four independent bundles, one per extension execution context:
 *   - page-agent  : injected into the page MAIN world (installs the hook)
 *   - content     : ISOLATED-world relay between page and background
 *   - background  : MV3 service worker, routes messages per tab
 *   - panel       : the React DevTools panel UI
 *
 * Static assets (manifest, panel HTML, devtools loader) are copied to dist/.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'dist');

const entries = {
    'page-agent': 'src/page-agent.entry.ts',
    content: 'src/content.ts',
    background: 'src/background.ts',
    panel: 'src/panel/index.tsx',
    devtools: 'src/devtools.ts',
};

const isWatch = process.argv.includes('--watch');

async function run() {
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });

    await build({
        entryPoints: Object.fromEntries(
            Object.entries(entries).map(([name, file]) => [name, resolve(root, file)])
        ),
        outdir,
        bundle: true,
        format: 'iife',
        target: ['chrome110'],
        jsx: 'automatic',
        sourcemap: true,
        logLevel: 'info',
        define: { 'process.env.NODE_ENV': '"production"' },
    });

    // Copy static assets that ship as-is.
    await cp(resolve(root, 'public'), outdir, { recursive: true });

    console.log(`\nExtension built to ${outdir}`);
    if (isWatch) console.log('(watch mode not implemented; re-run to rebuild)');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
