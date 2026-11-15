/*
 * Bygger public/m3/material.js ud fra public/m3/komponenter.js.
 *
 * Kør med: npm run build:m3
 *
 * esbuild samler alle komponenterne i én fil. Bagefter sorterer scriptet
 * koden i sektioner (Knapper, Chips, ...) og skriver en indholdsfortegnelse
 * med linjenumre øverst, så filen er til at finde rundt i.
 *
 * Omsorteringen er sikker, fordi esbuild pakker hvert modul ind i en
 * init-funktion, der først kaldes til sidst i filen. Scriptet tjekker det
 * og stopper, hvis det ikke længere passer.
 */

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const ENTRY = "public/m3/komponenter.js";
const OUTFILE = path.join(ROOT, "public/m3/material.js");
const MW_VERSION = require("@material/web/package.json").version;
const MW_GITHUB = `https://github.com/material-components/material-web/blob/v${MW_VERSION}/`;

// Sektionerne i den rækkefølge de står i filen.
// `folders` er mapper i @material/web (eller pakkenavne for "lit").
const SECTIONS = [
    {
        title: "Fundament: Lit og tslib",
        about: "Lit er biblioteket alle Material-komponenterne er bygget på (web components, skabeloner, reaktive egenskaber).",
        folders: ["lit"],
    },
    {
        title: "Fælles hjælpekode",
        about: "Intern kode som flere komponenter deler (formularer, animationer, tastaturstyring osv.).",
        folders: ["internal", "labs/behaviors"],
    },
    {
        title: "Effekter: elevation, fokusring og ripple",
        about: "Skygger, fokusringen ved tastaturbrug og bølgeeffekten ved klik. Bruges inde i næsten alle andre komponenter.",
        folders: ["elevation", "focus", "ripple"],
    },
    { title: "Knapper og FAB", about: "", folders: ["button", "fab"] },
    { title: "Ikonknapper", about: "", folders: ["iconbutton"] },
    { title: "Segmenterede knapper (labs)", about: "", folders: ["labs/segmentedbutton", "labs/segmentedbuttonset"] },
    { title: "Chips", about: "", folders: ["chips"] },
    {
        title: "Formularfelter: tekstfelt og select",
        about: "field er rammen omkring felterne. menu er den liste der folder ud, når man åbner en select.",
        folders: ["field", "textfield", "menu", "select"],
    },
    { title: "Lister og divider", about: "labs/item er layoutet inde i hver listerække.", folders: ["labs/item", "list", "divider"] },
    { title: "Dialog og kort (kort er labs)", about: "", folders: ["dialog", "labs/card"] },
    { title: "Kontakter (switch)", about: "", folders: ["switch"] },
    { title: "Ikon", about: "", folders: ["icon"] },
];

const RULE = "=".repeat(78);

