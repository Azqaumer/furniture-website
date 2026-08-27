// nav-search.js — adds a search box to the navbar on every page.
// Submitting always goes to shop.html?search=... , since that's the
// only page that actually filters products. Typing a search on, say,
// the About page just takes you to Shop with the query pre-filled.

function initNavSearch() {

    const nav = document.querySelector(".navbar nav");

    if (!nav || nav.querySelector("#nav-search-form")) {
        return;
    }

    const form = document.createElement("form");
    form.id = "nav-search-form";
    form.setAttribute("role", "search");

    const input = document.createElement("input");
    input.type = "search";
    input.id = "nav-search-input";
    input.placeholder = "Search…";
    input.setAttribute("aria-label", "Search products");

    // Pre-fill from the current URL so the box reflects an active
    // search when landing on shop.html?search=...
    const params = new URLSearchParams(window.location.search);
    const currentSearch = params.get("search");
    if (currentSearch) {
        input.value = currentSearch;
    }

    form.appendChild(input);

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = input.value.trim();
        window.location.href = q
            ? `shop.html?search=${encodeURIComponent(q)}`
            : "shop.html";
    });

    // Put it first in the nav, before the page links, so it reads
    // consistently regardless of how many links a given page has.
    nav.insertBefore(form, nav.firstChild);
}

document.addEventListener("DOMContentLoaded", initNavSearch);