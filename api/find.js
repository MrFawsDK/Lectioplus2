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
const db = require("./db");

const ID = /^(?:S|T|C|HE|H|G|R|RE)\d+$/;
const CACHE_MS = 30 * 60 * 1000;   // efter så lang tid hentes listen på ny i baggrunden
const PARALLEL = 8;               // sider hentet samtidig (flere ad gangen gør det hurtigere)
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Æ", "Ø", "Å", "?"];
const cache = new Map();    // skolekode -> { time, groups }  (hukommelse)
const loading = new Map();  // skolekode -> igangværende hentning, så den kun sker én gang ad gangen

// Listen gemmes også i databasen, så den overlever en genstart og er klar med det samme næste gang
db.exec(`
    CREATE TABLE IF NOT EXISTS find_cache (
        school     TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
`);

function readCache(school) {
    if (cache.has(school)) return cache.get(school);

    const row = db.prepare("SELECT data, updated_at FROM find_cache WHERE school = ?").get(school);
    if (!row) return null;

    try {
        const entry = { time: row.updated_at, groups: JSON.parse(row.data) };
        cache.set(school, entry);
        return entry;
    } catch {
        return null;
    }
}

function writeCache(school, groups) {
    const entry = { time: Date.now(), groups };
    cache.set(school, entry);
    db.prepare(`INSERT INTO find_cache (school, data, updated_at) VALUES (?, ?, ?)
                ON CONFLICT (school) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
        .run(school, JSON.stringify(groups), entry.time);
}

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
async function inBatches(tasks, size = PARALLEL) {
    const results = [];
    for (let i = 0; i < tasks.length; i += size) {
        results.push(...await Promise.all(tasks.slice(i, i + size).map(task => task())));
    }
    return results;
}

// Henter og læser én side. En side der ikke kan hentes (fx en type skolen ikke bruger) giver en tom liste og en note til fejlfinding.
// Kun den første side (lærerne) må stoppe alt, hvis eleven ikke er logget ind - ellers tæller en enkelt afvist side ikke.
async function readPage(user, page, label, notes, { required = false } = {}) {
    try {
        const html = await getPage(user, page);
        const items = readList(html);

        if (items.length) {
            notes.push(`${label}: ${items.length}`);
        } else {
            const $ = cheerio.load(html);
            notes.push(`${label}: 0 (${clean($("title").text()).slice(0, 40) || "ingen titel"}; ${$("ul.ls-columnlist").length} lister, ${$("a").length} links)`);
        }

        return items;
    } catch (error) {
        if (required && error instanceof NotLoggedInError) throw error;
        notes.push(`${label}: ${error instanceof NotLoggedInError ? "afvist af Lectio" : error.message}`);
        return [];
    }
}

// Skolens lister er de samme for alle på skolen, så de hentes højst hvert 30. minut
async function build(user) {
    const notes = [];

    // Lærerne først: afvises den, er eleven ikke logget ind
    const teachers = await readPage(user, "FindSkema.aspx?type=laerer", "lærere", notes, { required: true });

    const [classes, teams, rooms] = await Promise.all([
        readPage(user, "FindSkema.aspx?type=stamklasse", "klasser", notes),
        readPage(user, "FindSkema.aspx?type=hold", "hold", notes),
        readPage(user, "FindSkema.aspx?type=lokale", "lokaler", notes)
    ]);

    const students = (await inBatches(LETTERS.map(letter => () =>
        readPage(user, `FindSkema.aspx?type=elev&forbogstav=${encodeURIComponent(letter)}`, `elever ${letter}`, notes)
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
        console.error("Find skema gav ingen personer:", notes);
        const error = new Error(`Kunne ikke læse listen over elever og lærere fra Lectio. ${notes.slice(0, 5).join(" | ")}`);
        error.expose = true;
        throw error;
    }

    // Ingen elever, men lærere: send alligevel det vi har, og skriv hvad der skete i serverens log
    if (!groups.some(group => group.title === "Elever")) console.error("Ingen elever fundet:", notes);

    writeCache(user.schoolCode, groups);
    return { groups, notes };
}

// Hentes kun én gang ad gangen pr. skole (flere der beder om listen samtidig venter på den samme hentning)
function refresh(user) {
    if (!loading.has(user.schoolCode)) {
        loading.set(user.schoolCode, build(user).finally(() => loading.delete(user.schoolCode)));
    }
    return loading.get(user.schoolCode);
}

// Listen er den samme for alle på skolen. Er den gemt, får man den med det samme (er den over 30 minutter gammel, hentes en ny
// i baggrunden til næste gang). Første gang skal den hentes fra Lectio, og det tager nogle sekunder.
async function getPeople(user, { fresh = false } = {}) {
    if (fresh) return refresh(user);

    const cached = readCache(user.schoolCode);
    if (cached) {
        if (Date.now() - cached.time > CACHE_MS) refresh(user).catch(error => console.error("Opdatering af Find skema:", error.message));
        return { groups: cached.groups };
    }

    return refresh(user);
}

// Henter listen i baggrunden, fx lige efter login, så den er klar, når man åbner Find
function prefetch(user) {
    if (readCache(user.schoolCode)) return;
    refresh(user).catch(error => console.error("Forhåndshentning af Find skema:", error.message));
}

module.exports = { getPeople, prefetch, ID };
