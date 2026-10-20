const ordersGrid = document.querySelector("#orders-grid");
const emptyPanel = document.querySelector("#empty");
const orderSummary = document.querySelector("#order-summary");
const position = document.querySelector("#position");
const clock = document.querySelector("#clock");

const ALERT_WINDOW_MS = 30 * 60 * 1000;
const ROTATION_MS = 20000; // Intervalo de rotação da grade da TV para alternar pedidos em destaque.

let orders = [];
let normalPage = 0;
let renderedSignature = "";
let visibleCards = 9; // Define o número de cartões visíveis conforme a densidade dos pedidos pendentes.

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short",
  }).format(new Date());
}

function getTimeRemaining(order) {
  return new Date(order.retirada_em).getTime() - Date.now();
}

function showOrders() {
  if (!orders.length) {
    renderedSignature = "";
    ordersGrid.className = "grid-3x3";
    ordersGrid.replaceChildren();
    emptyPanel.hidden = false;
    orderSummary.textContent = "";
    position.textContent = "0 pedidos";
    return;
  }

  // Ajusta a densidade da grade da TV conforme a quantidade de pedidos pendentes.
  if (orders.length <= 9) {
    visibleCards = 9;
    ordersGrid.className = "grid-3x3";
  } else if (orders.length <= 12) {
    visibleCards = 12;
    ordersGrid.className = "grid-4x3";
  } else {
    visibleCards = 16;
    ordersGrid.className = "grid-4x4";
  }

  const prioritized = [...orders].sort((first, second) => {
    const firstRemaining = getTimeRemaining(first);
    const secondRemaining = getTimeRemaining(second);
    const firstAlert = firstRemaining <= ALERT_WINDOW_MS;
    const secondAlert = secondRemaining <= ALERT_WINDOW_MS;
    if (firstAlert !== secondAlert) return firstAlert ? -1 : 1;
    return firstRemaining - secondRemaining || first.id - second.id;
  });

  const alertOrders = prioritized.filter((order) => getTimeRemaining(order) <= ALERT_WINDOW_MS);
  const regularOrders = prioritized.filter((order) => getTimeRemaining(order) > ALERT_WINDOW_MS);
  
  const normalSlots = Math.max(visibleCards - Math.min(alertOrders.length, visibleCards), 0);
  const pageCount = normalSlots ? Math.max(1, Math.ceil(regularOrders.length / normalSlots)) : 1;
  normalPage %= pageCount;
  const pageStart = normalPage * normalSlots;

  const visibleOrders = [
    ...alertOrders.slice(0, visibleCards),
    ...regularOrders.slice(pageStart, pageStart + normalSlots),
  ].slice(0, visibleCards);

  emptyPanel.hidden = true;

  const signature = visibleOrders.map((order) => `${order.id}:${getTimeRemaining(order) <= ALERT_WINDOW_MS ? 1 : 0}`).join("|");
  
  if (signature === renderedSignature) {
    visibleOrders.forEach((order) => {
      const remaining = getTimeRemaining(order);
      const minutes = Math.ceil(Math.abs(remaining) / 60000);
      const card = ordersGrid.querySelector(`[data-order-id="${order.id}"]`);
      if (card) card.querySelector(".order-countdown").textContent = remaining < 0 ? `ATRASADO: -${minutes} MIN` : `FALTAM ${minutes} MIN`;
    });
    return;
  }

  renderedSignature = signature;

  ordersGrid.innerHTML = visibleOrders.map((order) => {
    const remaining = getTimeRemaining(order);
    const isAlert = remaining <= ALERT_WINDOW_MS;
    const minutes = Math.ceil(Math.abs(remaining) / 60000);
    const countdown = remaining < 0 ? `ATRASADO: -${minutes} MIN` : `FALTAM ${minutes} MIN`;
    const number = order.numero_pedido || order.id;
    
    // Formata a data para o padrão visual da TV, exibindo dia e mês sem repetir o ano.
    const dateParts = order.data_retirada.split('-');
    const dataFormatada = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : order.data_retirada;

    return `<article class="order-card${isAlert ? " alert-card" : ""}" data-order-id="${order.id}">
      <div class="order-topline">
        <div class="order-primary"><span class="order-primary-label">Açougueiro</span><span class="order-primary-value">${escapeHtml(order.acougueiro)}</span></div>
        <div class="order-primary"><span class="order-primary-label">Pedido #${escapeHtml(number)}</span><span class="order-primary-value">${escapeHtml(order.cliente)}</span></div>
      </div>
      <div class="order-middle">
        <span class="order-detail">Atendente: ${escapeHtml(order.atendente || "—")}</span>
        <span class="order-pickup">Entrega: ${dataFormatada} às ${escapeHtml(order.hora_retirada)}</span>
        <span class="order-countdown">${countdown}</span>
      </div>
      <span class="order-type">${escapeHtml(order.tipo_entrega)}</span>
    </article>`;
  }).join("");

  orderSummary.textContent = `${alertOrders.length} em alerta · ${orders.length} pendentes`;
  const gradeNome = visibleCards === 9 ? "3x3" : (visibleCards === 12 ? "4x3" : "4x4");
  position.textContent = pageCount > 1 ? `Página ${normalPage + 1} / ${pageCount} (Grade ${gradeNome})` : `Grade ${gradeNome}`;
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

async function refreshOrders() {
  try {
    // Lê o token CSRF do HTML para enviar a requisição na mesma sessão autenticada.
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    
    // Consulta a API do módulo e traz os pedidos pendentes para a exibição em tempo real.
    const response = await fetch("/cliente/pedidos-tv/api/pedidos", {
      headers: { "X-CSRFToken": csrfToken || "" }
    });
    
    if (!response.ok) throw new Error("Erro do Servidor (Status " + response.status + ")");
    
    orders = await response.json();
    renderedSignature = "";
    showOrders();
  } catch (error) {
    emptyPanel.textContent = "Falha na comunicação: " + error.message;
    emptyPanel.hidden = false;
    ordersGrid.replaceChildren();
  }
}

function rotatePage() {
  const alertCount = orders.filter((order) => getTimeRemaining(order) <= ALERT_WINDOW_MS).length;
  const normalSlots = Math.max(visibleCards - Math.min(alertCount, visibleCards), 0);
  const regularCount = orders.length - alertCount;
  const pageCount = normalSlots ? Math.max(1, Math.ceil(regularCount / normalSlots)) : 1;
  if (pageCount > 1) normalPage = (normalPage + 1) % pageCount;
  showOrders();
}

document.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
});

updateClock();
refreshOrders();
setInterval(updateClock, 1000);
setInterval(showOrders, 1000);
setInterval(rotatePage, ROTATION_MS);
const socket = io();
socket.on("atualizar_pedidos", () => {
  // A tela reage imediatamente quando o backend sinaliza que houve alteração nos pedidos.
  refreshOrders();
});