// "node_modules/@material/web/labs/card/x.js" -> "labs/card", "node_modules/lit-html/x.js" -> "lit"
function folderOf(modulePath) {
    const rest = modulePath.replace(/^node_modules\//, "");
    const material = rest.match(/^@material\/web\/((?:labs\/)?[^/]+)\//);
    if (material) return material[1];
    if (/^(tslib|lit|lit-html|lit-element|@lit\/[^/]+|@lit-labs\/[^/]+)\//.test(rest)) return "lit";
    return null;
}

// GitHub-link til kildefilen. De genererede *.cssresult.js-filer laves ud fra
// scss, så de linker til mappen i stedet.
function githubLink(modulePath) {
    const file = modulePath.replace(/^node_modules\/@material\/web\//, "");
    if (file === modulePath) return null;
    if (file.endsWith(".cssresult.js")) return MW_GITHUB.replace("/blob/", "/tree/") + path.posix.dirname(file);
    return MW_GITHUB + file.replace(/\.js$/, ".ts");
}

function splitBundle(code) {
    const lines = code.split("\n");
    const preamble = [];
    const modules = [];
    let entry = null;
    let current = null;

    for (const line of lines) {
        const header = line.match(/^\/\/ (node_modules\/\S+|public\/\S+)$/);
        if (header) {
            current = { path: header[1], lines: [] };
            if (header[1].startsWith("public/")) entry = current;
            else modules.push(current);
            continue;
        }
        (current ? current.lines : preamble).push(line);
    }

    for (const module of modules) {
        if (!module.lines.some((line) => / = __esm\(\{$/.test(line))) {
            throw new Error(`${module.path} er ikke pakket ind i __esm(), så koden kan ikke omsorteres sikkert.`);
        }
    }
    if (!entry) throw new Error(`Fandt ikke ${ENTRY} i bundlet.`);
    return { preamble, modules, entry };
}

// Elementer som modulet registrerer. Moduler i internal/ bruger kun
// tag-navne i @query(...), så de tælles ikke med.
function tagsIn(module) {
    if (module.path.includes("/internal/")) return [];
    return [...module.lines.join("\n").matchAll(/__decorate\(\[\s*\w+\("(md-[a-z-]+)"\)/g)].map((match) => match[1]);
}

function sectionHeader(number, section, tags) {
    const out = ["", `// ${RULE}`, `// SEKTION ${number}: ${section.title}`];
    if (section.about) out.push(`// ${section.about}`);
    if (tags.length) out.push(`// Elementer: ${tags.map((tag) => `<${tag}>`).join(" ")}`);
    out.push(`// ${RULE}`, "");
    return out;
}

function moduleHeader(module) {
    const name = module.path.replace(/^node_modules\//, "");
    const link = githubLink(module.path);
    return link ? [`// --- ${name}`, `// --- ${link}`] : [`// --- ${name}`];
}

function render({ preamble, modules, entry }) {
    const unknown = modules.filter((module) => !SECTIONS.some((s) => s.folders.includes(folderOf(module.path))));
    if (unknown.length) {
        throw new Error(
            "Disse moduler hører ikke til nogen sektion. Tilføj deres mappe til SECTIONS i scripts/build-m3.js:\n  " +
                unknown.map((module) => module.path).join("\n  ")
        );
    }

    // Brødteksten bygges først, så linjenumrene til indholdsfortegnelsen kan regnes ud.
    const body = [...preamble];
    const toc = [];
    SECTIONS.forEach((section, index) => {
        const members = modules.filter((module) => section.folders.includes(folderOf(module.path)));
        const tags = members.flatMap((module) => tagsIn(module));
        const entryInToc = { title: `${index + 1}. ${section.title}`, index: body.length + 2, tags: [] };
        body.push(...sectionHeader(index + 1, section, tags));
        for (const module of members) {
            for (const tag of tagsIn(module)) entryInToc.tags.push({ tag, index: body.length });
            body.push(...moduleHeader(module), ...module.lines);
        }
        toc.push(entryInToc);
    });
    toc.push({ title: `${SECTIONS.length + 1}. Start: registrerer komponenterne`, index: body.length + 2, tags: [] });
    body.push(
        "",
        `// ${RULE}`,
        `// SEKTION ${SECTIONS.length + 1}: Start`,
        `// Svarer til ${ENTRY}. Kalder init-funktionerne ovenfor, som registrerer elementerne.`,
        `// ${RULE}`,
        "",
        ...entry.lines
    );

    const tocCount = toc.reduce((count, entryInToc) => count + 1 + entryInToc.tags.length, 0);
    const headLength = fileHeader([]).length + tocCount;
    const fileLine = (index) => headLength + index + 1;
    const tocLines = toc.flatMap((entryInToc) => [
        ` *   ${entryInToc.title} (linje ${fileLine(entryInToc.index)})`,
        ...entryInToc.tags.map(({ tag, index }) => ` *       <${tag}> (linje ${fileLine(index)})`),
    ]);
    return [...fileHeader(tocLines), ...body].join("\n");
}

function fileHeader(tocLines) {
    return [
        "/*",
        ` * MATERIAL 3-KOMPONENTER (@material/web ${MW_VERSION})`,
        " *",
        " * GENERERET FIL: rediger den ikke, den overskrives ved næste build.",
        ` * Ret i ${ENTRY} og kør: npm run build:m3`,
        " * Overblik med links til hver komponent: public/m3/README.md",
        " *",
        " * Sådan finder du rundt:",
        ' *   - Søg efter "SEKTION 4" for at hoppe til en sektion.',
        ' *   - Søg efter et tag, fx "md-filled-button", for at finde komponenten.',
        ' *   - Hvert modul starter med "// --- <filnavn>" og et link til kildekoden på GitHub.',
        " *",
        " * Indhold (linjenummer i parentes):",
        ...tocLines,
        " *",
        " * Licenser: @material/web (c) Google LLC, Apache-2.0. Lit (c) Google LLC, BSD-3-Clause.",
        " * tslib (c) Microsoft, 0BSD.",
        " */",
    ];
}

async function main() {
    const result = await esbuild.build({
        absWorkingDir: ROOT,
        entryPoints: [ENTRY],
        bundle: true,
        format: "esm",
        legalComments: "none",
        charset: "utf8",
        write: false,
    });
    const output = render(splitBundle(result.outputFiles[0].text));
    fs.writeFileSync(OUTFILE, output);
    const lineCount = output.split("\n").length;
    console.log(`Skrev ${path.relative(ROOT, OUTFILE)} (${lineCount} linjer, ${Math.round(output.length / 1024)} KB)`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
