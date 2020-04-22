// @ts-nocheck
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const eslint = require('eslint');
const babel = require("@babel/core");
const babelPresetReact = require('@babel/preset-react');
const {parseForESLint} = require('babel-eslint');
const eslintPluginReact = require('eslint-plugin-react');
const eslintPluginUnusedImports = require('eslint-plugin-unused-imports');

const getSelectedCode = editor => {
	const selectedCode = editor.document.getText(editor.selection);
	if (selectedCode === '') {
		return null;
	}
	return selectedCode;
};

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

const getSubComponentName = async ({folderPath}) => {
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
	try {
		const filesInCurrentFolder = await fs.readdirSync(folderPath, {withFileTypes: true})
			.filter(item => !item.isDirectory())
			.map(item => item.name);
		const subComponentFileName = `${subComponentName}.js`;
		
		if (filesInCurrentFolder.includes(subComponentFileName)) {
			return {getSubComponentNameError: `${subComponentFileName} already exists in the current folder`};
		}
	} catch ({message: errorMessage}) {
		return {getSubComponentNameError: errorMessage};;
	}

	return {subComponentName};
};

// trims and fixes tab indentation of the selected code to fit inside a new subcomponent
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

const generateSubComponentCode = async ({editor, selectedCode, subComponentName}) => {
	const formattedSelectedCode = formatSelectedCode(selectedCode);
	const subComponentCodeWithoutProps = fitCodeInsideReactComponentSkeleton({subComponentName, jsx: formattedSelectedCode});
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
	const potentialSubComponentProps = undefinedVars.filter((undefinedVar, i) => undefinedVars.indexOf(undefinedVar) === i);
	const originalCode = editor.document.getText();
	
	// excludes imports from potential props
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
			subComponentImports: [...res.subComponentImports, `import ${isDefaultTypeImport ? prop : `{${prop}}`} from ${importMatch[5].replace(/"/, "'")};`]
		};
	}, {subComponentProps: [], subComponentImports: []});

	const subComponentCode = fitCodeInsideReactComponentSkeleton({
		subComponentName,
		jsx: formattedSelectedCode,
		props: subComponentProps, 
		imports: subComponentImports,
	});
	return {subComponentCode, subComponentImports, subComponentProps};
};

const createSubComponent = async ({name, code, folderPath}) => {
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

const replaceOriginalCode = async ({editor, subComponentName, subComponentImports, subComponentProps}) => {
	const missingSubComponentImports = [];
	try {
		await editor.edit(async edit => {
			// replaces selected code with subcomponent tag
			const formattedProps = subComponentProps.map(prop => `${prop}={${prop}}`);
			const leadingSpaces = ' '.repeat(editor.selection.start.character);
			let propsAndClosing = '/';
			if (formattedProps.length > 3) {
				propsAndClosing = `\n${leadingSpaces}\t${formattedProps.join(`\n${leadingSpaces}\t`)}\n${leadingSpaces}/`;
			} else if (formattedProps.length > 0) {
				propsAndClosing = ` ${formattedProps.join(' ')}/`;
			}
			edit.replace(editor.selection, `<${subComponentName}${propsAndClosing}>`);			
			
			// adds import to subcomponent
			const originalCodeLines = editor.document.getText().split('\n');
			const firstImportLineIndex = originalCodeLines.findIndex(codeLine => codeLine.match(/^\s*import /));
			const originalCodeLinesFromFirstImport = firstImportLineIndex > -1 ? [...originalCodeLines].splice(firstImportLineIndex) : originalCodeLines;
			const newImportLineIndex = originalCodeLinesFromFirstImport.findIndex(codeLine => codeLine.match(/^\s*[^i]/)) - 1;
			edit.insert(new vscode.Position(Math.max(newImportLineIndex, 0), 0), `import ${subComponentName} from './${subComponentName}';\n`);
		});

		// removes redundant imports and collects missing imports of subcomponent
		await editor.edit(async edit => {
			const linter = new eslint.Linter();	
			linter.defineRule('react/jsx-uses-react', eslintPluginReact.rules['jsx-uses-react']);
			linter.defineRule('react/jsx-uses-vars', eslintPluginReact.rules['jsx-uses-vars']);
			linter.defineRule('unused-imports/no-unused-imports', eslintPluginUnusedImports.rules['no-unused-imports']);

			const linterConfig = {
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
			};

			const linterResults = linter.verify(editor.document.getText(), linterConfig);
			linterResults.forEach(linterResult => {
				const unusedImport = linterResult.message.replace(/^[^']*'([^']+)'.*/, '$1');
				const codeFromImport = editor.document.getText().split('\n').slice(linterResult.line - 1).join('\n');
				let importLocation = codeFromImport.substring(codeFromImport.indexOf('from'));
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
	} catch ({message: errorMessage}) {
		return {replaceOriginalCodeError: errorMessage};
	}
	return {missingSubComponentImports};
};

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
    getSelectedCode,
    validateSelectedCode,
    getSubComponentName,
    formatSelectedCode,
    generateSubComponentCode,
    createSubComponent,
    replaceOriginalCode,
    addMissingImportsToSubComponent,
};