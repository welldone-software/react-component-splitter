import * as path from 'path';
import {ExtensionContext, TextEditor, TextDocument, commands, window} from 'vscode';
import splitter from './utils/splitter';

const editor: TextEditor = window.activeTextEditor;
const { document }: { document: TextDocument } = editor;

const getComponentNameFromUser = () =>
	window.showInputBox({
		prompt: 'Choose a name for the new component',
		ignoreFocusOut: true,
		placeHolder: 'New component name...',
	});

export const activate = (context: ExtensionContext) => {
	context.subscriptions.push(commands.registerCommand(
		'react-component-splitter.split',
		async () => {    
			try {

				const code: string = document.getText();
				const selectedCode: string = document.getText(editor.selection);
				splitter.validateSelectedCode({ selectedCode, selection: editor.selection });

				const componentName: string | undefined = await getComponentNameFromUser();
				splitter.validateComponentName(componentName);

				const fsPath = path.join(document.uri.fsPath, '..', `${componentName}.js`);
				const newComponent = splitter.createNewComponent({ componentName, code, fsPath, selectedCode });
				splitter.replaceCode({ editor, reactElement: newComponent.reactElement, componentName });

			} catch (error) {
				vscode.window.showErrorMessage(error.message);
			}
		},
	));
};
