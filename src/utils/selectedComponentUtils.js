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
        endToStart ? /^\s*[<|\/>].*$/.test(line) : /^\s*<.*$/.test(line));
    const indexOfFirstSpace = selectedCodeLines[firstCodeLineIndex].search(/\S/);
    
    return Math.max(0, indexOfFirstSpace);
};

const checkIfJsxElementsAreAdjacent = selectedCode => !/<.*<\/.*>/gs.test(selectedCode);

const wrapAdjacentJsxElements = selectedCode => {
    const numberOfLeadingSpaces = getNumberOfLeadingSpaces(selectedCode, true);
    const lineIndent = '  ';
    const selectedCodeLinesTrimmed = _(selectedCode).trim().split('\n').value();
    const selectedCodeIndentedForWrapping = _(selectedCodeLinesTrimmed).map((line, i) =>
        i > 0 ? `${lineIndent}${line.substring(numberOfLeadingSpaces)}` : `${lineIndent}${line}`).join('\n');
    
    return `<>${EOL}${selectedCodeIndentedForWrapping}${EOL}</>`;
};

const validateSelectedCode = selectedCode => {
    if (checkIfJsxElementsAreAdjacent(selectedCode)) {
        const selectedCodeWithWrappingTag = wrapAdjacentJsxElements(selectedCode);
        return validateSelectedCode(selectedCodeWithWrappingTag);
    }
    try {
        babel.transformSync(selectedCode, {
            presets: [babelPresetReact],
            plugins: [[babelPluginProposalOptionalChaining, {loose: true}]],
        });
        if (!/^\s*<.*>\s*$/s.test(selectedCode)) {
            throw new Error('expected one wrapping element (for example, a wrapping <div>...</div> or any other element for the entire selection)');
        }
        return selectedCode;
    } catch (e) {
        throw new Error(`Invalid component code: ${e.message}`);
    }
};

const generateSubComponentElement = (selectedCode, subComponentName, subComponentProps) => {
    const numberOfLeadingSpacesFromStart = getNumberOfLeadingSpaces(selectedCode);
    const leadingSpacesFromStart = _.repeat(' ', numberOfLeadingSpacesFromStart);
    let propsString = '';
    
    if (_.size(subComponentProps) > 3) {
        const numberOfLeadingSpacesFromEnd = getNumberOfLeadingSpaces(selectedCode, true);
        const leadingSpacesFromEnd = _.repeat(' ', numberOfLeadingSpacesFromEnd);
        propsString = `${EOL}${leadingSpacesFromEnd}  {...{${EOL}${leadingSpacesFromEnd}    ${_.join(subComponentProps, `,${EOL}${leadingSpacesFromEnd}    `)},${EOL}  ${leadingSpacesFromEnd}}}${EOL}${leadingSpacesFromEnd}`;
        
    } else if (_.size(subComponentProps) > 0) {
        propsString = ` {...{${_.join(subComponentProps, ', ')}}}`;
    }
    
    return `${leadingSpacesFromStart}<${subComponentName}${propsString}/>`;
};

const replaceSelectedCodeWithSubComponentElement = async (editor, selectedCode, subComponentName, subComponentProps) => {
    const subComponentElement = generateSubComponentElement(selectedCode, subComponentName, subComponentProps);
    const numberOfLeadingSpaces = getNumberOfLeadingSpaces(selectedCode);
    const leadingSpacesAfterSelectionStart = _.repeat(' ', numberOfLeadingSpaces);
    
    await editor.edit(async edit => edit.replace(editor.selection, `${leadingSpacesAfterSelectionStart}${_.trim(subComponentElement)}`));
};

const getLineIndexForNewImports = code => {
    const importMatches = code.match(/^\s*import\s+(.|\n)+?from/gm);

    if (_.isEmpty(importMatches)) {
        return 0;
    }

    return _.reduce(importMatches, (res, match) =>
        res + _.split(match, '\n').length, 0)
};
    

const addSubComponentImport = async (editor, subComponentName) => {
    const originalCode = editor.document.getText();
    const newImportLineIndex = getLineIndexForNewImports(originalCode);
    const subComponentImportLine = `import ${subComponentName} from './${subComponentName}';${EOL}`;
    
    await editor.edit(edit => edit.insert(new vscode.Position(newImportLineIndex, 0), subComponentImportLine));
};

const removeUnusedImports = async (editor, importEntitiesToIgnore) => {
    const code = editor.document.getText();
    const codeLines = _.split(code, '\n');
    const linterResults = getLinterResultsForUnusedImports(code);
    
    await editor.edit(edit => {        
        _.forEach(linterResults, linterResult => {
            const unusedImportEntity = extractEntityNameFromLinterResult(linterResult);
            
            if (!unusedImportEntity) {
                return;
            }

            if (_.includes(importEntitiesToIgnore, unusedImportEntity)) {
                return;
            }

            const regexForDefaultTypeImport = new RegExp(`^import\\s+${unusedImportEntity}\\s+from\\s+.*$`, 'g');
            const regexForNonDefaultTypeImport = new RegExp(`(?<importLineBeforeUnusedImport>^import\\s+{[\\s*\\w+\\s*,]*\\s*)${unusedImportEntity}\\s*,?\\s*(?<importLineAfterUnusedImport>[\\w+\\s*,?]*\\s*}\\s+from\\s+.*$)`, 'g');

            const matchingImports = _.reduce(codeLines, (res, line, lineIndex) => {
                const isDefaultTypeImport = line.match(regexForDefaultTypeImport);
                const isNonDefaultTypeImport = line.match(regexForNonDefaultTypeImport);

                if (!isDefaultTypeImport && !isNonDefaultTypeImport) {
                    return res;
                }

                return [...res, {lineIndex, isDefaultTypeImport, isNonDefaultTypeImport}];
            }, []);

            matchingImports.forEach(({lineIndex, isDefaultTypeImport, isNonDefaultTypeImport}) => {
                const codeLine = editor.document.lineAt(lineIndex);
                const codeLineText = codeLine.text;

                if (isDefaultTypeImport || (isNonDefaultTypeImport && _.size(isNonDefaultTypeImport) === 1)) {
                    edit.delete(codeLine.rangeIncludingLineBreak);
                } else if (isNonDefaultTypeImport && _.size(isNonDefaultTypeImport) > 1) {
                    edit.replace(codeLine.range, codeLineText.replace(regexForNonDefaultTypeImport, '$<importLineBeforeUnusedImport>$<importLineAfterUnusedImport>'));
                }
            });
        });
    });
};

const replaceOriginalCode = async (editor, selectedCode, subComponentName, subComponentProps) => {
    const originalUnusedImportEntities = getUnusedImportEntitiesFromCode(editor.document.getText());
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
