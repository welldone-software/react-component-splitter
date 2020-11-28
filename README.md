# React Component Splitter

This extension allows to easily split long React components into sub-components.

## Usage:

**1**. Select the code you want to export to a new sub-component.

**2**. Choose  `Split to New Component`  from the Right-Click Menu / Command Palette.

**3**. Enter a name for the new sub-component.

![enter image description here](https://raw.githubusercontent.com/welldone-software/react-component-splitter/master/src/assets/example.gif)

## Concept & Assumptions:

The extension, as of the current version, is based on several basic assumptions:

- The new component should be created in the current component folder

- The selected code represents a valid jsx for a new React component

- Imports and variables that become unused after splitting, will be deleted from the original component file and re-imported in the new component file

- The extension uses eslint Linters which are all set for ecmaVersion 2017

## Reporting Bugs:

If you find a bug or malfunction, or have any other comments, you can contact us via email: [sahara@welldone-software.com](mailto:sahara@welldone-software.com), or open a github issue (with specific code example).
