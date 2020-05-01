const vscode = require('vscode');
const path = require('path');
const {
	getSelectedCode,
	validateSelectedCode,
	replaceOriginalCode,
} = require('./utils/selectedComponentUtils');
const {
	getSubComponentNameFromUser,
	generateSubComponentCode,
	createSubComponentFile,
} = require('./utils/subComponentUtils');

const activate = context => {
	const disposable = vscode.commands.registerCommand(
		'react-component-splitter.split',
		async () => {	
			try {
				const editor = vscode.window.activeTextEditor;
				const selectedCode = getSelectedCode(editor);
				await validateSelectedCode(selectedCode);

				const folderPath = editor.document.uri.path.replace(/[^\/]+$/, '');
				const subComponentName = await getSubComponentNameFromUser(folderPath);
				const subComponentPath = path.join(folderPath, `${subComponentName}.js`);
				const {subComponentCode, subComponentProps} = await generateSubComponentCode(editor, selectedCode, subComponentName);
				await createSubComponentFile(subComponentCode, subComponentPath);
				await replaceOriginalCode(editor, subComponentName, subComponentProps);

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
