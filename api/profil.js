// Profilbilledet fra Lectio. Billedet ligger bag elevens Lectio-login, så serveren henter det med cookien
// og sender det videre til browseren (som ikke kender cookien). Billedets adresse står som
// <img id="s_m_HeaderContent_picctrlthumbimage"> på Lectios sider (set i BetterLectios kode, _informationer.py).

const cheerio = require("cheerio");
const { getPage, LECTIO } = require("./lectio");

async function findPicture(user) {
    const pages = ["forside.aspx"];
    if (user.student?.studentId) pages.push(`SkemaNy.aspx?type=elev&elevid=${user.student.studentId}`);

    for (const page of pages) {
        const $ = cheerio.load(await getPage(user, page));
        const src = $("img[id$='picctrlthumbimage']").attr("src");
        if (src) return new URL(src, `${LECTIO}/${user.schoolCode}/`);
    }

    return null;
}

async function getProfileImage(user) {
    const url = await findPicture(user);

    // Kun billeder fra Lectio selv
    if (!url || url.hostname !== "www.lectio.dk") return null;

    const response = await fetch(url, { headers: { Cookie: user.cookie }, redirect: "manual" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;

    return { type, buffer: Buffer.from(await response.arrayBuffer()) };
}

module.exports = { getProfileImage };
