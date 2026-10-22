// Lille bibliotek af farver og ikoner til tags.
// Ikonerne er navne fra Material Symbols (samme ikonsæt som M3):
// https://m3.material.io/styles/icons/overview  -  https://fonts.google.com/icons

// Farverne følger M3's opbygning: main (tekst/ikon), container (baggrund), on (tekst på baggrund)
// https://m3.material.io/styles/color/roles
const TAG_COLORS = {
    red:    { name: "Rød",    main: "#b3261e", container: "#f9dedc", on: "#410e0b" },
    orange: { name: "Orange", main: "#8b5000", container: "#ffdcbe", on: "#2c1600" },
    yellow: { name: "Gul",    main: "#6d5e00", container: "#f8e287", on: "#211b00" },
    green:  { name: "Grøn",   main: "#386a20", container: "#b8f397", on: "#042100" },
    teal:   { name: "Petrol", main: "#006a6a", container: "#9cf1f0", on: "#002020" },
    blue:   { name: "Blå",    main: "#1a6bb5", container: "#d6e3ff", on: "#001b3e" },
    purple: { name: "Lilla",  main: "#6750a4", container: "#eaddff", on: "#21005d" },
    pink:   { name: "Pink",   main: "#984061", container: "#ffd9e2", on: "#3e001d" },
    grey:   { name: "Grå",    main: "#5e5e62", container: "#e3e2e6", on: "#1b1b1f" }
};

const TAG_ICONS = [
    "label",
    "star",
    "priority_high",
    "flag",
    "bookmark",
    "lightbulb",
    "school",
    "science",
    "calculate",
    "functions",
    "menu_book",
    "edit_note",
    "build",
    "movie",
    "quiz",
    "event",
    "favorite",
    "warning",
    "check_circle",
    "groups"
];

const DEFAULT_TAG_COLOR = "blue";
const DEFAULT_TAG_ICON = "label";

// CSS-variabler til et tag, bruges i style="..."
function tagStyle(tag) {
    const color = TAG_COLORS[tag.color] ?? TAG_COLORS[DEFAULT_TAG_COLOR];
    return `--tag-main: ${color.main}; --tag-container: ${color.container}; --tag-on: ${color.on};`;
}
