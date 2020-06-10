const eslint = require('eslint');
const eslintPluginReact = require('eslint-plugin-react');
const eslintPluginUnusedImports = require('eslint-plugin-unused-imports');
const eslintPluginImport = require('eslint-plugin-import');
const babelCore = require('@babel/core');
const babelPresetReact = require('@babel/preset-react');
const babelPluginProposalOptionalChaining = require('@babel/plugin-proposal-optional-chaining');
const {parseForESLint} = require('babel-eslint');
const {compact} = require('lodash');

const linterConfig = {
    parser: parseForESLint,
    parserOptions: {
        ecmaFeatures: {jsx: true},
        ecmaVersion: 2017,
        sourceType: 'module',
    },
};

const transformCode = async code => {
    const babelFileResult = await babelCore.transformAsync(code, {
        presets: [babelPresetReact],
        plugins: [[babelPluginProposalOptionalChaining, {loose: true}]],
    });
    return babelFileResult.code;
};

const getUndefinedVarsFromCode = async code => {
    const transformedCode = await transformCode(code);
    const linter = new eslint.Linter();	
    linter.defineRule('react/jsx-no-undef', eslintPluginReact.rules['jsx-no-undef']);
    
    const linterResults = linter.verify(transformedCode, {
        ...linterConfig,
        rules: {
            'no-undef': 'error',
            'react/jsx-no-undef': 'error',
        },
    });
    const undefinedVars = compact(linterResults.map(linterResult => extractEntityNameFromLinterResult(linterResult)));
    return undefinedVars.filter((undefinedVar, i) => undefinedVars.indexOf(undefinedVar) === i);
};

const getLinterResultsForUnusedImports = async code => {
    const transformedCode = await transformCode(code);
    const linter = new eslint.Linter();	
    linter.defineRule('react/jsx-uses-react', eslintPluginReact.rules['jsx-uses-react']);
    linter.defineRule('react/jsx-uses-vars', eslintPluginReact.rules['jsx-uses-vars']);
    linter.defineRule('unused-imports/no-unused-imports', eslintPluginUnusedImports.rules['no-unused-imports']);

    return linter.verify(transformedCode, {
        ...linterConfig,
        rules: {
            'react/jsx-uses-react': 1,
            'react/jsx-uses-vars': 1,
            'unused-imports/no-unused-imports': 1,
        },
    });
};

const getUnusedImportEntitiesFromCode = async code => {
    const linterResultsForUnusedImports = await getLinterResultsForUnusedImports(code);
    return compact(linterResultsForUnusedImports.map(linterResult => extractEntityNameFromLinterResult(linterResult)));
};

const fixImportsOrder = code => {
    const linter = new eslint.Linter();	
    linter.defineRule('import/order', eslintPluginImport.rules['order']);

    const linterFixReport = linter.verifyAndFix(code, {
        ...linterConfig,
        rules: {
            'import/order': 1,
        },
    });
    return linterFixReport.output;
};

const extractEntityNameFromLinterResult = linterResult => {
    const entityNameMatch = linterResult.message.match(/^[^']*'(?<entityName>[^']+)'.*/);
    return entityNameMatch && entityNameMatch.groups.entityName;
};

module.exports = {
    getUndefinedVarsFromCode,
    getUnusedImportEntitiesFromCode,
    getLinterResultsForUnusedImports,
    extractEntityNameFromLinterResult,
    fixImportsOrder,
};