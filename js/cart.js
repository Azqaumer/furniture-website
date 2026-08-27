// cart.js — shared across every page

const CART_KEY = "furni_cart";

function getCart() {
    try {
        const raw = localStorage.getItem(CART_KEY);

        if (!raw) {
            return [];
        }

        const cart = JSON.parse(raw);

        if (!Array.isArray(cart)) {
            return [];
        }

        return cart
            .map(item => ({
                productId: Number(item.productId),
                qty: Number(item.qty)
            }))
            .filter(item =>
                Number.isInteger(item.productId) &&
                item.productId > 0 &&
                Number.isInteger(item.qty) &&
                item.qty > 0
            );

    } catch (error) {
        console.error("Error reading cart:", error);
        return [];
    }
}


function saveCart(cart) {
    try {
        localStorage.setItem(
            CART_KEY,
            JSON.stringify(cart)
        );

        updateCartBadge();

    } catch (error) {
        console.error("Error saving cart:", error);
    }
}


function addToCart(productId, qty = 1) {

    productId = Number(productId);
    qty = Number(qty);

    if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isInteger(qty) ||
        qty <= 0
    ) {
        console.error("Invalid cart item:", productId, qty);
        return;
    }

    const cart = getCart();

    const existing = cart.find(
        line => Number(line.productId) === productId
    );

    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({
            productId: productId,
            qty: qty
        });
    }

    saveCart(cart);

    console.log("Added to cart:", {
        productId,
        qty
    });

    updateCartBadge();
}


function updateQty(productId, qty) {

    productId = Number(productId);
    qty = Number(qty);

    let cart = getCart();

    if (qty <= 0) {

        cart = cart.filter(
            line => Number(line.productId) !== productId
        );

    } else {

        const line = cart.find(
            line => Number(line.productId) === productId
        );

        if (line) {
            line.qty = qty;
        }
    }

    saveCart(cart);
}


function removeFromCart(productId) {

    productId = Number(productId);

    const cart = getCart().filter(
        line => Number(line.productId) !== productId
    );

    saveCart(cart);
}


function clearCart() {
    localStorage.removeItem(CART_KEY);
    updateCartBadge();
}


function cartCount() {

    return getCart().reduce(
        (sum, line) => sum + Number(line.qty),
        0
    );
}


function updateCartBadge() {

    const nav = document.querySelector(".navbar nav");

    if (!nav) {
        return;
    }

    let badge = nav.querySelector("#cart-badge");

    if (!badge) {

        badge = document.createElement("a");

        badge.id = "cart-badge";
        badge.href = "cart.html";

        nav.appendChild(badge);
    }

    badge.textContent = `Cart (${cartCount()})`;
}


document.addEventListener(
    "DOMContentLoaded",
    updateCartBadge
);