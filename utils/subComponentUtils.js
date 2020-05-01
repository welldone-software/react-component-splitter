// @ts-nocheck
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const eslint = require('eslint');
const {parseForESLint} = require('babel-eslint');
const {
	generateSubComponentElement,
	getLineIndexForNewImports,
	getLinterResultsForUnusedImports,
} = require('./selectedComponentUtils');

const getSubComponentNameFromUser = async folderPath => {
	const subComponentName = await vscode.window.showInputBox({
		prompt: 'Choose a name for the new component',
		ignoreFocusOut: true,
		placeHolder: 'New component name...',
	});
	if (!subComponentName || subComponentName.length === 0) {
		throw new Error('Empty name received');
	}
	if (!subComponentName.match(/^[A-Z][0-9a-zA-Z_$].*$/g)) {
		throw new Error('Invalid React component name');
	}

	const subComponentFileName = `${subComponentName}.js`;
	const subComponentPath = path.join(folderPath, subComponentFileName);
	const subComponentFileAlreadyExists = await fs.existsSync(subComponentPath);
	if (subComponentFileAlreadyExists) {
		throw new Error(`${subComponentFileName} already exists in the current folder`);
	}

	return subComponentName;
};

const trimAndAlignCode = code => {
	const lines = code.split('\n');
	const firstCodeLineIndex = lines.findIndex(line => line.match(/^ *</));
	const lastCodeLineIndex = lines.length - 1 - [...lines].reverse().findIndex(line => line.match(/^\s*[<|\/>]/));
	const numberOfLeadingSpaces = lines[lastCodeLineIndex].search(/\S/);
	const leadingSpaces = ' '.repeat(numberOfLeadingSpaces);
	let formattedCode = lines[firstCodeLineIndex].replace(/^ +/, '');
	
	for (let i = firstCodeLineIndex + 1; i < lastCodeLineIndex; i++) {
		formattedCode = `${formattedCode}\n\t${lines[i].startsWith(leadingSpaces) ?
			lines[i].substring(numberOfLeadingSpaces) : lines[i]}`;
	}
	if (firstCodeLineIndex !== lastCodeLineIndex) {
		formattedCode = `${formattedCode}\n\t${lines[lastCodeLineIndex].substring(numberOfLeadingSpaces)}`;
	}
	
	return formattedCode;
};

const fitCodeInsideReactComponentSkeleton = ({subComponentName, jsx, props = [], imports = []}) => {
	let importsString = `import React from 'react';\n`;
	imports.forEach(importLine => {
		importsString = `${importsString}${importLine}\n`;
	});
	let propsString = '';
	if (props.length > 2) {
		propsString = `{\n\t${props.join(',\n\t')},\n}`;
	} else if (props.length === 2) {
		propsString = `{${props.join(', ')}}`;
	} else if (props.length === 1) {
		propsString = `{${props[0]}}`;
	}
	return `${importsString}\nconst ${subComponentName} = (${propsString}) => (\n\t${jsx}\n);\n\nexport default ${subComponentName};\n`;
}

