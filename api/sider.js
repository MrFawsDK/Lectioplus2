// Bøger, spørgeskemaer og SPS fra Lectio.
//
// Vi har ikke set de tre siders HTML, så de læses generisk: alle tabeller på siden sendes videre som overskrifter og rækker
// (med linket i rækken, hvis der er et), og siden vises ellers som tekst. Adressen til Bøger og SPS findes i Lectios menu
// på forsiden, så vi ikke skal gætte den. Spørgeskemaer har en kendt adresse (set i BetterLectios kode, _spørgeskema.py).

const cheerio = require("cheerio");
const { getPage, clean, LECTIO } = require("./lectio");

// Gør et link fra Lectio til en adresse, getPage kan hente: "/lectio/123/side.aspx?x=1" -> "side.aspx?x=1"
function toPage(user, href) {
    const prefix = `/lectio/${user.schoolCode}/`;
    const url = new URL(href, `${LECTIO}/${user.schoolCode}/`);
    return url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) + url.search : null;
}

// Finder et menupunkt på forsiden ud fra dets tekst, fx "Bøger"
async function findMenuPage(user, name) {
    const $ = cheerio.load(await getPage(user, "forside.aspx"));
    const wanted = name.toLowerCase();
    const seen = new Set();

    for (const link of $("a[href]").toArray()) {
        const text = clean($(link).text());
        if (text) seen.add(text);

        if (text.toLowerCase() === wanted) {
            const page = toPage(user, $(link).attr("href"));
            if (page) return page;
        }
    }

    const error = new Error(`Kunne ikke finde "${name}" i Lectios menu. Menuen indeholder: ${[...seen].slice(0, 25).join(", ")}`);
    error.expose = true;
    throw error;
}

// Alle tabeller på siden (uden indlejrede tabeller) som { headers, rows: [{ cells, href }] }
function readPage(user, html) {
    const $ = cheerio.load(html);
    const tables = [];

    $("table").each((_, table) => {
        if ($(table).find("table").length) return; // layout-tabel

        const rows = $(table).find("tr").toArray();
        const headRow = rows.find(row => $(row).children("th").length);
        const headers = headRow ? $(headRow).children("th").toArray().map(cell => clean($(cell).text())) : [];

        const body = rows.filter(row => row !== headRow && $(row).children("td").length).map(row => {
            const href = $(row).find("a[href]").first().attr("href");
            return {
                cells: $(row).children("td").toArray().map(cell => clean($(cell).text())),
                href: href && !href.startsWith("#") && !href.startsWith("javascript") ? new URL(href, `${LECTIO}/${user.schoolCode}/`).href : null
            };
        }).filter(row => row.cells.some(Boolean));

        if (body.length) tables.push({ headers, rows: body.slice(0, 300) });
    });

    // Står der ingen tabel, vises sidens tekst i stedet
    const main = $("[id$='Content_Content']").first();
    const text = tables.length ? "" : clean((main.length ? main : $("body")).text()).slice(0, 2000);

    return { title: clean($("title").text()), tables, text };
}

async function load(user, page) {
    return { ...readPage(user, await getPage(user, page)), url: `${LECTIO}/${user.schoolCode}/${page}` };
}

const getBooks = async user => load(user, await findMenuPage(user, "Bøger"));
const getSps = async user => load(user, await findMenuPage(user, "SPS"));

async function getSurveys(user) {
    const direct = `spoergeskema/spoergeskema_rapport.aspx?type=mine&elevid=${user.student.studentId}`;

    try {
        const result = await load(user, direct);
        if (result.tables.length) return result;
    } catch (error) {
        if (error.constructor.name !== "NotLoggedInError") throw error;
    }

    return load(user, await findMenuPage(user, "Spørgeskema"));
}

module.exports = { getBooks, getSps, getSurveys };
