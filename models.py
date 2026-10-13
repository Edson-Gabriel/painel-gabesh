"""Modelos do sistema GabeSH.dev: leads, clientes, serviços e pedidos da TV."""

from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from sqlalchemy import UniqueConstraint
from werkzeug.security import check_password_hash, generate_password_hash


db = SQLAlchemy()


class Lead(db.Model):
    """Oportunidade capturada no formulário inicial de orçamento."""

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(160), nullable=False)
    whatsapp = db.Column(db.String(32), nullable=False)
    email = db.Column(db.String(254), nullable=False, index=True)
    tipo_cliente = db.Column(db.String(2), nullable=False)
    documento = db.Column(db.String(18), nullable=False)
    tipo_solucao = db.Column(db.String(40), nullable=False)
    descricao_projeto = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="Pendente")
    data_criacao = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class Usuario(UserMixin, db.Model):
    """Conta autenticada do cliente ou do administrador do sistema."""

    id = db.Column(db.Integer, primary_key=True)
    nome_ou_razao = db.Column(db.String(160), nullable=False)
    email = db.Column(db.String(254), nullable=False, unique=True, index=True)
    senha_hash = db.Column(db.String(255), nullable=False)
    tipo_cliente = db.Column(db.String(2), nullable=False)
    documento = db.Column(db.String(18), nullable=True)
    role = db.Column(db.String(20), nullable=False, default="cliente")
    status_projeto = db.Column(
        db.String(32), nullable=False, default="Briefing"
    )
    telefone = db.Column(db.String(32), nullable=True)
    cep = db.Column(db.String(16), nullable=True)
    estado = db.Column(db.String(2), nullable=True)
    cidade = db.Column(db.String(120), nullable=True)
    bairro = db.Column(db.String(120), nullable=True)
    rua = db.Column(db.String(160), nullable=True)
    numero = db.Column(db.String(32), nullable=True)
    complemento = db.Column(db.String(120), nullable=True)
    referencia = db.Column(db.String(160), nullable=True)
    ativo = db.Column(db.Boolean, nullable=False, default=True)

    servicos_vinculados = db.relationship(
        "UsuarioServico", back_populates="usuario", cascade="all, delete-orphan"
    )

    @property
    def is_active(self):
        return self.ativo

    def definir_senha(self, senha):
        self.senha_hash = generate_password_hash(senha)

    def verificar_senha(self, senha):
        return check_password_hash(self.senha_hash, senha)


class Servico(db.Model):
    """Área restrita do portal acessível por cliente autorizado."""

    id = db.Column(db.Integer, primary_key=True)
    nome_exibicao = db.Column(db.String(120), nullable=False, unique=True)
    rota_acesso = db.Column(db.String(255), nullable=False, unique=True)

    usuarios_vinculados = db.relationship(
        "UsuarioServico", back_populates="servico", cascade="all, delete-orphan"
    )


class UsuarioServico(db.Model):
    """Vínculo entre usuário e serviço, permitindo controle de acesso granular."""

    __table_args__ = (
        UniqueConstraint("usuario_id", "servico_id", name="uq_usuario_servico"),
    )

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(
        db.Integer, db.ForeignKey("usuario.id"), nullable=False, index=True
    )
    servico_id = db.Column(
        db.Integer, db.ForeignKey("servico.id"), nullable=False, index=True
    )
    ativo = db.Column(db.Boolean, nullable=False, default=True)

    usuario = db.relationship("Usuario", back_populates="servicos_vinculados")
    servico = db.relationship("Servico", back_populates="usuarios_vinculados")


class Acougueiro(db.Model):
    """Funcionário responsável por atender um pedido na TV."""

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False)
    nome = db.Column(db.String(100), nullable=False)
    ativo = db.Column(db.Boolean, default=True)


class Atendente(db.Model):
    """Colaborador que acompanha a operação de retirada."""

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False)
    nome = db.Column(db.String(100), nullable=False)
    ativo = db.Column(db.Boolean, default=True)


class Pedido(db.Model):
    """Pedido registrado para controle de retirada e acompanhamento do prazo."""

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False)
    numero_pedido = db.Column(db.String(30))
    nome_cliente = db.Column(db.String(120), nullable=False)
    data_retirada = db.Column(db.String(10), nullable=False)
    hora_retirada = db.Column(db.String(5), nullable=False)
    acougueiro_id = db.Column(db.Integer, db.ForeignKey('acougueiro.id'), nullable=False)
    atendente_id = db.Column(db.Integer, db.ForeignKey('atendente.id'))
    tipo_entrega = db.Column(db.String(20), default='Retirada')
    status = db.Column(db.String(20), default='Pendente')
    data_hora_conclusao = db.Column(db.String(20))

    acougueiro = db.relationship('Acougueiro')
    atendente = db.relationship('Atendente')


class ConfiguracaoTV(db.Model):
    """Configurações pessoais do cliente para a tela de pedidos e liberação de exclusão."""

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False, unique=True)
    senha_exclusao = db.Column(db.String(50), default="0000")
