// Beskeder og dokumenter fra Lectio.
// Opbygningen af siderne er set i BetterLectios kode (github.com/BetterLectio/betterLectio,
// apps/api/lectio/_beskeder.py og _dokumenter.py).

const cheerio = require("cheerio");
const { getPage, clean, LECTIO } = require("./lectio");

/* ---------- Beskeder ---------- */

// Overskrifterne i tabellen gøres til nøgler: "Sidst ændret" -> "sidstÆndret"
function headerKey(text) {
    const words = clean(text).toLowerCase().split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("");
    return words.charAt(0).toLowerCase() + words.slice(1);
}

// beskeder2.aspx har et mappe-træ og en tabel med beskeder (første side)
async function getMessages(user, folderId) {
    const page = folderId ? `beskeder2.aspx?mappeid=${encodeURIComponent(folderId)}` : "beskeder2.aspx";
    const $ = cheerio.load(await getPage(user, page));

    const folders = [];
    $("div[id$='ListGridSelectionTree'] div[lec-role='treeviewnodecontainer']").each((_, div) => {
        const id = $(div).attr("lec-node-id") ?? "";
        if (!id.includes("-")) return;

        // Undermapper ligger inde i forælderens container - kun mappens egen titel (første linje) bruges
        const name = clean($(div).text().trim().split("\n")[0]);
        if (name && !folders.some(folder => folder.id === id)) {
            folders.push({ id, name, selected: $(div).find("a.selectedFolder").length > 0 });
        }
    });

    const rows = $("tr").toArray();
    const headerRow = rows.find(row => $(row).find("th").toArray().some(cell => /^emne$/i.test(clean($(cell).text()))));
    const keys = headerRow
        ? $(headerRow).find("th").toArray().map(cell => clean($(cell).text())).filter(Boolean).map(headerKey)
        : [];

    const messages = [];
    if (headerRow) {
        for (const row of rows.slice(rows.indexOf(headerRow) + 1)) {
            const cells = $(row).children("td").toArray().slice(3, -2);
            if (cells.length < keys.length) continue;

            const message = {};
            keys.forEach((key, index) => {
                const cell = $(cells[index]);

                if (key === "modtagere") {
                    message[key] = (cell.find("span").attr("title") ?? cell.text()).split(/\r?\n/).map(clean).filter(Boolean);
                } else {
                    message[key] = clean(cell.find("span").attr("title") ?? cell.text());
                }

                if (key === "emne") {
                    message.id = (cell.find("a").attr("onclick") ?? "").match(/\$_(\d+)/)?.[1] ?? null;
                }
            });

            if (message.id) messages.push(message);
        }
    }

    return { folders, messages };
}

// En besked med alle svar i tråden
async function getMessage(user, id) {
    const $ = cheerio.load(await getPage(user, `beskeder2.aspx?type=visbesked&id=${encodeURIComponent(id)}`));
    const messages = [];

    $("table[id$='MessageThreadCtrl_MessagesGV'] tr").each((_, row) => {
        const sender = $(row).find(".message-thread-message-sender").first();
        if (!sender.length) return;

        const name = clean(sender.find("span").first().text());
        const content = $(row).find(".message-thread-message-content").first().clone();

        const attachments = $(row).find(".message-attachements a").toArray().map(link => ({
            name: clean($(link).text()),
            href: new URL($(link).attr("href") ?? "", "https://www.lectio.dk").href
        }));

        content.find(".message-attachements").remove();
        content.find("br").replaceWith("\n");
        content.find("p, div").each((_, element) => {
            $(element).append("\n");
        });

        messages.push({
            sender: name,
            title: clean($(row).find(".message-thread-message-header").first().text()),
            date: clean(sender.text().replace(name, "")).replace(/^[,\s]+/, ""),
            text: content.text().replace(/\n{3,}/g, "\n\n").trim(),
            attachments,
            replyTo: clean($(row).find(".message-reply-summary").first().text().replace("Er svar på besked af ", "")) || null
        });
    });

    if (!messages.length) {
        const error = new Error("Kunne ikke læse beskeden fra Lectio");
        error.expose = true;
        throw error;
    }

    return {
        subject: messages[0].title,
        messages,
        url: `${LECTIO}/${user.schoolCode}/beskeder2.aspx?type=visbesked&id=${id}`
    };
}


/* ---------- Dokumenter ---------- */

// DokumentOversigt.aspx har et mappe-træ og en tabel med filer
async function getDocuments(user, folderId) {
    const id = user.student.studentId;
    const page = `DokumentOversigt.aspx?elevid=${id}${folderId ? `&folderid=${encodeURIComponent(folderId)}` : ""}`;
    const $ = cheerio.load(await getPage(user, page));

    const title = clean($("span[id$='FolderLabel']").first().text());
    const tree = $("div[id$='FolderTreeView']").first();

    const readFolder = element => ({
        id: $(element).attr("lec-node-id"),
        name: clean($(element).find(".TreeNode-title").first().text())
    });

    // Mapper: øverste niveau, eller undermapperne til den mappe vi står i
    let folders;
    let parent = null;

    if (!folderId) {
        folders = tree.children("div").toArray().map(readFolder);
    } else {
        const current = tree.find("div[lec-node-id]").toArray().find(element => $(element).attr("lec-node-id") === folderId);
        parent = $(current).parent().closest("div[lec-node-id]").attr("lec-node-id") ?? "";
        folders = $(current).find("div[lec-role='ltv-sublist']").first().children("div").toArray().map(readFolder);
    }

    // Filer: tabellen i #printfoldercontent. Cellerne før/efter navnet er ikoner og handlinger
    const files = [];
    $("[id$='printfoldercontent'] tr").slice(1).each((_, row) => {
        if ($(row).find(".noRecord").length) return;

        const link = $(row).find("a[href*='documentid='], a[href*='lc/']").first();
        if (!link.length) return;

        const cells = $(row).children("td").toArray().map(cell => $(cell));
        const index = cells.findIndex(cell => cell.find("a").is(link));
        const tip = cell => cell?.find("span.tooltip").attr("title") ?? clean(cell?.text() ?? "");

        files.push({
            name: clean(link.text()),
            comment: tip(cells[index + 1]),
            changedBy: tip(cells[index + 2]),
            date: clean(cells[index + 3]?.text() ?? ""),
            url: new URL(link.attr("href") ?? "", `${LECTIO}/${user.schoolCode}/`).href
        });
    });

    return { title, parent, folders: folders.filter(folder => folder.id && folder.name), files };
}

module.exports = { getMessages, getMessage, getDocuments };
