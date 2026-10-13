(() => {
  const root = document.documentElement;
  const themeButton = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");

  const atualizarBotaoTema = () => {
    const temaClaro = root.classList.contains("theme-light");
    if (!themeButton || !themeIcon || !themeLabel) return;
    themeButton.setAttribute("aria-pressed", String(temaClaro));
    themeButton.setAttribute(
      "aria-label",
      temaClaro ? "Ativar tema escuro" : "Ativar tema claro",
    );
    themeIcon.textContent = temaClaro ? "☾" : "☀";
    themeLabel.textContent = temaClaro ? "Tema escuro" : "Tema claro";
  };

  atualizarBotaoTema();
  if (themeButton) {
    themeButton.addEventListener("click", () => {
      const temaClaro = root.classList.toggle("theme-light");
      try {
        localStorage.setItem("gabesh-theme", temaClaro ? "light" : "dark");
      } catch (error) {
        console.warn("Não foi possível salvar a preferência de tema.", error);
      }
      atualizarBotaoTema();
    });
  }

  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("hidden") === false;
      links.classList.toggle("flex", open);
      links.classList.toggle("absolute", open);
      links.classList.toggle("left-0", open);
      links.classList.toggle("right-0", open);
      links.classList.toggle("top-16", open);
      links.classList.toggle("z-20", open);
      links.classList.toggle("flex-col", open);
      links.classList.toggle("items-stretch", open);
      links.classList.toggle("border-b", open);
      links.classList.toggle("border-line", open);
      links.classList.toggle("bg-ink", open);
      links.classList.toggle("p-5", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  document.querySelectorAll(".flash-message").forEach((message) => {
    window.setTimeout(() => {
      message.style.transition = "opacity 300ms ease";
      message.style.opacity = "0";
      window.setTimeout(() => message.remove(), 300);
    }, 7000);
  });
})();
