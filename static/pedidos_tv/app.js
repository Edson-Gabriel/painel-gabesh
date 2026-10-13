const ordersElement = document.querySelector("#orders");
const orderCount = document.querySelector("#order-count");
const butcherSelect = document.querySelector("#butcher-select");
const attendantSelect = document.querySelector("#attendant-select");
const orderForm = document.querySelector("#order-form");
const formMessage = document.querySelector("#form-message");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const editMessage = document.querySelector("#edit-message");
const deleteDialog = document.querySelector("#delete-dialog");
const deleteForm = document.querySelector("#delete-form");
const deleteMessage = document.querySelector("#delete-message");
const alertState = document.querySelector("#alert-state");
const alertButton = document.querySelector("#enable-alerts");
const announced = new Set();
let alertsEnabled = false;
let audioContext;
let currentOrders = [];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

async function requestJson(url, options = {}) {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  const response = await fetch(url, {
    headers: { 
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken
    },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

async function loadButchers() {
  const [butchers, attendants] = await Promise.all([
    requestJson("/cliente/pedidos-tv/api/acougueiros"),
    requestJson("/cliente/pedidos-tv/api/atendentes"),
  ]);
  const active = butchers.filter((butcher) => butcher.ativo);
  const activeAttendants = attendants.filter((attendant) => attendant.ativo);
  const butcherOptions = '<option value="">Selecione</option>' + active.map((butcher) =>
    `<option value="${butcher.id}">${escapeHtml(butcher.nome)}</option>`).join("");
  const attendantOptions = '<option value="">Selecione</option>' + activeAttendants.map((attendant) =>
    `<option value="${attendant.id}">${escapeHtml(attendant.nome)}</option>`).join("");
  butcherSelect.innerHTML = active.length ? butcherOptions : '<option value="">Cadastre um açougueiro</option>';
  attendantSelect.innerHTML = activeAttendants.length ? attendantOptions : '<option value="">Cadastre uma atendente</option>';
  document.querySelectorAll(".edit-butcher-select").forEach((select) => { select.innerHTML = butcherOptions; });
  document.querySelectorAll(".edit-attendant-select").forEach((select) => { select.innerHTML = attendantOptions; });
}

function playAlert() {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.45);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.45);
}

function notify(order, kind, minutes) {
  const key = `${order.id}:${kind}`;
  if (!alertsEnabled || announced.has(key)) return;
  announced.add(key);
  playAlert();
  if ("Notification" in window && Notification.permission === "granted") {
    const text = kind === "late"
      ? `${order.cliente} ultrapassou o horário de retirada.`
      : `${order.cliente}: faltam ${minutes} minutos para a retirada.`;
    new Notification(kind === "late" ? "Pedido atrasado" : "Pedido próximo do horário", { body: text });
  }
}

function renderOrders(orders) {
  orderCount.textContent = `(${orders.length})`;
  if (!orders.length) {
    ordersElement.innerHTML = '<p class="p-8 text-center text-stone-500">Nenhum pedido pendente.</p>';
    return;
  }

  const now = Date.now();
  ordersElement.innerHTML = orders.map((order) => {
    const pickup = new Date(order.retirada_em);
    const milliseconds = pickup.getTime() - now;
    const minutes = Math.ceil(milliseconds / 60000);
    let status;
    if (milliseconds < 0) {
      status = `<span class="status-late font-bold">Atrasado · ${Math.ceil(-milliseconds / 60000)} min</span>`;
      notify(order, "late");
    } else if (minutes <= 10) {
      status = `<span class="status-soon font-bold">Vence em ${minutes} min</span>`;
      notify(order, "soon", minutes);
    } else {
      status = `<span class="status-good">No prazo · ${minutes} min</span>`;
    }
    return `<article class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0"><div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 class="text-lg font-bold">Pedido ${escapeHtml(order.numero_pedido || order.id)} · ${escapeHtml(order.cliente)}</h3>${status}
      </div><p class="mt-1 text-sm text-stone-600">${escapeHtml(order.tipo_entrega)} · ${escapeHtml(order.data_retirada.split("-").reverse().join("/"))} às ${escapeHtml(order.hora_retirada)}</p>
      <p class="mt-1 text-sm text-stone-600">Açougueiro: ${escapeHtml(order.acougueiro)} · Atendente: ${escapeHtml(order.atendente || "Não informado")}</p></div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <button data-edit="${order.id}" class="rounded border border-stone-400 px-3 py-2 text-sm font-semibold hover:bg-stone-100">Editar</button>
        <button data-complete="${order.id}" class="rounded border border-emerald-800 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">Concluir</button>
        <button data-delete="${order.id}" class="rounded border border-red-700 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">Excluir</button>
      </div>
    </article>`;
  }).join("");
}

async function loadOrders() {
  try {
    currentOrders = await requestJson("/cliente/pedidos-tv/api/pedidos");
    renderOrders(currentOrders);
  } catch (error) {
    ordersElement.innerHTML = `<p class="p-5 text-sm text-red-700">${escapeHtml(error.message)}</p>`;
  }
}

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(orderForm);
  const payload = Object.fromEntries(formData.entries());
  payload.acougueiro_id = Number(payload.acougueiro_id);
  payload.atendente_id = payload.atendente_id ? Number(payload.atendente_id) : null;
  try {
    await requestJson("/cliente/pedidos-tv/api/pedidos", { method: "POST", body: JSON.stringify(payload) });
    orderForm.reset();
    document.querySelector("#pickup-date").value = localDateInputValue();
    loadLastOrderNumber(); 
    formMessage.textContent = "Pedido registrado.";
    formMessage.className = "min-h-5 text-sm text-emerald-800";
    await loadOrders();
  } catch (error) {
    formMessage.textContent = error.message;
    formMessage.className = "min-h-5 text-sm text-red-700";
  }
});

