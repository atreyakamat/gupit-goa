import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      '**/expo-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
    },
  },
  {
    // The app is native only, and must never reach for server-side code or secrets.
    files: ['apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react-dom',
                'react-dom/*',
                'react-native-web',
                'react-native-web/*',
                'next',
                'next/*',
              ],
              message: 'This release is native Android and iOS only. No web code.',
            },
            {
              group: ['@gupit/research-worker', '**/services/research-worker/**'],
              message: 'The research worker is server-side. The app must not import it.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^(?!EXPO_PUBLIC_|NODE_ENV$|EAS_PROJECT_ID$)/]",
          message:
            'Only EXPO_PUBLIC_* values may be read in the app. Server secrets must never be compiled into the bundle.',
        },
      ],
    },
  },
);
