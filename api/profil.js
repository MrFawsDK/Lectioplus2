// Studiekort og profilbillede fra Lectio.
//
// Lectios studiekort ligger på digitaltStudiekort.aspx (set i BetterLectios kode, lib/profil-parser.ts):
//   #s_m_Content_Content_StudentName      elevens navn
//   #s_m_Content_Content_SchoolName       skolen
//   #s_m_Content_Content_StudentBirthday  fødselsdag
//   #s_m_Content_Content_StudPic          elevens foto (i god kvalitet - det er det samme foto, som står på studiekortet)
//   #s_m_Content_Content_LectioCR         "© Lectio d. 16/11-2026 00:27"
//
// Fotoet ligger bag elevens Lectio-login, så serveren henter det med cookien og sender det videre til browseren.
// QR-koden på studiekortet henter vi ikke: den indeholder elevens login-oplysninger.

const cheerio = require("cheerio");
const { getPage, clean, LECTIO } = require("./lectio");

// Id'er har et præfiks i Lectios HTML, så vi matcher på slutningen
const byId = ($, name) => $(`[id$='Content_Content_${name}']`).first();

async function readStudyCard(user) {
    const $ = cheerio.load(await getPage(user, "digitaltStudiekort.aspx"));
    const src = byId($, "StudPic").attr("src");

    return {
        name: clean(byId($, "StudentName").text()),
        school: clean(byId($, "SchoolName").text()),
        birthday: clean(byId($, "StudentBirthday").text()),
        timestamp: clean(byId($, "LectioCR").text()),
        photoSrc: src ? new URL(src, `${LECTIO}/${user.schoolCode}/`) : null
    };
}

async function getStudyCard(user) {
    const { photoSrc, ...card } = await readStudyCard(user);
    return { ...card, hasPhoto: Boolean(photoSrc) };
}

// Fotoet fra studiekortet. Findes det ikke, bruges den lille miniature fra Lectios sidehoved.
async function findPicture(user) {
    const card = await readStudyCard(user).catch(() => null);
    if (card?.photoSrc) return card.photoSrc;

    const $ = cheerio.load(await getPage(user, "forside.aspx"));
    const src = $("img[id$='picctrlthumbimage']").attr("src");
    if (!src) return null;

    const url = new URL(src, `${LECTIO}/${user.schoolCode}/`);
    url.searchParams.set("fullsize", "1");
    return url;
}

async function getProfileImage(user) {
    const url = await findPicture(user);

    // Kun billeder fra Lectio selv
    if (!url || url.hostname !== "www.lectio.dk") return null;

    const small = new URL(url);
    small.searchParams.delete("fullsize");

    for (const candidate of [url, small]) {
        const response = await fetch(candidate, { headers: { Cookie: user.cookie }, redirect: "manual" });
        const type = response.headers.get("content-type") ?? "";
        if (response.ok && type.startsWith("image/")) return { type, buffer: Buffer.from(await response.arrayBuffer()) };
    }

    return null;
}

module.exports = { getProfileImage, getStudyCard };
