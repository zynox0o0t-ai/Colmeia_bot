# Colmeia Bot — Filas 1x1 / 2x2 / 3x3 / 4x4

Bot de filas de apostas para Discord: filas de jogadores (1x1 a 4x4),
fila de mediadores, cadastro de Pix, rankings, tickets de suporte,
blacklist e painéis de análise de tela.

## O que o bot faz

- **Filas de jogadores** nos formatos 1x1, 2x2, 3x3 e 4x4 (Gel Normal /
  Gel Inf), com variante opcional **misto** ou **emu**.
- **Confirmação por tópico privado**: quando a fila fecha, o bot cria um
  tópico, adiciona os jogadores e pede para todos confirmarem.
- **Fila de mediadores** (entrar/sair, em ordem de chegada). O primeiro da
  fila é sorteado como mediador da partida.
- **Ficha da partida** (Regras / QR / Cancelar), chave Pix do mediador e
  QR code gerado automaticamente.
- **Finalizar Aposta** (só mediador): escolhe o vencedor, por W.O. ou por
  vitória, e registra no ranking.
- **Rankings**: vitórias dos jogadores, horas e ganhos dos mediadores,
  ranking do suporte.
- **Suporte**: painel de tickets (Suporte / Reembolso), fila de suporte e
  cadastro de Pix do suporte.
- **Blacklist** de IDs e painel de análise de tela por Google Meet.
- **Emojis personalizados automáticos** subidos pelo bot na primeira vez
  que ele liga.
- **Cargo de Membro automático** para quem entra no servidor (opcional).

## Fluxo da fila (`!painel1x1`, `!painel2x2`, `!painel3x3`, `!painel4x4`)

1. Digite o comando no canal. Exemplos:
   ```
   !painel1x1
   !painel1x1 R$2,00
   !painel4x4 misto R$5,00
   !painel2x2 emu
   ```
   - Formato: `1x1` (2 jogadores), `2x2` (4), `3x3` (6) ou `4x4` (8).
   - Variante opcional: `misto` ou `emu` (só muda o rótulo).
   - Valor opcional: tudo que vier depois vira o valor da fila. Se não
     digitar nada, usa o `VALOR_APOSTA` configurado.
   - Cada comando cria **um** painel, com a sua própria fila.
2. O botão de entrar na fila só funciona se houver **mediador disponível**
   na fila de mediadores. Senão responde "Não há mediadores disponíveis
   no momento."
3. Quando a fila fecha, o bot cria um **tópico privado**
   `aguardando-<número>`, adiciona os jogadores e manda o embed com
   **Confirmar / Cancelar**.
4. Quando **todos confirmam**:
   - os botões somem e aparece "Partida Confirmada!" (some em 3 segundos);
   - o bot pega o **primeiro mediador da fila** e o tira dela;
   - aparece a **ficha da partida** (Jogadores, Mediador, Formato, Taxa de
     Inscrição) com botões **Regras**, **QR** e **Cancelar**;
   - aparece o **Valor** e a **Chave Pix** do mediador. O valor é o valor
     da fila + `ACRESCIMO_MEDIADOR` (padrão R$0,50);
   - aparece o aviso "Mudou a forma de mostrar a tela".
5. Se um jogador mandar o ID e a senha da sala, o bot avisa
   "Aguardando pagamento" (uma vez por partida).
6. **Finalizar Aposta** (só mediador): escolhe o vencedor, depois
   **Vencedor por W.O.** ou **Vencedor por Vitória**. O vencedor ganha
   +1 vitória no ranking, o mediador ganha o valor no ranking-adm, e o
   tópico é arquivado e trancado 1 minuto depois.
7. **Cancelar** (em qualquer etapa): contagem regressiva, remove os
   jogadores e exclui o tópico.
8. **QR**: se o mediador cadastrou um link de QR próprio, o bot mostra
   essa imagem. Senão, gera um QR a partir da chave Pix dele.

## Lista de comandos

Quem pode usar:
- **Permissão de painel** = "Gerenciar Canais".
- **Admin** = "Gerenciar Servidor".
- **CEO** = quem tem o cargo de CEO (ou o dono configurado em
  `DONO_USER_ID`).

### Painéis de fila e pagamento
| Comando | O que faz | Quem |
|---|---|---|
| `!painel1x1` / `2x2` / `3x3` / `4x4` | Painel de fila de jogadores | Gerenciar Canais |
| `!painelmediador` | Fila de mediadores (Entrar / Sair / limpar) | Gerenciar Canais |
| `!painelpix` | Cadastro de Pix dos mediadores | Gerenciar Canais |

### Rankings
| Comando | O que faz | Quem |
|---|---|---|
| `!painelranking` | Ranking de vitórias dos jogadores | Gerenciar Canais |
| `!painelrankingadm` | Ranking de horas e ganhos dos mediadores | Admin |
| `!painelrankingsuporte` | Ranking do suporte | Gerenciar Canais |

