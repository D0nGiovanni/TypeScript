/* @internal */
namespace ts.refactor.addB {
    const refactorName = "Kitty enchantment";
    const refactorDescription = Diagnostics.Kitty_enchantment.message;
    const invokeName = "Invoke kitty";
    const vanishName = "Vanish kitty";
    const invokeDescription = Diagnostics.Invoke_kitty.message;
    const vanishDescription = Diagnostics.Vanish_kitty.message;
    registerRefactor(refactorName, { getEditsForAction, getAvailableActions });

    interface Info{
        fun: FunctionDeclaration;
        bodyEmpty: Boolean;
    }

    function getAvailableActions(context: RefactorContext): ApplicableRefactorInfo[] | undefined {
        const { file, startPosition } = context;
        const info = isApplicable(file, startPosition);
        if (!info) return undefined;

        return [{
            name: refactorName,
            description: refactorDescription,
            actions: [
                    info.bodyEmpty ? 
                    {
                        name: invokeName,
                        description: invokeDescription
                    }:
                    {
                        name: vanishName,
                        description: vanishDescription
                    }
            ]
        }];
    }

    function getEditsForAction(context: RefactorContext, actionName: string): RefactorEditInfo | undefined {
        const { file, startPosition } = context;
        const info = isApplicable(file, startPosition);
        if (!info) return undefined;

        const {fun} = info;
        let newFun: FunctionDeclaration = {...fun};

        if (actionName == invokeName){            
            newFun.type = createKeywordTypeNode(SyntaxKind.StringKeyword);
            const secretStr = createStringLiteral("	      _                        \n	      \`*-.                    \n	       )  _`-.                 \n	      .  : `. .                \n	      : _   '  \               \n	      ; *` _.   `*-._          \n	      `-.-'          `-.       \n		;       `       `.     \n		:.       .        \    \n		. \  .   :   .-'   .   \n		'  `+.;  ;  '      :   \n		:  '  |    ;       ;-. \n		; '   : :`-:     _.`* ;\n	[bug] .*' /  .*' ; .*`- +'  `*'\n	     `*-*   `*-*  `*-*'        \n")
            const returnStatement = createReturn(secretStr);
            newFun.body = createBlock([returnStatement],true);;
        }
        else if (actionName == vanishName){
            newFun.type = createKeywordTypeNode(SyntaxKind.VoidKeyword);
            newFun.body = createBlock([],false);
        }  
        else {
            Debug.fail("invalid action");
        }

        const edits = textChanges.ChangeTracker.with(context, t => t.replaceNode(file, fun, newFun));
        return { renameFilename: undefined, renameLocation: undefined, edits };
    }

    function isApplicable(file: SourceFile, startPosition: number): Info | undefined{
        const node = getTokenAtPosition(file, startPosition);
        const maybeFun = getContainingFunction(node);
        
        if(!maybeFun || !isFunctionDeclaration(maybeFun) || maybeFun.name == undefined || !maybeFun.name.text.startsWith("cat") ) return undefined;

        let empty = (maybeFun.body == undefined ||  maybeFun.body.statements.length == 0) 
        
        return {
            fun: maybeFun,
            bodyEmpty: empty,
        }
    }
}
