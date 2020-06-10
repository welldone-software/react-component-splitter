const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
	getUndefinedVarsFromCode,
	getUnusedImportEntitiesFromCode,
	getLinterResultsForUnusedImports,
	extractEntityNameFromLinterResult,
	fixImportsOrder,
} = require('./linterUtils');
const {
	generateSubComponentElement,
	getLineIndexForNewImports,
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
	if (!subComponentName.match(/^[A-Z][0-9a-zA-Z_$]*$/g)) {
		throw new Error('Invalid React component name.\r\nChoose a name that starts with a capital letter, followed by letters or digits only');
	}

	const subComponentFileName = `${subComponentName.replace(/\.js$/, '')}.js`;
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
		formattedCode = `${formattedCode}\r\n  ${lines[i].startsWith(leadingSpaces) ?
			lines[i].substring(numberOfLeadingSpaces) : lines[i]}`;
	}
	if (firstCodeLineIndex !== lastCodeLineIndex) {
		formattedCode = `${formattedCode}\r\n  ${lines[lastCodeLineIndex].substring(numberOfLeadingSpaces)}`;
	}
	
	return formattedCode;
};

const fitCodeInsideReactComponentSkeleton = ({subComponentName, jsx, props = [], imports = []}) => {
	let importsString = `import React from 'react';\r\n`;
	imports.forEach(importLine => {
		importsString = `${importsString}${importLine}\r\n`;
	});
	
	let propsString = '';
	if (props.length > 2) {
		propsString = `{\r\n  ${props.join(',\r\n  ')},\r\n}`;
	} else if (props.length === 2) {
		propsString = `{${props.join(', ')}}`;
	} else if (props.length === 1) {
		propsString = `{${props[0]}}`;
	}

	const subComponentCode = `${importsString}\r\nconst ${subComponentName} = (${propsString}) => (\r\n  ${jsx}\r\n);\r\n\r\nexport default ${subComponentName};\r\n`;
	return fixImportsOrder(subComponentCode);
}

const sortUndefinedVarsToPropsAndImports = (code, undefinedVars) => {
	return undefinedVars.reduce((res, undefinedVar) => {
		const importMatch = code.match(`import\\s+(?<leftBrace>{?)[\\s*\\w\\s*,]*\\s*${undefinedVar}\\s*[,?\\s*\\w\\s*]*,?\\s*(?<rightBrace>}?)\\s*from\\s*(?<importLocation>[^\\n;]*)[\\n|;]`);
		const isDefaultTypeImport = importMatch && importMatch.groups.leftBrace === '' && importMatch.groups.rightBrace === '';
		
		if (!importMatch) {
			return {
				...res,
				subComponentProps: [...res.subComponentProps, undefinedVar],
			};
		}
		return {
			...res,
			subComponentImports: [
				...res.subComponentImports,
				`import ${isDefaultTypeImport ? undefinedVar : `{${undefinedVar}}`} from ${importMatch.groups.importLocation.replace(/"/, "'")};`,
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

const getUnusedImportsFromCode = async (code, importEntitiesToIgnore) => {
	const codeLines = code.split('\n');
	const unusedImports = [];
	const linterResults = await getLinterResultsForUnusedImports(code);
	
	linterResults.forEach(linterResult => {
		const unusedImportEntity = extractEntityNameFromLinterResult(linterResult);
		if (unusedImportEntity && !importEntitiesToIgnore.includes(unusedImportEntity)) {
			const codeStartingAtImport = [...codeLines].slice(linterResult.line - 1).join('\n');
			let importLocation = codeStartingAtImport.substring(codeStartingAtImport.indexOf('from'));
			importLocation = importLocation.substring(
				0, Math.min(importLocation.indexOf('\n'), importLocation.indexOf(';'))
			);
			const importLine = codeLines[linterResult.line - 1];
			const regexForDefaultTypeImport = new RegExp(`^import\\s+${unusedImportEntity}\\s+from\\s+.*$`, 'g');
			const isDefaultTypeImport = importLine.match(regexForDefaultTypeImport);

			const formattedImportLine = `import ${isDefaultTypeImport ? unusedImportEntity : `{${unusedImportEntity}}`} ${importLocation};`;
			unusedImports.push(formattedImportLine);
		}
	});
	
	return unusedImports;
};

const generateSubComponentPropsAndImports = async (editor, selectedCode, subComponentName) => {
	const originalCode = editor.document.getText();

	const subComponentCodeWithoutProps = fitCodeInsideReactComponentSkeleton({subComponentName, jsx: selectedCode});
	const subComponentUndefinedVars = await getUndefinedVarsFromCode(subComponentCodeWithoutProps);
	const {subComponentProps, subComponentImports} = sortUndefinedVarsToPropsAndImports(originalCode, subComponentUndefinedVars);

	const subComponentElement = generateSubComponentElement(editor, subComponentName, subComponentProps);
	const originalCodeWithSubComponentElement = replaceRangeOfGivenCode(originalCode, editor.selection, subComponentElement);

	const subComponentImportLineIndex = getLineIndexForNewImports(originalCode);
	const subComponentImportLine = `import ${subComponentName} from './${subComponentName}';\r\n`;
	const replacedOriginalCode = addImportToCode(originalCodeWithSubComponentElement, subComponentImportLine, subComponentImportLineIndex);

	const originalUnusedImportEntities = await getUnusedImportEntitiesFromCode(editor.document.getText());
	const unusedImports = await getUnusedImportsFromCode(replacedOriginalCode, originalUnusedImportEntities);
	unusedImports.forEach(unusedImport => {
		const importAlreadyExists = subComponentImports.includes(unusedImport);
		if (!importAlreadyExists) {
			subComponentImports.push(unusedImport);
		}
	});
	
	return {subComponentProps, subComponentImports};
}

const generateSubComponentCode = async (editor, selectedCode, subComponentName) => {
	const prettierSelectedCode = trimAndAlignCode(selectedCode);
	const {subComponentProps, subComponentImports} = await generateSubComponentPropsAndImports(editor, prettierSelectedCode, subComponentName);
	const subComponentCode = fitCodeInsideReactComponentSkeleton({
		subComponentName,
		jsx: prettierSelectedCode,
		props: subComponentProps, 
		imports: subComponentImports,
	});

	return {subComponentCode, subComponentProps};
};

const createSubComponentFile = async (subComponentPath, code) => {
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