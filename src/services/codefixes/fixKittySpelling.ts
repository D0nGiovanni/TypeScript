/* @internal */
namespace ts.codefix {
    const fixId = "fixKittySpelling";
    const errorCodes = [
        Diagnostics.Cannot_find_name_0_Did_you_mean_1.code
    ];
    registerCodeFix({
        errorCodes,
        getCodeActions,
        fixIds: [fixId],
        getAllCodeActions,
    });

    function getCodeActions(context: CodeFixContext): CodeFixAction[] | undefined {
        const { sourceFile } = context;
        const info = getInfo(sourceFile, context.span.start, context);
        if (!info) return undefined;
        const { node, suggestion } = info;
        const { target } = context.host.getCompilationSettings();
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, node, suggestion, target!));
        return [createCodeFixAction("spelling", changes, [Diagnostics.Kittify_to_0, suggestion], fixId, Diagnostics.Kittify_all_detected)];
    }
    
    function getAllCodeActions(context: CodeFixAllContext): CombinedCodeActions {
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const info = getInfo(diag.file, diag.start, context);
            const { target } = context.host.getCompilationSettings();
            if (info) doChange(changes, context.sourceFile, info.node, info.suggestion, target!);
        })
    }

    function getInfo(sourceFile: SourceFile, pos: number, context: CodeFixContextBase): { node: Node, suggestion: string } | undefined {
        // This is the identifier of the misspelled word. eg:
        // this.speling = 1;
        //      ^^^^^^^
        const node = getTokenAtPosition(sourceFile, pos);
        const checker = context.program.getTypeChecker();

        let suggestion: string | undefined;
        if (isPropertyAccessExpression(node.parent) && node.parent.name === node) {
            Debug.assert(node.kind === SyntaxKind.Identifier);
            const containingType = checker.getTypeAtLocation(node.parent.expression);
            suggestion = checker.getSuggestionForNonexistentProperty(node as Identifier, containingType);
        }
        else if (isImportSpecifier(node.parent) && node.parent.name === node) {
            Debug.assert(node.kind === SyntaxKind.Identifier);
            const importDeclaration = findAncestor(node, isImportDeclaration)!;
            const resolvedSourceFile = getResolvedSourceFileFromImportDeclaration(sourceFile, context, importDeclaration);
            if (resolvedSourceFile && resolvedSourceFile.symbol) {
                suggestion = checker.getSuggestionForNonexistentExport(node as Identifier, resolvedSourceFile.symbol);
            }
        }
        else {
            const meaning = getMeaningFromLocation(node);
            const name = getTextOfNode(node);
            Debug.assert(name !== undefined, "name should be defined");
            suggestion = checker.getSuggestionForNonexistentSymbol(node, name, convertSemanticMeaningToSymbolFlags(meaning));
        }

        return suggestion === undefined ? undefined : { node, suggestion };
    }

    function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, node: Node, suggestion: string, target: ScriptTarget) {
        if (!isIdentifierText(suggestion, target) && isPropertyAccessExpression(node.parent)) {
            changes.replaceNode(sourceFile, node.parent, createElementAccess(node.parent.expression, createLiteral(suggestion)));
        }
        else {
            changes.replaceNode(sourceFile, node, createIdentifier(suggestion));
        }
    }

    function convertSemanticMeaningToSymbolFlags(meaning: SemanticMeaning): SymbolFlags {
        let flags = 0;
        if (meaning & SemanticMeaning.Namespace) {
            flags |= SymbolFlags.Namespace;
        }
        if (meaning & SemanticMeaning.Type) {
            flags |= SymbolFlags.Type;
        }
        if (meaning & SemanticMeaning.Value) {
            flags |= SymbolFlags.Value;
        }
        return flags;
    }

    function getResolvedSourceFileFromImportDeclaration (sourceFile: SourceFile, context: CodeFixContextBase, importDeclaration: ImportDeclaration): SourceFile | undefined {
        if (!importDeclaration || !isStringLiteralLike(importDeclaration.moduleSpecifier)) return undefined;

        const resolvedModule = getResolvedModule(sourceFile, importDeclaration.moduleSpecifier.text);
        if (!resolvedModule) return undefined;

        return context.program.getSourceFile(resolvedModule.resolvedFileName);
    }
}
