/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
};