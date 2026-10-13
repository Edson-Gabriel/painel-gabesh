// Elementos do painel de cadastro do módulo de pedidos da TV.
const butcherList = document.querySelector("#butchers");
const attendantList = document.querySelector("#attendants");
const butcherForm = document.querySelector("#butcher-form");
const attendantForm = document.querySelector("#attendant-form");
const butcherMessage = document.querySelector("#form-message");
const attendantMessage = document.querySelector("#attendant-message");

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

// Renderiza a lista de colaboradores com status ativo/inativo para o painel administrativo.
function renderPeople(list, people, kind) {
  list.innerHTML = people.length ? people.map((person) => `
    <article class="flex items-center justify-between gap-4 p-4">
      <div><h3 class="font-semibold">${escapeHtml(person.nome)}</h3>
      <p class="mt-1 text-sm ${person.ativo ? "text-emerald-800" : "text-stone-500"}">${person.ativo ? "Ativo" : "Inativo"}</p></div>
      <button data-kind="${kind}" data-id="${person.id}" data-active="${person.ativo ? 1 : 0}" class="rounded border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-100">${person.ativo ? "Desativar" : "Ativar"}</button>
    </article>`).join("") : `<p class="p-5 text-sm text-stone-500">Nenhum ${kind === "atendente" ? "atendente" : "açougueiro"} cadastrado.</p>`;
}

async function loadPeople() {
  const [butchers, attendants] = await Promise.all([
    requestJson("/cliente/pedidos-tv/api/acougueiros"), requestJson("/cliente/pedidos-tv/api/atendentes"),
  ]);
  renderPeople(butcherList, butchers, "acougueiro");
  renderPeople(attendantList, attendants, "atendente");
}

function configureForm(form, endpoint, message, label) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nome = new FormData(form).get("nome").trim();
    try {
      await requestJson(endpoint, { method: "POST", body: JSON.stringify({ nome }) });
      form.reset();
      message.textContent = `${label} cadastrado.`;
      message.className = "mt-3 min-h-5 text-sm text-emerald-800";
      await loadPeople();
    } catch (error) {
      message.textContent = error.message;
      message.className = "mt-3 min-h-5 text-sm text-red-700";
    }
  });
}

configureForm(butcherForm, "/cliente/pedidos-tv/api/acougueiros", butcherMessage, "Açougueiro");
configureForm(attendantForm, "/cliente/pedidos-tv/api/atendentes", attendantMessage, "Atendente");

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id][data-kind]");
  if (!button) return;
  button.disabled = true;
  const endpoint = button.dataset.kind === "atendente" ? "atendentes" : "acougueiros";
  const message = button.dataset.kind === "atendente" ? attendantMessage : butcherMessage;
  try {
    await requestJson(`/cliente/pedidos-tv/api/${endpoint}/${button.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ativo: button.dataset.active !== "1" }),
    });
    await loadPeople();
  } catch (error) {
    button.disabled = false;
    message.textContent = error.message;
  }
});

loadPeople().catch((error) => { butcherMessage.textContent = error.message; });

const configForm = document.querySelector("#config-form");
const configMessage = document.querySelector("#config-message");

// Atualiza a senha de liberação usada para excluir pedidos e evitar remoções acidentais.
configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(configForm);
  const senhaAtual = formData.get("senha_atual").trim();
  const novaSenha = formData.get("nova_senha").trim();
  
  try {
    await requestJson("/cliente/pedidos-tv/api/configuracao", {
      method: "PUT", 
      body: JSON.stringify({ 
        senha_atual: senhaAtual, 
        nova_senha: novaSenha 
      })
    });
    configForm.reset();
    configMessage.textContent = "Senha alterada com sucesso.";
    configMessage.className = "mt-3 min-h-5 text-sm text-emerald-800";
  } catch (error) {
    configMessage.textContent = error.message;
    configMessage.className = "mt-3 min-h-5 text-sm text-red-700";
  }
});