// Beskeder: mapper og liste til venstre, valgt besked (hele tråden) til højre.
// Svar og nye beskeder skrives i Lectio - her kan man læse dem.

const folderBar = document.querySelector("#folders");
const messageList = document.querySelector("#messageList");
const reader = document.querySelector("#reader");
const emptyState = document.querySelector("#emptyState");

let currentFolder = "";

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

// Lectios kolonner kender vi ikke på forhånd: afsender og dato findes ud fra navnene
function describe(message) {
    const sender = message.afsender ?? message.fra ?? "";
    const dateKey = Object.keys(message).find(key => /ændret|dato|sendt|tid/i.test(key));
    return [sender, dateKey ? message[dateKey] : ""].filter(Boolean).join(" · ");
}


/* ---------- Mapper og liste ---------- */

function renderFolders(folders) {
    folderBar.innerHTML = folders.map(folder => `
        <md-text-button data-folder="${escapeHtml(folder.id)}"${folder.selected ? ` class="current"` : ""}>${escapeHtml(folder.name)}</md-text-button>`).join("");

    // Den valgte mappe vises som en tonal knap (M3: Filled tonal button)
    folderBar.querySelectorAll("md-text-button.current").forEach(button => {
        const tonal = document.createElement("md-filled-tonal-button");
        tonal.dataset.folder = button.dataset.folder;
        tonal.textContent = button.textContent;
        button.replaceWith(tonal);
    });
}

function renderMessages(messages) {
    messageList.innerHTML = messages.map(message => `
        <md-list-item type="button" data-id="${escapeHtml(message.id)}">
            <div slot="headline">${escapeHtml(message.emne)}</div>
            <div slot="supporting-text">${escapeHtml(describe(message))}</div>
        </md-list-item>`).join("");

    showEmpty(messages.length ? "" : "Der er ingen beskeder i denne mappe.");
}

async function loadFolder(folderId = "") {
    currentFolder = folderId;
    showEmpty("Henter beskeder …");

    try {
        const data = await apiGet(`/api/beskeder${folderId ? `?mappe=${encodeURIComponent(folderId)}` : ""}`);
        renderFolders(data.folders);
        renderMessages(data.messages);
    } catch (error) {
        messageList.innerHTML = "";
        showEmpty(error.message);
    }
}


/* ---------- Læs en besked ---------- */

function renderThread(thread) {
    reader.innerHTML = `
        <h2>${escapeHtml(thread.subject)}</h2>
        ${thread.messages.map(post => `
            <section class="post">
                <div class="post-head">
                    <strong>${escapeHtml(post.sender)}${post.replyTo ? ` <span>svarer ${escapeHtml(post.replyTo)}</span>` : ""}</strong>
                    <span>${escapeHtml(post.date)}</span>
                </div>
                <p class="post-text">${escapeHtml(post.text)}</p>
                ${post.attachments.length ? `<div class="attachments">${post.attachments.map(file => `
                    <md-text-button href="${escapeHtml(file.href)}" target="_blank" rel="noopener">
                        <md-icon slot="icon">attach_file</md-icon>${escapeHtml(file.name)}
                    </md-text-button>`).join("")}</div>` : ""}
            </section>`).join("")}
        <div class="reader-actions">
            <md-filled-tonal-button href="${escapeHtml(thread.url)}" target="_blank" rel="noopener">Svar i Lectio</md-filled-tonal-button>
        </div>`;
}

async function openMessage(id) {
    reader.innerHTML = `<p class="placeholder">Henter besked …</p>`;

    try {
        renderThread(await apiGet(`/api/beskeder/${encodeURIComponent(id)}`));
    } catch (error) {
        reader.innerHTML = `<p class="placeholder">${escapeHtml(error.message)}</p>`;
    }
}

folderBar.addEventListener("click", event => {
    const button = event.target.closest("[data-folder]");
    if (button) loadFolder(button.dataset.folder);
});

messageList.addEventListener("click", event => {
    const item = event.target.closest("[data-id]");
    if (item) openMessage(item.dataset.id);
});

loadFolder();
