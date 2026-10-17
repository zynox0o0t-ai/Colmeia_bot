# Colmeia Bot — Filas 1x1 / 2x2 / 3x3 / 4x4

Bot de Discord para filas de apostas estilo Colmeia APP. Cobre o fluxo
inteiro: painéis de fila, tópico privado de confirmação, fila de
mediadores, ficha da partida, Pix/QR do mediador, sala (ID e senha),
finalização com vencedor, rankings, tickets de suporte/reembolso,
blacklist e painéis de apoio (tela por Google Meet, salas automáticas).

## Como funciona uma partida

1. Um admin posta o painel (`!painel1x1`, `!painel2x2`, ...). Os
   jogadores entram nas filas pelos botões.
2. A fila **fecha com 2 jogadores** (em qualquer formato). O bot cria um
   tópico privado `aguardando-<número>` no canal definido em
   `CANAL_FILAS_ID`, adiciona os jogadores e já sorteia o mediador (o
   primeiro da fila de mediadores; depois ele vai para o fim da fila,
   em revezamento). O mediador entra no tópico, mas só é revelado na
   ficha.
3. Cada jogador clica **Confirmar** (uma vez só). O bot avisa quem
   confirmou e quem falta. Qualquer jogador pode **Cancelar**.
4. Quando os 2 confirmam, o bot apaga os avisos de confirmação, renomeia
   o tópico para `fila-<número>` e manda, em ordem:
   - notificação "✅ Partida Confirmada!" (some em 2 segundos);
   - **ficha da partida**: Jogadores, Mediador, Formato e Taxa de
     Inscrição, com botões **Regras**, **QR** e **Cancelar** e o menu
     **Finalizar Aposta**;
   - bloco **Valor** + **Chave Pix** do mediador (valor da fila +
     `ACRESCIMO_MEDIADOR`);
   - aviso "📢 MUDOU A FORMA DE MOSTRAR A TELA" (Google Meet);
   - card de regras padrão.
5. O mediador manda o **ID** (9 dígitos) sozinho numa mensagem e depois a
   **senha** (2 a 4 dígitos) sozinha na seguinte. O bot cria o card
   "🎮 ID e Senha" (botões **Copiar ID** e **Trocar Valor**), renomeia o
   tópico para `pagar-R$X,00💰` e manda o aviso "Análises funcionando".
   Só mediador/CEO ativa a sala, e só uma vez por partida. O comando
   `.cs` (mediador/CEO) apenas renomeia o tópico para `pagar-...`.
6. Para encerrar, o mediador usa **Finalizar Aposta**: escolhe o
   vencedor (só ele vê esses passos) e depois **Vencedor por W.O.** ou
   **Vencedor por Vitória**. O bot registra +1 vitória para o vencedor,
   registra o ganho do mediador no ranking-adm, manda a mensagem de
   aposta finalizada e **exclui o tópico na hora**.

O botão **Cancelar** da ficha só funciona para o mediador da partida
(ou quem tem acesso de mediador). Ele posta "❌ Partida cancelada",
remove os jogadores do tópico e exclui o tópico.

Quem não tem acesso tenta usar essas opções: na 1ª e na 2ª vez recebe um
aviso diferente; da 3ª em diante o clique é ignorado em silêncio.

## Comandos de painéis

Exigem a permissão **Gerenciar Canais**, salvo indicação. O comando é
apagado depois de postar o painel.

### Filas de jogadores

```
!painel1x1 | !painel2x2 | !painel3x3 | !painel4x4
!painel1x1 R$2,00                valor da fila
!painel4x4 misto R$5,00          variante + valor
!painel4x4 emu 5                 variante + valor
```

- Sem variante, o rótulo é "1x1 Mobile". Com `misto` ou `emu`, o rótulo
  vira "1x1 Misto", "4x4 Emu" etc.
- Cada comando cria **um** painel independente (com fila própria). Tudo
  que vier depois da variante vira o valor do painel. Sem valor, usa
  `VALOR_APOSTA`.
- **1x1**: botões **Gel Normal** e **Gel Inf**.
- **2x2/3x3/4x4 sem `misto`**: um botão **Entrar**.
- **2x2/3x3/4x4 com `misto`**: botões "1 Emu", "2 Emu"... (2x2 = 1,
  3x3 = 2, 4x4 = 3).
- Regras de entrada: precisa haver mediador na fila; a pessoa só pode
  estar em 1 fila por painel e em no máximo **2 filas ao mesmo tempo**
  (somando todos os painéis).
- Os painéis ficam salvos em `paineis-fila.json` e continuam
  funcionando depois de reiniciar o bot.

### Mediadores e Pix

