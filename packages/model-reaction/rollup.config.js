import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const bundleSizes = new Map();

const sharedPlugins = (emitDeclarations = false) => [
  resolve({ browser: true, preferBuiltins: false }),
  commonjs({ include: /node_modules/ }),
  typescript({
    tsconfig: './tsconfig.build.json',
    compilerOptions: {
      module: 'esnext',
      declaration: emitDeclarations,
      ...(emitDeclarations ? { declarationDir: 'dist/types' } : {}),
    },
  }),
  {
    name: 'bundle-size',
    async writeBundle(output, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const file = output.file ?? join(output.dir ?? '.', chunk.fileName);
        const content = await readFile(file);
        const size = (content.length / 1000).toFixed(2);
        const gzipSize = (gzipSync(content).length / 1000).toFixed(2);
        bundleSizes.set(file, `${file}  ${size} kB │ gzip: ${gzipSize} kB`);
      }
    },
  },
];

export default [
  // Core entry emits declarations once for every source in the build tsconfig.
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
      { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true },
      {
        file: 'dist/index.js',
        format: 'umd',
        name: 'ModelReaction',
        sourcemap: true,
        plugins: [terser()],
      },
    ],
    plugins: sharedPlugins(true),
  },
  // Optional rule builders and error formatting; no core runtime dependency.
  {
    input: 'src/validation/index.ts',
    output: [
      { file: 'dist/validation.mjs', format: 'esm', sourcemap: true },
      { file: 'dist/validation.cjs.js', format: 'cjs', sourcemap: true },
      {
        file: 'dist/validation.js',
        format: 'umd',
        name: 'ModelReactionValidation',
        sourcemap: true,
        plugins: [terser()],
      },
    ],
    plugins: sharedPlugins(),
  },
  // React adapter (peer dependency on react)
  {
    input: 'src/react/index.ts',
    external: ['react'],
    output: [
      { file: 'dist/react.mjs', format: 'esm', sourcemap: true },
      { file: 'dist/react.cjs.js', format: 'cjs', sourcemap: true },
    ],
    plugins: sharedPlugins(),
  },
  // DevTools-enabled entry (opt-in via `model-reaction/devtools`).
  {
    input: 'src/devtools.ts',
    output: [
      { file: 'dist/devtools.mjs', format: 'esm', sourcemap: true },
      { file: 'dist/devtools.cjs.js', format: 'cjs', sourcemap: true },
    ],
    plugins: [
      ...sharedPlugins(),
      {
        name: 'bundle-size-report',
        closeBundle() {
          console.log('\nBundle sizes:');
          for (const file of [...bundleSizes.keys()].sort()) {
            if (file !== 'dist/index.js') console.log(bundleSizes.get(file));
          }
          const coreSize = bundleSizes.get('dist/index.js');
          if (coreSize) console.log(`Core UMD (minified): ${coreSize}`);
          bundleSizes.clear();
        },
      },
    ],
  },
];
