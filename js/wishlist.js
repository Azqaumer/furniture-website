// wishlist.js — shared across every page, same pattern as cart.js

const WISHLIST_KEY = "furni_wishlist";

function getWishlist() {
    try {
        const raw = localStorage.getItem(WISHLIST_KEY);

        if (!raw) {
            return [];
        }

        const list = JSON.parse(raw);

        if (!Array.isArray(list)) {
            return [];
        }

        return list
            .map(id => Number(id))
            .filter(id => Number.isInteger(id) && id > 0);

    } catch (error) {
        console.error("Error reading wishlist:", error);
        return [];
    }
}


function saveWishlist(list) {
    try {
        localStorage.setItem(
            WISHLIST_KEY,
            JSON.stringify(list)
        );

        updateWishlistBadge();

    } catch (error) {
        console.error("Error saving wishlist:", error);
    }
}


function isWishlisted(productId) {
    productId = Number(productId);
    return getWishlist().includes(productId);
}


function toggleWishlist(productId) {

    productId = Number(productId);

    if (!Number.isInteger(productId) || productId <= 0) {
        console.error("Invalid wishlist item:", productId);
        return false;
    }

    const list = getWishlist();
    const idx = list.indexOf(productId);

    let nowWishlisted;

    if (idx === -1) {
        list.push(productId);
        nowWishlisted = true;
    } else {
        list.splice(idx, 1);
        nowWishlisted = false;
    }

    saveWishlist(list);

    return nowWishlisted;
}


function removeFromWishlist(productId) {
    productId = Number(productId);
    const list = getWishlist().filter(id => id !== productId);
    saveWishlist(list);
}


function wishlistCount() {
    return getWishlist().length;
}


function updateWishlistBadge() {

    const nav = document.querySelector(".navbar nav");

    if (!nav) {
        return;
    }

    let badge = nav.querySelector("#wishlist-badge");

    if (!badge) {

        badge = document.createElement("a");

        badge.id = "wishlist-badge";
        badge.href = "wishlist.html";

        // Insert before the cart badge so nav order stays predictable,
        // falling back to appending if cart.js hasn't run yet.
        const cartBadge = nav.querySelector("#cart-badge");
        if (cartBadge) {
            nav.insertBefore(badge, cartBadge);
        } else {
            nav.appendChild(badge);
        }
    }

    badge.textContent = `♥ ${wishlistCount()}`;
}


// Renders a heart toggle button. Call after inserting product cards
// into the DOM, or bind onclick="toggleWishlistButton(this, id)" directly.
function toggleWishlistButton(el, productId) {
    const nowOn = toggleWishlist(productId);
    el.classList.toggle("active", nowOn);
    el.textContent = nowOn ? "♥" : "♡";
    el.setAttribute("aria-pressed", String(nowOn));
}


document.addEventListener(
    "DOMContentLoaded",
    updateWishlistBadge
);
