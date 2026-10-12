import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

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
  // React adapter (peer dependency on react)
  {
    input: 'src/react.ts',
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
    plugins: sharedPlugins(),
  },
];
