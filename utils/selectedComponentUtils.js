
const vscode = require('vscode');
const eslint = require('eslint');
const babel = require("@babel/core");
const babelPresetReact = require('@babel/preset-react');
const {parseForESLint} = require('babel-eslint');
const eslintPluginReact = require('eslint-plugin-react');
const eslintPluginUnusedImports = require('eslint-plugin-unused-imports');

const getSelectedCode = editor => {
	const selectedCode = editor.document.getText(editor.selection);
	if (!selectedCode || selectedCode === '') {
		throw new Error('No code selected')
	}
	return selectedCode;
};

const validateSelectedCode = async selectedCode => {
    try {
        await babel.transformAsync(selectedCode, {
            presets: [babelPresetReact]
        });
        if (!selectedCode.match(/^\s*<[^>]*>/)) {
            throw new Error('expected "<" and ">" in the beginnig and the end of the code');
        }
    } catch (e) {
        throw new Error(`Invalid component code: ${e.message}`);
    }
};

const generateSubComponentElement = (editor, subComponentName, subComponentProps) => {
    const formattedProps = subComponentProps.map(prop => `${prop}={${prop}}`);
    const leadingSpaces = ' '.repeat(editor.selection.start.character);
    let propsAndClosing = '/';
    
    if (formattedProps.length > 3) {
        propsAndClosing = `\n${leadingSpaces}\t${formattedProps.join(`\n${leadingSpaces}\t`)}\n${leadingSpaces}/`;
    } else if (formattedProps.length > 0) {
        propsAndClosing = ` ${formattedProps.join(' ')}/`;
    }
    
    return `<${subComponentName}${propsAndClosing}>`;
};

const replaceSelectedCodeWithSubComponentElement = async (editor, subComponentName, subComponentProps) => {
    await editor.edit(async edit => {
        const subComponentElement = generateSubComponentElement(editor, subComponentName, subComponentProps);
        edit.replace(editor.selection, subComponentElement);
    });
};

const getLineIndexForNewImports = code => {
    const codeLines = code.split('\n');
    const firstImportLineIndex = codeLines.findIndex(codeLine => codeLine.match(/^\s*import /));
    const codeLinesFromFirstImport = firstImportLineIndex > -1 ? [...codeLines].splice(firstImportLineIndex) : codeLines;
    const indexOfFirstNonImportLine = codeLinesFromFirstImport.findIndex(codeLine => codeLine.match(/^\s*[^i]/)) - 1;
    return Math.max(indexOfFirstNonImportLine, 0);
};

const addSubComponentImport = async (editor, subComponentName) => {
    await editor.edit(async edit => {
        const originalCode = editor.document.getText();
        const newImportLineIndex = getLineIndexForNewImports(originalCode);
        const subComponentImportLine = `import ${subComponentName} from './${subComponentName}';\n`;
        edit.insert(new vscode.Position(newImportLineIndex, 0), subComponentImportLine);
    });
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

const removeUnusedImports = async editor => {
    await editor.edit(async edit => {
        const linterResults = getLinterResultsForUnusedImports(editor.document.getText());
        linterResults.forEach(linterResult => {
            const unusedImport = linterResult.message.replace(/^[^']*'(?<unusedImportGroup>[^']+)'.*/, '$<unusedImportGroup>');
            const codeLine = editor.document.lineAt(linterResult.line - 1);
            const codeLineText = codeLine.text;
            const regexForDefaultTypeImport = new RegExp(`^import\\s+${unusedImport}\\s+from\\s+.*$`, 'g');
            const regexForNonDefaultTypeImport = new RegExp(`(?<importLineBeforeUnusedImport>^import\\s+{[\\s*\\w+\\s*,]*\\s*)${unusedImport}\\s*,?\\s*(?<importLineAfterUnusedImport>[\\w+\\s*,?]*\\s*}\\s+from\\s+.*$)`, 'g');
            const isDefaultTypeImport = codeLineText.match(regexForDefaultTypeImport);
            const isNonDefaultTypeImport = codeLineText.match(regexForNonDefaultTypeImport);
            
            if (isDefaultTypeImport || (isNonDefaultTypeImport && isNonDefaultTypeImport.length === 1)) {
                edit.delete(codeLine.rangeIncludingLineBreak);
            } else if (isNonDefaultTypeImport && isNonDefaultTypeImport.length > 1) {
                edit.replace(codeLine.range, codeLineText.replace(regexForNonDefaultTypeImport, '$<importLineBeforeUnusedImport>$<importLineBeforeUnusedImport>'));
            }
        });
    });
};

const replaceOriginalCode = async (editor, subComponentName, subComponentProps) => {
    await replaceSelectedCodeWithSubComponentElement(editor, subComponentName, subComponentProps);
    await addSubComponentImport(editor, subComponentName);
    await removeUnusedImports(editor);
};

module.exports = {
    getSelectedCode,
    validateSelectedCode,
    generateSubComponentElement,
    getLineIndexForNewImports,
    getLinterResultsForUnusedImports,
    replaceOriginalCode,
};
