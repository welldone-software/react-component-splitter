export type ShortRange = {
    startIndex: number,
    endIndex: number,
};

export type Component = {
    code: string,
    reactElement: string,
    imports: string[],
    name: string,
    fsPath: string,
    props: string[],
};

export type PropsAndImports = {
    props: string[],
    imports: string[],
};
