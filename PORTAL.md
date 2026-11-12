# Portal MaxDistrib

A vitrine estática continua disponível. O portal em `/minha-conta` usa a função `/api/portal` e PostgreSQL no esquema `maxdistrib`. A gestão de contas, estoque operacional e pedidos usa a mesma rota após login com uma conta administrativa. O estoque e o galpão demonstrativos continuam identificados como demonstração.

## Configuração

- `MAXDISTRIB_DATABASE_URL` recebe a conexão PostgreSQL exclusiva deste projeto, via variável protegida no ambiente da Vercel. Configure TLS conforme o provedor.
- `MAXDISTRIB_ORIGIN` recebe a origem HTTPS do ambiente correspondente. Configure produção e homologação separadamente.
- `MAXDISTRIB_TERMS_URL`, `MAXDISTRIB_PRIVACY_URL` e `MAXDISTRIB_TERMS_VERSION` habilitam cadastro após configurar os textos oficiais.
- `MAXDISTRIB_DELIVERY_QUOTE=1` habilita solicitações de pedido com frete a cotar, se essa modalidade fizer parte da operação.
- `MAXDISTRIB_RESEND_KEY` e `MAXDISTRIB_EMAIL_FROM` habilitam recuperação por e-mail. Use remetente verificado.
- `MAXDISTRIB_WHATSAPP_URL` é opcional. A interface usa o canal somente quando configurado.
- `MAXDISTRIB_PORTAL_ENABLED=1` ativa a API e o acesso pela vitrine.

Execute `npm install`, `npm run migrate` e `npm test`. Aplique a migração primeiro em homologação. O script `npm run create-admin` recebe `MAXDISTRIB_ADMIN_EMAIL`, `MAXDISTRIB_ADMIN_PASSWORD`, `MAXDISTRIB_ADMIN_NAME` e `MAXDISTRIB_ADMIN_PHONE` do ambiente restrito em que é executado. Essas variáveis são necessárias só no provisionamento da conta administrativa.

Cadastre SKUs, disponibilidade e preços confirmados em Produtos e preços. O painel oferece consulta às condições e à fonte dos encartes durante o cadastro. A base começa vazia. Os dados demonstrativos e os preços públicos dos encartes ficam na vitrine. Preços promocionais operacionais exigem identificação do SKU, validade e disponibilidade confirmadas. As faixas de atacado restritas só são retornadas para contas aprovadas.

## Pedidos e estoque

O checkout salva a solicitação com os preços revisados e o endereço da conta. O estoque é validado no envio e reservado na confirmação. A expedição baixa o saldo e a reserva na mesma transação. Cancelamentos antes do envio liberam a reserva. O histórico registra mudanças de status e movimentações.

A automação testa uma instância PostgreSQL descartável. O teste não se conecta à produção nem envia e-mails. Execute `npm run build` para preparar os arquivos públicos em `dist`. As fontes do servidor e das migrações ficam fora da pasta pública.

A validação no navegador usa `npm run test:browser` após o build, com PostgreSQL isolado. Para os endereços de estoque e vendedor, os atalhos operacionais aparecem somente com o portal habilitado.
