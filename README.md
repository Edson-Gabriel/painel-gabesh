# GabeSH.dev Sistemas & Automações

Portal Flask para captação de leads, gestão de clientes e controle de acesso a sistemas contratados.

O site oferece alternância entre tema claro e escuro no cabeçalho e salva a preferência neste navegador.

Ao enviar o formulário da landing page, o lead é salvo no banco e o navegador abre uma conversa com `+55 66 99935-7985` com os dados do pedido preenchidos. O CPF/CNPJ não é incluído na mensagem. Para concluir o contato, a pessoa precisa confirmar o envio no próprio WhatsApp. Descrições longas são resumidas no texto do WhatsApp; o conteúdo completo permanece no painel administrativo.

## Requisitos

- Python 3.10+
- Dependências de `requirements.txt`

## Instalação e execução local (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = py -c "import secrets; print(secrets.token_hex(32))"
flask --app app init-db
flask --app app run --debug
```

O SQLite será criado em `instance\gabesh.db`. Gere uma chave secreta forte e persistente para uso contínuo; não use a chave aleatória de desenvolvimento em produção.

## Criar o primeiro administrador

Configure as variáveis em uma sessão segura (não as salve no repositório) e execute o comando:

```powershell
$env:ADMIN_NAME = "Administrador"
$env:ADMIN_EMAIL = "admin@exemplo.com"
$env:ADMIN_PASSWORD = "uma-senha-forte-com-12-ou-mais"
flask --app app create-admin
```

O comando bloqueia a criação de um segundo administrador. Remova as variáveis de ambiente após o uso, se apropriado ao ambiente.

## Configuração

| Variável | Uso |
| --- | --- |
| `SECRET_KEY` | Chave de sessão e CSRF. Obrigatória com `APP_ENV=production`. |
| `DATABASE_URL` | URI SQLAlchemy. Padrão local: `sqlite:///gabesh.db`. |
| `APP_ENV` | Defina como `production` em produção. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Credenciais temporárias para `create-admin`; senha com no mínimo 12 caracteres. |

Em produção, use HTTPS, uma chave persistente guardada no gerenciador de segredos, banco gerenciado e servidor WSGI (por exemplo, Gunicorn em Linux). O script Tailwind por CDN é conveniente para desenvolvimento; para implantação, compile Tailwind como asset estático e revise a política CSP e os cabeçalhos de segurança do proxy.

## Portal e serviços

O administrador cadastra serviços com rotas locais iniciadas por `/cliente/` e habilita os acessos individualmente para cada cliente. Uma rota cadastrada deve corresponder a uma página real registrada pela aplicação; o portal não cria automaticamente o software de destino. Rotas que forem implementadas nesta aplicação são conferidas pelo middleware com base no vínculo ativo. Sistemas hospedados em outros domínios também precisam validar a identidade e a autorização no próprio destino.

O painel mostra faturamento estimado como indisponível porque o modelo inicial não registra valores de contrato. Nenhum dado ou usuário de demonstração é criado automaticamente.

## Testes

Com as dependências instaladas, execute:

```powershell
py -m unittest discover -s tests -v
```
