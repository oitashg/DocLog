// The module 'vscode' contains the VS Code extensibility API

// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// Array to track where notes were logged: {uri, line}
let noteLocations = new Map();
let codeLensProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "live-doc-logger" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('live-doc-logger.DocLog', async () => {
		// The code you place here will be executed every time your command is executed
		const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open a file and place the cursor to log a note.');
            return;
        }
		
		vscode.window.showInputBox({
			prompt: 'Write your note here…',
			placeHolder: 'E.g. Fixed off-by-one error in parser',
			ignoreFocusOut: true
		})
		.then(input => {
			if (typeof input !== 'string') {
				return; // user cancelled
			}

			// 1. Figure out workspace folder
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				vscode.window.showErrorMessage('Open a folder first to save notes.');
				return;
			}

			const rootPath = folders[0].uri.fsPath;
			const relPath = path.relative(rootPath, editor.document.uri.fsPath);
			const lineNum = editor.selection.active.line;
			const heading = `### ${relPath}:${lineNum + 1}`;
			const date = new Date().toISOString().split('T')[0];
			
			// 2. Build your markdown entry
			const entry = [
				heading,
				`**Note:** ${input}`,
				`**Date:** ${date}`,
				''
			].join('\n') + '\n';

			// 3. Determine NOTES.md path
			const notesPath = path.join(rootPath, 'NOTES.md');

			// 4. Append (or create if missing)
			fs.appendFile(notesPath, entry, err => {
				if (err) {
					vscode.window.showErrorMessage(`Failed to write note: ${err.message}`);
				} 
				else {
					vscode.window.showInformationMessage('Note saved to NOTES.md');
					// Track location key
					const key = `${editor.document.uri.fsPath}:${lineNum}`;
					noteLocations.set(key, { uri: editor.document.uri, line: lineNum });
					codeLensProvider.reload();
				}
			});
		});

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Live-Doc-Logger and Oitash!');
	});

	// Command: Open an existing note
	const openDisposable = vscode.commands.registerCommand('live-doc-logger.DocLogOpen', async args => {
        const { uri, line } = args;
        const folders = vscode.workspace.workspaceFolders;

        if (!folders || folders.length === 0) { return; }
        const root = folders[0].uri.fsPath;
        const rel = path.relative(root, uri.fsPath);

        // Open NOTES.md
        const notesUri = vscode.Uri.file(path.join(root, 'NOTES.md'));
        const doc = await vscode.workspace.openTextDocument(notesUri);
        const ed = await vscode.window.showTextDocument(doc);

        // Search for matching entry header
        const regex = new RegExp(`^###\\s+${rel}:${line + 1}\\b`);
        const matchLine = doc.getText().split(/\r?\n/).findIndex(l => regex.test(l));
        if (matchLine >= 0) {
            const pos = new vscode.Position(matchLine, 0);
            ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            ed.selection = new vscode.Selection(pos, pos);
        }
    });

	// Command: Edit an existing note
    const editDisposable = vscode.commands.registerCommand('live-doc-logger.DocLogEdit', async ({ uri, line }) => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        const root = folder.uri.fsPath;
        const notesPath = path.join(root, 'NOTES.md');
        const content = fs.readFileSync(notesPath, 'utf8').split(/\r?\n/);
        const rel = path.relative(root, uri.fsPath);
        const header = `### ${rel}:${line + 1}`;
        const startIdx = content.findIndex(l => l.trim() === header);
        if (startIdx === -1) return;
        // Note text is on the next line starting with **Note:**
        const noteLineIdx = startIdx + 1;
        const oldLine = content[noteLineIdx];
        const oldText = oldLine.replace(/^\*\*Note:\*\*\s*/, '');
        const newText = await vscode.window.showInputBox({
            prompt: 'Edit your note…',
            value: oldText,
            ignoreFocusOut: true
        });
        if (typeof newText !== 'string') return;
        content[noteLineIdx] = `**Note:** ${newText}`;
        fs.writeFileSync(notesPath, content.join('\n'), 'utf8');
        vscode.window.showInformationMessage('Note updated in NOTES.md');
    });

    // Command: Delete an existing note
    const deleteDisposable = vscode.commands.registerCommand('live-doc-logger.DocLogDelete', async ({ uri, line }) => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;

        const root = folder.uri.fsPath;
        const notesPath = path.join(root, 'NOTES.md');
        const content = fs.readFileSync(notesPath, 'utf8').split(/\r?\n/);
        const rel = path.relative(root, uri.fsPath);
        const header = `### ${rel}:${line + 1}`;
        const startIdx = content.findIndex(l => l.trim() === header);
        if (startIdx === -1) return;
        // Remove header and following 3 lines (Note, Date, blank)
        content.splice(startIdx, 4);
        fs.writeFileSync(notesPath, content.join('\n'), 'utf8');
        // Remove from in-memory map
        const key = `${uri.fsPath}:${line}`;
        noteLocations.delete(key);
        codeLensProvider.reload();
        vscode.window.showInformationMessage('Note deleted from NOTES.md');
    });

	// CodeLens provider to show action above logged lines
    codeLensProvider = new (class {
        constructor() { this._onDidChange = new vscode.EventEmitter(); }
        get onDidChangeCodeLenses() { return this._onDidChange.event; }
        reload() { this._onDidChange.fire(); }

        provideCodeLenses(document) {
            const lenses = [];
            for (const [key, loc] of noteLocations.entries()) {
                if (loc.uri.fsPath === document.uri.fsPath) {
                    const range = new vscode.Range(loc.line, 0, loc.line, 0);
                    lenses.push(
                        new vscode.CodeLens(range, { title: '📝 View', command: 'live-doc-logger.DocLogOpen', arguments: [loc] }),
                        new vscode.CodeLens(range, { title: '✏️ Edit', command: 'live-doc-logger.DocLogEdit', arguments: [loc] }),
                        new vscode.CodeLens(range, { title: '🗑️ Delete', command: 'live-doc-logger.DocLogDelete', arguments: [loc] })
                    );
                }
            }
            return lenses;
        }
    })();

	context.subscriptions.push(disposable, openDisposable, editDisposable, deleteDisposable);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
    );
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}