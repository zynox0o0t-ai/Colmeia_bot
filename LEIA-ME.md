# Colmeia Bot — Fila 1x1

Bot completo de fila 1x1: confirmação por tópico privado, **fila de
mediadores** (entrar/sair, em ordem de chegada), ficha da partida
(Regras / QR / Cancelar), contagem regressiva de cancelamento, aviso de
troca de app de tela, e um **painel de autocadastro de Pix** onde cada
mediador cadastra a própria chave.

## Novidades desta versão

- **Emojis personalizados automáticos:** o bot sobe sozinho, na primeira
  vez que liga, duas imagens como emoji do servidor (uma pro botão de
  fila, outra pro botão Sair) e já usa elas nos botões do painel — não
  precisa mais fazer isso manualmente. Pra isso funcionar, o bot precisa
  da permissão **"Gerenciar Emojis e Figurinhas"** no servidor. Se você
  preferir subir/trocar a imagem manualmente, defina `EMOJI_GEL` e
  `EMOJI_SAIR` (formato `<:nome:ID>`) nas variáveis de ambiente — aí o
  bot nem tenta criar as automáticas.
- **Fila só abre com mediador disponível:** se ninguém estiver na fila
  de mediadores (`!painelmediador`) no momento, o botão de entrar na
  fila (Gel Normal/Gel Inf) responde **"🚫 Não há mediadores disponíveis
  no momento."** em vez de deixar a pessoa entrar.
- **Tópico nasce como "aguardando":** quando a fila fecha (2
  jogadores), o tópico privado agora é criado com o nome
  `aguardando-<número aleatório>` (antes era `fila-<número>`).
- **Aviso de aguardando pagamento:** dentro do tópico da partida, se um
  dos 2 jogadores mandar o ID e a senha da sala do Free Fire, o bot
  identifica automaticamente (heurística: uma sequência de 6+ dígitos
  junto com mais alguma informação na mensagem) e manda um aviso
  **"⏳ Aguardando pagamento"** mostrando o valor da taxa de inscrição da
  fila. Isso acontece só uma vez por partida.
- **Finalizar Aposta / Definir Vencedor (só mediador):** logo abaixo da
  ficha da partida aparece um menu **"Selecione uma opção"** com a opção
  **Finalizar Aposta**. Só quem tem o cargo configurado em
  `MEDIADOR_ROLE_ID` pode usar esse menu e os que vêm depois dele. Ao
  clicar:
  1. Aparece **"Escolha o vencedor"**, com os 2 jogadores como opções —
     nome em destaque e o ID dele logo abaixo, menor.
  2. Ao escolher o jogador, aparece **"Vencedor Definido"**.
  3. Em seguida, outro menu pergunta **Vencedor por W.O.** ou
     **Vencedor por Vitória**. Qualquer uma das duas: o vencedor ganha
     **+1 vitória** no ranking (arquivo `ranking.json`) e aparece
     **"✅ Partida Encerrada"** (ou **"✅ Partida Encerrada por W.O."**).
     O tópico é arquivado e trancado automaticamente 1 minuto depois.

## Fluxo da fila (`!painel1x1`)

1. `!painel1x1` no canal → painel com **Gel Normal** / **Gel Inf** / **Sair**.

   Pra definir o valor da fila na hora, digite o valor junto do comando:
   ```
   !painel1x1 R$2,00
   ```
   Esse valor fica valendo até você rodar o comando de novo com outro
   valor (ou reiniciar o bot, aí volta pro valor padrão configurado em
   `VALOR_APOSTA` no Railway). Se digitar só `!painel1x1` sem nada, ele
   usa o último valor que estiver ativo.

   **O valor pago ao mediador se ajusta sozinho:** o campo "Valor:" que
   aparece depois que os 2 jogadores confirmam é sempre = valor da fila
   + `ACRESCIMO_MEDIADOR` (padrão R$0,50). Exemplo: fila de R$2,00 →
   mediador recebe R$2,50. Não precisa configurar isso toda vez, só o
   acréscimo fixo (uma vez, no Railway).
