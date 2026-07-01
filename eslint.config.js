import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '*.config.js',
      '*.config.ts'
    ]
  },
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-undef': 'off'
    }
  },
  {
    files: ['packages/virage-dashboard/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-undef': 'off'
    }
  },
  {
    // Infrastructure files that implement the output system or terminal control.
    // These legitimately call console.log / process.stdout directly.
    files: [
      'packages/virage-cli/src/output.ts',
      'packages/virage-cli/src/progress/progress-bar.ts',
      'packages/virage-cli/src/spinner.ts',
    ],
    rules: { 'no-console': 'off' }
  }
);
