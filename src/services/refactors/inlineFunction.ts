/* @internal */
namespace ts.refactor.inlineFunction {
    const refactorName = "Inline function";
    const refactorDescription = getLocaleSpecificMessage(Diagnostics.Inline_function);

    const inlineHereActionName = "Inline here";
    const inlineAllActionName = "Inline all";

    const inlineHereActionDescription = getLocaleSpecificMessage(Diagnostics.Inline_here);
    const inlineAllActionDescription = getLocaleSpecificMessage(Diagnostics.Inline_all);


    registerRefactor(refactorName, { getEditsForAction, getAvailableActions });

    interface Info {
        readonly declaration: InlineableFunction;
        readonly usages: ReadonlyArray<CallExpression>;
        readonly selectedUsage: CallExpression | undefined;
    }

    function getAvailableActions(context: RefactorContext): ReadonlyArray<ApplicableRefactorInfo> {
        const { program, file, startPosition } = context;
        const info = getInfo(program, file, startPosition);
        if (!info) return emptyArray;
        const { selectedUsage } = info;
        const refactorInfo = {
            name: refactorName,
            description: refactorDescription,
            actions: [{
                name: inlineAllActionName,
                description: inlineAllActionDescription
            }]
        };
        if (selectedUsage) {
            refactorInfo.actions.push({
                name: inlineHereActionName,
                description: inlineHereActionDescription
            });
        }
        return [refactorInfo];
    }

    function getInfo(program: Program, file: SourceFile, startPosition: number): Info | undefined {
        const token = getTokenAtPosition(file, startPosition);
        const checker = program.getTypeChecker();
        isCallExpression(token);
        if (isIdentifier(token)) {
            if (isNameOfFunctionDeclaration(token)) {
                return createInfo(checker, <InlineableFunction>token.parent);
            }

            const call = token.parent;
            if (!isCallExpression(call)) return undefined;
            const symbol = checker.getSymbolAtLocation(token);
            if (!symbol) return undefined;
            const declaration = symbol.valueDeclaration;
            if (!isInlineableFunction(declaration)) return undefined;
            return createInfo(checker, declaration, call);
        }
        return undefined;
    }

    function createInfo(checker: TypeChecker, declaration: InlineableFunction, call?: CallExpression): Info | undefined {
        const usages = getReferencesInScope(
            getEnclosingBlockScopeContainer(declaration),
            declaration.name!,
            checker);
        return canInline(declaration, /* usages */) ? {
            declaration,
            usages,
            selectedUsage: call ? call : undefined
        } : undefined;
    }

    function getReferencesInScope(scope: Node, target: Node, checker: TypeChecker): ReadonlyArray<CallExpression> {
        const symbol = checker.getSymbolAtLocation(target);
        return inlineLocal.findDescendants(scope, n =>
            isCallExpression(n) &&
            checker.getSymbolAtLocation(n.expression) === symbol) as CallExpression[];
    }

    function canInline(declaration: InlineableFunction, /* usages: ReadonlyArray<CallExpression> */): boolean {
        let hasErrors = false;
        if (!declaration.body) hasErrors = true;
        if (containsProhibitedModifiers(declaration.modifiers)) hasErrors = true;
        return !hasErrors;
    }

    function containsProhibitedModifiers(modifiers?: NodeArray<Modifier>): boolean {
        return !!modifiers && !!modifiers.find(mod =>
            mod.kind === SyntaxKind.ExportKeyword ||
            mod.kind === SyntaxKind.PrivateKeyword);
    }

    function getEditsForAction(context: RefactorContext, actionName: string): RefactorEditInfo | undefined {
        const { file, program, startPosition } = context;
        const info = getInfo(program, file, startPosition);
        if (!info) return undefined;
        const { declaration, usages, selectedUsage } = info;

        switch (actionName) {
            case inlineAllActionName:
                return { edits: getInlineAllEdits(context, declaration, usages) };
            case inlineHereActionName:
                return { edits: getInlineHereEdits(context, declaration, usages, selectedUsage!) };
            default:
                return Debug.fail("invalid action");
        }
    }

    function getInlineAllEdits(
            context: RefactorContext,
            declaration: InlineableFunction,
            usages: ReadonlyArray<CallExpression>): FileTextChanges[] {
        const { file, program } = context;
        return textChanges.ChangeTracker.with(context, t => {
            forEach(usages, oldNode => {
                inlineAt(file, program.getTypeChecker(), t, oldNode, declaration);
            });
            t.delete(file, declaration);
        });
    }

    function getInlineHereEdits(context: RefactorContext,
            declaration: InlineableFunction,
            usages: ReadonlyArray<CallExpression>,
            selectedUsage: CallExpression): FileTextChanges[] {
        const { file, program } = context;
        return textChanges.ChangeTracker.with(context, t => {
            inlineAt(file, program.getTypeChecker(), t, selectedUsage, declaration);
            if (usages.length === 1) t.delete(file, declaration);
        });
    }

    function inlineAt(
            file: SourceFile,
            checker: TypeChecker,
            t: textChanges.ChangeTracker,
            targetNode: CallExpression,
            declaration: InlineableFunction) {
        const { parameters } = declaration;
        let body = getSynthesizedDeepClone(declaration.body)!;
        const statement = <Statement>findAncestor(targetNode, n => isStatement(n));
        const renameMap: Map<Identifier> = createMap();
        forEach(parameters, (p, i) => {
            // let name = `arg${i}`; // if parameter is object or array literal
            const oldName = p.name;
            if (isIdentifier(oldName)) {
                const symbol = checker.getSymbolAtLocation(oldName)!;
                checker.isSymbolAccessible(symbol, targetNode, 0, /* shouldComputeAliasesToMakeVisible */ false);
                const symbols = checker.getSymbolsInScope(targetNode, SymbolFlags.All);
                let name = oldName.text;
                let safeName = getSynthesizedClone(oldName);
                if (nameIsTaken(symbols, name, symbol)) {
                    name = getUniqueName(name, file);
                    safeName = createIdentifier(name);
                    renameMap.set(String(symbol.id), safeName);
                }
                const value = targetNode.arguments[i];
                const decl = createVariableDeclaration(safeName, /* type */ undefined, value);
                const declList = createVariableDeclarationList([decl], NodeFlags.Const);
                t.insertNodeBefore(file, statement, createVariableStatement(/* modifiers */ undefined, declList));
            }
        });
        body = getSynthesizedDeepCloneWithRenames(body, /* includeTrivia */ true, renameMap, checker);
        forEach(body.statements, st => {
            if (!isReturnStatement(st)) {
                t.insertNodeBefore(file, statement, st);
            }
        });
        const retExpr = forEachReturnStatement<Expression | undefined>(body, r => r.expression);
        if (retExpr) {
            const expression = inlineLocal.parenthesizeIfNecessary(targetNode, retExpr);
            t.replaceNode(file, targetNode, expression);
        }
    }

    type InlineableFunction = FunctionDeclaration | MethodDeclaration;

    function nameIsTaken(symbols: Symbol[], name: string, symbol: Symbol) {
        return forEach(symbols, s => s.name === name && s !== symbol ? s : undefined);
    }

    function isInlineableFunction(node: Node): node is InlineableFunction {
        return node.kind === SyntaxKind.FunctionDeclaration || node.kind === SyntaxKind.MethodDeclaration;
    }
}