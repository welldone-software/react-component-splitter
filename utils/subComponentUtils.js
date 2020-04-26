// @ts-nocheck
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const eslint = require('eslint');
const {parseForESLint} = require('babel-eslint');

/* Checks if sub-component file already exists */
const checkIfSubComponentFileAlreadyExists = async ({folderPath, subComponentFileName}) => {
	try {
		const filesInCurrentFolder = await fs.readdirSync(folderPath, {withFileTypes: true})
			.filter(item => !item.isDirectory())
			.map(item => item.name);		
		return filesInCurrentFolder.includes(subComponentFileName);
	} catch ({message: errorMessage}) {
		return {getSubComponentNameError: errorMessage};;
	}
};

/* Gets the new sub-component name the user */
const getSubComponentNameFromUser = async ({folderPath}) => {
	const subComponentName = await vscode.window.showInputBox({
		prompt: 'Choose a name for the new component',
		ignoreFocusOut: true,
		placeHolder: 'New component name...',
	});
	if (!subComponentName || subComponentName.length === 0) {
		return {getSubComponentNameError: 'Empty name received'};
	}
	if (!subComponentName.match(/^[A-Z][0-9a-zA-Z_$].*$/g)) {
		return {getSubComponentNameError: 'Invalid React component name'};
	}

	const subComponentFileName = `${subComponentName}.js`;
	const subComponentFileAlreadyExists = await checkIfSubComponentFileAlreadyExists({folderPath, subComponentFileName});
	if (subComponentFileAlreadyExists) {
		return {getSubComponentNameError: `${subComponentFileName} already exists in the current folder`};
	}
	return {subComponentName};
};

/* Formats (trim & indendation) the selected code, to beautifully fit in a new file */
const formatSelectedCode = selectedCode => {
	const lines = selectedCode.split('\n');
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

/* Fits code lines inside a pre-written React component skeleton */
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

/* Gets the potential sub-component props from undefined linter results */
const getPotentialSubComponentProps = ({subComponentCodeWithoutProps}) => {
	const linter = new eslint.Linter();	
	const linterResults = linter.verify(subComponentCodeWithoutProps, {
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
	const undefinedVars = linterResults.map(({message}) => message.replace(/^[^']*'([^']+)'.*/, '$1'));
	return undefinedVars.filter((undefinedVar, i) => undefinedVars.indexOf(undefinedVar) === i);
};

/* Gets the final sub-component props and initial imports */
const getSubComponentPropsAndImports = ({editor, potentialSubComponentProps}) => {
	const originalCode = editor.document.getText();
	const {subComponentProps, subComponentImports} = potentialSubComponentProps.reduce((res, prop) => {
		const importMatch = originalCode.match(`import\\s+({?)(\\s*\\w\\s*,)*\\s*${prop}\\s*(,?\\s*\\w\\s*)*,?\\s*(}?)\\s*from\\s*([^\\n;]*)[\\n|;]`);
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
	
	return {subComponentProps, subComponentImports};
}

/* Generates the code for the new sub-component */
const generateSubComponentCode = async ({editor, selectedCode, subComponentName}) => {
	const formattedSelectedCode = formatSelectedCode(selectedCode);	
	const subComponentCodeWithoutProps = fitCodeInsideReactComponentSkeleton({subComponentName, jsx: formattedSelectedCode});
	const potentialSubComponentProps = getPotentialSubComponentProps({subComponentCodeWithoutProps});
	const {subComponentProps, subComponentImports} = getSubComponentPropsAndImports({editor, potentialSubComponentProps});
	const subComponentCode = fitCodeInsideReactComponentSkeleton({
		subComponentName,
		jsx: formattedSelectedCode,
		props: subComponentProps, 
		imports: subComponentImports,
	});

	return {subComponentCode, subComponentImports, subComponentProps};
};

/* Creates the sub-component file with the generated code inside */
const createSubComponentFile = async ({name, code, folderPath}) => {
	const {workspaceFolders} = vscode.workspace;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return 'You must add working environment!';
	}
	const subComponentPath = path.join(folderPath, name);
	try {
		await fs.writeFileSync(subComponentPath, code);
	} catch ({message: errorMessage}) {
		return {createSubComponentError: errorMessage};
	}
	return {subComponentPath};
};

/* Adds any missing imports to the sub-component */
const addMissingImportsToSubComponent = async ({subComponentPath, subComponentCode, missingSubComponentImports}) => {
	const subComponentCodeLines = subComponentCode.split('\n');
	const newSubComponentCode = [
		subComponentCodeLines[0],
		...missingSubComponentImports,
		...subComponentCodeLines.slice(1),
	].join('\n');

	try {
		await fs.writeFileSync(subComponentPath, newSubComponentCode);
	} catch ({message: errorMessage}) {
		return errorMessage;
	}
};

module.exports = {
    getSubComponentNameFromUser,
    formatSelectedCode,
    generateSubComponentCode,
    createSubComponentFile,
    addMissingImportsToSubComponent,
};