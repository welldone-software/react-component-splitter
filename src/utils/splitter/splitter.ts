import * as _ from 'lodash';
import { Position, Range, Selection, TextDocument, TextEditor, window } from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import {
	eslintAutofix,
	getImports,
	getNumberOfLeadingSpaces,
	getUndefinedVars,
	pretify,
	removeUnusedImports,
	transformCode,
} from '../parse/parse';

import { Component, PropsAndImports, ShortRange } from './types';

export const validateSelectedCode = ({ selectedCode, selection }:
    { selectedCode: string, selection: Selection }): void => {

	try { transformCode(`<>${selectedCode}</>`); }
	catch { throw new Error('Invalid selection. Make sure your selection represents a valid React component'); }

	const codeWithoutSelection = replaceCodeByRange(selectedCode, selection, '');

	try { transformCode(codeWithoutSelection); }
	catch { throw new Error('Invalid selection. Make sure the code remains valid without your selection'); }

};

const buildComponentPath = (componentName: string): string => {

	const activeDocumentPath: string = window.activeTextEditor.document.uri.fsPath;
	const activeDocumentExtension: string = _.replace(activeDocumentPath, /(.*)+\.[^\.]+/, '$1');
	const nameWithoutExtension: string = _.replace(componentName, /\.[^\.]+$/, '');

	return path.join(activeDocumentPath, '..', `${nameWithoutExtension}.${activeDocumentExtension}`);
    
};

export const validateComponentName = (componentName: string | undefined) => {
    
	if (_.isNil(componentName)) { throw new Error('Empty name received'); }

	if (!/^[A-Z][0-9a-zA-Z_$]*$/g.test(componentName!)) { throw new Error('Invalid React component name.\nChoose a name that starts with a capital letter, followed by letters or digits only'); }

	if (fs.existsSync(buildComponentPath(componentName!))) { throw new Error('File with this component name already exists in the current folder'); }

	return componentName;
};

export const replaceCodeByRange = (
	code: string,
	range: Range,
	replaceValue: string,
): string => {

	const lines: string[] = _.split(code, '\n');

	const { startIndex, endIndex }: ShortRange = _.reduce(lines, (res: ShortRange, line: string, index: number) => {
        
		const newRes: ShortRange = {...res};

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
    
	return `${code.substring(0, startIndex)}${replaceValue}${code.substring(endIndex)}`;

};

export const replaceCode = ({ editor, reactElement, componentName }:
    { editor: TextEditor, reactElement: string, componentName: string }): void => {

	const { document }: { document: TextDocument } = editor;
    
	const lastImportIndex: number = _.chain(document.getText())
		.split('\n')
		.findLastIndex(codeLine => /from\s+[`|'|"].*$/.test(codeLine))
		.value();
    
	editor.edit(edit => {
		edit.replace(editor.selection, reactElement);
		edit.insert(new Position((lastImportIndex + 1), 0), `import ${componentName} from './${componentName}';\n`);
	})
		.then(() => {
			return eslintAutofix(document.getText(), { filePath: document.uri.fsPath });
		})
		.then((output: string) => {
			return editor.edit(edit => {
				const fullRange: Range = new Range(
					document.positionAt(0),
					document.positionAt(_.size(document.getText()) - 1),
				);
				edit.replace(fullRange, output);
			});   
		});
    
};

const generateReactElement = ({ name, props, jsx }:
    { name: string, props: string[], jsx: string }): string => {
    
	let propsString: string = '';

	const numberOfLeadingSpacesFromStart: number = getNumberOfLeadingSpaces(jsx);
	const leadingSpacesFromStart: string = _.repeat(' ', numberOfLeadingSpacesFromStart);
    
	if (_.size(props) > 3) {
        
		const numberOfLeadingSpacesFromEnd: number = getNumberOfLeadingSpaces(jsx, {endToStart: true});
		const leadingSpacesFromEnd: string = _.repeat(' ', numberOfLeadingSpacesFromEnd);
        
		propsString = `\n${leadingSpacesFromEnd}  {...{\n${leadingSpacesFromEnd}    ${_.join(props, `,\n${leadingSpacesFromEnd}    `)},\n  ${leadingSpacesFromEnd}}}\n${leadingSpacesFromEnd}`;

	} else if (_.size(props) > 0) {
		propsString = ` {...{ ${_.join(props, ', ')} }}`;
	}
    
	return `${leadingSpacesFromStart}<${name}${propsString}/>`;
};

const extractRelevantImportsAndProps = ({ code, selectedCode }:
    { code: string, selectedCode: string }): PropsAndImports => {
    
	const selectionAndImports: string = `
        ${buildImportsString(getImports(code))}\n
        export default () => (<>${selectedCode}</>);
    `;

	return {
		props: getUndefinedVars(selectionAndImports),
		imports: removeUnusedImports(selectionAndImports),
	};

};

const buildImportsString = (imports: string[]): string => _.join(imports, '\n');

const buildPropsString = (props: string[]): string => {

	const numOfProps: number = _.size(props);

	if (numOfProps > 2) { return `{\n  ${_.join(props, `,\n  `)},\n}`; }
	if (numOfProps === 2) { return `{${_.join(props, ', ')}}`; }
	if (numOfProps === 1) { return `{${props[0]}}`; }

	return '';

};

const isCodeWrappedWithTags = (code: string): boolean => /^\s*<.*>\s*$/s.test(code);

export const createNewComponent = ({ componentName, code, fsPath, selectedCode }:
    { componentName: string, code: string, fsPath: string, selectedCode: string }): Component => {

	const { imports, props }: PropsAndImports = extractRelevantImportsAndProps({ code, selectedCode });

	const newComponent = {
		code: pretify(
			`${buildImportsString(imports)}\n\n` +

            `const ${componentName} = (${buildPropsString(props)}) => (\n` +
                `${isCodeWrappedWithTags(selectedCode) ? selectedCode : `<>\n${selectedCode}\n</>`}\n` +
            `);\n\n` +

            `export default ${componentName};\n`,
		),
		reactElement: generateReactElement({ name: componentName, props, jsx: selectedCode }),
		imports,
		name: componentName,
		fsPath,
		props,
	};
    
	eslintAutofix(newComponent.code, {filePath: newComponent.fsPath})
		.then(output => { fs.writeFileSync(newComponent.fsPath, output); });

	return newComponent;
};
