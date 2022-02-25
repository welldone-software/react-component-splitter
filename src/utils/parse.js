const _ = require('lodash');
const { transformSync } = require('@babel/core');
const babelPluginProposalObjectRestSpread = require('@babel/plugin-proposal-object-rest-spread');
const babelPluginProposalOptionalChaining = require('@babel/plugin-proposal-optional-chaining');
const babelPresetReact = require('@babel/preset-react');
const { parseForESLint } = require('@babel/eslint-parser');
const findBabelConfig = require('find-babel-config');
const { ESLint, Linter } = require('eslint');

const eslintPlugins = {
    'react': require('eslint-plugin-react'),
    'react-hooks': require('eslint-plugin-react-hooks'),
    'unused-imports': require('eslint-plugin-unused-imports'),
    'prettier': require('eslint-plugin-prettier'),
};

const linterConfig = {
    parser: parseForESLint,
    parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2017,
        sourceType: 'module',
    },
};

const linter = new (
    class CustomLinter extends Linter {

        constructor(...args) {

            super(...args);

            _.chain(eslintPlugins)
                .keys()
                .forEach(pluginName => {
                    this.defineRules(_.chain(eslintPlugins[pluginName].rules).keys().reduce((res, ruleId) => {
                        return { ...res, [`${pluginName}/${ruleId}`]: eslintPlugins[pluginName].rules[ruleId] };
                    }, {}).value());
                })
                .value();

        }

        extractEntityNames(textOrSourceCode, config) {

            const lintMessages = super.verify(textOrSourceCode, {
                ...linterConfig,
                ...config,
            });

            return _.chain(lintMessages)
                .map(({ message }) => _.get(message.match(/^[^']*'(?<entityName>[^']+)'.*/), 'groups.entityName'))
                .compact()
                .uniq()
                .value();

        }

        verifyAndFix(textOrSourceCode, config) {

            return super.verifyAndFix(textOrSourceCode, {
                ...linterConfig,
                ...config,
            });

        }
    }
)();

const transformCode = code => transformSync(code, {
    presets: [babelPresetReact],
    plugins: [
        [babelPluginProposalOptionalChaining, { loose: true }],
        [babelPluginProposalObjectRestSpread, { loose: true }],
    ],
}).code;

const getUnusedVars = code => {

    const transformedCode = transformCode(code);

    return linter.extractEntityNames(
        transformedCode, {
            rules: {
                'no-unused-vars': 'error',
            },
        });

};

const getUndefinedVars = code => {

    const transformedCode = transformCode(code);

    return linter.extractEntityNames(
        transformedCode, {
            rules: {
                'react/jsx-no-undef': 'error',
                'no-undef': 'error',
            },
        });

};

const getImports = (code, options = { transform: true }) => {

    const finalCode = (_.get(options, 'transform') ? transformCode(code) : code);

    return _.chain(finalCode)
        .split('\n')
        .filter(codeLine => /^\s*import.*from.*/.test(codeLine))
        .value();

};

const getUsedImports = (code, options = { transform: true }) => {

    const finalCode = (_.get(options, 'transform') ? transformCode(code) : code);

    const { output } = linter.verifyAndFix(finalCode, {
        rules: {
            'react/jsx-uses-react': 1,
            'react/jsx-uses-vars': 1,
            'unused-imports/no-unused-imports': 1,
        },
    });

    return getImports(output, { transform: false });

};

const pretify = code => {

    return linter.verifyAndFix(
        code, {
            rules: eslintPlugins.prettier.configs.recommended.rules,
        }).output;

};

const getNumberOfLeadingSpaces = (code, options = { endToStart: false }) => {

    const codeLines = _.split(code, '\n');

    if (_.get(options, 'endToStart')) {
        _.reverse(codeLines);
    }

    const firstCodeLineIndex = _.findIndex(codeLines, line =>
        (_.get(options, 'endToStart') ? /^\s*[<|\\/>].*$/.test(line) : /^\s*<.*$/.test(line)));
    const firstSpaceIndex = codeLines[firstCodeLineIndex].search(/\S/);

    return Math.max(0, firstSpaceIndex);

};

const eslintAutofix = async (code, { filePath }) => {

    const { file: babelConfigFilePath } = findBabelConfig.sync(filePath);

    const eslint = new ESLint({
        baseConfig: {
            parserOptions: {
                babelOptions: {
                    configFile: babelConfigFilePath,
                },
            },
        },
        fix: true,
    });

    return new Promise(resolve => {
        eslint.lintText(code, { filePath })
            .then(results => resolve(results[0].output));
    });

};

module.exports = {
    eslintAutofix,
    getImports,
    getNumberOfLeadingSpaces,
    getUndefinedVars,
    getUnusedVars,
    getUsedImports,
    pretify,
    transformCode,
};
