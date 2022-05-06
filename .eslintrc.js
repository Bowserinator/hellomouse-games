module.exports = {
    env: {
        es6: true,
        node: true,
        browser: true
    },
    parserOptions: {
        ecmaVersion: 8,
        sourceType: 'module',
        ecmaFeatures: {
            experimentalObjectRestSpread: true
        }
    },
    parser: 'babel-eslint',
    extends: ['eslint:recommended', '@hellomouse'],
    rules: {
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
        'padding-line-between-statements': [
            'error',
            { blankLine: 'always', prev: '*', next: 'return' },
            { blankLine: 'always', prev: ['const', 'let'], next: '*' },
            { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] }
        ],
        'no-shadow': 'error',
        'no-useless-return': 'error',
        'block-scoped-var': 'error',
        'no-else-return': 'error',
        'no-undef-init': 'error'
    }
};
