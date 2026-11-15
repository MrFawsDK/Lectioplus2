// Dokumenter: mapper (klik for at gå ind) og filer (åbner i Lectio i en ny fane)

const list = document.querySelector("#docList");
const emptyState = document.querySelector("#emptyState");

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function showEmpty(text) {
    emptyState.hidden = !text;
    document.querySelector("#emptyText").textContent = text ?? "";
}

function render({ title, parent, folders, files }) {
    document.querySelector("#lead").textContent = title || "Dine dokumenter og mapper fra Lectio.";

    const up = parent === null ? "" : `
        <md-list-item type="button" data-folder="${escapeHtml(parent)}">
            <md-icon slot="start">arrow_back</md-icon>
            <div slot="headline">Tilbage</div>
        </md-list-item>`;

    const folderItems = folders.map(folder => `
        <md-list-item type="button" data-folder="${escapeHtml(folder.id)}">
            <md-icon slot="start">folder</md-icon>
            <div slot="headline">${escapeHtml(folder.name)}</div>
        </md-list-item>`).join("");

    const fileItems = files.map(file => `
        <md-list-item type="link" href="${escapeHtml(file.url)}" target="_blank" rel="noopener">
            <md-icon slot="start">description</md-icon>
            <div slot="headline">${escapeHtml(file.name)}</div>
            <div slot="supporting-text">${escapeHtml([file.comment, file.changedBy, file.date].filter(Boolean).join(" · "))}</div>
        </md-list-item>`).join("");

    list.innerHTML = up + folderItems + fileItems;
    showEmpty(folders.length + files.length ? "" : "Mappen er tom.");
}

async function loadFolder(folderId = "") {
    showEmpty("Henter dokumenter …");

    try {
        render(await apiGet(`/api/dokumenter${folderId ? `?mappe=${encodeURIComponent(folderId)}` : ""}`));
    } catch (error) {
        list.innerHTML = "";
        showEmpty(error.message);
    }
}

list.addEventListener("click", event => {
    const item = event.target.closest("[data-folder]");
    if (item) loadFolder(item.dataset.folder);
});

loadFolder();
