const vscode = require('vscode');
const {
    validateSelection,
    askForComponentName,
    createNewComponent,
    updateOriginalComponent,
} = require('./utils/splitter');

const activate = context => {
    context.subscriptions.push(vscode.commands.registerCommand(
        'react-component-splitter.split',
        async () => {
            try {

                validateSelection();

                const newComponentName = await askForComponentName();
                const newComponent = await createNewComponent(newComponentName);

                await updateOriginalComponent({ newComponent });

            } catch (error) {
                vscode.window.showErrorMessage(error.message);
            }
        },
    ));
};

module.exports = {
    activate,
};
