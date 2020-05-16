const eslint = require('eslint');
const eslintPluginReact = require('eslint-plugin-react');
const eslintPluginUnusedImports = require('eslint-plugin-unused-imports');
const eslintPluginImport = require('eslint-plugin-import');
const {parseForESLint} = require('babel-eslint');

const getUndefinedVarsFromCode = code => {
    const linter = new eslint.Linter();	
    linter.defineRule('react/jsx-no-undef', eslintPluginReact.rules['jsx-no-undef']);

	const linterResults = linter.verify(code, {
		parser: parseForESLint,
		parserOptions: {
			ecmaFeatures: {
			  jsx: true,
			},
			ecmaVersion: 2015,
			sourceType: 'module',
		},
		rules: {
            'no-undef': 'error',
            'react/jsx-no-undef': 'error',
		},
    });
	const undefinedVars = linterResults.map(linterResult => extractEntityNameFromLinterResult(linterResult));
	return undefinedVars.filter((undefinedVar, i) => undefinedVars.indexOf(undefinedVar) === i);
};

const getLinterResultsForUnusedImports = code => {
    const linter = new eslint.Linter();	
    linter.defineRule('react/jsx-uses-react', eslintPluginReact.rules['jsx-uses-react']);
    linter.defineRule('react/jsx-uses-vars', eslintPluginReact.rules['jsx-uses-vars']);
    linter.defineRule('unused-imports/no-unused-imports', eslintPluginUnusedImports.rules['no-unused-imports']);

    return linter.verify(code, {
        parser: parseForESLint,
        parserOptions: {
            ecmaFeatures: {
            jsx: true,
            },
            ecmaVersion: 2015,
            sourceType: 'module',
        },
        rules: {
            'react/jsx-uses-react': 1,
            'react/jsx-uses-vars': 1,
            'unused-imports/no-unused-imports': 1,
        },
    });
};

const fixImportsOrder = code => {
    const linter = new eslint.Linter();	
    linter.defineRule('import/order', eslintPluginImport.rules['order']);

    const linterFixReport = linter.verifyAndFix(code, {
        parser: parseForESLint,
        parserOptions: {
            ecmaFeatures: {
            jsx: true,
            },
            ecmaVersion: 2015,
            sourceType: 'module',
        },
        rules: {
            'import/order': 1,
        },
    });
    return linterFixReport.output;
}

const extractEntityNameFromLinterResult = linterResult => {
    const entityNameMatch = linterResult.message.match(/^[^']*'(?<entityName>[^']+)'.*/);
    return entityNameMatch && entityNameMatch.groups.entityName;
}

module.exports = {
	getUndefinedVarsFromCode,
	getLinterResultsForUnusedImports,
    extractEntityNameFromLinterResult,
    fixImportsOrder,
};