import eventlet
eventlet.monkey_patch()
import os
import re
from extensions import socketio
from flask_socketio import join_room
from datetime import datetime
from functools import wraps
from urllib.parse import urlencode, urljoin, urlparse

import click
from flask import (
    Flask, abort, flash, redirect, render_template, request, url_for
)
from flask_login import LoginManager, current_user, login_required, login_user, logout_user
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from models import Lead, Servico, Usuario, UsuarioServico, db

TIPOS_CLIENTE = {"PF", "PJ"}
TIPOS_SOLUCAO = {"Sistema Web", "App", "Automação", "Outra"}
STATUS_LEAD = {"Pendente", "Respondido"}
STATUS_PROJETO = {"Briefing", "Em Desenvolvimento", "Ativo"}
WHATSAPP_DESTINO = "5566999357985"
REGEX_EMAIL = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

login_manager = LoginManager()
csrf = CSRFProtect()

def _validar_cpf_cnpj(documento, tipo_cliente):
    digitos = re.sub(r"\D", "", documento or "")
    esperado = 11 if tipo_cliente == "PF" else 14
    if len(digitos) != esperado:
        raise ValueError(f"Informe um {'CPF' if tipo_cliente == 'PF' else 'CNPJ'} com {esperado} dígitos.")
    if digitos == digitos[0] * len(digitos):
        raise ValueError("Documento inválido.")
    return digitos

def _destino_local_seguro(destino):
    if not destino or "\\" in destino or any(ord(c) < 32 for c in destino):
        return None
    base = urlparse(request.host_url)
    alvo = urlparse(urljoin(request.host_url, destino))
    if alvo.scheme in {"http", "https"} and alvo.netloc == base.netloc and not alvo.username:
        return alvo.path + (f"?{alvo.query}" if alvo.query else "")
    return None

def _papel_requerido(*papeis):
    def decorar(view):
        @wraps(view)
        @login_required
        def protegido(*args, **kwargs):
            if current_user.role not in papeis:
                abort(403)
            if not current_user.ativo:
                logout_user()
                flash("Sua conta está desativada. Fale com o suporte.", "error")
                return redirect(url_for("login"))
            return view(*args, **kwargs)
        return protegido
    return decorar

