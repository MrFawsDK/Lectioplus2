// Tekstbehandler til noter: formatering med en værktøjslinje på et contenteditable-felt.
// Indholdet gemmes som HTML og renses altid (sanitizeHtml), så kun sikre tags og styles bliver gemt.

/* ---------- Rensning af HTML ---------- */

const EDITOR_ALLOWED_TAGS = new Set([
    "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "SUB", "SUP",
    "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A"
]);

// Tags der fjernes helt sammen med indholdet
const EDITOR_DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);

const EDITOR_ALLOWED_STYLES = [
    "font-size", "color", "background-color", "text-align",
    "font-weight", "font-style", "text-decoration", "text-decoration-line", "margin-left", "padding-left"
];

// <font size="1-7"> fra execCommand oversættes til pt
const FONT_TAG_SIZES = { 1: "8pt", 2: "10pt", 3: "12pt", 4: "14pt", 5: "18pt", 6: "24pt", 7: "36pt" };

function cleanStyle(element) {
    const kept = [];

    EDITOR_ALLOWED_STYLES.forEach(property => {
        const value = element.style.getPropertyValue(property);
        if (value && !/url\(|expression|javascript:/i.test(value)) {
            kept.push(`${property}: ${value}`);
        }
    });

    return kept.join("; ");
}

// <font> fra execCommand laves om til <span style="...">
function fontToSpan(font) {
    const span = document.createElement("span");
    const size = FONT_TAG_SIZES[font.getAttribute("size")];
    if (size) span.style.fontSize = size;
    if (font.getAttribute("color")) span.style.color = font.getAttribute("color");
    span.append(...font.childNodes);
    font.replaceWith(span);
    return span;
}

function cleanNode(parent) {
    [...parent.childNodes].forEach(child => {
        let node = child;

        if (node.nodeType === Node.TEXT_NODE) return;

        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }

        if (EDITOR_DROP_TAGS.has(node.tagName.toUpperCase())) {
            node.remove();
            return;
        }

        if (node.tagName.toUpperCase() === "FONT") node = fontToSpan(node);

        const tag = node.tagName.toUpperCase();

        cleanNode(node);

        // Ukendte tags pakkes ud, så teksten bevares
        if (!EDITOR_ALLOWED_TAGS.has(tag)) {
            node.replaceWith(...node.childNodes);
            return;
        }

        const style = cleanStyle(node);
        const href = tag === "A" ? node.getAttribute("href") : null;

        [...node.attributes].forEach(attribute => node.removeAttribute(attribute.name));

        if (style) node.setAttribute("style", style);

        if (href && /^(https?:|mailto:)/i.test(href.trim())) {
            node.setAttribute("href", href.trim());
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer");
        }
    });
}

function sanitizeHtml(html) {
    // <template> kører ikke scripts eller indlæser billeder, mens vi renser
    const template = document.createElement("template");
    template.innerHTML = html ?? "";
    cleanNode(template.content);
    return template.innerHTML;
}

