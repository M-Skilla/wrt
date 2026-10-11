/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  collectCoverageFrom: ['src/**/*.ts', '!src/shared/**', '!src/index.ts'],
  coverageThreshold: {
    // Spec §13 milestone 3: ≥ 85% line coverage on the contracts.
    './src/contracts/': { lines: 85 },
  },
};
