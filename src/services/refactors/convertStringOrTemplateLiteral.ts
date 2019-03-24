/* @internal */
namespace ts.refactor.convertStringOrTemplateLiteral {
    const refactorName = "Convert string concatenation or template literal";
    const toTemplateLiteralActionName = "Convert to template literal";
    const toStringConcatenationActionName = "Convert to string concatenation";

    const refactorDescription = getLocaleSpecificMessage(Diagnostics.Convert_string_concatenation_or_template_literal);
    const toTemplateLiteralDescription = getLocaleSpecificMessage(Diagnostics.Convert_to_template_literal);
    const toStringConcatenationDescription = getLocaleSpecificMessage(Diagnostics.Convert_to_string_concatenation);

    registerRefactor(refactorName, { getEditsForAction, getAvailableActions });

    function getAvailableActions(context: RefactorContext): ReadonlyArray<ApplicableRefactorInfo> {
        const { file, startPosition } = context;
        const node = getNodeOrParentOfParentheses(file, startPosition);
        const maybeBinary = getParentBinaryExpression(node);
        const actions: RefactorActionInfo[] = [];

        if ((isBinaryExpression(maybeBinary) || isStringLiteral(maybeBinary)) && isStringConcatenationValid(maybeBinary)) {
            actions.push({ name: toTemplateLiteralActionName, description: toTemplateLiteralDescription });
        }

        const templateLiteral = findAncestor(node, n => isTemplateLiteral(n));

        if (templateLiteral && !isTaggedTemplateExpression(templateLiteral.parent)) {
            actions.push({ name: toStringConcatenationActionName, description: toStringConcatenationDescription });
        }

        return [{ name: refactorName, description: refactorDescription, actions }];
    }

    function getNodeOrParentOfParentheses(file: SourceFile, startPosition: number) {
        const node = getTokenAtPosition(file, startPosition);
        if (isParenthesizedExpression(node.parent) && isBinaryExpression(node.parent.parent)) return node.parent.parent;
        return node;
    }

    function getEditsForAction(context: RefactorContext, actionName: string): RefactorEditInfo | undefined {
        const { file, startPosition } = context;
        const node = getNodeOrParentOfParentheses(file, startPosition);

        switch (actionName) {
            case toTemplateLiteralActionName:
                return { edits: getEditsForToTemplateLiteral(context, node) };

            case toStringConcatenationActionName:
                return { edits: getEditsForToStringConcatenation(context, node) };

            default:
                return Debug.fail("invalid action");
        }
    }

    function getEditsForToTemplateLiteral(context: RefactorContext, node: Node) {
        const maybeBinary = getParentBinaryExpression(node);
        const arrayOfNodes = transformTreeToArray(maybeBinary);
        const templateLiteral = nodesToTemplate(arrayOfNodes);
        return textChanges.ChangeTracker.with(context, t => t.replaceNode(context.file, maybeBinary, templateLiteral));
    }

    function getEditsForToStringConcatenation(context: RefactorContext, node: Node) {
        const templateLiteral = findAncestor(node, n => isTemplateLiteral(n))! as TemplateLiteral;

        if (isTemplateExpression(templateLiteral)) {
            const { head, templateSpans } = templateLiteral;
            const arrayOfNodes = templateSpans.map(templateSpanToExpressions)
                                              .reduce((accumulator, nextArray) => accumulator.concat(nextArray));

            if (head.text.length !== 0) arrayOfNodes.unshift(createStringLiteral(head.text));

            const binaryExpression = arrayToTree(arrayOfNodes);
            return textChanges.ChangeTracker.with(context, t => t.replaceNode(context.file, templateLiteral, binaryExpression));
        }
        else {
            const stringLiteral = createStringLiteral(templateLiteral.text);
            return textChanges.ChangeTracker.with(context, t => t.replaceNode(context.file, node, stringLiteral));
        }
    }

    function templateSpanToExpressions(templateSpan: TemplateSpan): Expression[] {
        const { expression, literal } = templateSpan;
        const text = literal.text;
        return text.length === 0 ? [expression] : [expression, createStringLiteral(text)];
    }

