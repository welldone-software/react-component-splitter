const _ = require('lodash');
const {EOL} = require('os');
const vscode = require('vscode');
const babel = require("@babel/core");
const babelPresetReact = require('@babel/preset-react');
const babelPluginProposalOptionalChaining = require('@babel/plugin-proposal-optional-chaining');
const {
    extractEntityNameFromLinterResult,
    getLinterResultsForUnusedImports,
    getUnusedImportEntitiesFromCode,
} = require('./linterUtils');

const getSelectedCode = editor => {
	const selectedCode = editor.document.getText(editor.selection);
    
    if (!selectedCode || selectedCode === '') {
        throw new Error('No code selected');
	}
    
    return selectedCode;
};

const getNumberOfLeadingSpaces = (selectedCode, endToStart = false) => {
    const selectedCodeLines = _.split(selectedCode, '\n');
    
    if (endToStart) {
        _.reverse(selectedCodeLines);
    }

    const firstCodeLineIndex = _.findIndex(selectedCodeLines, line =>
        endToStart ? line.match(/^\s*[<|\/>].*$/) : line.match(/^\s*<.*$/));
    const indexOfFirstSpace = selectedCodeLines[firstCodeLineIndex].search(/\S/);
    
    return Math.max(0, indexOfFirstSpace);
};

const jsxElementsAreAdjacent = selectedCode => !selectedCode.match(/<.*<\/.*>/gs);

const wrapAdjacentJsxElements = selectedCode => {
    const numberOfLeadingSpaces = getNumberOfLeadingSpaces(selectedCode, true);
    const lineIndent = '  ';
    const selectedCodeLinesTrimmed = selectedCode.trim().split('\n');
    const selectedCodeIndentedForWrapping = _.map(selectedCodeLinesTrimmed, (line, i) =>
        i > 0 ? `${lineIndent}${line.substring(numberOfLeadingSpaces)}` : `${lineIndent}${line}`).join('\n');
    
    return `<>${EOL}${selectedCodeIndentedForWrapping}${EOL}</>`;
};

const validateSelectedCode = async selectedCode => {
    if (jsxElementsAreAdjacent(selectedCode)) {
        const selectedCodeWithWrappingTag = wrapAdjacentJsxElements(selectedCode);
        return validateSelectedCode(selectedCodeWithWrappingTag);
    }
    try {
        await babel.transformAsync(selectedCode, {
            presets: [babelPresetReact],
            plugins: [[babelPluginProposalOptionalChaining, {loose: true}]],
        });
        if (!selectedCode.match(/^\s*<.*>\s*$/s)) {
            throw new Error('expected one wrapping element (for example, a wrapping <div>...</div> or any other element for the entire selection)');
        }
        return selectedCode;
    } catch (e) {
        throw new Error(`Invalid component code: ${e.message}`);
    }
};

const generateSubComponentElement = (selectedCode, subComponentName, subComponentProps) => {
    const formattedProps = _.map(subComponentProps, prop => `${prop}={${prop}}`);
    const numberOfLeadingSpacesFromStart = getNumberOfLeadingSpaces(selectedCode);
    const leadingSpacesFromStart = ' '.repeat(numberOfLeadingSpacesFromStart);
    let propsAndClosing = '/';
    
    if (formattedProps.length > 3) {
        const numberOfLeadingSpacesFromEnd = getNumberOfLeadingSpaces(selectedCode, true);
        const leadingSpacesFromEnd = ' '.repeat(numberOfLeadingSpacesFromEnd);
        propsAndClosing = `${EOL}${leadingSpacesFromEnd}  ${_.join(formattedProps, `${EOL}${leadingSpacesFromEnd}  `)}${EOL}${leadingSpacesFromEnd}/`;
        
    } else if (formattedProps.length > 0) {
        propsAndClosing = ` ${_.join(formattedProps, ' ')}/`;
    }
    
    return `${leadingSpacesFromStart}<${subComponentName}${propsAndClosing}>`;
};

