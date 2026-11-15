// Lektier og studieplan fra Lectio.
// Opbygningen af siderne er set i BetterLectios kode (github.com/BetterLectio/betterLectio,
// apps/api/lectio/_lektier.py og _studieplan.py).

const cheerio = require("cheerio");
const { getPage, clean, readTooltip, LECTIO } = require("./lectio");

/* ---------- Lektier ---------- */

// material_lektieoversigt.aspx: en tabel med én række pr. modul. Anden celle har skemabrikken, tredje har lektierne
// (tekst og links adskilt af linjeskift).
async function getHomework(user) {
    const $ = cheerio.load(await getPage(user, `material_lektieoversigt.aspx?elevid=${user.student.studentId}`));
    const homework = [];

    $("tr").slice(1).each((_, row) => {
        const cells = $(row).children("td").toArray();
        if (cells.length < 3) return;

        const brick = $(cells[1]).find("a.s2skemabrik").first();
        const lesson = readTooltip(brick.attr("data-tooltip")) ?? {};

        const items = [];
        const lines = ($(cells[2]).html() ?? "").split(/<br\s*\/?>|&nbsp;| /i);

        for (const line of lines) {
            const part = cheerio.load(`<div>${line}</div>`);
            const text = clean(part("div").text());
            if (!text) continue;

            const href = part("a[href]").first().attr("href");
            items.push({ text, href: href ? new URL(href, "https://www.lectio.dk").href : null });
        }

        if (!items.length) return;

        homework.push({
            date: lesson.date ?? null,
            start: lesson.start ?? "",
            end: lesson.end ?? "",
            subject: lesson.teams?.length === 1 ? lesson.teams[0] : (lesson.title || lesson.teams?.join(", ") || clean($(cells[1]).text())),
            title: lesson.teams?.length === 1 ? lesson.title : "",
            teacher: lesson.teachers?.join(" ") ?? "",
            items
        });
    });

    return { homework };
}


/* ---------- Studieplan ---------- */

// studieplan.aspx?displaytype=ugeteksttabel: én kolonne (eller flere) pr. fag, og i dem forløb som <div class="phase">
// med en tooltip: "Titel: ...\nEstimat: ...\nPeriode: ...\n<beskrivelse>"
async function getStudyPlan(user) {
    const $ = cheerio.load(await getPage(user, `studieplan.aspx?displaytype=ugeteksttabel&elevid=${user.student.studentId}`));
    const table = $("table[id$='spUge_theTable']").first();

    const span = cell => Number($(cell).attr("colspan")) || 1;

    // Hvilke kolonner hører til hvilket fag (overskrifter: de første og sidste to er uge-kolonner)
    const headerCells = table.find("tr").first().children("th").toArray().slice(2, -2);
    let column = 2;

    const subjects = headerCells.map(cell => {
        const start = column;
        column += span(cell);
        return {
            start,
            end: column,
            subject: clean($(cell).text()),
            id: $(cell).find("a[data-lectiocontextcard]").attr("data-lectiocontextcard") ?? null,
            phases: []
        };
    });

    // Hvert forløb hører til den kolonne, cellen står i
    table.find("tr").slice(1).each((_, row) => {
        let index = 0;

        $(row).children("td, th").each((_, cell) => {
            const owner = subjects.find(item => index >= item.start && index < item.end);

            $(cell).find("div.phase").each((_, phase) => {
                const link = $(phase).find("a").first();
                const tooltip = link.attr("data-tooltip") ?? "";
                if (!owner || !link.length) return;

                const title = clean(link.text());
                const field = name => tooltip.match(new RegExp(`${name}: ([^\\n]+)`))?.[1]?.trim() ?? "";

                owner.phases.push({
                    id: link.attr("data-lectiocontextcard") ?? null,
                    title,
                    estimate: field("Estimat"),
                    period: field("Periode"),
                    description: tooltip
                        .replace(/Titel: [^\n]*\n?/, "")
                        .replace(/Estimat: [^\n]*\n?/, "")
                        .replace(/Periode: [^\n]*\n?/, "")
                        .trim(),
                    top: Number(($(phase).attr("style") ?? "").match(/top:\s*(-?\d+)/)?.[1] ?? 0),
                    url: link.attr("data-lectiocontextcard")?.length > 2
                        ? `${LECTIO}/${user.schoolCode}/studieplan/forloeb_vis.aspx?phaseid=${link.attr("data-lectiocontextcard").slice(2)}`
                        : null
                });
            });

            index += span(cell);
        });
    });

    return {
        subjects: subjects
            .map(({ subject, id, phases }) => ({ subject, id, phases: phases.sort((a, b) => a.top - b.top) }))
            .filter(item => item.subject)
    };
}

module.exports = { getHomework, getStudyPlan };