2. Fila fecha (2 jogadores) → bot cria **tópico privado** `fila-<número
   aleatório>`, adiciona os 2 jogadores, manda embed amarelo com
   **Confirmados:** e botões **Confirmar / Cancelar**.
3. Quando **os 2 confirmam**:
   - os botões somem;
   - aparece uma notificação **"✅ Partida Confirmada!"** que se apaga
     sozinha em **3 segundos**;
   - o bot **pega o primeiro mediador da fila** (`!painelmediador`) e o
     remove dela;
   - aparece a **ficha da partida**: Jogadores, Mediador, Formato, Taxa
     de Inscrição — com botões **Regras**, **QR** e **Cancelar**;
   - aparece o bloco **Valor:** / **CHAVE PIX:** com a chave do
     mediador sorteado;
   - por fim aparece o aviso destacado **"📢 MUDOU A FORMA DE MOSTRAR A
     TELA"**.
4. Botão **QR**: se o mediador cadastrou um link de QR code próprio, o
   bot mostra essa imagem; senão gera um QR automático a partir da
   chave Pix dele.
5. Botão **Cancelar** (em qualquer etapa): contagem regressiva no chat
   (*Cancelado em 3... 2... 1...*), remove os 2 jogadores do tópico (o
   Discord gera sozinho a mensagem nativa **"Colmeia Bot removeu
   @fulano do tópico"**) e o tópico é excluído.

## Fila de mediadores (`!painelmediador`)

Poste esse painel num canal visível pra mediadores (ex: `fila-mediador`):
```
!painelmediador
```

Mostra:
- **🎮 Filas dos Mediadores** — lista numerada de quem está na fila
  agora (ex: `1. @Fulano`, `2. @Ciclano`), em ordem de chegada.
- **Entrar** — o mediador entra no fim da fila.
- **Sair** — o mediador sai da fila (se estiver nela).
- **⚙️** — só quem tem permissão **"Gerenciar Servidor"**: limpa a fila
  inteira.

Quando uma partida é confirmada (fluxo do `!painel1x1`), o bot pega
automaticamente o **primeiro da fila** como mediador daquela partida, e
remove ele da fila (o painel se atualiza sozinho). Se a fila estiver
vazia nesse momento, a ficha da partida mostra **"Nenhum mediador
disponível no momento."** em vez de travar ou dar erro.

Se você configurar `MEDIADOR_ROLE_ID`, só quem tem esse cargo consegue
clicar em **Entrar**. Se deixar essa variável vazia, qualquer pessoa
pode entrar na fila.

## Painel de cadastro de Pix (`!painelpix`)

Poste esse painel num canal visível pra staff/mediadores (`!painelpix`).
Ele mostra 3 botões:

- **Cadastrar Pix** → abre um formulário dentro do próprio Discord com:
  - *Informe a chave PIX* (obrigatório)
  - *Informe seu nome* (opcional — nome que aparece na hora do pagamento)
  - *Link da imagem do QR Code* (opcional — se não preencher, o bot gera
    automaticamente quando precisar)
- **Verificar Cadastro** → mostra só pra quem clicou um cartão dourado
  com a foto de perfil, nome e chave Pix cadastrados, mais um botão de
  **Regras**.
- **Tutorial** → abre o link configurado em `TUTORIAL_URL`.

Cada pessoa só vê e edita o próprio cadastro — não precisa admin fazer
nada manualmente.

### Cadastro manual (opcional, feito por admin)

Se precisar cadastrar por alguém (só quem tem permissão **"Gerenciar
Servidor"**):
```
!addmediador @pessoa chavepix
!removermediador @pessoa
!listamediadores
```

## Requisitos

```bash
npm install
```
(já inclui `discord.js` e `qrcode` no `package.json`)

## Configuração

### 1) Criar o bot
- https://discord.com/developers/applications
- Em **Bot** → ative **Message Content Intent** E **Server Members
  Intent** (necessário pra sortear o mediador pelo cargo).

### 2) Permissões (OAuth2 → URL Generator, scope `bot`)
- Ver Canais
- Enviar Mensagens
- Gerenciar Canais
- Gerenciar Mensagens
- Inserir Links
- Ver Histórico de Mensagens
- **Criar Tópicos Privados**
- **Gerenciar Tópicos**
- **Gerenciar Emojis e Figurinhas** (necessário só pra subir os emojis
  personalizados automaticamente na primeira vez que o bot liga)

### 3) Variáveis de ambiente
```bash
export DISCORD_TOKEN="seu_token_aqui"
export VALOR_APOSTA="R$1,00"          # Taxa de Inscrição
export ACRESCIMO_MEDIADOR="0.50"       # some ao valor da fila pra calcular o "Valor:" pago ao mediador (use ponto, ex: "1.00" = R$1,00)
export REGRAS_URL="https://seulink.com/regras"
export TUTORIAL_URL="https://seulink.com/tutorial-pix"
export MEDIADOR_ROLE_ID="id_do_cargo_de_mediador"   # opcional — quem pode clicar Entrar na fila de mediadores
export CHAVE_PIX_PADRAO="colmeia.org@gmail.com"  # usada se o mediador sorteado ainda não se cadastrou
export EMOJI_GEL="<:nome:ID>"          # opcional — pula a criação automática do emoji da fila
export EMOJI_SAIR="<:nome:ID>"         # opcional — pula a criação automática do emoji de Sair
export EMOJI_GEL_IMAGEM_URL="https://..."   # opcional — troca a imagem usada pra criar o emoji da fila
export EMOJI_SAIR_IMAGEM_URL="https://..."  # opcional — troca a imagem usada pra criar o emoji de Sair
```

> ⚠️ As URLs de imagem do Google Drive precisam estar no formato direto
> `https://drive.google.com/uc?export=view&id=ID_DO_ARQUIVO` (não o link
> `.../file/d/ID/view`) e o arquivo precisa estar compartilhado como
> **"Qualquer pessoa com o link"**, senão o Discord não consegue baixar
> a imagem pra criar o emoji.

Pra pegar o `MEDIADOR_ROLE_ID`: ative o **Modo Desenvolvedor** no Discord
(Configurações → Avançado), depois toque e segure o cargo em
Configurações do Servidor → Cargos → **Copiar ID**.

### 4) Rodar
```bash
npm start
```
No canal desejado, digite:
- `!painel1x1` ou `!painel1x1 R$2,00` — painel de fila de jogadores
- `!painelmediador` — painel de fila de mediadores (Entrar/Sair)
- `!painelpix` — painel de cadastro de chave Pix dos mediadores

## Personalizações fáceis (topo do `index.js`)

- `VALOR_APOSTA`, `ACRESCIMO_MEDIADOR`, `NOME_MODALIDADE`, `NOME_ORG`
- `COR_AMARELA` — cor da barra lateral dos embeds da fila
- `COR_DOURADA` — cor da barra lateral do painel/cartão de cadastro Pix
- `REGRAS_URL`, `TUTORIAL_URL`, `MEDIADOR_ROLE_ID`, `PIX_PADRAO`
- `LINK_ANDROID`, `LINK_IOS`, `LINK_WINDOWS`

> ⚠️ O Discord só permite uma cor sólida por embed — não dá pra fazer
> uma barra "metade de uma cor, metade de outra".

## Observação sobre segurança

Nunca compartilhe seu `DISCORD_TOKEN` publicamente (nem em prints, nem em
repositórios). Se ele aparecer em algum print ou vazar, gere um novo
token imediatamente (**Bot → Reset Token**).

Se você hospedar no Railway no **plano gratuito** (sem volume
persistente), o arquivo `mediadores.json` pode ser apagado quando o
serviço reinicia/reimplanta. Se isso acontecer, me avise que ajusto pra
salvar os dados em outro lugar (ex: um banco de dados simples).
