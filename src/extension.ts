'use strict';
import * as vscode from 'vscode';
import * as vm from 'vm2';

function length(str: string): vscode.Position  {
    const lines = str.split(/\r\n|\r|\n/);
    const lastLineLength = lines[lines.length - 1].length;
    return new vscode.Position(lines.length - 1, lastLineLength);
}

function addPos(p1: vscode.Position, length: vscode.Position): vscode.Position {
    let chr = length.line === 0 ? p1.character + length.character : length.character;
    return new vscode.Position(p1.line + length.line, chr);
}

class Edit {
    constructor(
        public readonly range: vscode.Range,
        public readonly newText: string,
    ) { }
}

class Edits {
    constructor(public readonly edits: ReadonlyArray<Edit>) {}

    public apply(b: vscode.TextEditorEdit, original: vscode.TextDocument): Edits {
        const reverseEdits = new Array<Edit>();
        const edits = [...this.edits].sort((a, b) => {
            if (a.range.start.isBefore(b.range.start)) { return -1; }
            if (a.range.start.isEqual(b.range.start)) { return 0; }
            return 1;
        });

        let lastOldLine: number = -1;
        let charsAddedOnLastModifiedLine = 0;
        let linesAdded = 0;

        for (const e of edits) {
            const replacedText = original.getText(e.range);
            b.replace(e.range, e.newText);

            if (e.range.start.line !== lastOldLine) {
                if (e.range.start.line < lastOldLine) { throw new Error("bug"); }

                charsAddedOnLastModifiedLine = 0;
            }

            const newTextLength = length(e.newText);
            const newStart = new vscode.Position(e.range.start.line + linesAdded, e.range.start.character + charsAddedOnLastModifiedLine);
            const newEnd = addPos(newStart, newTextLength);
            const newRange = new vscode.Range(newStart, newEnd);
            reverseEdits.push(new Edit(newRange, replacedText));
            lastOldLine = e.range.end.line;

            if (e.range.isSingleLine) {
                if (newTextLength.line === 0) {
                    /*
                        "123[456]789|" [=> "ab"]
                    =   "123[ab]789|"
                    */
                    charsAddedOnLastModifiedLine += newTextLength.character - (e.range.end.character - e.range.start.character);
                } else {
                    /*
                        "123[456]789|" [=> "a\nb"]
                    =   "123a
                         b789|"
                    */
                    charsAddedOnLastModifiedLine = newTextLength.character - e.range.start.character;
                }
            } else {
                if (newTextLength.line === 0) {
                    /*
                        "123[45
                        6]789|" [=> "ab"]
                    =   "123[ab]789|"
                    */
                    charsAddedOnLastModifiedLine += newTextLength.character + e.range.start.character - e.range.end.character;
                } else {
                    /*
                        "123[45
                         6]789|" [=> "a\nbc"]
                    =   "123[a
                         bc]789|"
                    */
                    charsAddedOnLastModifiedLine = newTextLength.character - e.range.end.character;
                }
            }
            linesAdded += newTextLength.line - (e.range.end.line - e.range.start.line);
        }
        return new Edits(reverseEdits);
    }
}

class Document {
    constructor(public readonly editor: vscode.TextEditor) {}

    private history: Edits[]|null = null;

    public disableBackup() {
        this.history = null;
    }

    public backup() {
        this.history = [];
    }

    public async restoreBackupIfExists(): Promise<void> {
        if (!this.history) { return; }
        for (let i = this.history.length - 1; i >= 0; i--) {
            const reverseEdit = this.history[i];
            const result = await this.editor.edit(b => {
                reverseEdit.apply(b, this.editor.document);
            });
            if (!result) { throw new Error("result is false"); }
        }

        this.history = [];
    }

    async applyEdits(edits: Edits): Promise<void> {
        const result = await this.editor.edit(b => {
            const reverse = edits.apply(b, this.editor.document);
            if (this.history) {
                this.history.push(reverse);
            }
        });
        if (!result) { throw new Error("result is false"); }
    }
}

class TransformedDocument {
    constructor(private readonly doc: Document) {
    }

    public async restore() {
        this.doc.editor.setDecorations(deco, []);
        await this.doc.restoreBackupIfExists();
    }

    public async update(transformSrc: string) {    
        await this.restore();
        this.doc.backup();
    

        const myVm = new vm.VM({
            timeout: 1000,
            sandbox: {
                find: (regexp: RegExp) => {
                    const str = this.doc.editor.document.getText();
                    //const regexp = new RegExp(transformSrc, "gi");
                    
                    let result = new Array<{ range: vscode.Range, text: string }>();
                    let match: RegExpExecArray|null;
                    let i = 0;
                    while (match = regexp.exec(str)) {
                        if (i++ > 1000) { break; }
                        const p1 = this.doc.editor.document.positionAt(match.index);
                        const p2 = this.doc.editor.document.positionAt(match.index + match[0].length);
                        
                        result.push({ range: new vscode.Range(p1, p2), text: match[0] });
                    }

                    
                    this.doc.editor.setDecorations(deco, result);

                    return ({
                        replace: async (mapResult: (str: String, idx: number) => string) => {
                            await this.doc.applyEdits(new Edits(result.map((r, idx) => new Edit(r.range, mapResult(r.text, idx)))));
                        }
                    })
                }
            }
        });
        try {
            myVm.run(transformSrc);
        } catch(e) {
            console.error(e);
        }

        
        //
    
    }
}

const deco = vscode.window.createTextEditorDecorationType({ backgroundColor: "yellow" });

export function activate(context: vscode.ExtensionContext) {
    
    let doc: TransformedDocument|undefined;
    vscode.workspace.onDidChangeTextDocument(async args => {
        try {
            if (args.document.fileName.indexOf("script.txt") === -1) { return; }

            if (doc) {
                await doc.update(args.document.getText());
            }
        } catch(e) {
            console.error(e);
        }
    });

    vscode.window.onDidChangeActiveTextEditor(async args => {
        try {
            if (args && args.document.fileName.indexOf("script.txt") !== -1) {
                if (doc) {
                    doc.update(args.document.getText());
                }
                return;
            }
            
            if (doc) {
                await doc.restore();
            }
            doc = args ? new TransformedDocument(new Document(args)) : undefined;

        } catch(e) {
            console.error(e);
        }
    });

}

export function deactivate() {
}