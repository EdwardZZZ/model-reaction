import path from 'path';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';

const sharedPlugins = (declarationDir) => [
  resolve({ browser: true, preferBuiltins: false }),
  commonjs({ include: /node_modules/ }),
  typescript({
    tsconfig: './tsconfig.json',
    declarationDir,
    compilerOptions: { module: 'esnext' },
  }),
  replace({
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    preventAssignment: true,
  }),
  require('@rollup/plugin-alias')({
    entries: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
  }),
];

export default [
  // Core entry
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.esm.js', format: 'esm', sourcemap: true },
      { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true },
      {
        file: 'dist/index.js',
        format: 'umd',
        name: 'ModelReaction',
        sourcemap: true,
        plugins: [terser()],
      },
    ],
    plugins: sharedPlugins('dist/types'),
  },
  // React adapter (peer dependency on react)
  {
    input: 'src/react.ts',
    external: ['react'],
    output: [
      { file: 'dist/react.esm.js', format: 'esm', sourcemap: true },
      { file: 'dist/react.cjs.js', format: 'cjs', sourcemap: true },
    ],
    plugins: sharedPlugins('dist/types'),
  },
];
