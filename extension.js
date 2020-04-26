// @ts-nocheck
const vscode = require('vscode');
const {
	getSelectedCode,
	validateSelectedCode,
	replaceOriginalCode,
} = require('./utils/selectedComponentUtils');
const {
	getSubComponentNameFromUser,
	generateSubComponentCode,
	createSubComponentFile,
	addMissingImportsToSubComponent,
} = require('./utils/subComponentUtils');

const activate = context => {
	const disposable = vscode.commands.registerCommand(
		'react-component-splitter.split',
		async () => {	
			/* Gets editor */
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showInformationMessage('Editor does not exist');
				return;
			}
			/* Gets selected code */
			const selectedCode = getSelectedCode(editor);
			if (!selectedCode) {
				vscode.window.showInformationMessage('Please select code first');
				return;
			}
			/* Validates selected code */
			const validateSelectedCodeError = await validateSelectedCode(selectedCode);
			if (validateSelectedCodeError) {
				vscode.window.showErrorMessage(validateSelectedCodeError);
				return;
			}
			/* Gets sub-component name from user */
			const folderPath = editor.document.uri.path.replace(/[^\/]+$/, '');
			const {subComponentName, getSubComponentNameError} = await getSubComponentNameFromUser({folderPath});
			if (getSubComponentNameError) {
				vscode.window.showErrorMessage(getSubComponentNameError);
				return;
			}
			/* Generates sub-component code */
			const {subComponentCode, subComponentImports, subComponentProps, generateSubComponentCodeError} = await generateSubComponentCode({editor, selectedCode, subComponentName});
			if (generateSubComponentCodeError) {
				vscode.window.showErrorMessage(generateSubComponentCodeError);
				return;
			}
			/* Creates sub-component file */
			const {subComponentPath, createSubComponentError} = await createSubComponentFile({name: `${subComponentName}.js`, code: subComponentCode, folderPath});
			if (createSubComponentError) {
				vscode.window.showErrorMessage(createSubComponentError);
				return;
			}
			/* Replaces original code with new sub-component tag */
			const {missingSubComponentImports, replaceOriginalCodeError} = await replaceOriginalCode({editor, subComponentName, subComponentImports, subComponentProps});
			if (replaceOriginalCodeError) {
				vscode.window.showErrorMessage(replaceOriginalCodeError);
				return;
			}
			/* Adds missing imports to sub-component */
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
