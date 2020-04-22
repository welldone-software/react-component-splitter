// @ts-nocheck
const vscode = require('vscode');
const {
	getSelectedCode,
	validateSelectedCode,
	getSubComponentName,
	generateSubComponentCode,
	createSubComponent,
	replaceOriginalCode,
	addMissingImportsToSubComponent,
} = require('./utils');

const activate = context => {
	const disposable = vscode.commands.registerCommand(
		'react-component-splitter.split',
		async () => {	
			// GET EDITOR
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showInformationMessage('Editor does not exist');
				return;
			}
			// GET SELECTED CODE
			const selectedCode = getSelectedCode(editor);
			if (!selectedCode) {
				vscode.window.showInformationMessage('Please select code first');
				return;
			}
			// VALIDATE SELECTED CODE
			const validateSelectedCodeError = await validateSelectedCode(selectedCode);
			if (validateSelectedCodeError) {
				vscode.window.showErrorMessage(validateSelectedCodeError);
				return;
			}
			// GET SUBCOMPONENT NAME FROM USER
			const folderPath = editor.document.uri.path.replace(/[^\/]+$/, '');
			const {subComponentName, getSubComponentNameError} = await getSubComponentName({folderPath});
			if (getSubComponentNameError) {
				vscode.window.showErrorMessage(getSubComponentNameError);
				return;
			}
			// GENERATE SUBCOMPONENT CODE
			const {subComponentCode, subComponentImports, subComponentProps, generateSubComponentCodeError} = await generateSubComponentCode({editor, selectedCode, subComponentName});
			if (generateSubComponentCodeError) {
				vscode.window.showErrorMessage(generateSubComponentCodeError);
				return;
			}
			// CREATE SUBCOMPONENT
			const {subComponentPath, createSubComponentError} = await createSubComponent({name: `${subComponentName}.js`, code: subComponentCode, folderPath});
			if (createSubComponentError) {
				vscode.window.showErrorMessage(createSubComponentError);
				return;
			}
			// REPLACE ORIGINAL CODE
			const {missingSubComponentImports, replaceOriginalCodeError} = await replaceOriginalCode({editor, subComponentName, subComponentImports, subComponentProps});
			if (replaceOriginalCodeError) {
				vscode.window.showErrorMessage(replaceOriginalCodeError);
				return;
			}
			// ADD MISSING SUBCOMPONENT IMPORTS
			const addMissingImportsToSubComponentError = await addMissingImportsToSubComponent({subComponentPath, subComponentCode, missingSubComponentImports});
			if (addMissingImportsToSubComponentError) {
				vscode.window.showErrorMessage(addMissingImportsToSubComponentError);
				return;
			}
		},
	);
	context.subscriptions.push(disposable);
};

exports.activate = activate;

module.exports = {
	activate,
};
