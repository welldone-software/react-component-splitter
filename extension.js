const vscode = require('vscode');
const path = require('path');
const {
	getSelectedCode,
	replaceOriginalCode,
	validateSelectedCode,
} = require('./utils/selectedComponentUtils');
const {
	createSubComponentFile,
	generateSubComponentCode,
	getSubComponentNameFromUser,
} = require('./utils/subComponentUtils');

const activate = context => {
	const disposable = vscode.commands.registerCommand(
		'react-component-splitter.split',
		async () => {	
			try {
				const editor = vscode.window.activeTextEditor;
				const selectedCode = validateSelectedCode(getSelectedCode(editor));
				const folderPath = path.join(editor.document.uri.fsPath, '..');
				
				const subComponentName = await getSubComponentNameFromUser(folderPath);
				const subComponentPath = path.join(folderPath, `${subComponentName}.js`);
				const {subComponentCode, subComponentProps} = generateSubComponentCode(editor, selectedCode, subComponentName);
				
				createSubComponentFile(subComponentPath, subComponentCode);
				await replaceOriginalCode(editor, selectedCode, subComponentName, subComponentProps);
			} catch (e) {
				vscode.window.showErrorMessage(e.message);
			}
		},
	);
	context.subscriptions.push(disposable);
};

exports.activate = activate;

module.exports = {
	activate,
};
