/// <reference path='fourslash.ts' />

//// function /*a*/catTheGreat()/*b*/: string {
////    return "meow";
//// }

goTo.select("a", "b");
edit.applyRefactor({
    refactorName: "Kitty enchantment",
    actionName: "Vanish kitty",
    actionDescription: "Vanish kitty",
    newContent: `function catTheGreat(): void { }`,
});
