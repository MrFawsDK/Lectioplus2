// Fælles for Bøger, Spørgeskema og SPS: henter /api/<data-api> og viser tabellerne fra Lectio.
// På telefon bliver hver række et kort (se side.css), så intet skal rulles sidelæns.

const root = document.querySelector("#content");
const emptyState = document.querySelector("#emptyState");
const API = document.body.dataset.api;

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

function renderTable(table) {
    const width = Math.max(...table.rows.map(row => row.cells.length));
    const headers = Array.from({ length: width }, (_, index) => table.headers[index] ?? "");

    return `
        <div class="table-wrap">
            <table class="data-table">
                <thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join("")}<th></th></tr></thead>
                <tbody>
                    ${table.rows.map(row => `
                        <tr>
                            ${headers.map((header, index) => `<td data-label="${escapeHtml(header)}">${escapeHtml(row.cells[index])}</td>`).join("")}
                            <td class="action">${row.href
                                ? `<md-text-button href="${escapeHtml(row.href)}" target="_blank" rel="noopener">Åbn</md-text-button>` : ""}</td>
                        </tr>`).join("")}
                </tbody>
            </table>
        </div>`;
}

function render(data) {
    const tables = data.tables ?? [];

    root.innerHTML =
        tables.map(renderTable).join("") +
        (data.text ? `<p class="plain">${escapeHtml(data.text)}</p>` : "") +
        (data.url ? `<div class="open"><md-filled-tonal-button href="${escapeHtml(data.url)}" target="_blank" rel="noopener">Åbn i Lectio</md-filled-tonal-button></div>` : "");

    showEmpty(tables.length || data.text ? "" : "Der er ikke noget at vise her.");
}

async function load() {
    try {
        render(await apiGet(`/api/${API}`));
    } catch (error) {
        root.innerHTML = "";
        showEmpty(error.message);
    }
}

load();
