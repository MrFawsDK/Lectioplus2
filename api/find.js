// "Find skema": alle elever, lærere, klasser, hold og lokaler på skolen - som i Lectio (FindSkemaAdv.aspx).
// Siden har en liste (select) pr. type, og hver mulighed har en værdi med et bogstav foran id'et:
//   S<id> elev, T<id> lærer, C<id> klasse, HE<id> hold, G<id> gruppe, R<id> lokale, RE<id> ressource
// (set i BetterLectios kode, _informationer.py og _skema.py). Med det id kan man hente personens skema (se getSchedule).

const cheerio = require("cheerio");
const { getPage, clean } = require("./lectio");

const ID = /^(?:S|T|C|HE|G|R|RE)\d+$/;
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map(); // skolekode -> { time, groups }

// Skolens liste er den samme for alle elever på skolen, så den hentes højst hvert 30. minut
async function getPeople(user) {
    const cached = cache.get(user.schoolCode);
    if (cached && Date.now() - cached.time < CACHE_MS) return { groups: cached.groups };

    const $ = cheerio.load(await getPage(user, "FindSkemaAdv.aspx"));
    const groups = [];

    $("select").each((_, select) => {
        const items = $(select).find("option").toArray()
            .map(option => ({ id: ($(option).attr("value") ?? "").trim(), name: clean($(option).text()) }))
            .filter(item => ID.test(item.id) && item.name);

        if (!items.length) return;

        const section = $(select).closest("section");
        const title = clean(section.find(".islandHeader").first().text()) || clean($(select).attr("aria-label") ?? "") || "Andre";

        // Samme overskrift to gange (fx flere lister): samles i én gruppe
        const existing = groups.find(group => group.title === title);
        if (existing) existing.items.push(...items);
        else groups.push({ title, items });
    });

    if (!groups.length) {
        const error = new Error(`Kunne ikke læse listen over elever og lærere fra Lectio (${clean($("title").text()) || "ingen titel"}; ${$("select").length} lister)`);
        error.expose = true;
        throw error;
    }

    cache.set(user.schoolCode, { time: Date.now(), groups });
    return { groups };
}

module.exports = { getPeople, ID };