def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", os.urandom(32)),
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", "sqlite:///gabesh.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        WTF_CSRF_TIME_LIMIT=None,
    )
    
    if test_config:
        app.config.update(test_config)
    if os.environ.get("APP_ENV") == "production" and not os.environ.get("SECRET_KEY"):
        raise RuntimeError("Configure SECRET_KEY na produção.")

    os.makedirs(app.instance_path, exist_ok=True)
    db.init_app(app)
    login_manager.init_app(app)
    csrf.init_app(app)
    socketio.init_app(app, cors_allowed_origins="*")
    
    from pedidos_tv import bp_tv
    app.register_blueprint(bp_tv)
    
    login_manager.login_view = "login"
    login_manager.login_message = "Entre para acessar esta página."
    login_manager.login_message_category = "info"

    @login_manager.user_loader
    def carregar_usuario(usuario_id):
        return db.session.get(Usuario, int(usuario_id)) if str(usuario_id).isdigit() else None

    @app.context_processor
    def adicionar_ano_corrente():
        return {"current_year": datetime.now().year}

    @app.before_request
    def proteger_rotas_de_servico():
        if request.endpoint in ('static', 'index', 'login', 'logout') or not request.path.startswith('/cliente/'):
            return None

        servico = db.session.execute(
            db.select(Servico).where(Servico.rota_acesso == request.path)
        ).scalar_one_or_none()
        
        if not servico:
            return None
            
        if not current_user.is_authenticated:
            return redirect(url_for("login", next=request.url))
            
        if current_user.role == "admin":
            return None
            
        if current_user.role != "cliente" or not current_user.ativo:
            abort(403)
            
        vinculo = db.session.execute(
            db.select(UsuarioServico.id).where(
                UsuarioServico.usuario_id == current_user.id,
                UsuarioServico.servico_id == servico.id,
                UsuarioServico.ativo.is_(True),
            )
        ).first()
        
        if not vinculo:
            abort(403)

    @app.route("/", methods=["GET", "POST"])
    def index():
        # Mantém os dados do formulário para evitar perda ao falhar a validação.
        dados = {}
        if request.method == "POST":
            dados = request.form.to_dict()
            nome = dados.get("nome", "").strip()
            whatsapp = dados.get("whatsapp", "").strip()
            email = dados.get("email", "").strip().lower()
            tipo_cliente = dados.get("tipo_cliente", "")
            tipo_solucao = dados.get("tipo_solucao", "")
            descricao = dados.get("descricao_projeto", "").strip()
            consentimento_lgpd = dados.get("lgpd_consent")
            
            erros = []
            if not nome or len(nome) > 160:
                erros.append("O Nome / Razão social é obrigatório e deve ter no máximo 160 caracteres.")
            if not REGEX_EMAIL.match(email) or len(email) > 254:
                erros.append("E-mail inválido. Verifique se o formato está correto (ex: voce@email.com).")
            if not whatsapp or len(whatsapp) > 32:
                erros.append("O número de WhatsApp é obrigatório.")
            if tipo_cliente not in TIPOS_CLIENTE:
                erros.append("Selecione um Tipo de Cliente válido (PF ou PJ).")
            if tipo_solucao not in TIPOS_SOLUCAO:
                erros.append("Selecione uma Solução de interesse válida.")
            if not descricao or len(descricao) > 5000:
                erros.append("Por favor, conte-nos um pouco sobre o seu projeto na descrição.")
            if not consentimento_lgpd:
                erros.append("É necessário concordar com a Política de Privacidade para enviar o formulário.")

            if erros:
                for erro in erros:
                    flash(erro, "error")
                # Mantém as informações preenchidas para que o usuário possa corrigir apenas os campos inválidos.
                return render_template("index.html", dados=dados), 400

            db.session.add(Lead(
                nome=nome, whatsapp=whatsapp, email=email,
                tipo_cliente=tipo_cliente, documento="",
                tipo_solucao=tipo_solucao, descricao_projeto=descricao
            ))
            db.session.commit()
            
            resumo = descricao[:1500] + "… (continuação salva)" if len(descricao) > 1500 else descricao
            mensagem = f"Novo orçamento:\nNome: {nome}\nWhatsApp: {whatsapp}\nE-mail: {email}\nPerfil: {tipo_cliente}\nSolução: {tipo_solucao}\nProjeto: {resumo}"
            
            destino_whatsapp = f"https://wa.me/{WHATSAPP_DESTINO}?{urlencode({'text': mensagem})}"
            
            flash("Solicitação enviada! Abrindo o WhatsApp...", "success")
            return render_template("index.html", whatsapp_url=destino_whatsapp)
            
        return render_template("index.html", dados=dados)

    # Página pública com a política de privacidade do formulário principal.
    @app.route("/privacidade", methods=["GET"])
    def privacidade():
        return render_template("privacidade.html")

    # Fluxo de exclusão do cliente: remove dependências e apaga a conta do usuário de forma consistente.

    @app.post("/admin/clientes/<int:usuario_id>/excluir")
    @_papel_requerido("admin")
    def excluir_cliente(usuario_id):
        usuario = db.get_or_404(Usuario, usuario_id)
        if usuario.role == "admin":
            abort(403, "Não é possível excluir contas administrativas.")
            
        # Remove os vínculos do cliente com serviços antes de apagar a conta para não deixar registros órfãos.
        for vinculo in usuario.servicos_vinculados:
            db.session.delete(vinculo)
            
        db.session.delete(usuario)
        db.session.commit()
        flash(f"Os dados do cliente '{usuario.nome_ou_razao}' foram excluídos permanentemente.", "success")
        return redirect(url_for("admin") + "#clientes")

    @app.post("/admin/leads/<int:lead_id>/excluir")
    @_papel_requerido("admin")
    def excluir_lead(lead_id):
        lead = db.get_or_404(Lead, lead_id)
        db.session.delete(lead)
        db.session.commit()
        flash("Lead excluído permanentemente da base de dados.", "success")
        return redirect(url_for("admin") + "#leads")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("admin" if current_user.role == "admin" else "portal"))
            
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            senha = request.form.get("senha", "")
            
            usuario = db.session.execute(
                db.select(Usuario).where(Usuario.email == email)
            ).scalar_one_or_none()
            
            if not usuario or not usuario.verificar_senha(senha):
                flash("E-mail ou senha inválidos.", "error")
                return render_template("login.html"), 401
                
            if not usuario.ativo:
                flash("Sua conta está desativada. Fale com o suporte.", "error")
                return render_template("login.html"), 403
                
            login_user(usuario)
            proximo = _destino_local_seguro(request.args.get("next"))
            return redirect(proximo or url_for("admin" if usuario.role == "admin" else "portal"))
            
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        logout_user()
        flash("Você saiu da sua conta.", "success")
        return redirect(url_for("index"))

    @app.get("/portal")
    @_papel_requerido("cliente")
    def portal():
        servicos = db.session.execute(
            db.select(Servico).join(UsuarioServico).where(
                UsuarioServico.usuario_id == current_user.id,
                UsuarioServico.ativo.is_(True)
            ).order_by(Servico.nome_exibicao)
        ).scalars().all()
        return render_template("portal.html", servicos=servicos)

    @app.get("/admin")
    @_papel_requerido("admin")
    def admin():
        filtro_tipo = request.args.get("tipo_cliente", "")
        filtro_servico = request.args.get("servico_id", type=int)
        filtro_solucao = request.args.get("tipo_solucao", "")
        filtro_status_lead = request.args.get("status_lead", "")

        q_usuarios = db.select(Usuario).where(Usuario.role == "cliente")
        if filtro_tipo in TIPOS_CLIENTE:
            q_usuarios = q_usuarios.where(Usuario.tipo_cliente == filtro_tipo)
        if filtro_servico:
            q_usuarios = q_usuarios.join(UsuarioServico).where(
                UsuarioServico.servico_id == filtro_servico, UsuarioServico.ativo.is_(True)
            ).distinct()
            
        usuarios = db.session.scalars(q_usuarios.order_by(Usuario.nome_ou_razao)).all()

        q_leads = db.select(Lead)
        if filtro_solucao in TIPOS_SOLUCAO:
            q_leads = q_leads.where(Lead.tipo_solucao == filtro_solucao)
        if filtro_status_lead in STATUS_LEAD:
            q_leads = q_leads.where(Lead.status == filtro_status_lead)
            
        leads = db.session.scalars(q_leads.order_by(Lead.data_criacao.desc())).all()

        metricas = {
            "leads_pendentes": db.session.scalar(db.select(func.count(Lead.id)).where(Lead.status == "Pendente")),
            "clientes_pf": db.session.scalar(db.select(func.count(Usuario.id)).where(Usuario.role == "cliente", Usuario.tipo_cliente == "PF")),
            "clientes_pj": db.session.scalar(db.select(func.count(Usuario.id)).where(Usuario.role == "cliente", Usuario.tipo_cliente == "PJ")),
            "projetos_ativos": db.session.scalar(db.select(func.count(Usuario.id)).where(Usuario.role == "cliente", Usuario.status_projeto == "Ativo", Usuario.ativo.is_(True))),
        }
        
        servicos = db.session.scalars(db.select(Servico).order_by(Servico.nome_exibicao)).all()
        
        return render_template(
            "admin.html", usuarios=usuarios, leads=leads, servicos=servicos,
            metricas=metricas, status_projeto=sorted(STATUS_PROJETO),
            status_lead=sorted(STATUS_LEAD), tipos_cliente=sorted(TIPOS_CLIENTE),
            tipos_solucao=sorted(TIPOS_SOLUCAO), filtro_tipo=filtro_tipo,
            filtro_servico=filtro_servico, filtro_solucao=filtro_solucao, filtro_status_lead=filtro_status_lead
        )

    @app.post("/admin/leads/<int:lead_id>/status")
    @_papel_requerido("admin")
    def atualizar_lead(lead_id):
        lead = db.get_or_404(Lead, lead_id)
        status = request.form.get("status", "")
        if status not in STATUS_LEAD:
            abort(400, "Status de lead inválido.")
        lead.status = status
        db.session.commit()
        flash("Status do lead atualizado.", "success")
        return redirect(url_for("admin") + "#leads")

    @app.post("/admin/clientes/criar")
    @_papel_requerido("admin")
    def criar_cliente():
        nome = request.form.get("nome_ou_razao", "").strip()
        email = request.form.get("email", "").strip().lower()
        senha = request.form.get("senha", "")
        tipo = request.form.get("tipo_cliente", "")
        documento = request.form.get("documento", "")
        
        # Captura os campos de contato e endereço que vêm do formulário de cadastro do cliente.
        telefone = request.form.get("telefone", "").strip()
        cep = re.sub(r"\D", "", request.form.get("cep", ""))
        estado = request.form.get("estado", "").strip()
        cidade = request.form.get("cidade", "").strip()
        bairro = request.form.get("bairro", "").strip()
        rua = request.form.get("rua", "").strip()
        numero = request.form.get("numero", "").strip()
        complemento = request.form.get("complemento", "").strip()
        referencia = request.form.get("referencia", "").strip()
        
        # Valida cada campo do cliente antes de criar a conta para evitar dados incompletos ou inconsistentes.
        if not nome or len(nome) > 160:
            flash("Nome ou razão social inválido.", "error")
            return redirect(url_for("admin") + "#clientes")
            
        if not REGEX_EMAIL.match(email) or len(email) > 254:
            flash("Formato de e-mail inválido. Verifique se não falta o domínio (ex: .com).", "error")
            return redirect(url_for("admin") + "#clientes")
            
        if len(senha) < 12:
            flash("A senha deve ter ao menos 12 caracteres.", "error")
            return redirect(url_for("admin") + "#clientes")
            
        if tipo not in TIPOS_CLIENTE:
            flash("Tipo de cliente selecionado é inválido.", "error")
            return redirect(url_for("admin") + "#clientes")
            
        if not telefone:
            flash("O telefone de contato é obrigatório.", "error")
            return redirect(url_for("admin") + "#clientes")
            
        if not estado or not cidade or not bairro or not rua or not numero:
            flash("Endereço incompleto. Estado, Cidade, Bairro, Rua e Número são obrigatórios.", "error")
            return redirect(url_for("admin") + "#clientes")
            
        try:
            documento_limpo = _validar_cpf_cnpj(documento, tipo)
        except ValueError as erro:
            flash(str(erro), "error")
            return redirect(url_for("admin") + "#clientes")
            
        # Cria o cliente com o cadastro completo e com status inicial de briefing para iniciar o relacionamento.
        usuario = Usuario(
            nome_ou_razao=nome, email=email, tipo_cliente=tipo,
            documento=documento_limpo, role="cliente", status_projeto="Briefing", ativo=True,
            telefone=telefone, cep=cep, estado=estado, cidade=cidade, bairro=bairro,
            rua=rua, numero=numero, complemento=complemento, referencia=referencia
        )
        usuario.definir_senha(senha)
        db.session.add(usuario)
        
        try:
            db.session.commit()
            flash("Cliente criado com sucesso.", "success")
        except IntegrityError:
            db.session.rollback()
            flash("Já existe uma conta com este e-mail.", "error")
            
        return redirect(url_for("admin") + "#clientes")
    
    @app.post("/admin/clientes/<int:usuario_id>/editar")
    @_papel_requerido("admin")
    def editar_cliente(usuario_id):
        usuario = db.get_or_404(Usuario, usuario_id)
        if usuario.role != "cliente":
            abort(404)
        status = request.form.get("status_projeto", "")
        if status not in STATUS_PROJETO:
            abort(400, "Status de projeto inválido.")
        usuario.status_projeto = status
        usuario.ativo = request.form.get("ativo") == "on"
        db.session.commit()
        flash("Dados do cliente atualizados.", "success")
        return redirect(url_for("admin") + "#clientes")

    @app.post("/admin/clientes/<int:usuario_id>/dados")
    @_papel_requerido("admin")
    def editar_dados_cliente(usuario_id):
        usuario = db.get_or_404(Usuario, usuario_id)
        if usuario.role != "cliente":
            abort(404)
        
        email = request.form.get("email", "").strip().lower()
        telefone = request.form.get("telefone", "").strip()
        
        # O cadastro do cliente exige contato válido para que a operação e a comunicação estejam sempre rastreáveis.
        if not REGEX_EMAIL.match(email) or not telefone:
            flash("E-mail e Telefone são obrigatórios e devem ser válidos.", "error")
            return redirect(url_for("admin") + "#clientes")
            
        usuario.nome_ou_razao = request.form.get("nome_ou_razao", usuario.nome_ou_razao).strip()
        usuario.email = email
        usuario.telefone = telefone
        usuario.cep = re.sub(r"\D", "", request.form.get("cep", ""))
        usuario.estado = request.form.get("estado", "").strip()
        usuario.cidade = request.form.get("cidade", "").strip()
        usuario.bairro = request.form.get("bairro", "").strip()
        usuario.rua = request.form.get("rua", "").strip()
        usuario.numero = request.form.get("numero", "").strip()
        usuario.complemento = request.form.get("complemento", "").strip()
        usuario.referencia = request.form.get("referencia", "").strip()
        
        try:
            db.session.commit()
            flash("Dados cadastrais do cliente atualizados com sucesso.", "success")
        except IntegrityError:
            db.session.rollback()
            flash("Erro: Este e-mail já está em uso por outra conta.", "error")
            
        return redirect(url_for("admin") + "#clientes")
    
    @app.post("/admin/clientes/<int:usuario_id>/servicos")
    @_papel_requerido("admin")
    def atualizar_servicos_cliente(usuario_id):
        usuario = db.get_or_404(Usuario, usuario_id)
        if usuario.role != "cliente":
            abort(404)
        ids_selecionados = {int(valor) for valor in request.form.getlist("servico_ids") if valor.isdigit()}
        ids_validos = set(db.session.scalars(db.select(Servico.id)).all())
        
        if not ids_selecionados.issubset(ids_validos):
            abort(400, "Um ou mais serviços selecionados não existem.")
            
        vinculos = {vinculo.servico_id: vinculo for vinculo in usuario.servicos_vinculados}
        for servico_id in ids_validos:
            vinculo = vinculos.get(servico_id)
            if vinculo is None:
                if servico_id in ids_selecionados:
                    db.session.add(UsuarioServico(usuario_id=usuario.id, servico_id=servico_id, ativo=True))
            else:
                vinculo.ativo = servico_id in ids_selecionados
                
        db.session.commit()
        flash("Acessos do cliente atualizados.", "success")
        return redirect(url_for("admin") + "#clientes")

    @app.post("/admin/servicos/criar")
    @_papel_requerido("admin")
    def criar_servico():
        nome = request.form.get("nome_exibicao", "").strip()
        rota = request.form.get("rota_acesso", "").strip().rstrip("/")
        
        if not nome or len(nome) > 120 or len(rota) > 255 or not re.match(r"^/cliente/[\w-]+$", rota):
            flash("Rota inválida. Deve iniciar com /cliente/ e conter apenas letras, números e hifens.", "error")
            return redirect(url_for("admin") + "#servicos")
            
        db.session.add(Servico(nome_exibicao=nome, rota_acesso=rota))
        try:
            db.session.commit()
            flash("Serviço cadastrado.", "success")
        except IntegrityError:
            db.session.rollback()
            flash("Já existe um serviço com esse nome ou rota.", "error")
            
        return redirect(url_for("admin") + "#servicos")

    @app.cli.command("init-db")
    def init_db():
        with app.app_context():
            db.create_all()
        click.echo("Tabelas criadas.")

    @app.cli.command("create-admin")
    def create_admin():
        nome = os.environ.get("ADMIN_NAME", "").strip()
        email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
        senha = os.environ.get("ADMIN_PASSWORD", "")
        if not nome or not REGEX_EMAIL.match(email) or len(senha) < 12:
            raise click.ClickException("Defina ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 12 caracteres).")
            
        if db.session.execute(db.select(Usuario.id).where(Usuario.role == "admin")).first():
            raise click.ClickException("Já existe um usuário administrador.")
            
        admin_usuario = Usuario(
            nome_ou_razao=nome, email=email, senha_hash="", tipo_cliente="PJ",
            documento="00000000000000", role="admin", status_projeto="Ativo", ativo=True
        )
        admin_usuario.definir_senha(senha)
        db.session.add(admin_usuario)
        try:
            db.session.commit()
        except IntegrityError as erro:
            db.session.rollback()
            raise click.ClickException("Não foi possível criar o administrador; confira se o e-mail já está cadastrado.") from erro
        click.echo(f"Administrador {email} criado.")

    return app

app = create_app()
@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(f"room_{current_user.id}")