const replaceSelectedCodeWithSubComponentElement = async (editor, selectedCode, subComponentName, subComponentProps) => {
    const subComponentElement = generateSubComponentElement(selectedCode, subComponentName, subComponentProps);
    const numberOfLeadingSpaces = getNumberOfLeadingSpaces(selectedCode);
    const leadingSpacesAfterSelectionStart = ' '.repeat(numberOfLeadingSpaces);
    
    await editor.edit(async edit => edit.replace(editor.selection, `${leadingSpacesAfterSelectionStart}${subComponentElement.trim()}`));
};

const getLineIndexForNewImports = code => {
    const codeLines = _.split(code, '\n');
    const firstImportLineIndex = _.findIndex(codeLines, codeLine => codeLine.match(/^\s*import /));
    const codeLinesFromFirstImport = firstImportLineIndex > -1 ? _.slice([...codeLines], firstImportLineIndex) : codeLines;
    const indexOfFirstNonImportLine = _.findIndex(codeLinesFromFirstImport, codeLine => codeLine.match(/^\s*[^i]/)) - 1;
    
    return Math.max(indexOfFirstNonImportLine, 0);
};

const addSubComponentImport = async (editor, subComponentName) => {
    const originalCode = editor.document.getText();
    const newImportLineIndex = getLineIndexForNewImports(originalCode);
    const subComponentImportLine = `import ${subComponentName} from './${subComponentName}';${EOL}`;
    
    await editor.edit(async edit => edit.insert(new vscode.Position(newImportLineIndex, 0), subComponentImportLine));
};

const removeUnusedImports = async (editor, importEntitiesToIgnore) => {
    const linterResults = await getLinterResultsForUnusedImports(editor.document.getText());
    
    await editor.edit(async edit => {        
        _.forEach(linterResults, linterResult => {
            const unusedImportEntity = extractEntityNameFromLinterResult(linterResult);
            
            if (unusedImportEntity && !_.includes(importEntitiesToIgnore, unusedImportEntity)) {
                const codeLine = editor.document.lineAt(linterResult.line - 1);
                const codeLineText = codeLine.text;
                const regexForDefaultTypeImport = new RegExp(`^import\\s+${unusedImportEntity}\\s+from\\s+.*$`, 'g');
                const regexForNonDefaultTypeImport = new RegExp(`(?<importLineBeforeUnusedImport>^import\\s+{[\\s*\\w+\\s*,]*\\s*)${unusedImportEntity}\\s*,?\\s*(?<importLineAfterUnusedImport>[\\w+\\s*,?]*\\s*}\\s+from\\s+.*$)`, 'g');
                const isDefaultTypeImport = codeLineText.match(regexForDefaultTypeImport);
                const isNonDefaultTypeImport = codeLineText.match(regexForNonDefaultTypeImport);
                
                if (isDefaultTypeImport || (isNonDefaultTypeImport && isNonDefaultTypeImport.length === 1)) {
                    edit.delete(codeLine.rangeIncludingLineBreak);
                } else if (isNonDefaultTypeImport && isNonDefaultTypeImport.length > 1) {
                    edit.replace(codeLine.range, codeLineText.replace(regexForNonDefaultTypeImport, '$<importLineBeforeUnusedImport>$<importLineAfterUnusedImport>'));
                }
            }
        });
    });
};

const replaceOriginalCode = async (editor, selectedCode, subComponentName, subComponentProps) => {
    const originalUnusedImportEntities = await getUnusedImportEntitiesFromCode(editor.document.getText());
    await replaceSelectedCodeWithSubComponentElement(editor, selectedCode, subComponentName, subComponentProps);
    await addSubComponentImport(editor, subComponentName);
    await removeUnusedImports(editor, originalUnusedImportEntities);
};

module.exports = {
    generateSubComponentElement,
    getLineIndexForNewImports,
    getSelectedCode,
    replaceOriginalCode,
    validateSelectedCode,
};
