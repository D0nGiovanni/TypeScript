/* @internal */
namespace ts.codefix {
    const fixId = "fixKittySpelling";
    const errorCodes = [
        Diagnostics.Property_0_does_not_exist_on_type_1_Did_you_mean_2.code
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

        const parent = node.parent;
        if (!isPropertyAccessExpression(parent)) return undefined;

        const changes = textChanges.ChangeTracker.with(context, t =>  t.replaceNode(sourceFile, parent, createElementAccess(parent.expression, createLiteral(suggestion)))  );
        return [createCodeFixAction("spelling", changes, [Diagnostics.Korrectify_to_0, suggestion], fixId, Diagnostics.Korrectify_all_detected_misspellings)];
    }
    
    function getAllCodeActions(context: CodeFixAllContext): CombinedCodeActions {
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const info = getInfo(diag.file, diag.start, context);

            if(info) {
                const node = info.node;
                const parent = node.parent;
                if (isPropertyAccessExpression(parent)){
                    changes.replaceNode(context.sourceFile, parent, createElementAccess(parent.expression, createLiteral(info.suggestion)))
                }
            }
        })
    }

    function getInfo(sourceFile: SourceFile, pos: number, context: CodeFixContextBase): { node: Node, suggestion: string } | undefined {
        const node = getTokenAtPosition(sourceFile, pos);
        const checker = context.program.getTypeChecker();

        let suggestion: string | undefined;
        if (isPropertyAccessExpression(node.parent) && node.parent.name === node) {
            Debug.assert(node.kind === SyntaxKind.Identifier);
            const containingType = checker.getTypeAtLocation(node.parent.expression);
            suggestion = checker.getSuggestionForNonexistentProperty(node as Identifier, containingType);
        }

        return suggestion === undefined ? undefined : { node, suggestion };
    }

}
