import love from 'eslint-config-love'
import jsdoc from 'eslint-plugin-jsdoc'
import vitest from 'eslint-plugin-vitest'

export default [
  // ignores key should be used first and without any other keys in the configuration object
  {
    ignores: ['build', 'docs']
  },
  jsdoc.configs['flat/recommended-typescript-error'],
  love,
  // general
  {
    rules: {
      'import/no-default-export': 'error',
      // don't work without typescript import specifier support
      'import/no-unresolved': 'off',
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/require-hyphen-before-param-description': 'error',
      'jsdoc/require-jsdoc': ['error', { require: { FunctionExpression: true, ArrowFunctionExpression: true } }],
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-returns': 'off',
      'jsdoc/require-throws': 'error',
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }]
    }
  },
  // typescript
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowNullableObject: true }],
      '@typescript-eslint/space-before-function-paren': 'off',
      'n/prefer-node-protocol': 'error'
    }
  },
  // vitest
  {
    files: ['**/*.test.ts'],
    plugins: {
      vitest
    },
    settings: {
      vitest: {
        typecheck: true
      }
    },
    languageOptions: {
      globals: {
        ...vitest.environments.env.globals
      }
    },
    rules: {
      ...vitest.configs.all.rules,
      'vitest/max-nested-describe': ['error', { max: 3 }],
      'vitest/no-hooks': ['error', { allow: ['afterEach'] }],
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }]
    }
  }
]
