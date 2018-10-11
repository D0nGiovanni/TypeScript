/// <reference path='fourslash.ts' />

//// function /*a*/catTheGreat()/*b*/: void { }

goTo.select("a", "b");
edit.applyRefactor({
    refactorName: "Kitty enchantment",
    actionName: "Invoke kitty",
    actionDescription: "Invoke kitty",
    newContent: `function catTheGreat(): string {
    return "Meow";
}`,
});