### Suporte
| Comando | O que faz | Quem |
|---|---|---|
| `!painelticket` | Painel de atendimento (Suporte / Reembolso) | Gerenciar Canais |
| `!painelfilasuporte` | Fila de suporte (Entrar / Sair) | Gerenciar Canais |
| `!painelpixsuporte` | Cadastro de Pix do suporte | Gerenciar Canais |

### Análise de tela e blacklist
| Comando | O que faz | Quem |
|---|---|---|
| `!paineltela` | Painel de análise por Google Meet | Gerenciar Canais |
| `!painelsalasbot` | Painel de salas automáticas (criar / estoque) | Gerenciar Canais |
| `!painelblacklist` | Painel para verificar um ID na blacklist | Gerenciar Canais |
| `!addblacklist <id> [motivo]` | Adiciona um ID na blacklist | Mediador / CEO |
| `!removeblacklist <id>` | Remove um ID da blacklist | Mediador / CEO |
| `!mudoutela` | Posta o aviso "Mudou a forma de mostrar a tela" | CEO |

### Textos de regras (cada um posta vários cards no canal)
| Comando | Conteúdo | Quem |
|---|---|---|
| `!regras` | Regras gerais | Admin |
| `!regrasadm` | Diretrizes para ADM / Mediador | Admin |
| `!termosadm` | Termos financeiros e de organização | Admin |
| `!regrassuporte` | Regras do time de suporte / reembolso | Admin |
| `!termossuporte` | Categorias de ticket e termos do suporte | Admin |
| `!regrasblacklist` | Regulamento de análise / blacklist | Admin |

### Cargos e acessos (valem na hora, sem reiniciar o bot)
| Comando | O que faz | Quem |
|---|---|---|
| `!setcargoceo @cargo` | Define o cargo de CEO | Admin |
| `!setcargomediador @cargo` | Define o cargo de Mediador | Admin |
| `!setcargosuporte @cargo` | Define o cargo de Suporte | Admin |
| `!vercargos` | Mostra os cargos configurados agora | Admin |
| `!addmediadoracesso @pessoa` | Dá acesso de mediador sem precisar do cargo | CEO |
| `!removermediadoracesso @pessoa` | Remove esse acesso | CEO |
| `!listamediadoresacesso` | Lista quem tem esse acesso | CEO |

### Cadastro manual de mediador (Pix)
| Comando | O que faz | Quem |
|---|---|---|
| `!addmediador @pessoa chavepix` | Cadastra a chave Pix de alguém | Admin |
| `!removermediador @pessoa` | Remove o cadastro | Admin |
| `!listamediadores` | Lista os mediadores cadastrados | Admin |

## Fila de mediadores (`!painelmediador`)

Mostra a lista numerada de quem está na fila, em ordem de chegada, e os
botões:
- **Entrar**: o mediador entra no fim da fila.
- **Sair**: o mediador sai da fila.
- **⚙️**: limpa a fila inteira (só quem tem "Gerenciar Servidor").

Se a fila estiver vazia quando a partida confirmar, a ficha mostra
"Nenhum mediador disponível no momento." Se `MEDIADOR_ROLE_ID` estiver
configurado, só quem tem esse cargo consegue entrar na fila.

Quem sai do servidor sai das filas de staff automaticamente.

## Painel de cadastro de Pix (`!painelpix`)

- **Cadastrar Pix**: formulário com a chave Pix (obrigatória), o nome
  (opcional) e o link da imagem do QR Code (opcional). O bot valida a
  chave (e-mail, CPF, CNPJ, telefone ou chave aleatória) e avisa se
  houver erro.
- **Verificar Cadastro**: mostra só para quem clicou o cartão com os
  dados cadastrados.
- **Tutorial**: abre o link de `TUTORIAL_URL`.

Cada pessoa só vê e edita o próprio cadastro.

## Requisitos

```bash
npm install
```
O `package.json` já inclui `discord.js`, `qrcode` e `jimp`.

> ⚠️ O `jimp` precisa ficar na série `0.22.x`. As versões 1.x mudaram a
> forma de usar e o código não funciona com elas.

## Configuração

### 1) Criar o bot
- https://discord.com/developers/applications
- Em **Bot**, ative as **3 Intents** e toque em Save Changes:
  - **Presence Intent**
  - **Server Members Intent**
  - **Message Content Intent**

Se alguma estiver desligada, o bot cai com o erro
"Used disallowed intents".

### 2) Permissões (OAuth2 → URL Generator, scope `bot`)
- Ver Canais
- Enviar Mensagens
- Gerenciar Canais
- Gerenciar Mensagens
- Inserir Links
- Ver Histórico de Mensagens
- **Criar Tópicos Privados**
- **Gerenciar Tópicos**
- **Gerenciar Emojis e Figurinhas** (para subir os emojis automáticos)
- **Gerenciar Cargos** (só se usar `MEMBRO_ROLE_ID`; o cargo do bot
  precisa ficar **acima** do cargo de Membro na lista de cargos)

### 3) Variáveis de ambiente (no Railway: aba Variables)

