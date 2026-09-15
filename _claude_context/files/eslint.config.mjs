import js from '@eslint/js'
import ts from 'typescript-eslint'
export default ts.config(
  { ignores: ['node_modules/**', 'out/**', 'release/**', '.qa/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
        document: 'readonly',
        getComputedStyle: 'readonly'
      }
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error' }
  }
)