| Comando | O que faz | Quem usa |
|---|---|---|
| `!painelmediador` | Fila de mediadores (Entrar/Sair) | Gerenciar Canais |
| `!painelpix` | Cadastro de Pix do mediador | Gerenciar Canais |
| `!addmediador @pessoa chavepix` | Cadastra Pix de alguém | Gerenciar Servidor |
| `!removermediador @pessoa` | Remove o cadastro | Gerenciar Servidor |
| `!listamediadores` | Lista cadastros | Gerenciar Servidor |
| `!addmediadoracesso @pessoa` | Dá acesso de mediador sem cargo | CEO/dono |
| `!removermediadoracesso @pessoa` | Tira esse acesso | CEO/dono |
| `!listamediadoresacesso` | Lista quem tem esse acesso | CEO/dono |

**Fila de mediadores:** lista em ordem de chegada. Para entrar, a pessoa
precisa ter a chave Pix cadastrada. Dá para postar mais de um painel (os
títulos ficam numerados e todos mostram a mesma fila). Quem fica
**offline** ou **sai do servidor** é removido da fila automaticamente. O
tempo na fila conta como "horas trabalhando" no ranking-adm.

**Painel de Pix:** botões **Cadastrar Pix**, **Verificar Cadastro**,
**Gerar Novo Pix** (substitui a chave) e **Excluir Pix**. O formulário
pede chave (obrigatória), nome e link de imagem do QR (opcionais). Só
CEO ou mediador usa. Regra de validação: se a chave tiver `@`, tem que
ser um e-mail `@gmail.com`; qualquer outro formato é aceito. Sem link de
QR, o botão **QR** da ficha gera um QR a partir da chave, com a logo no
meio.

### Cargos e acessos

Exigem **Gerenciar Servidor**. A resposta vai na DM de quem usou. O que
for configurado por comando fica salvo em `config-cargos.json`, vale na
hora e tem prioridade sobre o `.env`.

```
!setcargoceo @cargo
!setcargomediador @cargo
!setcargosuporte @cargo
!vercargos
```

- **CEO** (cargo `CEO_ROLE_ID` ou o usuário `DONO_USER_ID`) tem acesso de
  mediador a tudo, mais os comandos de CEO.
- **Mediador** (cargo `MEDIADOR_ROLE_ID` ou lista de `!addmediadoracesso`)
  pode cadastrar Pix, finalizar, cancelar, trocar valor e ativar sala.
- **Suporte** (cargo `SUPORTE_ROLE_ID`) atende tickets e usa a fila de
  suporte.

### Rankings

| Comando | O que mostra | Quem posta |
|---|---|---|
| `!painelranking` | Vitórias dos jogadores (Meu Perfil / Ranking) | Gerenciar Canais |
| `!painelrankingadm` | Ganhos e horas dos mediadores | Gerenciar Servidor |
| `!painelrankingsuporte` | Atendimentos do suporte | Gerenciar Canais |

- Cada fila finalizada rende ao mediador `ACRESCIMO_MEDIADOR` no
  ranking-adm (top 10 semanal, mensal e total, com coroa no 1º).
- O "Meu Perfil" do mediador tem filtros **Hoje / 3 dias / 7 dias**.
- Os dados ficam em `ranking.json`, `ranking-adm.json` e
  `ranking-suporte.json`.

### Atendimento (tickets) e suporte

- `!painelticket` — menu **Suporte / Reembolso**.
  - **Reembolso**: formulário (chave Pix, nome, valor) e abre tópico
    privado marcando o cargo de suporte.
  - **Suporte**: pergunta o problema (regras, pagamento, bug, denúncia
    ou outros) e abre o tópico. Em **Outros**, em vez de abrir tópico, o
    bot avisa o cargo de suporte em `CANAL_AVISO_SUPORTE_ID`.
  - Dentro do ticket, o suporte usa **Resolvido** (conta como
    atendimento no ranking e exclui o tópico) e, no reembolso,
    **Informar por Nome**.
- `!painelfilasuporte` — fila de suporte (Entrar/Sair). Exige cargo de
  suporte e Pix de suporte cadastrado. Também sai sozinha quando a pessoa
  fica offline.
- `!painelpixsuporte` — cadastro de Pix do suporte.

### Blacklist

- `!painelblacklist` — botão **Verificar ID** (qualquer pessoa consulta).
- `!addblacklist <id> [motivo]` e `!removeblacklist <id>` — só mediador/CEO.
- Os IDs ficam em `blacklist.json`.

### Apoio (só CEO)

- `!paineltela` — painel **Google Meet**: abre um tópico privado com o
  passo a passo da análise por tela (botão **Sair** fecha o tópico).
- `!painelsalasbot` — painel de salas automáticas (**Criar Sala** /
  **Salas Restantes**). Abre um tópico que pede para digitar `.painel`
  ou `.s` e se apaga sozinho em 3 minutos.
- `!mudoutela` — posta o aviso "MUDOU A FORMA DE MOSTRAR A TELA".