    function isNotEqualsOperator(node: BinaryExpression) {
        return node.operatorToken.kind !== SyntaxKind.EqualsToken;
    }

    function getParentBinaryExpression(expr: Node) {
        while (isBinaryExpression(expr.parent) && isNotEqualsOperator(expr.parent)) {
            expr = expr.parent;
        }
        return expr;
    }

    function arrayToTree(nodes: ReadonlyArray<Expression>, accumulator?: BinaryExpression): BinaryExpression {
        if (nodes.length === 0) return accumulator!;

        if (!accumulator) {
            const left = nodes[0];
            const right = nodes[1];

            const binary = createBinary(left, SyntaxKind.PlusToken, right);
            return arrayToTree(nodes.slice(2), binary);
        }

        const right = nodes[0];
        const binary = createBinary(accumulator, SyntaxKind.PlusToken, right);
        return arrayToTree(nodes.slice(1), binary);
    }

    function isStringConcatenationValid(node: Node): boolean {
        const { containsString, areOperatorsValid } = treeToArray(node);
        return containsString && areOperatorsValid;
    }

    function transformTreeToArray(node: Node): ReadonlyArray<Expression> {
        return treeToArray(node).nodes;
    }

    function treeToArray(node: Node): { nodes: ReadonlyArray<Expression>, containsString: boolean, areOperatorsValid: boolean} {
        if (isBinaryExpression(node)) {
            const { nodes: leftNodes, containsString: leftHasString, areOperatorsValid: leftOperatorValid } = treeToArray(node.left);
            const { nodes: rightNodes, containsString: rightHasString, areOperatorsValid: rightOperatorValid } = treeToArray(node.right);

            if (!leftHasString && !rightHasString) {
                return { nodes: [node], containsString: false, areOperatorsValid: true };
            }

            const currentOperatorValid = node.operatorToken.kind === SyntaxKind.PlusToken;
            const areOperatorsValid = leftOperatorValid && currentOperatorValid && rightOperatorValid;

            return { nodes: leftNodes.concat(rightNodes), containsString: true, areOperatorsValid };
        }

        return { nodes: [node as Expression], containsString: isStringLiteral(node), areOperatorsValid: true };
    }

    function concatConsecutiveString(index: number, nodes: ReadonlyArray<Expression>): [number, string] {
        let text = "";

        while (index < nodes.length && isStringLiteral(nodes[index])) {
            text = text + decodeRawString(nodes[index].getText());
            index++;
        }

        text = escapeText(text);
        return [index, text];
    }

    function nodesToTemplate(nodes: ReadonlyArray<Expression>) {
        const templateSpans: TemplateSpan[] = [];
        const [begin, headText] = concatConsecutiveString(0, nodes);
        const templateHead = createTemplateHead(headText);

        if (begin === nodes.length) return createNoSubstitutionTemplateLiteral(headText);

        for (let i = begin; i < nodes.length; i++) {
            const expression = isParenthesizedExpression(nodes[i]) ? (nodes[i] as ParenthesizedExpression).expression : nodes[i];
            const [newIndex, subsequentText] = concatConsecutiveString(i + 1, nodes);
            i = newIndex - 1;

            const templatePart = i === nodes.length - 1 ? createTemplateTail(subsequentText) : createTemplateMiddle(subsequentText);
            templateSpans.push(createTemplateSpan(expression, templatePart));
        }

        return createTemplateExpression(templateHead, templateSpans);
    }

    const octalToUnicode = (_match: string, grp: string) => String.fromCharCode(parseInt(grp, 8));

    function decodeRawString(content: string) {
        const outerQuotes = /["']((.|\s)*)["']/;
        const octalEscape = /\\((?:[1-7][0-7]{0,2}|[0-7]{2,3}))/g;

        return content.replace(outerQuotes, (_match, grp) => grp)
                      .replace(octalEscape, octalToUnicode);

    }

    function escapeText(content: string) {
        return content.replace("`", "\`")       // back-tick
                      .replace("${", "$\\{");  // placeholder alike beginning
    }

}

