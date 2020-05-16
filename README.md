# React Component Splitter

This VSCode extension allows to easily split long React components into sub-components.

## Usages:

**1**. Select the code you want to export to a new sub-component

**2**. Choose  `Split to New Component`  from the Right-Click Menu / Command Palette.

![usage example](https://raw.githubusercontent.com/welldone-software/react-component-splitter/master/images/example.gif)


## Concept & Assumptions

The extension, as of the current version, is based on several basic assumptions:

- The new component should be created in the current component folder

- The selected code represents a valid jsx for a new React component, and has one wrapper tag

- Imports and variables that become unused after splitting, will be deleted from the original component and re-imported in the new component

## Reporting Bugs

If you find a bug or malfunction, or have any other comments, you can contact us via email: sahara@welldone-software.com, or open a github issue (with specific code example).
