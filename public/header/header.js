// Skifter et element til et andet M3-element med samme indhold og attributter
function replaceTag(element, tagName) {
    const replacement = document.createElement(tagName);

    [...element.attributes].forEach(attribute => {
        replacement.setAttribute(attribute.name, attribute.value);
    });

    replacement.innerHTML = element.innerHTML;
    element.replaceWith(replacement);
}

async function loadHeader() {
    const header = document.querySelector("#header");
    if (!header) return;

    const response = await fetch("/header/header.html");
    header.innerHTML = await response.text();

    // Den side man er på, vises som en tonal knap
    // M3: Buttons - Filled tonal button: https://m3.material.io/components/buttons/overview
    //     Element: <md-filled-tonal-button> fra @material/web/button/filled-tonal-button.js
    // M3: Icon buttons - Filled tonal icon button: https://m3.material.io/components/icon-buttons/overview
    //     Element: <md-filled-tonal-icon-button> fra @material/web/iconbutton/filled-tonal-icon-button.js
    const path = window.location.pathname;

    header.querySelectorAll("md-text-button[href]").forEach(button => {
        if (path.startsWith(button.getAttribute("href"))) {
            replaceTag(button, "md-filled-tonal-button");
        }
    });

    header.querySelectorAll("md-icon-button[href]").forEach(button => {
        if (path.startsWith(button.getAttribute("href"))) {
            replaceTag(button, "md-filled-tonal-icon-button");
        }
    });

    // Vis elevens navn på profil-knappen og "Demo" hvis der bruges demo-data (getMe() fra session.js)
    getMe().then(me => {
        const profileButton = header.querySelector(".profile [href='/profil/']");
        if (profileButton) profileButton.title = `Profil - ${me.student?.name ?? ""}`;
        header.querySelector("#demoBadge").hidden = !me.demo;
    });
}

loadHeader();