const getUndefinedVarsFromCode = code => {
	const linter = new eslint.Linter();	
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
		},
	});
	const undefinedVars = linterResults.map(({message}) => message.replace(/^[^']*'(?<undefinedVarGroup>[^']+)'.*/, '$<undefinedVarGroup>'));
	return undefinedVars.filter((undefinedVar, i) => undefinedVars.indexOf(undefinedVar) === i);
};

const sortUndefinedVarsToPropsAndImports = (code, undefinedVars) => {
	return undefinedVars.reduce((res, prop) => {
		const importMatch = code.match(`import\\s+({?)(\\s*\\w\\s*,)*\\s*${prop}\\s*(,?\\s*\\w\\s*)*,?\\s*(}?)\\s*from\\s*([^\\n;]*)[\\n|;]`);
		const isDefaultTypeImport = importMatch && importMatch[1] === '' && importMatch[4] === '';
		
		if (!importMatch) {
			return {
				...res,
				subComponentProps: [...res.subComponentProps, prop],
			};
		}
		return {
			...res,
			subComponentImports: [
				...res.subComponentImports,
				`import ${isDefaultTypeImport ? prop : `{${prop}}`} from ${importMatch[5].replace(/"/, "'")};`,
			]
		};
	}, {subComponentProps: [], subComponentImports: []});
};

const replaceRangeOfGivenCode = (code, range, replacement) => {
	const codeLines = code.split('\n');
	const {startIndexForReplacement, endIndexForReplacement} = codeLines.reduce((res, line, lineIndex) => {
		let newRes = {...res};
		if (lineIndex < range.start.line) {
			newRes = {...newRes, startIndexForReplacement: newRes.startIndexForReplacement + line.length + 1};
		}
		if (lineIndex === range.start.line) {
			newRes = {...newRes, startIndexForReplacement: newRes.startIndexForReplacement + range.start.character};
		}
		if (lineIndex < range.end.line) {
			newRes = {...newRes, endIndexForReplacement: newRes.endIndexForReplacement + line.length + 1};
		} 
		if (lineIndex === range.end.line) {
			newRes = {...newRes, endIndexForReplacement: newRes.endIndexForReplacement + range.end.character};
		}
		return newRes;
	}, {startIndexForReplacement: 0, endIndexForReplacement: 0});
	
	return code.substring(0, startIndexForReplacement) +
		replacement + code.substring(endIndexForReplacement);
};

const addImportToCode = (code, importLine, importIndex) => {
	const codeLines = code.split('\n');
	codeLines.splice(importIndex, 0, importLine);
	return codeLines.join('\n');
};

const getUnusedImportsFromCode = code => {
	const codeLines = code.split('\n');
	const unusedImports = [];
	const linterResults = getLinterResultsForUnusedImports(code);
	
	linterResults.forEach(linterResult => {

		const unusedImport = linterResult.message.replace(/^[^']*'(?<unsuedImportGroup>[^']+)'.*/, '$<unsuedImportGroup>');
		const codeStartingAtImport = [...codeLines].slice(linterResult.line - 1).join('\n');
		let importLocation = codeStartingAtImport.substring(codeStartingAtImport.indexOf('from'));
		importLocation = importLocation.substring(
			0, Math.min(importLocation.indexOf('\n'), importLocation.indexOf(';'))
		);
		const importLine = codeLines[linterResult.line - 1];
		const regexForDefaultTypeImport = new RegExp(`^import\\s+${unusedImport}\\s+from\\s+.*$`, 'g');
		const isDefaultTypeImport = importLine.match(regexForDefaultTypeImport);

		const formattedImportLine = `import ${isDefaultTypeImport ? unusedImport : `{${unusedImport}}`} ${importLocation};`;
		unusedImports.push(formattedImportLine);
	});
	
	return unusedImports;
};

const generateSubComponentPropsAndImports = (editor, selectedCode, subComponentName) => {
	const originalCode = editor.document.getText();

	const subComponentCodeWithoutProps = fitCodeInsideReactComponentSkeleton({subComponentName, jsx: selectedCode});
	const subComponentUndefinedVars = getUndefinedVarsFromCode(subComponentCodeWithoutProps);
	const {subComponentProps, subComponentImports} = sortUndefinedVarsToPropsAndImports(originalCode, subComponentUndefinedVars);
	
	const subComponentElement = generateSubComponentElement(editor, subComponentName, subComponentProps);
	const originalCodeWithSubComponentElement = replaceRangeOfGivenCode(originalCode, editor.selection, subComponentElement);

	const subComponentImportLineIndex = getLineIndexForNewImports(originalCode);
	const subComponentImportLine = `import ${subComponentName} from './${subComponentName}';\n`;
	const replacedOriginalCode = addImportToCode(originalCodeWithSubComponentElement, subComponentImportLine, subComponentImportLineIndex);

	const unusedImports = getUnusedImportsFromCode(replacedOriginalCode);
	unusedImports.forEach(unusedImport => {
		const importAlreadyExists = subComponentImports.includes(unusedImport);
		if (!importAlreadyExists) {
			subComponentImports.push(unusedImport)
		}
	})
	
	return {subComponentProps, subComponentImports};
}

const generateSubComponentCode = async (editor, selectedCode, subComponentName) => {
	const prettierSelectedCode = trimAndAlignCode(selectedCode);	
	const {subComponentProps, subComponentImports} = generateSubComponentPropsAndImports(editor, prettierSelectedCode, subComponentName);
	const subComponentCode = fitCodeInsideReactComponentSkeleton({
		subComponentName,
		jsx: prettierSelectedCode,
		props: subComponentProps, 
		imports: subComponentImports,
	});

	return {subComponentCode, subComponentProps};
};

const createSubComponentFile = async (code, subComponentPath) => {
	const {workspaceFolders} = vscode.workspace;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return new Error('You must add working environment!');
	}
	await fs.writeFileSync(subComponentPath, code);
};

module.exports = {
    getSubComponentNameFromUser,
    generateSubComponentCode,
    createSubComponentFile,
};