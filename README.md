# ObraFlow - Controle de Materiais por Obra

Aplicação web responsiva para controlar materiais, compras, estoque, recebimento, pintura opcional, separação e envio para a obra. Os dados ficam no Firebase Realtime Database e são atualizados em tempo real para toda a equipe.

## O que já está implementado

- Cadastro de várias obras, cada uma com seus próprios materiais e prazos.
- Painel gerencial com progresso, pendências, compras atrasadas e pintura atrasada.
- Material com origem em **compra** ou **estoque**.
- Etapa de pintura **opcional**: só aparece quando o item é marcado como “vai para pintura”.
- Fluxo completo: comprar/reservar → receber → pintar → separar → enviar para a obra.
- Recebimentos, retornos e separações parciais.
- Histórico de movimentações por obra e usuário.
- Perfis: Gerente, Compras, Almoxarifado, Produção e Operador.
- Importador de XLSX/XLS com seleção da aba, detecção do cabeçalho, mapeamento de colunas e prévia.
- Importador de PDF com leitores preparados para os formatos de **Vidros agrupados por código** e **Vedaportas**.
- Catálogo de estoque com saldo, estoque mínimo e localização.
- Interface responsiva para computador, tablet e celular.

## Estrutura da pasta

```text
controle-obras-firebase/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── docs/
│   └── estrutura-banco.md
├── database.rules.json
├── firebase.json
├── .firebaserc
└── README.md
```

## Configuração inicial do Firebase

### 1. Ativar login com e-mail e senha

No Firebase Console:

1. Abra **Authentication**.
2. Clique em **Sign-in method**.
3. Ative **E-mail/senha**.

### 2. Publicar as regras e o site

Instale a CLI do Firebase caso ainda não tenha:

```bash
npm install -g firebase-tools
firebase login
```

Na pasta do projeto:

```bash
firebase use systemsquared
firebase deploy --only database,hosting
```

### 3. Criar a primeira gerente

1. Abra o endereço publicado.
2. Clique em **Criar primeiro acesso** e faça o cadastro.
3. No Firebase Console, abra **Authentication > Users** e copie o `UID` do usuário.
4. No **Realtime Database**, localize `users/UID/role` e altere o valor de `operador` para `gerente`.
5. Saia e entre novamente no sistema.

Depois disso, a gerente poderá alterar os perfis dos demais usuários pela tela **Usuários**.

## Testar localmente

Como o projeto usa módulos JavaScript, abra por um servidor HTTP em vez de clicar diretamente no arquivo HTML:

```bash
cd public
python -m http.server 5500
```

Acesse `http://localhost:5500`.

## Como usar no dia a dia

1. Cadastre a obra.
2. Adicione os materiais manualmente ou use **Importar arquivos**.
3. Para cada material, defina a origem:
   - **Precisa comprar**: informe fornecedor, pedido, data e previsão.
   - **Já existe no estoque**: informe a quantidade reservada e a localização.
4. Marque **Este material vai para pintura** somente nos itens necessários.
5. A equipe atualiza as etapas com os botões de ação rápida.
6. A gerente acompanha tudo na **Visão geral** e pode abrir o detalhe de cada obra.

## Importação de planilhas

O sistema:

- encontra automaticamente a linha do cabeçalho;
- sugere o mapeamento de Código, Descrição, Tipo, Quantidade, Unidade, Cor, Medidas, Área e Observações;
- permite trocar a aba e ajustar cada coluna;
- ignora títulos, linhas vazias, resumos e assinaturas;
- salva colunas extras em `sourceDetails`, sem perder a informação original.

Isso permite subir planilhas com abas como perfis, ferragens, cantoneiras, motores, persianas, reforços, telas e vidros, sem deixar o sistema preso a um único modelo.

## Importação de PDF

Há dois leitores automáticos:

- **Vidros agrupados por código**: código do vidro, descrição, tipologia, quantidade, largura, altura e área.
- **Vedaportas**: tipologia, largura, modelo, quantidade e cor.

PDFs diferentes desses modelos ficam visíveis como texto extraído para conferência, mas não são gravados automaticamente. Assim, um arquivo desconhecido não cria materiais errados.

## Segurança

O objeto `firebaseConfig` identifica o projeto web e normalmente fica no código do cliente. A proteção real está nas regras do Realtime Database e na autenticação. Não deixe o banco em modo público/teste.

As regras incluídas fazem o seguinte:

- só usuários autenticados e ativos podem ler;
- somente Gerente ou Compras alteram dados gerais das obras;
- usuários ativos podem atualizar materiais e o fluxo operacional;
- somente a Gerente exclui obras e materiais;
- somente Gerente ou Almoxarifado alteram o estoque;
- somente a Gerente altera perfis e permissões.

## Próximas evoluções recomendadas

- anexos de pedido, nota fiscal e foto do recebimento usando Firebase Storage;
- notificações de prazo por e-mail/WhatsApp;
- reserva automática que baixa o saldo do estoque;
- relatório em PDF por obra;
- custos previstos e realizados;
- Cloud Functions para consolidar os indicadores em projetos com muitos milhares de itens.