### Textos prontos (Gerenciar Servidor)

`!regras`, `!regrasadm`, `!termosadm`, `!termossuporte`,
`!regrassuporte` e `!regrasblacklist` postam os respectivos textos em
cards amarelos.

## Instalação

```bash
npm install
npm install jimp@0.22.12
npm start
```

O `index.js` usa `discord.js`, `qrcode` e `jimp`. Se o seu
`package.json` ainda não lista o `jimp`, instale-o como acima (a API
usada é a da versão 0.22.x).

## Configuração

### 1) Criar o bot

No https://discord.com/developers/applications, em **Bot**, ative as
três intents privilegiadas:

- **Message Content Intent**
- **Server Members Intent** (cargos e entrada de membros)
- **Presence Intent** (tirar mediador/suporte da fila quando ficam offline)

### 2) Permissões do bot (OAuth2 → URL Generator, scope `bot`)

- Ver Canais, Enviar Mensagens, Inserir Links, Ver Histórico de Mensagens
- Gerenciar Mensagens e Gerenciar Canais
- Criar Tópicos Privados e Gerenciar Tópicos
- Gerenciar Emojis e Figurinhas (para criar os emojis automáticos)
- Gerenciar Cargos (só se usar `MEMBRO_ROLE_ID`; o cargo do bot precisa
  estar acima do cargo de membro)

### 3) Variáveis de ambiente

```bash
export DISCORD_TOKEN="seu_token_aqui"
export VALOR_APOSTA="R$1,00"            # valor padrão quando o painel é criado sem valor
export ACRESCIMO_MEDIADOR="0.50"        # somado ao valor da fila (Valor pago ao mediador) e ganho por fila no ranking-adm; use ponto
export REGRAS_URL="https://seulink.com/regras"
export CHAVE_PIX_PADRAO="email@gmail.com"   # usada se o mediador da partida não tiver Pix
export CANAL_FILAS_ID="id_do_canal"         # canal onde os tópicos das partidas são criados
export CANAL_AVISO_SUPORTE_ID="id_do_canal" # aviso de tickets "Outros"

# Cargos e acessos (também dá para configurar por comando no Discord)
export CEO_ROLE_ID="id_do_cargo"
export MEDIADOR_ROLE_ID="id_do_cargo"
export SUPORTE_ROLE_ID="id_do_cargo"
export MEMBRO_ROLE_ID="id_do_cargo"         # cargo dado a quem entra no servidor
export DONO_USER_ID="id_do_seu_usuario"     # acesso de emergência de CEO/mediador

# Emojis (opcional). Se definidos, o bot não cria os automáticos
export EMOJI_GEL="<:nome:ID>"
export EMOJI_SAIR="<:nome:ID>"
```

Existem outras variáveis `EMOJI_*` e `EMOJI_*_IMAGEM_URL` para trocar
cada emoji ou a imagem usada para criá-lo (veja o topo do `index.js`).
Na primeira vez que liga, o bot procura emojis do servidor com nomes
como `gelo`, `saida`, `finalizar`, `coroa_1`, `trofeus`, `ranking`,
`org_colmeia` e `colmeia_1`, e cria os que faltarem. Imagens do Google
Drive precisam estar no formato `https://drive.google.com/uc?export=view&id=ID`
e compartilhadas como "Qualquer pessoa com o link".

Para copiar IDs, ative o **Modo Desenvolvedor** no Discord
(Configurações → Avançado) e use **Copiar ID**.

## Arquivos de dados

Ficam na mesma pasta do bot e não precisam ser editados à mão:

| Arquivo | Conteúdo |
|---|---|
| `partidas.json` | Partidas em andamento (sobrevivem a reinício) |
| `paineis-fila.json` | Painéis de fila e quem está em cada um |
| `mediadores.json` | Pix dos mediadores |
| `mediadores-extras.json` | Acessos de mediador por comando |
| `config-cargos.json` | Cargos configurados por comando |
| `ranking.json` | Vitórias dos jogadores |
| `ranking-adm.json` | Horas e ganhos dos mediadores |
| `ranking-suporte.json` | Horas e atendimentos do suporte |
| `suporte-pix.json` | Pix do suporte |
| `blacklist.json` | IDs na blacklist |

As filas de mediadores e de suporte ficam só em memória: se o bot
reiniciar, elas esvaziam e os painéis antigos deixam de atualizar (é
preciso postar de novo e entrar de novo na fila).

## Observações

- **Segurança:** nunca compartilhe o `DISCORD_TOKEN` (prints,
  repositórios). Se vazar, use **Bot → Reset Token**.
- **Hospedagem:** em serviços sem volume persistente (como o plano
  gratuito do Railway), os arquivos `.json` somem quando o serviço
  reinicia ou é reimplantado. Para não perder cadastros e rankings, use
  um volume persistente.
