import type { Config } from 'jest';

const config: Config = {
  preset:          'ts-jest',
  testEnvironment: 'node',
  roots:           ['<rootDir>/tests'],
  testMatch:       ['**/*.test.ts'],
  // Run setup before every test file
  setupFiles:      ['<rootDir>/tests/setup.ts'],
  // ts-jest must use the root tsconfig (which includes both src and tests)
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.json',
    },
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/docs/**',
    '!src/server.ts',   // entry points are not unit-tested directly
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};

export default config;
