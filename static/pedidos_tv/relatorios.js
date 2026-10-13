// Elementos do painel de relatórios e filtros por intervalo de datas.
const filterForm = document.querySelector("#date-filter");
const reportMessage = document.querySelector("#report-message");
const completedRows = document.querySelector("#completed-rows");
const performanceRows = document.querySelector("#performance-rows");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

function localDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(date) {
  return date ? date.split("-").reverse().join("/") : "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const [date, time] = value.replace("T", " ").split(" ");
  return `${formatDate(date)} ${time?.slice(0, 5) || ""}`;
}

// Carrega o relatório de pedidos e desempenho para o período selecionado no filtro.
async function loadReports(event) {
  event?.preventDefault();
  const values = new FormData(filterForm);
  const query = new URLSearchParams({ inicio: values.get("inicio"), fim: values.get("fim") });
  document.querySelector("#export-pdf").href = `/cliente/pedidos-tv/api/relatorios/exportar/pdf?${query}`;
  document.querySelector("#export-xlsx").href = `/cliente/pedidos-tv/api/relatorios/exportar/xlsx?${query}`;
  reportMessage.textContent = "Carregando relatórios...";
  reportMessage.className = "mt-4 min-h-5 text-sm text-stone-600";
  try {
    const [ordersResponse, performanceResponse] = await Promise.all([
      fetch(`/cliente/pedidos-tv/api/relatorios/pedidos?${query}`),
      fetch(`/cliente/pedidos-tv/api/relatorios/desempenho?${query}`),
    ]);
    const orders = await ordersResponse.json();
    const performance = await performanceResponse.json();
    if (!ordersResponse.ok) throw new Error(orders.error || "Não foi possível carregar os pedidos.");
    if (!performanceResponse.ok) throw new Error(performance.error || "Não foi possível carregar o desempenho.");

    const lateCount = orders.filter((order) => (order.minutos_atraso || 0) > 0).length;
    document.querySelector("#total-orders").textContent = orders.length;
    document.querySelector("#on-time-orders").textContent = orders.length - lateCount;
    document.querySelector("#late-orders").textContent = lateCount;
    completedRows.innerHTML = orders.length ? orders.map((order) => {
      const late = (order.minutos_atraso || 0) > 0;
      const result = late
        ? `Atrasado · ${Number(order.minutos_atraso).toFixed(1)} min`
        : "No prazo";
      return `<tr>
        <td class="px-4 py-3 font-semibold">${escapeHtml(order.numero_pedido || order.id)}</td>
        <td class="px-4 py-3">${escapeHtml(order.cliente)}</td>
        <td class="px-4 py-3">${formatDate(order.data_retirada)} ${escapeHtml(order.hora_retirada)}</td>
        <td class="px-4 py-3">${escapeHtml(order.acougueiro)}</td>
        <td class="px-4 py-3">${escapeHtml(order.atendente || "—")}</td>
        <td class="px-4 py-3">${formatDateTime(order.concluido_em)}</td>
        <td class="px-4 py-3 font-semibold ${late ? "text-red-700" : "text-emerald-800"}">${result}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="7" class="px-4 py-8 text-center text-stone-500">Nenhum pedido concluído neste período.</td></tr>';

    performanceRows.innerHTML = performance.length ? performance.map((butcher) => `
      <tr><td class="px-4 py-3 font-semibold">${escapeHtml(butcher.acougueiro)}</td>
      <td class="px-4 py-3">${butcher.total}</td><td class="px-4 py-3 text-emerald-800">${butcher.no_prazo}</td>
      <td class="px-4 py-3 text-red-700">${butcher.atrasados}</td>
      <td class="px-4 py-3"><div class="flex flex-wrap gap-2">${butcher.pedidos.map((order) => {
        const late = order.resultado === "Atrasado";
        return `<span class="border px-2 py-1 text-xs ${late ? "border-red-300 text-red-800" : "border-emerald-300 text-emerald-800"}">#${escapeHtml(order.numero_pedido || order.pedido_id)} · ${order.resultado}${late ? ` (${Number(order.minutos_atraso).toFixed(1)} min)` : ""}</span>`;
      }).join("")}</div></td></tr>`).join("")
      : '<tr><td colspan="5" class="px-4 py-8 text-center text-stone-500">Sem pedidos concluídos por açougueiro neste período.</td></tr>';
    reportMessage.textContent = `${orders.length} pedido(s) concluído(s) no intervalo selecionado.`;
    reportMessage.className = "mt-4 min-h-5 text-sm text-emerald-800";
  } catch (error) {
    reportMessage.textContent = error.message;
    reportMessage.className = "mt-4 min-h-5 text-sm text-red-700";
  }
}

const today = new Date();
filterForm.elements.inicio.value = localDateValue(today);
filterForm.elements.fim.value = localDateValue(today);
filterForm.addEventListener("submit", loadReports);
loadReports();