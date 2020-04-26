
// @ts-nocheck
const vscode = require('vscode');
const eslint = require('eslint');
const babel = require("@babel/core");
const babelPresetReact = require('@babel/preset-react');
const {parseForESLint} = require('babel-eslint');
const eslintPluginReact = require('eslint-plugin-react');
const eslintPluginUnusedImports = require('eslint-plugin-unused-imports');

/* Gets the selected code as text */
const getSelectedCode = editor => {
	const selectedCode = editor.document.getText(editor.selection);
	if (selectedCode === '') {
		return null;
	}
	return selectedCode;
};

/* Validates the selected code to be a valid React component */
const validateSelectedCode = async selectedCode => {
	try {
		await babel.transformAsync(selectedCode, {
			presets: [babelPresetReact]
		});
		if (!selectedCode.match(/^\s*<[^>]*>/)) {
			throw new Error();
		}
	} catch ({message: errorMessage}) {
		return `Invalid code... ${errorMessage}`;
	}
};

/* Replaces selected code with subcomponent tag */
const replaceSelectedCodeWithSubComponentTag = async ({editor, subComponentName, subComponentProps}) => {
    await editor.edit(async edit => {
        const formattedProps = subComponentProps.map(prop => `${prop}={${prop}}`);
        const leadingSpaces = ' '.repeat(editor.selection.start.character);
        let propsAndClosing = '/';
        if (formattedProps.length > 3) {
            propsAndClosing = `\n${leadingSpaces}\t${formattedProps.join(`\n${leadingSpaces}\t`)}\n${leadingSpaces}/`;
        } else if (formattedProps.length > 0) {
            propsAndClosing = ` ${formattedProps.join(' ')}/`;
        }
        edit.replace(editor.selection, `<${subComponentName}${propsAndClosing}>`);
    });
};

/* Adds an import of the sub-component to the original component */
const addSubComponentImportToOriginalComponent = async ({editor, subComponentName}) => {
    await editor.edit(async edit => {
        const originalCodeLines = editor.document.getText().split('\n');
        const firstImportLineIndex = originalCodeLines.findIndex(codeLine => codeLine.match(/^\s*import /));
        const originalCodeLinesFromFirstImport = firstImportLineIndex > -1 ? [...originalCodeLines].splice(firstImportLineIndex) : originalCodeLines;
        const newImportLineIndex = originalCodeLinesFromFirstImport.findIndex(codeLine => codeLine.match(/^\s*[^i]/)) - 1;
        edit.insert(new vscode.Position(Math.max(newImportLineIndex, 0), 0), `import ${subComponentName} from './${subComponentName}';\n`);
    });
};

/* Verifies replaced code and extracts redundant imports */
const getLinterResultsForRedundantImports = editor => {
    const linter = new eslint.Linter();	
    linter.defineRule('react/jsx-uses-react', eslintPluginReact.rules['jsx-uses-react']);
    linter.defineRule('react/jsx-uses-vars', eslintPluginReact.rules['jsx-uses-vars']);
    linter.defineRule('unused-imports/no-unused-imports', eslintPluginUnusedImports.rules['no-unused-imports']);

    return linter.verify(editor.document.getText(), {
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

/* Removes redundant imports and collects missing imports of subcomponent */
const removeRedundantImports = async ({editor, subComponentImports}) => {
    const missingSubComponentImports = [];

    await editor.edit(async edit => {
        const linterResults = getLinterResultsForRedundantImports(editor);
        linterResults.forEach(linterResult => {
            const unusedImport = linterResult.message.replace(/^[^']*'([^']+)'.*/, '$1');
            const codeStartingAtImport = editor.document.getText().split('\n').slice(linterResult.line - 1).join('\n');
            let importLocation = codeStartingAtImport.substring(codeStartingAtImport.indexOf('from'));
            importLocation = importLocation.substring(
                0, Math.min(importLocation.indexOf('\n'), importLocation.indexOf(';'))
            );
            const codeLine = editor.document.lineAt(linterResult.line - 1);
            const codeLineText = codeLine.text;
            const regexForDefaultTypeImport = new RegExp(`^import\\s+${unusedImport}\\s+from\\s+.*$`, 'g');
            const regexForNonDefaultTypeImport = new RegExp(`(^import\\s+{(\\s*\\w+\\s*,)*\\s*)${unusedImport}\\s*,?\\s*((\\w+\\s*,?)*\\s*}\\s+from\\s+.*$)`, 'g');
            const isDefaultTypeImport = codeLineText.match(regexForDefaultTypeImport);
            const isNonDefaultTypeImport = codeLineText.match(regexForNonDefaultTypeImport);
            
            if (isDefaultTypeImport || (isNonDefaultTypeImport && isNonDefaultTypeImport.length === 1)) {
                edit.delete(codeLine.rangeIncludingLineBreak);
            } else if (isNonDefaultTypeImport && isNonDefaultTypeImport.length > 1) {
                edit.replace(codeLine.range, codeLineText.replace(regexForNonDefaultTypeImport, '$1$3'));
            }

            const importString = `import ${isDefaultTypeImport ? unusedImport : `{${unusedImport}}`} ${importLocation};`;
            const importAlreadyExists = subComponentImports.includes(importString);
            
            if (!importAlreadyExists) {
                missingSubComponentImports.push(importString)
            }
        });
    });

    return missingSubComponentImports;
};

/* Replaces original selected code */
const replaceOriginalCode = async ({editor, subComponentName, subComponentImports, subComponentProps}) => {
	try {
		await replaceSelectedCodeWithSubComponentTag({editor, subComponentName, subComponentProps});
        await addSubComponentImportToOriginalComponent({editor, subComponentName});
        const missingSubComponentImports = await removeRedundantImports({editor, subComponentImports});
        return {missingSubComponentImports};
		
	} catch ({message: errorMessage}) {
		return {replaceOriginalCodeError: errorMessage};
	}
};

module.exports = {
    getSelectedCode,
    validateSelectedCode,
    replaceOriginalCode,
};