ordersElement.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-complete], [data-edit], [data-delete]");
  if (!button) return;
  const order = currentOrders.find((item) => item.id === Number(button.dataset.complete || button.dataset.edit || button.dataset.delete));
  if (button.dataset.edit) {
    if (!order) return;
    await loadButchers();
    for (const [key, value] of Object.entries({
      id: order.id,
      numero_pedido: order.numero_pedido || "",
      cliente: order.cliente,
      acougueiro_id: order.acougueiro_id,
      atendente_id: order.atendente_id,
      tipo_entrega: order.tipo_entrega,
      data_retirada: order.data_retirada,
      hora_retirada: order.hora_retirada,
    })) {
      if (key === "tipo_entrega") {
        editForm.querySelector(`[name="${key}"][value="${value}"]`).checked = true;
      } else {
        editForm.elements.namedItem(key).value = value ?? "";
      }
    }
    editMessage.textContent = "";
    editDialog.showModal();
    return;
  }
  if (button.dataset.delete) {
    document.querySelector("#delete-order-id").value = button.dataset.delete;
    deleteForm.reset();
    deleteMessage.textContent = "";
    deleteDialog.showModal();
    return;
  }

  button.disabled = true;
  try {
    await requestJson(`/cliente/pedidos-tv/api/pedidos/${button.dataset.complete}/concluir`, { method: "POST" });
    await loadOrders();
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(editForm).entries());
  const orderId = payload.id;
  delete payload.id;
  payload.acougueiro_id = Number(payload.acougueiro_id);
  payload.atendente_id = Number(payload.atendente_id);
  payload.atendente_id = payload.atendente_id ? Number(payload.atendente_id) : null;
  try {
    await requestJson(`/cliente/pedidos-tv/api/pedidos/${orderId}`, { method: "PUT", body: JSON.stringify(payload) });
    editDialog.close();
    await loadOrders();
  } catch (error) {
    editMessage.textContent = error.message;
    editMessage.className = "min-h-5 text-sm text-red-700";
  }
});

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(deleteForm).entries());
  const orderId = payload.order_id;
  const btn = document.querySelector("#confirm-delete");
  
  btn.disabled = true;
  btn.textContent = "Excluindo...";
  
  try {
    await requestJson(`/cliente/pedidos-tv/api/pedidos/${orderId}`, {
      method: "DELETE", body: JSON.stringify({ senha: payload.senha }),
    });
    deleteDialog.close();
    await loadOrders();
  } catch (error) {
    deleteMessage.textContent = error.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Excluir Pedido";
  }
});

document.querySelector("#close-delete").addEventListener("click", () => deleteDialog.close());

document.querySelector("#close-edit").addEventListener("click", () => editDialog.close());

alertButton.addEventListener("click", async () => {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  await audioContext.resume();
  alertsEnabled = true;
  alertState.textContent = "Alertas ativados";
  alertState.className = "text-xs text-emerald-800";
  alertButton.textContent = "Alertas ativos";
  alertButton.disabled = true;
});

function localDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

document.querySelector("#pickup-date").value = localDateInputValue();
loadButchers().catch((error) => {
  butcherSelect.innerHTML = '<option value="">Falha ao carregar equipe</option>';
  formMessage.textContent = error.message;
});
loadOrders();
setInterval(() => renderOrders(currentOrders), 1000);

async function loadNextOrderNumber() {
  try {
    const data = await requestJson("/cliente/pedidos-tv/api/pedidos/proximo-numero");
    const input = document.querySelector('input[name="numero_pedido"]');
    // Mantém o número do pedido apenas quando o campo ainda não foi preenchido manualmente.
    if (!input.value) {
      input.value = data.proximo_numero;
    }
  } catch (error) {
    console.error("Falha ao buscar próximo número", error);
  }
}

// Carrega o último número registrado para exibir o histórico da sequência do cliente.
async function loadLastOrderNumber() {
  try {
    const data = await requestJson("/cliente/pedidos-tv/api/pedidos/ultimo-numero");
    const badge = document.querySelector('#last-order-badge');
    if (badge && data.ultimo_numero > 0) {
      badge.textContent = `(Último registrado: ${data.ultimo_numero})`;
    }
  } catch (error) {
    console.error("Falha ao buscar último número", error);
  }
}

// Atualiza o badge de histórico no carregamento inicial da tela de gestão.
loadLastOrderNumber();

const socket = io();
socket.on("atualizar_pedidos", () => {
  // Recebe a notificação do servidor e sincroniza a lista de pedidos sem recarregar a página.
  loadOrders();
  loadLastOrderNumber();
});