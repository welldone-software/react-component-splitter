const _ = require('lodash');
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const {
    eslintAutofix,
    getImports,
    getNumberOfLeadingSpaces,
    getUndefinedVars,
    pretify,
    removeUnusedImports,
    transformCode,
} = require('./parse');

const validateSelection = () => {

    const editor = vscode.window.activeTextEditor;
    const selection = editor.document.getText(editor.selection);

    try { transformCode(`<>${selection}</>`); }
    catch { throw new Error('Invalid selection. Make sure your selection represents a valid React component'); }

    const codeWithoutSelection = replaceByRange(editor.document.getText(), editor.selection, '');

    try { transformCode(codeWithoutSelection); }
    catch { throw new Error('Invalid selection. Make sure the code remains valid without your selection'); }

};

const buildComponentPath = name => {

    const activeDocumentPath = vscode.window.activeTextEditor.document.uri.fsPath;
    const activeDocumentExtension = activeDocumentPath.replace(/(.*)+\.[^\.]+/, '$1');
    const nameWithoutExtension = name.replace(/\.[^\.]+$/, '');

    return path.join(activeDocumentPath, '..', `${nameWithoutExtension}.${activeDocumentExtension}`);
    
};

const askForComponentName = async () => {

    const name = await vscode.window.showInputBox({
        prompt: 'Choose a name for the new component',
        ignoreFocusOut: true,
        placeHolder: 'New component name...',
    });
    
    if (_.isNil(name)) { throw new Error('Empty name received'); }

    if (!/^[A-Z][0-9a-zA-Z_$]*$/g.test(name)) { throw new Error('Invalid React component name.\nChoose a name that starts with a capital letter, followed by letters or digits only'); }

    if (fs.existsSync(buildComponentPath(name))) { throw new Error('File with this component name already exists in the current folder'); }

    return name;
};

const replaceByRange = (string, range, replaceValue) => {

    const lines = _.split(string, '\n');

    const { startIndex, endIndex } = _.reduce(lines, (res, line, index) => {
        
        const newRes = {...res};

        if (index < range.start.line) {
            newRes.startIndex = (newRes.startIndex + _.size(line) + 1);
        }

        if (index === range.start.line) {
            newRes.startIndex = (res.startIndex + range.start.character);
        }

        if (index < range.end.line) {
            newRes.endIndex = (res.endIndex + _.size(line) + 1);
        } 
        
        if (index === range.end.line) {
            newRes.endIndex = (res.endIndex + range.end.character);
        }

        return newRes;

    }, { startIndex: 0, endIndex: 0 });
    
    return `${string.substring(0, startIndex)}${replaceValue}${string.substring(endIndex)}`;

};

const replaceCode = async ({ reactElement, name }) => {

    const editor = vscode.window.activeTextEditor;
    const {document} = editor;
    
    const lastImportIndex = _.chain(document.getText())
        .split('\n')
        .findLastIndex(codeLine => /from\s+[`|'|"].*$/.test(codeLine))
        .value();
    
    await editor.edit(edit => {
        edit.replace(editor.selection, reactElement);
        edit.insert(new vscode.Position((lastImportIndex + 1), 0), `import ${name} from './${name}';\n`)
    });    

    eslintAutofix(document.getText(), { filePath: document.uri.fsPath })
        .then(output => {
            editor.edit(edit => {
                const fullRange = new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(_.size(document.getText()) - 1),
                );
                edit.replace(fullRange, output);
            });   
        });
    
};

const generateReactElement = ({ name, props, jsx }) => {
    
    const numberOfLeadingSpacesFromStart = getNumberOfLeadingSpaces(jsx);
    const leadingSpacesFromStart = _.repeat(' ', numberOfLeadingSpacesFromStart);
    let propsString = '';
    
    if (_.size(props) > 3) {
        const numberOfLeadingSpacesFromEnd = getNumberOfLeadingSpaces(jsx, {endToStart: true});
        const leadingSpacesFromEnd = _.repeat(' ', numberOfLeadingSpacesFromEnd);
        propsString = `\n${leadingSpacesFromEnd}  {...{\n${leadingSpacesFromEnd}    ${_.join(props, `,\n${leadingSpacesFromEnd}    `)},\n  ${leadingSpacesFromEnd}}}\n${leadingSpacesFromEnd}`;
    } else if (_.size(props) > 0) {
        propsString = ` {...{ ${_.join(props, ', ')} }}`;
    }
    
    return `${leadingSpacesFromStart}<${name}${propsString}/>`;
};

const extractRelevantImportsAndProps = () => {

    const editor = vscode.window.activeTextEditor;
    const code = editor.document.getText();
    const selection = editor.document.getText(editor.selection);
    
    const selectionAndImports = `
        ${buildImportsString(getImports(code))}\n
        export default () => (<>${selection}</>);
    `;

    return {
        props: getUndefinedVars(selectionAndImports),
        imports: removeUnusedImports(selectionAndImports),
    };

};

const buildImportsString = imports => _.join(imports, '\n');

const buildPropsString = props => {

    const numOfProps = _.size(props);

    if (numOfProps > 2) { return `{\n  ${_.join(props, `,\n  `)},\n}`; }
    if (numOfProps === 2) { return `{${_.join(props, ', ')}}`; }
    if (numOfProps === 1) { return `{${props[0]}}`; }

    return '';

};

const isWrappedWithTags = string => /^\s*<.*>\s*$/s.test(string);

const createNewComponent = async componentName => {

    const editor = vscode.window.activeTextEditor;
    const selection = editor.document.getText(editor.selection);
    const { imports, props } = extractRelevantImportsAndProps(componentName);

    const newComponent = {
        code: pretify(
            `${buildImportsString(imports)}\n\n` +

            `const ${componentName} = (${buildPropsString(props)}) => (\n` +
                `${isWrappedWithTags(selection) ? selection : `<>\n${selection}\n</>`}\n` +
            `);\n\n` +

            `export default ${componentName};\n`,
        ),
        reactElement: generateReactElement({ name: componentName, props, jsx: selection }),
        imports,
        name: componentName,
        path: path.join(editor.document.uri.fsPath, '..', `${componentName}.js`),
        props,
    };
    
    eslintAutofix(newComponent.code, {filePath: newComponent.path})
        .then(output => { fs.writeFileSync(newComponent.path, output); });

    return newComponent;
};

module.exports = {
    createNewComponent,
    askForComponentName,
    validateSelection,
    replaceByRange,
    replaceCode,
};