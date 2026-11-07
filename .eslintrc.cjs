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
    ignorePatterns: ['build/**', 'scripts/**'],
    overrides: [
        {
            files: ['client/artillery/**/*.ts', 'server/games/artillery.ts'],
            rules: {
                'id-denylist': ['error', 'hp', 'dmg', 'pos', 'vel', 'rng', 'dt', 'tmp', 'idx',
                    'ctx', 'cfg', 'i', 'j', 'k', 'n', 'v', 'e'],
                'id-length': ['error', { min: 3, exceptions: ['x', 'y', 'z'] }]
            }
        },
        {
            files: ['client/artillery/js/sim/**/*.ts'],
            rules: {
                'no-restricted-globals': ['error', 'Date', 'performance', 'window', 'document', 'navigator'],
                'no-restricted-properties': ['error', ...[
                    'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'expm1',
                    'log', 'log2', 'log10', 'log1p', 'pow', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh',
                    'asinh', 'acosh', 'atanh'
                ].map(property => ({ object: 'Math', property }))],
                'no-restricted-imports': ['error', { patterns: ['**/render/**', '**/ui/**', '**/audio/**'] }],
                'no-restricted-syntax': ['error',
                    { selector: 'BinaryExpression[operator="**"]', message: 'Use deterministic arithmetic.' },
                    {
                        selector: 'CallExpression[callee.property.name="sort"][arguments.length=0]',
                        message: 'Supply a total-order comparator.'
                    },
                    { selector: 'ForInStatement', message: 'Use insertion-ordered Map or explicit keys.' },
                    {
                        selector: 'CallExpression[callee.object.name="Object"]' +
                            '[callee.property.name=/^(keys|values|entries)$/]',
                        message: 'Use insertion-ordered Map or explicit keys in simulation.'
                    }
                ]
            }
        }
    ],
    rules: {
        '@typescript-eslint/indent': ['error', 4, { SwitchCase: 1 }],
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
        '@typescript-eslint/no-var-requires': 'off',
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