function htmlToText(html) {
    const template = document.createElement("template");
    template.innerHTML = (html ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h1|h2|h3|li|blockquote)>/gi, "\n");
    return (template.content.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// Almindelig tekst (fra ældre noter) laves om til afsnit
function textToHtml(text) {
    const escape = value => value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    return (text ?? "")
        .split(/\n{2,}/)
        .map(paragraph => `<p>${escape(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("");
}


/* ---------- Editoren ---------- */

const FONT_SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
const DEFAULT_FONT_SIZE_PT = 12;

function createRichEditor({ page, toolbar, onChange }) {
    let savedRange = null;

    document.execCommand("defaultParagraphSeparator", false, "p");

    /* Markering: gemmes, så værktøjslinjen kan bruges uden at miste den */

    function selectionInPage() {
        const selection = window.getSelection();
        return selection.rangeCount > 0 && page.contains(selection.anchorNode) ? selection : null;
    }

    document.addEventListener("selectionchange", () => {
        const selection = selectionInPage();
        if (selection) {
            savedRange = selection.getRangeAt(0).cloneRange();
            updateToolbar();
        }
    });

    function restoreSelection() {
        page.focus({ preventScroll: true });
        if (!savedRange) return;

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
    }

    function run(command, value = null, withCss = false) {
        restoreSelection();
        document.execCommand("styleWithCSS", false, withCss);
        document.execCommand(command, false, value);
        changed();
    }

    function changed() {
        updateToolbar();
        onChange?.();
    }

    /* Skriftstørrelse: execCommand kender kun 1-7, så vi markerer med 7 og skifter til pt */

    function setFontSize(pt) {
        restoreSelection();
        document.execCommand("styleWithCSS", false, false);
        document.execCommand("fontSize", false, "7");

        page.querySelectorAll('font[size="7"]').forEach(font => {
            const span = document.createElement("span");
            span.style.fontSize = `${pt}pt`;
            span.append(...font.childNodes);
            font.replaceWith(span);
        });

        changed();
    }

    /* Værktøjslinjens tilstand */

    const toggles = [...toolbar.querySelectorAll("[data-command][toggle]")];
    const blockSelect = toolbar.querySelector("[data-block-select]");
    const sizeSelect = toolbar.querySelector("[data-size-select]");

    function currentElement() {
        const selection = selectionInPage();
        if (!selection) return null;
        const node = selection.anchorNode;
        return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    }

    function updateToolbar() {
        toggles.forEach(button => {
            const command = button.dataset.command;
            let active = false;
            try {
                active = document.queryCommandState(command);
            } catch {
                active = false;
            }
            button.selected = active;
        });

        const element = currentElement();
        if (!element) return;

        if (blockSelect) {
            const block = element.closest("h1, h2, h3, blockquote, p, li, div");
            const tag = block && page.contains(block) ? block.tagName.toLowerCase() : "p";
            blockSelect.value = ["h1", "h2", "h3", "blockquote"].includes(tag) ? tag : "p";
        }

        if (sizeSelect) {
            const px = parseFloat(getComputedStyle(element).fontSize);
            const pt = Math.round(px * 0.75);
            sizeSelect.value = FONT_SIZES_PT.includes(pt) ? String(pt) : "";
        }
    }

    /* Knapper og valg */

    toolbar.addEventListener("click", event => {
        const button = event.target.closest("[data-command]");
        if (!button) return;

        const command = button.dataset.command;

        if (command === "removeFormat") {
            run("removeFormat");
            run("formatBlock", "<p>");
            return;
        }

        run(command, button.dataset.value ?? null);
    });

    blockSelect?.addEventListener("change", () => {
        if (blockSelect.value) run("formatBlock", `<${blockSelect.value}>`);
    });

    sizeSelect?.addEventListener("change", () => {
        if (sizeSelect.value) setFontSize(Number(sizeSelect.value));
    });

    // Farver: knappen åbner browserens farvevælger (M3 har ingen farvevælger)
    toolbar.querySelectorAll("[data-color-command]").forEach(button => {
        const input = toolbar.querySelector(`#${button.dataset.colorInput}`);
        const swatch = button.parentElement.querySelector(".color-bar");

        button.addEventListener("click", () => input.click());

        input.addEventListener("input", () => {
            if (swatch) swatch.style.background = input.value;
            run(button.dataset.colorCommand, input.value, true);
        });
    });

    /* Indsæt: kun rensede formater */

    page.addEventListener("paste", event => {
        const html = event.clipboardData?.getData("text/html");
        const text = event.clipboardData?.getData("text/plain");
        if (!html && !text) return;

        event.preventDefault();
        const clean = html ? sanitizeHtml(html) : textToHtml(text);
        document.execCommand("insertHTML", false, clean);
        changed();
    });

    page.addEventListener("input", changed);
    page.addEventListener("keyup", updateToolbar);
    page.addEventListener("mouseup", updateToolbar);

    return {
        getHtml() {
            return sanitizeHtml(page.innerHTML);
        },
        setHtml(html) {
            page.innerHTML = sanitizeHtml(html) || "<p><br></p>";
            savedRange = null;
            updateToolbar();
        },
        getText() {
            return htmlToText(page.innerHTML);
        },
        focus() {
            page.focus();
        }
    };
}
