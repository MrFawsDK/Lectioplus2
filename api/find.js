// Alle elever, lærere, klasser, hold og lokaler på skolen - som i Lectios "Find skema" (FindSkema.aspx).
//
// Opbygningen er set i Lectio-sider, som BetterLectio har gemt (github.com/jonbng/betterlectio, lectio-html-2026-09-15):
//   FindSkema.aspx?type=laerer                 alle lærere på én side
//   FindSkema.aspx?type=elev&forbogstav=B      eleverne, der begynder med bogstavet (A-Z, Æ, Ø, Å og ? for andre tegn)
//   FindSkema.aspx?type=lokale                 lokaler
//   (klasser og hold: type=stamklasse og type=hold)
// Alle sider har samme liste:  <ul class="ls-columnlist"><li><a href="SkemaNy.aspx?elevid=123">Navn (klasse)</a></li>...
//
// Vores id'er har et bogstav foran, så de kan bruges i /api/skema?id=...:
//   S elev, T lærer, C klasse, H hold, HE holdelement, G gruppe, R lokale, RE ressource

const cheerio = require("cheerio");
const { getPage, clean, NotLoggedInError } = require("./lectio");

const ID = /^(?:S|T|C|HE|H|G|R|RE)\d+$/;
const CACHE_MS = 30 * 60 * 1000;
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Æ", "Ø", "Å", "?"];
const cache = new Map(); // skolekode -> { time, groups }

// id fra linkets adresse: SkemaNy.aspx?elevid=123 -> S123
function idFromHref(href) {
    const url = new URL(href, "https://www.lectio.dk/");
    const param = name => url.searchParams.get(name);

    if (param("elevid")) return `S${param("elevid")}`;
    if (param("laererid")) return `T${param("laererid")}`;
    if (param("klasseid")) return `C${param("klasseid")}`;
    if (param("holdelementid")) return `HE${param("holdelementid")}`;
    if (param("holdid")) return `H${param("holdid")}`;
    if (param("type") === "lokale" && param("id")) return `R${param("id")}`;
    if (param("type") === "ressource" && param("id")) return `RE${param("id")}`;
    if (param("lokaleid")) return `R${param("lokaleid")}`;
    return null;
}

// Alle links i listen på en FindSkema-side
function readList(html) {
    const $ = cheerio.load(html);
    const items = [];

    $("ul.ls-columnlist li a[href]").each((_, link) => {
        const id = idFromHref($(link).attr("href"));
        if (!id || !ID.test(id)) return;

        // Lokaler har en kort kode foran navnet: <span class="findskema-symbol">IN 2.1</span>Navn
        const symbol = clean($(link).find(".findskema-symbol").text());
        const rest = clean($(link).clone().find(".findskema-symbol").remove().end().text());
        const name = [symbol, rest].filter(Boolean).join(" ");

        if (name) items.push({ id, name });
    });

    return items;
}

// Henter mange sider ad gangen uden at overbelaste Lectio (6 ad gangen)
async function inBatches(tasks, size = 6) {
    const results = [];
    for (let i = 0; i < tasks.length; i += size) {
        results.push(...await Promise.all(tasks.slice(i, i + size).map(task => task())));
    }
    return results;
}

// En side der ikke kan hentes (fx en type skolen ikke bruger) giver en tom liste - kun manglende login stopper alt
const safe = async load => {
    try {
        return await load();
    } catch (error) {
        if (error instanceof NotLoggedInError) throw error;
        console.error(error.message);
        return [];
    }
};

// Skolens lister er de samme for alle på skolen, så de hentes højst hvert 30. minut
async function getPeople(user) {
    const cached = cache.get(user.schoolCode);
    if (cached && Date.now() - cached.time < CACHE_MS) return { groups: cached.groups };

    const list = type => safe(async () => readList(await getPage(user, `FindSkema.aspx?type=${type}`)));

    const [teachers, classes, teams, rooms] = await Promise.all([list("laerer"), list("stamklasse"), list("hold"), list("lokale")]);

    const students = (await inBatches(LETTERS.map(letter => () =>
        safe(async () => readList(await getPage(user, `FindSkema.aspx?type=elev&forbogstav=${encodeURIComponent(letter)}`)))
    ))).flat();

    // Samme person kan stå under flere bogstaver (fx Aa/Å) - hver kun én gang
    const unique = items => [...new Map(items.map(item => [item.id, item])).values()];

    const groups = [
        { title: "Elever", items: unique(students) },
        { title: "Lærere", items: unique(teachers) },
        { title: "Klasser", items: unique(classes) },
        { title: "Hold", items: unique(teams) },
        { title: "Lokaler", items: unique(rooms) }
    ].filter(group => group.items.length);

    if (!groups.some(group => group.title === "Elever" || group.title === "Lærere")) {
        const error = new Error("Kunne ikke læse listen over elever og lærere fra Lectio (Find skema gav ingen personer)");
        error.expose = true;
        throw error;
    }

    cache.set(user.schoolCode, { time: Date.now(), groups });
    return { groups };
}

module.exports = { getPeople, ID };
