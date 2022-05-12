/* eslint-disable @typescript-eslint/naming-convention */
/** @type {import("eslint").Linter.Config} */
module.exports = {
    env: {
        es6: true,
        node: true,
        browser: true
    },
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
            experimentalObjectRestSpread: true
        },
        project: './tsconfig.json'
    },
    extends: ['@hellomouse/typescript'],
    ignorePatterns: ['build/**'],
    rules: {
        '@typescript-eslint/indent': ['error', 4, { SwitchCase: 2 }],
        'curly': ['error', 'multi'],
        'padded-blocks': [
            'error',
            {
                blocks: 'never'
            }
        ],
        'one-var': 'off',
        'space-unary-ops': [
            'error',
            {
                words: true,
                nonwords: false
            }
        ],
        'padding-line-between-statements': 'off',
        '@typescript-eslint/padding-line-between-statements': [
            'error',
            { blankLine: 'any', prev: '*', next: 'return' },
            { blankLine: 'any', prev: ['const', 'let'], next: '*' },
            { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
            { blankLine: 'any', prev: '*', next: ['interface', 'type'] }
        ],
        'no-shadow': 'off',
        '@typescript-eslint/no-shadow': 'error',
        'no-useless-return': 'error',
        'block-scoped-var': 'error',
        'no-else-return': 'error',
        'no-undef-init': 'error',
        'no-multi-spaces': ['error', { ignoreEOLComments: true }],
        "@typescript-eslint/no-var-requires": "off",
        '@typescript-eslint/naming-convention': [
            'error',
            { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
            { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
            { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
            { selector: 'memberLike', format: ['camelCase'], leadingUnderscore: 'allow' },
            { selector: 'typeLike', format: ['PascalCase'] },
            { selector: 'enum', format: ['PascalCase', 'UPPER_CASE'] },
            { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
            { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE'] },
            { selector: 'typeProperty', format: ['PascalCase', 'camelCase'], leadingUnderscore: 'allow' },
            { selector: 'typeAlias', format: ['PascalCase', 'UPPER_CASE'] },
            { selector: 'objectLiteralProperty', format: ['camelCase', 'UPPER_CASE'] }
        ],
        '@typescript-eslint/array-type': ['error', { default: 'generic' }]
    }
};
