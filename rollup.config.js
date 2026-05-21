import path from 'path';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.ts',
  output: [
    // ESM模块
    {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true
    },
    // CommonJS模块
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true
    },
    // UMD模块
    {
      file: 'dist/index.js',
      format: 'umd',
      name: 'ModelReaction', // 全局变量名称
      sourcemap: true,
      plugins: [terser()]
    }
  ],
  plugins: [
    resolve({
     // 确保所有依赖都被正确解析
     browser: true,
     preferBuiltins: false
    }),
    commonjs({
     // 强制将所有CommonJS模块转换为ES模块
     include: /node_modules/
    }),
    typescript({
      tsconfig: './tsconfig.json',
      declarationDir: 'dist/types',
      compilerOptions: {
        module: 'esnext',
      }
    }),
    replace({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      preventAssignment: true
    }),
   // 添加模块合并插件
   require('@rollup/plugin-alias')({
     entries: [
       { find: '@', replacement: path.resolve(__dirname, 'src') }
     ]
   })
  ]
};