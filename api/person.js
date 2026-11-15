// Andre elever og lærere: navn, klasse/hold og billede, som man ser dem på Lectios "contextcard"
// (set i BetterLectios kode, _informationer.py -> fåBruger):
//   contextcard/contextcard.aspx?lectiocontextcard=S123
//   Første <span>:  "Elev - Anna Hansen" / "Lærer - Anders Dahl"
//   <img src="...GetImage.aspx?pictureid=123">
//   table.textTop:  eleven: 2. celle er stamklassen; læreren: links til holdene (holdelementid=...)

const cheerio = require("cheerio");
const { getPage, clean, LECTIO } = require("./lectio");
const { fetchImage } = require("./profil");

const PERSON = /^[ST]\d+$/;

async function readCard(user, id) {
    const $ = cheerio.load(await getPage(user, `contextcard/contextcard.aspx?lectiocontextcard=${id}`, { partial: true }));

    const title = clean($("span").first().text());
    if (!title) {
        const error = new Error("Kunne ikke finde personen i Lectio");
        error.expose = true;
        throw error;
    }

    const [kindText, ...rest] = title.split(" - ");
    const pictureId = ($("img").first().attr("src") ?? "").match(/pictureid=(\d+)/)?.[1] ?? null;

    const person = {
        id,
        name: rest.join(" - ") || title,
        kind: id.startsWith("T") ? "teacher" : "student",
        label: clean(kindText),
        pictureId,
        className: "",
        teams: []
    };

    const table = $("table.textTop").first();

    if (person.kind === "teacher") {
        table.find("a").each((_, link) => {
            const teamId = ($(link).attr("href") ?? "").match(/holdelementid=(\d+)/)?.[1];
            if (teamId) person.teams.push({ id: `HE${teamId}`, name: clean($(link).text()) });
        });
    } else {
        person.className = clean(table.find("td").eq(1).text());
    }

    return person;
}

async function getPerson(user, id) {
    const { pictureId, ...person } = await readCard(user, id);
    return { ...person, hasPhoto: Boolean(pictureId) };
}

async function getPersonImage(user, id) {
    const { pictureId } = await readCard(user, id);
    if (!pictureId) return null;

    const url = new URL(`${LECTIO}/${user.schoolCode}/GetImage.aspx`);
    url.searchParams.set("pictureid", pictureId);
    url.searchParams.set("fullsize", "1");
    return fetchImage(user, url);
}

module.exports = { getPerson, getPersonImage, PERSON };
