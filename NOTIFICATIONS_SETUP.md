# Notificações do ObraFlow

O projeto agora possui:

- centro de notificações dentro do sistema;
- aviso de recebimento parcial;
- aviso de item completamente recebido;
- aviso quando todos os itens de uma categoria foram recebidos;
- aviso quando todos os materiais comprados da obra foram recebidos;
- notificações Web Push para Windows, Android e PWA instalado no iPhone/iPad;
- limpeza automática de tokens de aparelhos que deixaram de ser válidos.

## Publicar o backend

As notificações internas e push são geradas pela Cloud Function em `functions/index.js`.
Para ativá-la no projeto Firebase:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --project sistemsquared --only functions,database
```

O uso de Cloud Functions exige que o projeto Firebase aceite o plano necessário para implantação de funções.

## Publicar a interface

Publique a pasta `public` pelo processo já usado no projeto. Caso use Firebase Hosting:

```bash
firebase deploy --project sistemsquared --only hosting
```

## Chave Web Push personalizada

O cliente usa a chave Web Push padrão do Firebase quando nenhuma chave é informada. Para usar uma chave VAPID própria, gere a chave em **Configurações do projeto → Cloud Messaging → Configuração da Web** e adicione ao `<head>` de `public/index.html`:

```html
<meta name="obraflow-vapid-key" content="SUA_CHAVE_PUBLICA_VAPID" />
```

Nunca coloque uma chave privada no HTML.