**Obrigatória:**
```bash
DISCORD_TOKEN="seu_token_aqui"      # também aceita o nome TOKEN
```

**Principais (opcionais):**
```bash
VALOR_APOSTA="R$1,00"               # Taxa de Inscrição padrão
ACRESCIMO_MEDIADOR="0.50"           # somado ao valor da fila (use ponto)
REGRAS_URL="https://..."            # link do botão Regras
TUTORIAL_URL="https://..."          # link do tutorial de Pix
CHAVE_PIX_PADRAO="email@exemplo.com"  # usada se o mediador não cadastrou
```

**Cargos e donos (opcionais):**
```bash
MEDIADOR_ROLE_ID=""    # cargo de mediador (vazio = qualquer pessoa)
CEO_ROLE_ID=""         # cargo de CEO
SUPORTE_ROLE_ID=""     # cargo de suporte
MEMBRO_ROLE_ID=""      # cargo dado automaticamente a quem entra
DONO_USER_ID=""        # ID de USUÁRIO com acesso total de emergência
CEO_USER_ID=""         # ID de usuário do CEO
```
Os cargos também podem ser definidos pelos comandos `!setcargoceo`,
`!setcargomediador` e `!setcargosuporte`, sem reiniciar o bot.

**Canais (opcionais, mas veja o aviso abaixo):**
```bash
CANAL_FILAS_ID=""             # canal onde os tópicos das partidas são criados
CANAL_AVISO_SUPORTE_ID=""     # canal de aviso de ticket "Outros"
```

> ⚠️ Se você não definir `REGRAS_URL`, `CANAL_FILAS_ID` e
> `CANAL_AVISO_SUPORTE_ID`, o código usa valores padrão de **outro
> servidor**. Para o seu servidor, defina os três com os IDs/links do
> seu próprio Discord.

**Emojis (opcionais):** todos os `EMOJI_*` e `EMOJI_*_IMAGEM_URL` abaixo
são opcionais. Se você definir o emoji (formato `<:nome:ID>`), o bot não
tenta criar o automático. Se definir só a imagem, o bot usa ela para
criar o emoji.
```bash
EMOJI_GEL, EMOJI_SAIR, EMOJI_FINALIZAR, EMOJI_COROA, EMOJI_COROA_2,
EMOJI_TROFEU, EMOJI_RANKING, EMOJI_PC, EMOJI_ORG, EMOJI_COLMEIA1,
EMOJI_QR, EMOJI_DINDIN, EMOJI_PROGRESSO, EMOJI_MNRAMIO, EMOJI_GIRO,
EMOJI_GIRO_OURO, EMOJI_ENTRA, EMOJI_COPIAR, EMOJI_INFO

EMOJI_GEL_IMAGEM_URL, EMOJI_SAIR_IMAGEM_URL, EMOJI_FINALIZAR_IMAGEM_URL,
EMOJI_COROA_IMAGEM_URL, EMOJI_TROFEU_IMAGEM_URL,
EMOJI_RANKING_IMAGEM_URL, EMOJI_ORG_URL, EMOJI_COLMEIA1_URL,
EMOJI_ABELHAS_URL
```

> ⚠️ Links de imagem do Google Drive precisam estar no formato direto
> `https://drive.google.com/uc?export=view&id=ID_DO_ARQUIVO` e o arquivo
> precisa estar compartilhado como **"Qualquer pessoa com o link"**.

Para pegar um ID: ative o **Modo Desenvolvedor** no Discord
(Configurações → Avançado), depois toque e segure o cargo, canal ou
perfil e escolha **Copiar ID**.

### 4) Rodar
```bash
npm start
```
No Railway isso é automático depois de cada commit no GitHub.

## Personalizações fáceis (topo do `index.js`)

- `VALOR_APOSTA`, `ACRESCIMO_MEDIADOR`, `NOME_MODALIDADE`, `NOME_ORG`
- `COR_AMARELA`: cor da barra lateral dos embeds da fila
- `COR_DOURADA`: cor da barra do painel/cartão de cadastro Pix
- `REGRAS_URL`, `TUTORIAL_URL`, `MEDIADOR_ROLE_ID`, `PIX_PADRAO`
- `LINK_ANDROID`, `LINK_IOS`, `LINK_WINDOWS`

> O Discord só permite uma cor sólida por embed.

## Arquivos de dados

O bot salva os dados em arquivos `.json` na mesma pasta dele, entre eles:
`mediadores.json`, `ranking.json` e `ranking-adm.json`. Não precisa
editar código para isso.

> ⚠️ No Railway **sem volume persistente**, esses arquivos podem ser
> apagados quando o serviço reinicia ou reimplanta (cadastros de Pix,
> rankings, blacklist e cargos configurados por comando). Para não perder
> os dados, crie um **Volume** no Railway ou migre para um banco de dados.

## Segurança

Nunca compartilhe o seu `DISCORD_TOKEN` (nem em prints, nem no GitHub).
Se ele vazar, gere outro na hora: **Bot → Reset Token**, e atualize a
variável no Railway.
