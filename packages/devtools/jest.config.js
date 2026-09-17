/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  rootDir: __dirname,
  testEnvironment: 'jsdom',
  clearMocks: true,
  restoreMocks: true,
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  // Resolve the workspace dependency to the library *source* (not built dist),
  // so the e2e test exercises the real source on both sides and needs no build
  // step. Anchored patterns keep the `/devtools` subpath distinct from the root.
  moduleNameMapper: {
    '^model-reaction/devtools$': '<rootDir>/../model-reaction/src/devtools',
    '^model-reaction$': '<rootDir>/../model-reaction/src/index',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', esModuleInterop: true } }],
  },
};
