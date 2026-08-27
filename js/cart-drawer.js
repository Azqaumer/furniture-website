function openCartDrawer(){
  document.getElementById("cartDrawer").classList.add("open");
  renderCartDrawer();
}
function closeCartDrawer(){
  document.getElementById("cartDrawer").classList.remove("open");
}
function renderCartDrawer(){
  const container = document.getElementById("cartDrawerItems");
  const cart = getCart();
  if(cart.length===0){
    container.innerHTML = '<p style="color:#999; text-align:center; margin-top:50px;">Your cart is empty</p>';
    document.getElementById("cartDrawerTotal").innerText = "";
    return;
  }
  fetch('/api/products')
    .then(r=>r.json())
    .then(all=>{
      let total = 0;
      container.innerHTML = cart.map(line=>{
        const p = all.find(x=>x.id===line.productId);
        if(!p) return "";
        total += p.price * line.qty;
        return `
          <div class="cart-drawer-item">
            <img src="${p.img}">
            <div style="flex:1">
              <p style="font-size:14px; font-weight:600;">${p.name}</p>
              <p style="font-size:12px; color:#999;">$${p.price.toFixed(2)} × ${line.qty}</p>
              <div style="margin-top:5px;">
                <button onclick="updateQty(${p.id}, ${line.qty-1}); renderCartDrawer();" style="border:none; background:#eee; width:24px; height:24px; border-radius:50%; cursor:pointer;">-</button>
                <span style="margin:0 8px; font-size:13px;">${line.qty}</span>
                <button onclick="updateQty(${p.id}, ${line.qty+1}); renderCartDrawer();" style="border:none; background:#eee; width:24px; height:24px; border-radius:50%; cursor:pointer;">+</button>
                <button onclick="removeFromCart(${p.id}); renderCartDrawer();" style="float:right; border:none; background:none; color:#c0392b; font-size:12px; cursor:pointer;">Remove</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
      document.getElementById("cartDrawerTotal").innerText = "Total: $" + total.toFixed(2);
    });
}

document.addEventListener("DOMContentLoaded", ()=>{
  setTimeout(()=>{
    const badge = document.getElementById("cart-badge");
    if(badge){
      badge.removeAttribute("href");
      badge.style.cursor = "pointer";
      badge.onclick = (e)=>{ e.preventDefault(); openCartDrawer(); };
    }
  }, 300);
});